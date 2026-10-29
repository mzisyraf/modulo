"""Bounded local separation and reference-scoped starting-preset state."""

from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
import json
import logging
import math
import os
from pathlib import Path
import shutil
import subprocess
from threading import RLock
import time
from uuid import UUID, uuid4
import wave

from .contracts import ROOT, validate_preset
from .job_lock import exclusive_lock
from .preset_generation import PresetError
from .reference import reference_options, select_reference
from .source_calibration import SourceCalibration
from .tone_features import wav_tone_features

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_JOBS = 4
RETENTION_SECONDS = 24 * 60 * 60
ARTIFACTS = {"mix", "guitar", "backing"}
logger = logging.getLogger(__name__)


def _remove_job_directory(directory):
    try:
        shutil.rmtree(directory)
    except OSError:
        # Windows/OneDrive may keep the empty directory open after every file was removed.
        if directory.exists() and any(directory.iterdir()):
            raise
        logger.warning("Empty job directory %s cleanup deferred until Windows releases it", directory.name)


class JobError(Exception):
    def __init__(self, code, message, status=400, retryable=False):
        super().__init__(message)
        self.code, self.message, self.status, self.retryable = code, message, status, retryable

    def public(self):
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


def canonical_id(value):
    try:
        if str(UUID(value)) == value:
            return value
    except (ValueError, TypeError, AttributeError):
        pass
    raise JobError("invalid_id", "Use a valid job or idempotency UUID.")


class JobStore:
    def __init__(self, root=ROOT / "data" / "jobs", timeout=600):
        self.root = Path(root).resolve()
        self.timeout = timeout
        self.lock = RLock()
        self.jobs = {}
        self.preset_running = {}
        self.reference_cache = {}
        self.reference_pending = {}

    def start(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.service_lock = exclusive_lock(self.root / ".service.lock")
        try:
            self.service_lock.__enter__()
        except OSError as failure:
            raise RuntimeError("Another local API owns this job directory; run one API worker.") from failure
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="separation")
        self.preset_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="preset")
        try:
            self.recover()
        except BaseException:
            self.close()
            raise

    def recover(self):
        for directory in self.root.iterdir():
            if not directory.is_dir():
                continue
            try:
                job_id = canonical_id(directory.name)
                self.directory(job_id)
            except JobError:
                continue
            try:
                if (directory / "state.json").stat().st_size > 65536:
                    raise ValueError("Oversized job metadata.")
                job = json.loads((directory / "state.json").read_text(encoding="utf-8"))
                if job["job_id"] != job_id or job["status"] not in {"queued", "running", "ready", "failed"}:
                    raise ValueError("Invalid job identity or state.")
                if job.get("backend", "local") not in {"local", "modal"}:
                    raise ValueError("Invalid persisted separation backend.")
                canonical_id(job["idempotency_key"])
                if any(type(job[key]) not in (int, float) or not math.isfinite(job[key]) for key in ("created_at", "expires_at")):
                    raise ValueError("Invalid job lifetime.")
            except (JobError, OSError, ValueError, KeyError, TypeError):
                logger.warning("Removing interrupted/corrupt local job directory %s", job_id)
                _remove_job_directory(self.directory(job_id))
                continue
            self.jobs[job_id] = job
            if job["status"] in {"queued", "running"}:
                self.fail(job_id, JobError("interrupted", "The API restarted during this job. Submit the song again.", retryable=True))
            elif job.get("generation", {}).get("status") == "generating":
                job["generation"].update(status="failed", error={"code": "generation_interrupted",
                    "message": "The API restarted during generation. The attempt may have been billed; its budget reservation is retained.", "retryable": True})
                job["generation"].pop("preset", None)
                self.save(job)
        self.prune()
        with self.lock:
            while len(self.jobs) > MAX_JOBS:
                self.remove(min(self.jobs, key=lambda item: self.jobs[item]["created_at"]))

    def close(self):
        self.preset_pool.shutdown(wait=True)
        self.pool.shutdown(wait=True)
        self.service_lock.__exit__(None, None, None)

    def directory(self, job_id):
        path = self.root / canonical_id(job_id)
        if path.is_symlink() or path.resolve().parent != self.root:
            raise JobError("invalid_id", "Invalid job directory.")
        return path

    def save(self, job):
        directory = self.directory(job["job_id"])
        temporary = directory / "state.tmp"
        temporary.write_text(json.dumps(job, allow_nan=False), encoding="utf-8")
        temporary.replace(directory / "state.json")

    def prune(self):
        with self.lock:
            for job_id, job in list(self.jobs.items()):
                if (time.time() >= job["expires_at"] and job["status"] in {"ready", "failed"}
                        and job_id not in self.preset_running and job_id not in self.reference_pending):
                    try:
                        self.remove(job_id)
                    except JobError:
                        logger.warning("Expired job %s is still in use; cleanup will retry", job_id)

    def remove(self, job_id):
        try:
            _remove_job_directory(self.directory(job_id))
        except OSError as failure:
            raise JobError("storage_busy", "An older audio job is still in use. Close its player and retry.", 503, True) from failure
        del self.jobs[job_id]
        self.reference_cache.pop(job_id, None)

    def reserve(self, key, backend="local"):
        if backend not in {"local", "modal"}:
            raise JobError("invalid_backend", "Choose Local or Cloud API separation.")
        canonical_id(key)
        with self.lock:
            self.prune()
            for job in self.jobs.values():
                if job["idempotency_key"] == key:
                    if job.get("backend", "local") != backend:
                        raise JobError("backend_conflict", "This upload key belongs to a different separation backend.", 409)
                    return deepcopy(job), False
            if any(job["status"] in {"queued", "running"} for job in self.jobs.values()):
                raise JobError("worker_busy", "One local song is already processing. Wait for it to finish.", 429, True)
            while len(self.jobs) >= MAX_JOBS:
                candidates = [item for item in self.jobs if item not in self.preset_running and item not in self.reference_pending]
                if not candidates:
                    raise JobError("generation_busy", "Retained jobs are generating presets or loading waveforms. Wait before uploading another song.", 429, True)
                self.remove(min(candidates, key=lambda item: self.jobs[item]["created_at"]))
            created = time.time()
            job_id = str(uuid4())
            self.directory(job_id).mkdir()
            job = {"job_id": job_id, "idempotency_key": key, "backend": backend, "status": "queued", "stage": "uploading",
                   "created_at": created, "expires_at": created + RETENTION_SECONDS}
            self.jobs[job_id] = job
            self.save(job)
            return deepcopy(job), True

    def get(self, job_id):
        canonical_id(job_id)
        with self.lock:
            self.prune()
            if job_id not in self.jobs or time.time() >= self.jobs[job_id]["expires_at"]:
                raise JobError("job_not_found", "This job is missing or expired. Submit the song again.", 404, True)
            job = deepcopy(self.jobs[job_id])
            del job["idempotency_key"]
            return job

    def submit(self, job_id):
        with self.lock:
            self.jobs[job_id]["stage"] = "separating"
            self.save(self.jobs[job_id])
        self.pool.submit(self.execute, job_id)

    def fail(self, job_id, failure):
        with self.lock:
            job = self.jobs[job_id]
            job.update(status="failed", stage="failed", error=failure.public())
            job.pop("result", None)
            self.save(job)
            directory = self.directory(job_id)
            for name in ("source.bin", "mix.wav", "guitar.wav", "backing.wav", "result.json"):
                try:
                    (directory / name).unlink(missing_ok=True)
                except OSError:
                    logger.warning("Failed job %s still has an open %s; retained until cleanup", job_id, name)

    def run_worker(self, directory):
        python = ROOT / "tools" / "demucs" / ".venv" / ("python.exe" if os.name == "nt" else "bin/python")
        if not python.is_file():
            raise JobError("separator_unavailable", "Set up the isolated local Demucs environment in docs/DEMUCS.md.", 503)
        env = os.environ.copy()
        env["TORCH_HOME"] = str(ROOT / "models" / "torch")
        env["PATH"] = str(python.parent / "Library" / "bin") + os.pathsep + env.get("PATH", "")
        try:
            with (directory / "worker.log").open("w", encoding="utf-8") as log:
                process = subprocess.run([str(python), str(ROOT / "tools" / "demucs" / "worker.py"), str(directory)],
                                         cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=self.timeout)
        except subprocess.TimeoutExpired as failure:
            raise JobError("separation_timeout", "Separation exceeded ten minutes. Retry a shorter song.", retryable=True) from failure
        errors = {
            2: JobError("invalid_audio", "Use a decodable mono/stereo WAV or MP3, 10–295 seconds at 8–192 kHz."),
            3: JobError("separator_unavailable", "Local CUDA, cached model or FFmpeg is unavailable. Check docs/DEMUCS.md.", 503),
            4: JobError("gpu_busy", "An earlier local separation process still owns the GPU. Wait, then retry.", 409, True),
        }
        if process.returncode:
            raise errors.get(process.returncode, JobError("separation_failed", "Local separation failed. Inspect this job's worker.log and retry.", retryable=True))

    def run_modal_worker(self, directory):
        python = ROOT / "tools/modal/.venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python.is_file():
            raise JobError("cloud_unavailable", "Install the Modal client and private credentials using tools/modal/README.md.", 503)
        command = [str(python), str(ROOT / "tools/modal/client.py")]
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        with (directory / "worker.log").open("w", encoding="utf-8") as log:
            try:
                process = subprocess.run(command + [str(directory / "source.bin"), str(directory)],
                                         cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=1200)
            except subprocess.TimeoutExpired as failure:
                try:
                    cancellation = subprocess.run(command + ["--cancel", str(directory)], cwd=ROOT, env=env,
                                                  stdout=log, stderr=subprocess.STDOUT, timeout=30)
                    if cancellation.returncode:
                        logger.error("Modal cancellation unconfirmed for job %s; inspect worker.log", directory.name)
                except (OSError, subprocess.TimeoutExpired):
                    logger.exception("Modal cancellation unconfirmed for job %s", directory.name)
                raise JobError("cloud_timeout", "Cloud separation timed out. Check Modal before retrying; the attempt may be billed.", 504, True) from failure
        if process.returncode:
            raise JobError("cloud_failed", "Cloud separation failed. Check Modal access, remaining attempts and worker.log; no Local fallback was used.", 502, True)

    def execute(self, job_id):
        directory = self.directory(job_id)
        try:
            with self.lock:
                self.jobs[job_id].update(status="running", stage="separating")
                self.save(self.jobs[job_id])
            backend = self.jobs[job_id].get("backend", "local")
            if backend == "modal":
                self.run_modal_worker(directory)
            else:
                self.run_worker(directory)
            report = json.loads((directory / "result.json").read_text(encoding="utf-8"))
            if backend == "modal" and (report.get("provider") != "modal" or report.get("model") != "htdemucs_6s"):
                raise ValueError("Invalid cloud separation provenance.")
            formats = []
            for name in ARTIFACTS:
                with wave.open(str(directory / f"{name}.wav"), "rb") as audio:
                    formats.append((audio.getnframes(), audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getcomptype()))
                    if len(audio.readframes(audio.getnframes())) != audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                        raise ValueError("Truncated worker artifact.")
            frames, rate, channels, width, compression = formats[0]
            if len(set(formats)) != 1 or (rate, channels, width, compression) != (44100, 2, 2, "NONE") or not 10 <= frames / rate <= 295:
                raise ValueError("Invalid worker artifacts.")
            if (not isinstance(report["device"], str) or not 1 <= len(report["device"]) <= 200
                    or type(report["common_gain_linear"]) not in (float, int)
                    or not math.isfinite(report["common_gain_linear"]) or not 0 < report["common_gain_linear"] <= 1):
                raise ValueError("Invalid worker provenance.")
            result = {"duration_seconds": frames / rate, "sample_rate": rate,
                      "artifacts": {name: f"/api/jobs/{job_id}/audio/{name}" for name in sorted(ARTIFACTS)},
                      "provenance": {"kind": "cloud_separation" if backend == "modal" else "local_separation",
                                     "model": "htdemucs_6s", "device": report["device"],
                                     **({"provider": "modal"} if backend == "modal" else {})},
                      "common_gain_linear": report["common_gain_linear"],
                      "quality_flags": ["separation_quality_unverified"], "reference": None, "reference_revision": 0, "suggestion": None}
            try:
                result["suggestion"] = select_reference(directory / "guitar.wav", directory / "mix.wav")
            except ValueError:
                result["quality_flags"].append("no_usable_reference_suggested")
            with self.lock:
                self.jobs[job_id].update(status="ready", stage="ready", result=result)
                self.save(self.jobs[job_id])
            (directory / "source.bin").unlink(missing_ok=True)
        except JobError as failure:
            self.fail(job_id, failure)
        except Exception:
            logger.exception("Local separation job %s failed", job_id)
            self.fail(job_id, JobError("separation_failed", "Separation did not produce valid artifacts. Inspect worker.log and retry.", retryable=True))

    def references(self, job_id):
        with self.lock:
            job = self.get(job_id)
            if job["status"] != "ready":
                raise JobError("job_not_ready", "Wait for separation before loading reference options.", 409)
            if job_id in self.reference_cache:
                return deepcopy(self.reference_cache[job_id])
            pending = self.reference_pending.get(job_id)
            owner = pending is None
            if owner:
                pending = self.reference_pending[job_id] = Future()
        if not owner:
            return deepcopy(pending.result())
        # Pin files while reading outside the global lock; job status remains responsive.
        try:
            directory = self.directory(job_id)
            try:
                result = reference_options(directory / "guitar.wav", directory / "mix.wav")
            except (OSError, ValueError, wave.Error, EOFError) as failure:
                raise JobError("reference_analysis_failed", "Could not read reference waveforms. Reconnect or submit the song again.", 422) from failure
            with self.lock:
                self.get(job_id)
                self.reference_cache[job_id] = result
            pending.set_result(result)
            return deepcopy(result)
        except BaseException as failure:
            pending.set_exception(failure)
            raise
        finally:
            with self.lock:
                self.reference_pending.pop(job_id, None)

    def confirm(self, job_id, start, end):
        with self.lock:
            job = self.get(job_id)
            if job["status"] != "ready":
                raise JobError("job_not_ready", "Wait for separation to finish before selecting a passage.", 409)
            directory = self.directory(job_id)
            try:
                reference = select_reference(directory / "guitar.wav", directory / "mix.wav", start_seconds=start, end_seconds=end)
            except ValueError as failure:
                raise JobError("invalid_reference", str(failure), 422) from failure
            self.jobs[job_id]["result"]["reference"] = reference
            self.jobs[job_id]["result"]["reference_revision"] = job["result"].get("reference_revision", 0) + 1
            self.jobs[job_id].pop("generation", None)
            self.save(self.jobs[job_id])
            return reference

    def start_generation(self, job_id, revision, generator, source_calibration=None):
        if source_calibration is not None:
            try:
                source_calibration = SourceCalibration.model_validate(source_calibration).model_dump(exclude_none=True)
            except ValueError:
                raise PresetError("invalid_source_calibration", "Choose and calibrate a usable guitar recording first.", 422) from None
        with self.lock:
            job = self.get(job_id)
            result = job.get("result", {})
            if job["status"] != "ready" or not result.get("reference"):
                raise JobError("reference_required", "Confirm a separated guitar passage before generating a starting preset.", 409)
            if revision != result.get("reference_revision", 0):
                raise JobError("reference_changed", "The confirmed passage changed. Review and confirm it again.", 409)
            previous = job.get("generation")
            if previous and previous["reference_revision"] == revision and previous.get("source_calibration") == source_calibration and previous["status"] in {"generating", "ready"}:
                return previous
            if job_id in self.preset_running:
                raise JobError("generation_busy", "The previous attempt is finishing. Wait before generating for the new passage.", 409, True)
            if generator is None or not generator.available:
                raise PresetError("generation_disabled", "Starting-preset generation is disabled. A separate approved backend request/budget allowance is required.")
            request_id = str(uuid4())
            generation = {"request_id": request_id, "reference_revision": revision, "status": "generating"}
            if source_calibration is not None:
                generation["source_calibration"] = source_calibration
            self.jobs[job_id]["generation"] = generation
            self.save(self.jobs[job_id])
            self.preset_running[job_id] = request_id
            self.preset_pool.submit(self.generate_preset, job_id, request_id, revision, result["reference"], generator, source_calibration)
            return deepcopy(generation)

    def generate_preset(self, job_id, request_id, revision, reference, generator, source_calibration=None):
        with self.lock:
            job = self.jobs.get(job_id)
            if (not job or time.time() >= job["expires_at"] or job.get("generation", {}).get("request_id") != request_id
                    or job["result"].get("reference_revision", 0) != revision):
                self.preset_running.pop(job_id, None)
                return
        try:
            if source_calibration and source_calibration.get("tone_features"):
                reference = deepcopy(reference)
                try:
                    reference["tone_features"] = wav_tone_features(self.directory(job_id)/"guitar.wav", reference["start_seconds"], reference["end_seconds"])
                except (OSError, ValueError, wave.Error):
                    raise PresetError("target_spectral_unavailable", "The target spectrum could not be measured. Choose a clearer guitar passage.", 422) from None
                # Analysis adds time before billing; recheck reference/expiry after it finishes.
                with self.lock:
                    current = self.jobs.get(job_id)
                    if (not current or time.time() >= current["expires_at"] or current.get("generation", {}).get("request_id") != request_id
                            or current["result"].get("reference_revision", 0) != revision):
                        self.preset_running.pop(job_id, None)
                        return
            preset = validate_preset(generator.generate(reference, source_calibration) if source_calibration is not None else generator.generate(reference))
            outcome = {"status": "ready", "preset": preset}
            if source_calibration and source_calibration.get("tone_features"):
                outcome["target_tone_features"] = reference["tone_features"]
                outcome["target_rms_dbfs"] = reference["metrics"]["guitar_rms_dbfs"]
        except PresetError as failure:
            outcome = {"status": "failed", "error": {"code": failure.code, "message": failure.message, "retryable": True}}
        except Exception:
            logger.error("Starting-preset generation failed for job %s", job_id)
            outcome = {"status": "failed", "error": {"code": "generation_failed", "message": "Starting-preset generation failed. The attempt may have been billed; no preset was applied.", "retryable": True}}
        with self.lock:
            try:
                job = self.jobs.get(job_id)
                if (job and time.time() < job["expires_at"] and job.get("generation", {}).get("request_id") == request_id
                        and job["result"].get("reference_revision", 0) == revision):
                    job["generation"].update(outcome)
                    self.save(job)
            except OSError:
                logger.exception("Could not persist generation for job %s", job_id)
                if job:
                    job["generation"].update(status="failed", error={"code": "generation_storage_failed",
                        "message": "The preset could not be saved. Its budget reservation is retained; review local storage before retrying.", "retryable": False})
                    job["generation"].pop("preset", None)
            finally:
                self.preset_running.pop(job_id, None)

    def artifact(self, job_id, name):
        if name not in ARTIFACTS:
            raise JobError("artifact_not_found", "Unknown audio artifact.", 404)
        job = self.get(job_id)
        if job["status"] != "ready":
            raise JobError("job_not_ready", "Audio is available only after separation succeeds.", 409)
        directory = self.directory(job_id)
        path = directory / f"{name}.wav"
        if path.is_symlink() or path.resolve().parent != directory or not path.is_file():
            raise JobError("artifact_not_found", "Audio is missing. Submit the song again.", 404, True)
        return path
