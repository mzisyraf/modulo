"""Bounded full-rig experiment. Browser renders real DSP; Python owns paid requests."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from preset_eval import ROOT, prepare, serve, write, engine_hash
sys.path.insert(0, str(ROOT / "services/api"))
from app.rig_generation import RigGenerator, SUPER_MODEL, CATALOG_SHA, PROMPT_VERSION
from app.preset_generation import post_completion


def propose(directory, model, count, case_id=None):
    config = json.loads((directory / "config.json").read_text())
    targets = json.loads((directory / "rig-targets.json").read_text())
    if config["engine_sha256"] != engine_hash() or targets["engine_sha256"] != engine_hash(): raise ValueError("DSP changed; regenerate targets first")
    provider = RigGenerator.from_env(); provider.model = model; provider.reservation_model = model
    provider.allow_super_fallback = False  # Grade exact models independently; the main app's repair policy is separate.
    provider.max_model_requests = 6 if model == SUPER_MODEL else 100
    if not provider.available: raise ValueError("Bounded generation must be enabled first")
    path = directory / "proposals.json"
    results = json.loads(path.read_text()) if path.exists() else []
    for row in targets["cases"]:
        if case_id is not None and row["id"] != case_id: continue
        for repeat in range(count):
            if any(item["case"] == row["id"] and item["repeat"] == repeat and item["model"] == model and item.get("prompt_version", "rig-features-v1") == PROMPT_VERSION for item in results): continue
            item = {"case": row["id"], "repeat": repeat, "model": model, "catalog_sha256": CATALOG_SHA, "prompt_version": PROMPT_VERSION}
            def transport(key, payload):
                response = post_completion(key, payload, timeout=180)
                item["usage"] = response.get("usage", {})
                item["finish_reason"] = response.get("choices", [{}])[0].get("finish_reason")
                return response
            provider.transport = transport
            reference = {"start_seconds": 0, "end_seconds": 15, "quality_flags": ["controlled_same_performance_target"],
                         "tone_features": row["features"], "temporal_features": row["temporal"],
                         "metrics": {"guitar_rms_dbfs": row["rms_dbfs"], "stem_to_mix_energy_ratio": 1, "quiet_second_fraction": 0, "clipped_sample_fraction": 0}}
            # Save an attempted marker first; a crash cannot silently repeat a possibly billed call.
            item["status"] = "attempted"; results.append(item); write(path, results)
            try:
                item["result"] = provider.generate(reference, targets["source_calibration"]); item["status"] = "ready"
            except Exception as error:
                item["status"] = "failed"; item["error"] = getattr(error, "message", type(error).__name__)
            write(path, results)
            print(json.dumps({key: item[key] for key in ("case", "repeat", "model", "status")}), flush=True)
            if item["status"] != "ready": return


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "serve", "propose"]); parser.add_argument("directory", type=Path)
    parser.add_argument("--port", type=int, choices=[5175, 5176], default=5175)
    parser.add_argument("--source", type=Path); parser.add_argument("--model", default="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")
    parser.add_argument("--repeats", type=int, choices=[1, 2, 3], default=3); parser.add_argument("--generate", action="store_true")
    parser.add_argument("--case", choices=["clean", "crunch", "space", "external"])
    args = parser.parse_args(); directory = args.directory.resolve()
    if not directory.is_relative_to(ROOT / "data"): parser.error("Keep evidence in ignored data")
    if args.action == "prepare":
        if not args.source: parser.error("Supply --source")
        prepare(args.source, directory)
        subprocess.run(["node", "tools/evaluation/rig-cases.ts", str(directory / "config.json")], cwd=ROOT, check=True)
    elif args.action == "serve": serve(directory, rig=True, port=args.port)
    else:
        if not args.generate: parser.error("Explicit --generate required for paid calls")
        if args.model not in ("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", SUPER_MODEL): parser.error("Unapproved model")
        if args.model == SUPER_MODEL and args.repeats > 2: parser.error("At most six Super calls")
        propose(directory, args.model, args.repeats, args.case)
