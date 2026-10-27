"""Check local CUDA separation on a generated signal, not musical quality."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from importlib.metadata import version

import numpy as np
import soundfile as sf


def validate_stems(directory, frames, rate):
    stems = {}
    for stem in ("drums", "bass", "other", "vocals", "guitar", "piano"):
        path = directory / f"{stem}.wav"
        samples, output_rate = sf.read(path, dtype="float32", always_2d=True)
        if output_rate != rate:
            raise ValueError(f"Unexpected sample rate: {stem}")
        if samples.shape != (frames, 2):
            raise ValueError(f"Unexpected length/channels: {stem}")
        if not np.isfinite(samples).all():
            raise ValueError(f"Non-finite output: {stem}")
        if sf.info(path).subtype != "PCM_16":
            raise ValueError(f"Unexpected PCM format: {stem}")
        stems[stem] = {"path": str(path), "peak": float(np.abs(samples).max())}
    return stems


def main():
    root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["TORCH_HOME"] = str(root / "models" / "torch")
    env["PATH"] = str(Path(sys.prefix) / "Library" / "bin") + os.pathsep + env["PATH"]
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    if not ffmpeg:
        raise RuntimeError("FFmpeg is missing from the isolated environment.")

    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; use the documented CUDA-enabled environment.")
    (root / "artifacts").mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="demucs-smoke-", dir=root / "artifacts"))
    rate = 44100
    t = np.arange(rate * 12) / rate
    signal = 0.12 * np.sin(2 * np.pi * 110 * t) * np.exp(-4 * (t % 1))
    signal += 0.04 * np.sin(2 * np.pi * 55 * t)
    source = run / "synthetic.wav"
    sf.write(source, np.column_stack((signal, signal * 0.9)), rate, subtype="PCM_16")
    command = [sys.executable, "-m", "demucs", "-n", "htdemucs_6s", "-d", "cuda",
               "--segment", "5", "-o", str(run / "separated"), str(source)]
    print(f"Synthetic GPU smoke test; logs and outputs: {run}", flush=True)
    started = time.perf_counter()
    try:
        with (run / "demucs.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, cwd=root, env=env, stdout=log,
                           stderr=subprocess.STDOUT, check=True, timeout=600)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        print(f"Separation failed; inspect {run / 'demucs.log'}", file=sys.stderr)
        raise
    elapsed = time.perf_counter() - started

    stems = validate_stems(run / "separated" / "htdemucs_6s" / "synthetic", len(t), rate)

    result = {
        "status": "passed",
        "input_kind": "generated_signal_not_a_guitar_quality_benchmark",
        "model": "htdemucs_6s",
        "device": torch.cuda.get_device_name(0),
        "python": sys.version.split()[0],
        "versions": {name: version(name) for name in ("demucs", "torch", "torchaudio", "numpy", "soundfile")},
        "ffmpeg": subprocess.check_output([ffmpeg, "-version"], env=env, text=True).splitlines()[0],
        "elapsed_seconds_including_load": round(elapsed, 3),
        "segment_seconds": 5,
        "clip_mode": "upstream_default_rescale",
        "frames": len(t),
        "sample_rate": rate,
        "stems": stems,
    }
    (run / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
