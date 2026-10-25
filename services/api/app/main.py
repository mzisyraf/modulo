from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .contracts import example_preset

app = FastAPI(title="modulo API", version="0.1.0")


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "scaffold", "analysis_available": False}


@app.get("/api/presets/example")
def preset_example():
    return example_preset()


@app.post("/api/jobs", status_code=501)
def create_job():
    return JSONResponse(
        status_code=501,
        content={"error": {
            "code": "analysis_not_implemented",
            "message": "Guitar separation and NVIDIA/Nebius preset generation are not connected yet.",
            "retryable": False,
        }},
    )
