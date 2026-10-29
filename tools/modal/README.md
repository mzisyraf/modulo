# Private Modal Demucs API

Deploy only the separator, keeping the web app, browser audio and Nemotron Token Factory integration separate. This checkpoint uses Modal's authenticated Python API, not a public HTTP URL. Credentials stay on the backend/operator machine. The existing web app still uses its local separator until a separately tested adapter is connected.

The Modal app is `modulo-demucs`, with a private volume `modulo-demucs-jobs`. It runs one GPU job at a time, preferring L4 with T4 as a compatible capacity fallback. It scales to zero with a two-second idle window, has a 600-second execution timeout and no configured automatic retries. The existing isolated worker retains the tested model, checkpoint hash, five-second segments and shared output scaling. Its model loads per invocation; measure before optimizing reuse.

Initial allowance: **ten attempts**, reserved durably in `/attempts.json` before inference. Failed attempts still count. This is an attempt limit, not a provider dollar limit; model loading, failed starts, storage and CPU cleanup can incur charges. Preserve this ledger across deploys and review billing before extending the allowance. The human's US$20 total cap remains unchanged by their US$30 Modal credit balance.

Only explicit source files and the pinned separator requirements are included in the image. Weights are downloaded from the official Demucs host while building, outside GPU execution, and checked by the worker. The pinned SDK currently requires Modal's `2025.06` image builder to preserve Python 3.10. This is a compatibility checkpoint, not a claim of long-term support for that stack.

## Local setup and authentication

From the repository root, use the existing Python 3.12 interpreter to create `tools/modal/.venv`, then install `tools/modal/requirements-lock.txt` there. Credentials, uploads and smoke outputs belong in ignored `data/modal/`.

```powershell
$env:MODAL_CONFIG_PATH = Join-Path $PWD 'data/modal/config.toml'
$env:PYTHONIOENCODING = 'utf-8'
.\tools\modal\.venv\Scripts\python.exe -m modal token new --expires-in 7d
.\tools\modal\.venv\Scripts\python.exe -m modal deploy tools/modal/app.py
```

Use only the human's authorized workspace. The initial session connects to `mzisyraf`; the account token expires after seven days and requires renewal for later use. Never paste tokens into issues or chat. Generation budgets and the real Nebius environment/ledger are unchanged.

## Send an inference request

```powershell
.\tools\modal\.venv\Scripts\python.exe tools/modal/client.py 'path/to/rights-cleared.wav' 'data/modal/my-result'
```

The client validates the 50 MiB byte bound, privately uploads to a fresh UUID directory, spawns the GPU function, polls its call ID and streams fixed-name artifacts back through the CPU client. It never serializes WAVs as JSON/base64 and never fetches arbitrary URLs. The worker validates mono/stereo WAV/MP3 decoding and 10–295 second duration. Downloads validate sizes, PCM format, alignment and provenance before deleting the remote job. The result directory contains `mix.wav`, `guitar.wav`, `backing.wav`, `result.json` and `modal-call.json` (call/job identifiers only).

Interrupted clients retain the call identifier for dashboard inspection/cancellation. The client requests cancellation on timeout or interruption; if cancellation cannot be confirmed it reports that explicitly. Client failure may leave partial downloaded artifacts; use a fresh output folder for a new attempt. Do not retry automatically because each attempt can incur charges. Remote jobs run to completion independently of the polling HTTP connection.

An hourly CPU-only cleanup deletes abandoned directories aged at least 24 hours, so cleanup may occur up to one hour later. It preserves the attempt ledger. Successful downloads delete their remote directory immediately. Private error logs can remain until expiry. Storage may remain chargeable after deletion while the provider processes it.

## Checks and limits

```powershell
.\tools\modal\.venv\Scripts\python.exe -m unittest discover -s tools/modal -p 'test_*.py' -v
.\tools\modal\.venv\Scripts\python.exe -m modal billing summary --json
```

A synthetic 12-second waveform can verify GPU execution, output transport and alignment. It cannot prove musical separation quality. Actual rights-cleared clean/distorted/dense clips, cold/warm timings, full-length transfer, driver/hardware tone acceptance and end-to-end web-app integration remain separate checks. Do not report inference success from deployment alone.

To stop both GPU invocations and the hourly cleanup, use `modal app stop modulo-demucs`. This preserves the volume and attempt ledger. Avoid deleting the volume as a way to reset spending limits. The earlier VM/Compose deployment draft is not used for this serverless service.

## Verified checkpoint — 29 October 2026

Deployed to workspace `mzisyraf`, app `modulo-demucs`. Seven offline checks pass, including remote startup without deployer paths and cancellation on worker failure. The CPU expiry function was also invoked successfully in Modal.

The successful cloud smoke used a generated 12-second stereo signal and a **Tesla T4** capacity fallback. Worker execution including model loading was **8.367 seconds**. Model `htdemucs_6s`, five-second segments, common gain 0.9, and checkpoint SHA-256 `34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd` match the local separator. Each downloaded WAV is 2,116,844 bytes; the client validated PCM16/stereo/44.1kHz alignment and provenance before removing its remote job. Evidence is ignored under `data/modal/cloud-smoke-3/`.

The initial startup import failed and was cancelled; a later L4-only test waited for capacity and was cancelled before deploying the fallback configuration. The durable ledger reports **2/10 attempts reserved**, including interrupted work, leaving eight attempts. No ledger was reset. A subsequent status check showed no running or queued GPU work. The full request includes upload, queue/startup and download time; **8.367 seconds is not end-to-end latency**. Large/full-length transfer remains unverified.

At the billing snapshot after this test, metered usage was **$0.02041824** and billed usage **$0**, after credit/egress adjustments. This covers the workspace's setup/tests at that snapshot, not a per-song quote or guaranteed final charge. Billing can lag. No real-music quality, warmed/full-song benchmark or browser/local-API cloud integration is claimed.
