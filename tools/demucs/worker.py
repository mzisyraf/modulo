"""One bounded local job, executed only by the API's isolated separator process."""

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))
from app.job_lock import exclusive_lock

RATE = 44100
MAX_SECONDS = 295
CHECKPOINT_SHA256 = "34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd"


class SeparatorUnavailable(Exception):
    pass


def decode(source):
    import numpy as np

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=channels,sample_rate:format=format_name", "-of", "json", str(source)],
        capture_output=True, timeout=20, check=True,
    )
    info = json.loads(probe.stdout)
    stream = info["streams"][0]
    if (info["format"]["format_name"] not in {"wav", "mp3"} or stream["channels"] not in (1, 2)
            or not 8000 <= int(stream["sample_rate"]) <= 192000):
        raise ValueError("Unsupported decoded format, channel count or sample rate.")
    decoded = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-map", "0:a:0", "-vn",
         "-t", str(MAX_SECONDS + 1), "-ar", str(RATE), "-ac", "2", "-f", "f32le", "pipe:1"],
        capture_output=True, timeout=45, check=True,
    )
    samples = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, 2).copy()
    if not 10 * RATE <= len(samples) <= MAX_SECONDS * RATE or not np.isfinite(samples).all():
        raise ValueError("Audio must be finite and last 10–295 seconds.")
    if float(np.max(np.abs(samples))) < 1e-5:
        raise ValueError("The decoded song is silent.")
    return samples


def separate(directory, mixture):
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if not torch.cuda.is_available():
        raise SeparatorUnavailable("CUDA is required; there is no CPU fallback.")
    checkpoint = ROOT / "models" / "torch" / "hub" / "checkpoints" / "5c90dfd2-34c22ccb.th"
    digest = hashlib.sha256()
    with checkpoint.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != CHECKPOINT_SHA256:
        raise SeparatorUnavailable("The cached checkpoint does not match the tested model.")
    model = get_model("htdemucs_6s").cpu().eval()
    if (set(model.sources) != {"drums", "bass", "other", "vocals", "guitar", "piano"}
            or model.samplerate != RATE or model.audio_channels != 2):
        raise SeparatorUnavailable("Unexpected separator model contract.")
    wav = torch.from_numpy(mixture.T.copy())
    reference = wav.mean(0)
    mean, deviation = reference.mean(), reference.std()
    if not torch.isfinite(deviation) or deviation <= 1e-8:
        raise ValueError("The song has no usable mono energy for this separator.")
    torch.manual_seed(0)
    with torch.inference_mode():
        stems = apply_model(model, ((wav - mean) / deviation)[None], device="cuda", shifts=1,
                            split=True, overlap=0.25, progress=False, num_workers=0, segment=5)[0]
        stems = (stems * deviation + mean).cpu()
    if tuple(stems.shape) != (6, 2, len(mixture)) or not torch.isfinite(stems).all():
        raise RuntimeError("Invalid separator output.")
    guitar_index = model.sources.index("guitar")
    guitar = stems[guitar_index].T.numpy()
    backing = stems[[index for index in range(6) if index != guitar_index]].sum(0).T.numpy()
    # One gain preserves stem/mix energy ratios and avoids upstream per-stem rescaling.
    peak = max(float(np.abs(mixture).max()), float(stems.abs().max()), float(np.abs(backing).max()))
    gain = 0.9 / max(1.0, peak)
    if not math.isfinite(gain) or gain <= 0:
        raise RuntimeError("Invalid shared output gain.")
    for name, samples in (("mix", mixture), ("guitar", guitar), ("backing", backing)):
        sf.write(directory / f"{name}.wav", samples * gain, RATE, subtype="PCM_16")
        exported, rate = sf.read(directory / f"{name}.wav", dtype="float32", always_2d=True)
        if (exported.shape != mixture.shape or rate != RATE or not np.isfinite(exported).all()
                or float(np.abs(exported).max()) > 0.901):
            raise RuntimeError("Invalid exported audio.")
    report = {"device": torch.cuda.get_device_name(0), "common_gain_linear": gain,
              "model": "htdemucs_6s", "checkpoint_sha256": CHECKPOINT_SHA256,
              "segment_seconds": 5, "export_scaling": "common_gain_pcm16"}
    (directory / "result.json").write_text(json.dumps(report, allow_nan=False), encoding="utf-8")


def main():
    directory = Path(sys.argv[1]).resolve()
    os.environ["TORCH_HOME"] = str(ROOT / "models" / "torch")
    os.environ["PATH"] = str(Path(sys.prefix) / "Library" / "bin") + os.pathsep + os.environ.get("PATH", "")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("Set up the isolated FFmpeg environment.", file=sys.stderr)
        return 3
    try:
        mixture = decode(directory / "source.bin")
    except (ValueError, KeyError, IndexError, subprocess.SubprocessError) as failure:
        print(f"Invalid audio: {failure}", file=sys.stderr)
        return 2
    # This also excludes an orphan worker left running after an API crash/restart.
    lock = exclusive_lock(directory.parent / ".gpu.lock")
    try:
        lock.__enter__()
    except OSError as failure:
        print(f"Local GPU lock unavailable: {failure}", file=sys.stderr)
        return 4
    try:
        separate(directory, mixture)
    except (SeparatorUnavailable, FileNotFoundError, ImportError) as failure:
        print(f"Local separator unavailable: {failure}", file=sys.stderr)
        return 3
    finally:
        lock.__exit__(None, None, None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
