import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .contracts import example_preset
from .jobs import JobError, JobStore, MAX_UPLOAD_BYTES
from .preset_generation import PresetError, PresetGenerator
from .source_calibration import SourceCalibration


class ReferenceInterval(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    start_seconds: int
    end_seconds: int


class PresetRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    reference_revision: int
    source_calibration: SourceCalibration | None = None


def create_app(store=None, generator=None):
    @asynccontextmanager
    async def lifespan(app):
        jobs = store if store is not None else JobStore()
        jobs.start()
        app.state.jobs = jobs
        app.state.preset_error = None
        try:
            app.state.generator = generator if generator is not None else PresetGenerator.from_env()
        except PresetError as failure:
            app.state.generator = None
            app.state.preset_error = failure

        async def expire_jobs():
            while True:
                await asyncio.sleep(60)
                await asyncio.to_thread(jobs.prune)

        cleanup = asyncio.create_task(expire_jobs())
        try:
            yield
        finally:
            cleanup.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup
            await asyncio.to_thread(jobs.close)

    app = FastAPI(title="modulo API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.middleware("http")
    async def local_origin(request, call_next):
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD"} and origin and origin not in {
            str(request.base_url).rstrip("/"), "http://127.0.0.1:5173", "http://localhost:5173",
        }:
            return JSONResponse(status_code=403, content={"error": {
                "code": "origin_forbidden", "message": "Use modulo from this local machine.", "retryable": False,
            }})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(JobError)
    async def job_error(_request, failure):
        return JSONResponse(status_code=failure.status, content={"error": failure.public()})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, _failure):
        if request.url.path.endswith("/preset"):
            return JSONResponse(status_code=422, content={"error": {
                "code": "invalid_generation_request", "message": "Supply a whole-number reference_revision and optional valid numeric source_calibration.", "retryable": False,
            }})
        return JSONResponse(status_code=422, content={"error": {
            "code": "invalid_reference", "message": "Supply only whole-second start_seconds and end_seconds.", "retryable": False,
        }})

    @app.exception_handler(PresetError)
    async def preset_error(_request, failure):
        return JSONResponse(status_code=failure.status, content={"error": {
            "code": failure.code, "message": failure.message, "retryable": False,
        }})

    @app.get("/api/health")
    def health(request: Request):
        provider = getattr(request.app.state, "generator", None)
        return {"status": "ok", "mode": "scaffold", "analysis_available": False,
                "separation_available": True, "preset_generation_available": bool(provider and provider.available),
                "preset_budget_unlimited": bool(provider and provider.budget is None)}

    @app.get("/api/presets/example")
    def preset_example():
        return example_preset()

    @app.post("/api/jobs", status_code=202)
    async def create_job(request: Request):
        if request.headers.get("content-type", "").split(";")[0].strip() not in {"audio/wav", "audio/x-wav", "audio/mpeg"}:
            raise JobError("invalid_upload", "Upload a WAV or MP3 with its audio Content-Type.", 415)
        length = request.headers.get("content-length")
        if length is not None:
            try:
                length = int(length)
                if length < 1:
                    raise ValueError()
            except ValueError:
                raise JobError("invalid_upload", "Upload a nonempty audio file.")
            if length > MAX_UPLOAD_BYTES:
                raise JobError("upload_too_large", "Choose a song no larger than 50 MiB.", 413)
        jobs = request.app.state.jobs
        job, created = jobs.reserve(request.headers.get("idempotency-key", ""), request.headers.get("x-separation-backend", "local"))
        job_id = job["job_id"]
        if created:
            try:
                size = 0
                with (jobs.directory(job_id) / "source.bin").open("wb") as output:
                    async with asyncio.timeout(60):
                        async for block in request.stream():
                            size += len(block)
                            if size > MAX_UPLOAD_BYTES:
                                raise JobError("upload_too_large", "Choose a song no larger than 50 MiB.", 413)
                            output.write(block)
                if size == 0 or (length is not None and size != length):
                    raise JobError("invalid_upload", "The audio upload is empty or incomplete.")
                jobs.submit(job_id)
            except BaseException as failure:
                error = failure if isinstance(failure, JobError) else JobError("upload_interrupted", "Upload was interrupted. Select the song and retry.", retryable=True)
                jobs.fail(job_id, error)
                if isinstance(failure, asyncio.CancelledError):
                    raise
                raise error from failure
        snapshot = jobs.get(job_id)
        return {"job_id": job_id, "status": snapshot["status"]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str, request: Request):
        return request.app.state.jobs.get(job_id)

    @app.post("/api/jobs/{job_id}/reference")
    def confirm_reference(job_id: str, interval: ReferenceInterval, request: Request):
        return request.app.state.jobs.confirm(job_id, interval.start_seconds, interval.end_seconds)

    @app.get("/api/jobs/{job_id}/references")
    def reference_options(job_id: str, request: Request):
        return request.app.state.jobs.references(job_id)

    @app.post("/api/jobs/{job_id}/preset", status_code=202)
    def generate_preset(job_id: str, selection: PresetRequest, request: Request):
        jobs = request.app.state.jobs
        if request.app.state.preset_error:
            jobs.get(job_id)
            raise request.app.state.preset_error
        source = selection.source_calibration.model_dump(exclude_none=True) if selection.source_calibration else None
        return jobs.start_generation(job_id, selection.reference_revision, request.app.state.generator, source)

    @app.get("/api/jobs/{job_id}/audio/{name}")
    def audio_artifact(job_id: str, name: str, request: Request):
        return FileResponse(request.app.state.jobs.artifact(job_id, name), media_type="audio/wav")

    return app


app = create_app()
