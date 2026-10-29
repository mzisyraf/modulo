"""Explicit paid Cloud API flow through the lightweight local backend; no ML imports."""
import argparse
import hashlib
import json
from pathlib import Path
import time
from uuid import uuid4
import urllib.request

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[2]


def request(path, *, data=None, headers=None):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers or {}), timeout=30) as response:
        return json.load(response)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("source", type=Path); parser.add_argument("output", type=Path)
    parser.add_argument("--run", action="store_true", help="Consumes one shared GPU attempt if this is a fresh request")
    args = parser.parse_args()
    if not args.run: parser.error("Paid check requires --run")
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / "data"): parser.error("Store evidence only in ignored data")
    source = args.source.read_bytes()
    if not 0 < len(source) <= 50 * 1024 * 1024: parser.error("Source exceeds upload bound")
    output.mkdir(parents=True, exist_ok=True); path = output / "flow.json"
    audit = json.loads(path.read_text()) if path.exists() else {"idempotency_key": str(uuid4()), "source_sha256": hashlib.sha256(source).hexdigest(), "started_at": time.time()}
    if audit["source_sha256"] != hashlib.sha256(source).hexdigest(): raise ValueError("Source changed; preserve the existing attempt")
    path.write_text(json.dumps(audit, indent=2))
    if "job_id" not in audit:
        job = request("/api/jobs", data=source, headers={"Content-Type": "audio/mpeg" if args.source.suffix.lower() == ".mp3" else "audio/wav",
            "Idempotency-Key": audit["idempotency_key"], "X-Separation-Backend": "modal"})
        audit["job_id"] = job["job_id"]; path.write_text(json.dumps(audit, indent=2))
    deadline = time.monotonic() + 1200; previous = None
    while True:
        job = request(f"/api/jobs/{audit['job_id']}")
        if job["status"] != previous: print(json.dumps({"job_id": audit["job_id"], "status": job["status"]}), flush=True); previous = job["status"]
        if job["status"] in {"ready", "failed"}: break
        if time.monotonic() > deadline: raise TimeoutError("Inspect the saved job before retrying")
        time.sleep(1)
    audit["job"] = job; audit["elapsed_seconds"] = time.time() - audit["started_at"]
    path.write_text(json.dumps(audit, indent=2))
    if job["status"] != "ready": raise RuntimeError(job.get("error", {}).get("message", "Cloud separation failed"))
    if job["backend"] != "modal" or job["result"]["provenance"]["kind"] != "cloud_separation": raise ValueError("Wrong backend/provenance")
    artifacts = {}
    for name in ("mix", "guitar", "backing"):
        with urllib.request.urlopen(BASE + job["result"]["artifacts"][name], timeout=30) as response:
            header = response.read(44); size = int(response.headers["Content-Length"])
        if header[:4] != b"RIFF" or header[8:12] != b"WAVE": raise ValueError("Invalid WAV response")
        artifacts[name] = {"bytes": size, "wave_header_hex": header.hex()}
    if len({row["bytes"] for row in artifacts.values()}) != 1: raise ValueError("Unaligned artifacts")
    audit["http_artifacts"] = artifacts; path.write_text(json.dumps(audit, indent=2))
    print(json.dumps({"job_id": audit["job_id"], "elapsed_seconds": audit["elapsed_seconds"], "duration_seconds": job["result"]["duration_seconds"], "artifacts": {key: row["bytes"] for key, row in artifacts.items()}}), flush=True)
