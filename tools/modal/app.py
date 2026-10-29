"""Private, scale-to-zero Demucs function. No frontend or public HTTP service."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import time

# Keep the tested Python 3.10 separator stack; the newest builder dropped 3.10.
os.environ.setdefault("MODAL_IMAGE_BUILDER_VERSION", "2025.06")

import modal

from common import APP_NAME, VOLUME_NAME, job_path, reserve_attempt, validate_source

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True, version=2)
app = modal.App(APP_NAME)

# Modal imports this module at /root/app.py; repository paths only exist on the deployer.
image = cpu_image = None
if modal.is_local():
    ROOT = Path(__file__).resolve().parents[2]
    image = (
        modal.Image.debian_slim(python_version="3.10")
        .apt_install("ffmpeg", "libsndfile1")
        .pip_install_from_requirements(str(ROOT / "tools/demucs/requirements-lock.txt"))
        .env({"TORCH_HOME": "/opt/modulo/models/torch"})
        .run_commands("python -c 'from demucs.pretrained import get_model; get_model(\"htdemucs_6s\")'")
        .add_local_file(ROOT / "tools/demucs/worker.py", "/opt/modulo/tools/demucs/worker.py", copy=True)
        .add_local_file(ROOT / "services/api/app/job_lock.py", "/opt/modulo/services/api/app/job_lock.py", copy=True)
        .add_local_file(ROOT / "services/api/app/__init__.py", "/opt/modulo/services/api/app/__init__.py", copy=True)
        .add_local_file(ROOT / "tools/modal/common.py", "/root/common.py", copy=True)
    )
    cpu_image = modal.Image.debian_slim().add_local_file(ROOT / "tools/modal/common.py", "/root/common.py", copy=True)


@app.function(image=image, gpu=["L4", "T4"], cpu=2, memory=8192, timeout=600,
              startup_timeout=240, min_containers=0, max_containers=1,
              buffer_containers=0, scaledown_window=2, retries=0,
              volumes={"/jobs": volume})
def separate(job_id: str):
    volume.reload()
    directory = job_path("/jobs", job_id)
    validate_source(directory / "source.bin")
    # Reservations survive failed jobs/redeployment; this first checkpoint permits ten attempts.
    ledger = Path("/jobs/attempts.json")
    reserve_attempt(ledger)
    volume.commit()
    started = time.monotonic()
    try:
        with (directory / "worker.log").open("w") as log:
            result = subprocess.run(
                ["python", "/opt/modulo/tools/demucs/worker.py", str(directory)],
                stdout=log, stderr=subprocess.STDOUT, timeout=570,
            )
        if result.returncode:
            raise RuntimeError(f"Demucs failed with code {result.returncode}; inspect private worker.log.")
        report = json.loads((directory / "result.json").read_text())
        report.update(provider="modal", elapsed_seconds=round(time.monotonic() - started, 3))
        (directory / "result.json").write_text(json.dumps(report, allow_nan=False))
        (directory / "source.bin").unlink()
        volume.commit()
        return {"job_id": job_id, "status": "ready", "report": report}
    except BaseException:
        # Keep only the private error log; failed attempts must not retain uploaded music.
        for path in directory.iterdir():
            if path.name != "worker.log" and path.is_file():
                path.unlink()
        volume.commit()
        raise


@app.function(image=cpu_image, schedule=modal.Period(hours=1),
              timeout=60, max_containers=1, volumes={"/jobs": volume})
def expire():
    """CPU-only expiry also handles clients disappearing before download/cleanup."""
    volume.reload()
    for directory in Path("/jobs").iterdir():
        if directory.is_dir() and time.time() - directory.stat().st_mtime >= 24 * 3600:
            shutil.rmtree(directory)
    volume.commit()
