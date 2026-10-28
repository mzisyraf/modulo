# modulo — running the scaffold

This starter connects a React page, a TypeScript audio package, a shared preset schema and a FastAPI fixture service. It is not the completed MVP.

## What works

- React/TypeScript/Vite app with editable gain, drive, three-band EQ and output level.
- Local audition of a synthetic two-second pluck or your own dry audio recording (up to 20 MB). Browser decoding support depends on the file codec.
- Bypass, stop, a bounded-output waveshaper and cleanup of earlier playback. Audio remains on the device.
- FastAPI health and manual-example preset endpoints. The frontend remains usable if the API is stopped.
- One JSON Schema used by Ajv in JavaScript and jsonschema in Python. The preset and its ranges are a draft for Isyraf/Dinnie/Shazlin to review.

The main Tone Match page embeds real separation/reference/starting-preset controls alongside local amp/live-input UI. The standalone [local workflow](LOCAL_SEPARATION.md) implements bounded mixed-song upload, one isolated CUDA worker, retained job/audio artifacts, reference confirmation and [budget-gated Nano starting presets](PRESET_GENERATION.md) with editable Apply/Play. It requires the local separator setup; local amp audition still needs no GPU/cloud credentials. Generation is disabled by default. Calibrated source/target tone matching, performance recording, live play-along and physical-interface acceptance remain incomplete.

The [reference selector](ANALYSIS.md) accepts already-isolated PCM16 guitar WAVs and aligned mix, and is reused by the local separation API. The [issue #1 contract review](CONTRACT_REVIEW.md) records controls, methods and pending team decisions; the separation-only job boundary is proposed for Shazlin's review.

For Isyraf's isolated local separator environment and generated-signal GPU check, see [local Demucs testing](DEMUCS.md). Its packages and model cache are separate from the API; the smoke check does not establish real guitar separation quality.

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

## Backend environment template

Use [services/api/.env.example](../services/api/.env.example) as the team's shared format. Each developer keeps their own values in `services/api/.env`. From the repository root, create it only if it does not already exist:

```powershell
if (-not (Test-Path -LiteralPath 'services/api/.env')) {
    Copy-Item -LiteralPath 'services/api/.env.example' -Destination 'services/api/.env'
}
```

Open `services/api/.env` in your editor and fill in `NEBIUS_API_KEY` with your Token Factory key. `NEBIUS_BASE_URL` is the API base URL; `NEBIUS_MODEL` is the exact serving ID, with a candidate supplied in the template. Verify that model is available to your account before using it.

Commit only the example with its empty key. The real `.env` is already Git-ignored; keep credentials out of chat, issue comments and frontend files, including `VITE_` variables. Frontend/audio contributors do not need a Nebius key for the scaffold.

The API now reads these provider settings at startup from the existing private `.env`, with process environment variables taking precedence. `NEBIUS_BUDGET_USD=0` and `NEBIUS_MAX_REQUESTS=0` keep generation disabled; adding only a key does not enable inference. A separate runtime request/budget allowance must be explicitly approved before activation; the earlier three-request smoke allowance is consumed. Integration tests inject provider transport and send no paid requests. See [PRESET_GENERATION.md](PRESET_GENERATION.md) for persistent reservations, no automatic retries and missing-calibration disclosures. Do not modify/reset the real `.env` or budget ledger as part of tests.

## Checks

From the root:

```powershell
npm run check
```

This runs TypeScript checking, shared-contract/audio/frontend-helper unit checks and the production frontend build. Frontend helpers cover device labels/filtering, duplicate/stale live requests and useful capture-error messages.

For API tests:

```powershell
cd services/api
.\.venv\Scripts\python.exe -m pytest
```

Tests cover unsafe/unknown preset values, fixture provenance, truthful unavailable-analysis behaviour, bounded synthetic audio/drive curves and playback cancellation/lifecycle. Unit tests use a fake audio context for lifecycle checks; they do not establish real interface latency, separation quality or hardware compatibility.

The separate [Demucs checks](DEMUCS.md) cover output validation/failure handling without a GPU, followed by an explicit generated-signal CUDA smoke. They use the separator environment, not the API environment.

For a browser integration check, run the local API and frontend, then verify:

- Main Tone Match: upload a rights-cleared song to the local API, inspect job state and compare aligned original/guitar/backing audio. Confirm a 10–20 second reference; generation stays disabled without a separately approved allowance.
- With offline injected responses, verify Generate does not Apply/play automatically, Apply reaches the one shared amp, proposal edits require reapply, and shared controls affect sample/live processing. Never enable paid calls merely to run a UI check.
- Navigation stops audio while retaining the current job. New projects start with no previous job; reopening a saved in-tab project restores its job/preset. Changing a reference invalidates the generated preset. Confirm provider failure retains separated audio and allows deliberate retry. The standalone preview remains supported; see [LOCAL_SEPARATION.md](LOCAL_SEPARATION.md).
- Device search and channel selection work; denial gives retry guidance. Live start/stop, disconnection, navigation and late permission grants release capture without reviving stale UI. Controls/bypass must not request capture again.

Synthetic browser media can verify these UI/lifecycle paths without microphone permission. Actual interface capture, audible tone changes, physical disconnect and recorded round-trip latency require the real rig checklist in [the audio package](../packages/audio/README.md). Real clean/distorted/dense music separation, source/target feature quality and authenticated NVIDIA/Nebius presets are separate acceptance gates; fixture success does not satisfy them.

## First coding tasks by owner

- **Isyraf:** start with issues #1–3. Prove real guitar separation and real NVIDIA/Nebius access before building a large job pipeline. The API stub is the entry point, not a fake worker.
- **Dinnie:** review issue #1's controls and `packages/audio`; prove live interface input in #4, then extend the engine in #5. The current native-node distortion is a starter, not a model of a particular amplifier.
- **Shazlin:** extend `apps/web` for #6 using agreed job fixtures and the audio package's public API. Keep example state visible until real analysis is connected.

Do not close those issues merely because the flow is connected. Starting-preset wiring does not establish calibrated tone quality, real source features, rig/latency acceptance or approval for additional paid calls.
