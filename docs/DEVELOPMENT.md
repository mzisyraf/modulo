# ToneForge — running the scaffold

This starter connects a React page, a TypeScript audio package, a shared preset schema and a FastAPI fixture service. It is not the completed MVP.

## What works

- React/TypeScript/Vite app with editable gain, drive, three-band EQ and output level.
- Local audition of a synthetic two-second pluck or your own dry audio recording (up to 20 MB). Browser decoding support depends on the file codec.
- Bypass, stop, a bounded-output waveshaper and cleanup of earlier playback. Audio remains on the device.
- FastAPI health and manual-example preset endpoints. The frontend remains usable if the API is stopped.
- One JSON Schema used by Ajv in JavaScript and jsonschema in Python. The preset and its ranges are a draft for Isyraf/Dinnie/Shazlin to review.

Still unimplemented: mixed-song upload/separation, automatic reference selection, NVIDIA/Nebius calls, job processing/storage, live interface input, cabinet simulation, compressor, delay, reverb and optional tabs. `POST /api/jobs` deliberately returns HTTP 501. No uploads are saved, and no cloud credentials or GPU are required for this starter.

## Prerequisites

Use Node.js **24.15.0** (see `.nvmrc`) and Python **3.12**. Other Node 24/Python 3.12 patches may work, but use the tested versions for the first team setup. Git is needed to clone/update the repository. All terminal examples below are PowerShell; frontend/audio contributors do not need to run the Python service.

## Frontend and audio

From the repository root:

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds only to this machine. The page labels its example preset and missing AI features. Try the short test signal at a comfortable listening level, move drive/EQ controls, select bypass, and stop playback. A locally selected dry recording is decoded in the browser and never sent to the API.

## API

In a second terminal, from the repository root:

```powershell
cd services/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

If `python` opens the Microsoft Store, install Python 3.12 or use the absolute path to your existing Python interpreter for the venv command. Do not install API packages into a global Python environment. On macOS/Linux use `.venv/bin/python` in place of the Windows executable path.

- Health: **http://127.0.0.1:8000/api/health**
- OpenAPI documentation: **http://127.0.0.1:8000/docs**
- Manual example: **http://127.0.0.1:8000/api/presets/example**

Vite proxies `/api` to port 8000. There is no permissive CORS setting or public listener. The starter is a local development setup, not an internet deployment. A production frontend needs a same-origin API reverse proxy or an explicitly designed deployment configuration.

The exact resolved Python environment is in `requirements-lock.txt`. The shorter requirements files list direct dependencies for intentional updates; regenerate the lock in a fresh Python 3.12 venv and run the checks when changing them.

## Checks

From the root:

```powershell
npm run check
```

This runs TypeScript checking, shared-contract/audio unit checks and the production frontend build.

For API tests:

```powershell
cd services/api
.\.venv\Scripts\python.exe -m pytest
```

Tests cover unsafe/unknown preset values, fixture provenance, truthful unavailable-analysis behaviour, bounded synthetic audio/drive curves and playback cancellation/lifecycle. Unit tests use a fake audio context for lifecycle checks; they do not establish real interface latency, separation quality or hardware compatibility.

## First coding tasks by owner

- **Isyraf:** start with issues #1–3. Prove real guitar separation and real NVIDIA/Nebius access before building a large job pipeline. The API stub is the entry point, not a fake worker.
- **Dinnie:** review issue #1's controls and `packages/audio`; prove live interface input in #4, then extend the engine in #5. The current native-node distortion is a starter, not a model of a particular amplifier.
- **Shazlin:** extend `apps/web` for #6 using agreed job fixtures and the audio package's public API. Keep example state visible until real analysis is connected.

Do not close those issues merely because the scaffold exists. No model prompts, cloud calls, secrets or paid infrastructure are configured here.
