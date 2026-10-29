"""Upload, invoke, poll and download via Modal's authenticated API; no public URL."""

import argparse
import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

from common import APP_NAME, ARTIFACTS, MAX_ARTIFACT_BYTES, VOLUME_NAME, job_path, validate_outputs, validate_source

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("MODAL_CONFIG_PATH", str(ROOT / "data/modal/config.toml"))

import modal


def run(source, output):
    validate_source(source)
    output.mkdir(parents=True, exist_ok=True)
    if any((output / name).exists() for name in ARTIFACTS):
        raise ValueError("Use an output folder without existing separation artifacts.")
    job_id = str(uuid4())
    job_path("/", job_id)
    volume = modal.Volume.from_name(VOLUME_NAME)
    with volume.batch_upload() as batch:
        batch.put_file(source, f"/{job_id}/source.bin")
    call = None
    complete = False
    try:
        call = modal.Function.from_name(APP_NAME, "separate").spawn(job_id)
        # Persist the call ID before waiting so interrupted clients can locate/cancel it.
        (output / "modal-call.json").write_text(json.dumps({"job_id": job_id, "call_id": call.object_id}))
        deadline = time.monotonic() + 900
        while True:
            try:
                result = call.get(timeout=0)
                break
            except TimeoutError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Modal job exceeded the client deadline; cancellation requested.")
                time.sleep(2)
        if result.get("job_id") != job_id or result.get("status") != "ready":
            raise ValueError("Unexpected Modal job result.")
        complete = True
        for name in ARTIFACTS:
            path = output / name
            temporary = output / f"{name}.partial"
            size = 0
            limit = 65536 if name == "result.json" else MAX_ARTIFACT_BYTES
            try:
                with temporary.open("wb") as target:
                    for chunk in volume.read_file(f"/{job_id}/{name}"):
                        size += len(chunk)
                        if size > limit:
                            raise ValueError("Modal artifact exceeded its size limit.")
                        target.write(chunk)
                if size == 0:
                    raise ValueError("Empty Modal artifact.")
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        validate_outputs(output)
        volume.remove_file(f"/{job_id}", recursive=True)
        return result
    except BaseException:
        if call is not None and not complete:
            try:
                call.cancel(terminate_containers=True)
            except Exception as cancellation_failure:
                print(f"Cancellation could not be confirmed: {cancellation_failure}. Check modal-call.json.", file=sys.stderr)
        # Durable remote artifacts expire via CPU cleanup; avoid racing a cancelled worker.
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.source, args.output), allow_nan=False))
    except Exception as failure:
        print(f"Modal separation failed: {failure}", file=sys.stderr)
        raise SystemExit(1)
