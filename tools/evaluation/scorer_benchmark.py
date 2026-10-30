"""Offline AFx-Rep versus current descriptors; local development audio only, no API calls."""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT_SHA = "3587c4f3a1a8ecbc53b8023c480a0e6ff80719bcc26ce6ee6d08b8daf41d75d4"
SOURCE_REV = "ec50e0cc647cc3637d0cbbfc01d059c682c9fb27"


def benchmark(directory, source, checkpoint, device):
    import numpy as np
    import soundfile as sf
    import torch
    import torch.nn.functional as F
    import torchaudio

    directory = directory.resolve()
    if not directory.is_relative_to(ROOT / "data"):
        raise ValueError("Keep benchmark audio/evidence in ignored data")
    digest = hashlib.sha256()
    with checkpoint.open("rb") as stream:
        while chunk := stream.read(1024 * 1024): digest.update(chunk)
    if digest.hexdigest() != CHECKPOINT_SHA:
        raise ValueError("Checkpoint digest mismatch")
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != SOURCE_REV:
        raise ValueError("Use the reviewed upstream encoder revision")
    torch.set_num_threads(4)
    started = time.perf_counter()
    spec = importlib.util.spec_from_file_location("afx_panns", source / "st_ito/models/panns.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Torch2.0 lacks public add_safe_globals; permit only the standard Counter used by this verified checkpoint.
    if hasattr(torch.serialization, "add_safe_globals"):
        torch.serialization.add_safe_globals([collections.Counter])
    else:
        import torch._weights_only_unpickler as restricted
        restricted._get_allowed_globals()["collections.Counter"] = collections.Counter
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    state = {k.removeprefix("encoder."): v for k, v in saved["state_dict"].items() if k.startswith("encoder.")}
    model = module.Cnn14(embed_dim=512, sample_rate=48000.0, window_size=2048, hop_size=1024,
        mel_bins=128, fmin=20.0, fmax=20000.0, use_batchnorm=True, input_norm="minmax")
    model.load_state_dict(state)
    del saved, state
    model.eval().to(device)
    load_seconds = time.perf_counter() - started
    manifest = json.loads((directory / "scorer-manifest.json").read_text())
    items = manifest["items"]
    conditions = {f"{family}-{kind}" for family in ("clean", "crunch", "space") for kind in ("target", "near")}
    if len(items) != 12 or len({x["id"] for x in items}) != 12:
        raise ValueError("Expected twelve unique development renders")
    for excerpt in ("a", "b"):
        if {x["condition"] for x in items if x["excerpt"] == excerpt} != conditions:
            raise ValueError("Missing retrieval condition")
    if len(manifest["current_rankings"]) != 6:
        raise ValueError("Missing current-metric comparisons")
    embeddings, timings = {}, []

    def embed(path, gain=1.0):
        samples, rate = sf.read(path, dtype="float32", always_2d=True)
        if rate != 44100 or samples.shape[1] != 2 or not rate * 3 <= len(samples) <= rate * 12 or not np.isfinite(samples).all() or not np.any(samples):
            raise ValueError("Unexpected benchmark PCM")
        audio = torch.from_numpy(samples.T.copy()).unsqueeze(0).to(device) * gain
        audio = torchaudio.functional.resample(audio, rate, 48000)
        audio = audio / audio.abs().max().clamp(min=1e-8)
        if device == "cuda": torch.cuda.synchronize()
        begin = time.perf_counter()
        with torch.inference_mode():
            mid, side = model(audio)
            vector = F.normalize(torch.cat([F.normalize(mid, dim=-1), F.normalize(side, dim=-1)], dim=-1), dim=-1)
        if device == "cuda": torch.cuda.synchronize()
        if not torch.isfinite(vector).all(): raise ValueError("Nonfinite learned embedding")
        return vector[0].cpu().numpy(), (time.perf_counter() - begin) * 1000

    for item in manifest["items"]:
        name = item["file"]
        if Path(name).name != name or not name.endswith(".wav"): raise ValueError("Invalid fixture filename")
        embeddings[item["id"]], elapsed = embed(directory / name)
        timings.append({"id": item["id"], "milliseconds": elapsed})
    rankings, controls = [], []
    for query in [x for x in manifest["items"] if x["excerpt"] == "b"]:
        scores = sorted([{"condition": c["condition"], "loss": float(1 - np.dot(embeddings[query["id"]], embeddings[c["id"]]))}
            for c in manifest["items"] if c["excerpt"] == "a"], key=lambda x: x["loss"])
        rankings.append({"query": query["condition"], "family": query["family"], "predicted": scores[0]["condition"],
            "correct": scores[0]["condition"] == query["condition"], "scores": scores})
        scaled, _ = embed(directory / query["file"], .5)
        drift = float(np.max(np.abs(scaled - embeddings[query["id"]])))
        if drift > 1e-4: raise ValueError("Level invariance control failed")
        controls.append({"query": query["condition"], "half_level_max_embedding_drift": drift})
    report = {"development_only": True, "not_training_or_fresh_song_acceptance": True, "checkpoint_sha256": CHECKPOINT_SHA,
        "source_revision": revision, "device": device, "load_seconds": load_seconds, "inference_timings": timings,
        "current_correct": sum(x["correct"] for x in manifest["current_rankings"]), "afx_rep_correct": sum(x["correct"] for x in rankings),
        "queries": len(rankings), "current_rankings": manifest["current_rankings"], "learned_rankings": rankings, "level_controls": controls}
    (directory / "scorer-report.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    print(json.dumps({k: report[k] for k in ["device", "load_seconds", "current_correct", "afx_rep_correct", "queries"]}), flush=True)
    for row in rankings: print(json.dumps({k: row[k] for k in ["query", "predicted", "correct"]}), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("--source", type=Path, default=ROOT / "data/scorer/st-ito")
    p.add_argument("--checkpoint", type=Path, default=ROOT / "data/scorer/afx-rep/afx-rep.ckpt")
    p.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    args = p.parse_args()
    benchmark(args.directory, args.source, args.checkpoint, args.device)
