# Local separation checkpoint

The separate modulo page at **http://127.0.0.1:5173/separation.html** connects a real local upload to cached `htdemucs_6s` CUDA separation. It provides original mix, combined guitar and guitar-reduced backing players, plus explicit 10–20-second reference confirmation. It needs no guitar/interface. The existing Tone Match page retains its labelled fixture flow and Shazlin's published calibration/session work without modification by this increment. Isyraf chose the separate page while that frontend work was still unpublished; it was subsequently merged from staging.

This is an Isyraf integration preview for #2/#6, with the proposed job boundary in #1/#6 awaiting Shazlin's review. It does not freeze the shared contract or establish broad separation quality, calibration, tone features, NVIDIA/Nebius preset generation, recording or synchronized live play-along acceptance.

## Run

Follow [DEVELOPMENT.md](DEVELOPMENT.md) for Node and the API venv, and [DEMUCS.md](DEMUCS.md) for the isolated separator environment and cached model. Do not install Torch/Demucs into the API environment. The worker requires the tested checkpoint SHA256 and actual CUDA; it neither downloads a missing model nor falls back to CPU.

1. From the root, run `npm ci` and `npm run dev`.
2. From `services/api`, run `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. Use one API worker and no reload during a job.
3. Open `/separation.html`, choose a rights-cleared WAV/MP3, and select **Separate guitar**.
4. Compare the tracks, enter whole-second bounds, preview the passage, and select **Confirm reference**.

The page remembers its job ID in this tab's session storage and reconnects after refresh. Changing bounds clears the displayed confirmation; invalid selections never silently choose another passage. Native players can audition the entire tracks; the passage buttons start at the chosen time and stop near its end using browser time updates. Only one of this page's players plays at a time. Tracks go directly to the browser output, outside the guitar amp.

## Limits and storage

- WAV/MP3 only; decoded mono/stereo at 8–192 kHz, 10–295 seconds, upload at most 50 MiB. The 295-second limit keeps 44.1 kHz stereo PCM16 exports below the existing reference selector's 50 MiB limit. File extensions/MIME are checked at the UI boundary; FFprobe/FFmpeg validate the actual content in the worker.
- One active upload/job, one separator process, 60-second upload timeout, 600-second worker timeout. Duplicate submissions reuse their idempotency key. A different active job gets an actionable busy response.
- Up to four jobs under ignored `data/jobs/`; jobs expire after 24 hours and the oldest completed job may be evicted sooner. Cleanup runs on requests, startup and every minute. Expired open files are inaccessible and deletion retries after players release them. Raw uploads are removed on success/failure. Four maximum-length jobs use roughly 625 MB of exported WAVs, plus one bounded upload and small metadata/logs.
- Atomic metadata updates recover interrupted uploads/runs as failed after restart. A service lock excludes multiple API processes using the same directory. A worker lock excludes an orphan application worker after a crash; unrelated research programs do not use this lock, so coordinate GPU experiments separately.
- Bind only to localhost. Host and mutation-Origin checks prevent arbitrary web origins from launching work. No permissive CORS, remote authentication, public hosting, provider credentials or paid inference is added. Remote deployment needs a separately designed access boundary.

## Draft HTTP boundary

| Request | Behavior |
|---|---|
| `POST /api/jobs` | Raw file body; `Content-Type: audio/wav` or `audio/mpeg`, `Idempotency-Key: <UUID>`. Returns HTTP 202 `{job_id,status}`. No client filename/path becomes a storage path. |
| `GET /api/jobs/{id}` | Server UUID; `queued`, `running`, `ready` or `failed`, stage and expiry. Result exists only when ready; errors contain `{code,message,retryable}`. |
| `GET /api/jobs/{id}/audio/{mix\|guitar\|backing}` | Fixed allowlisted PCM16 WAVs, browser Range support, no-store responses. No raw-upload/log/metadata path access. |
| `POST /api/jobs/{id}/reference` | Strict JSON `{start_seconds,end_seconds}`; 10–20 whole seconds within the song. Returns validated manual selection, metrics, explanation and quality flags. No preset. |

Ready results identify `provenance.kind: local_separation`, model/device, sample rate/duration, common gain, fixed artifact URLs, optional suggested interval and separately confirmed reference. The health response retains `mode: scaffold` for the existing fixture UI, with `separation_available: true` identifying the implemented endpoint capability; per-job failures report missing CUDA/model/FFmpeg. `analysis_available` and `preset_generation_available` remain false.

The worker decodes into finite stereo 44.1 kHz audio, uses five-second CUDA model segments and exports three aligned PCM16 tracks. Backing sums non-guitar stems. One common gain on mix, guitar and backing prevents per-stem rescaling from distorting energy ratios. Neither energy ranking nor matching file lengths establishes separation accuracy or independently measured musical alignment. The complete checkpoint checksum/scaling report remains beside each local job.

## Checks and evidence

Run root `npm ci` / `npm run check`, then API-local `.\.venv\Scripts\python.exe -m pytest` (use a fresh ignored project `--basetemp` if Windows requires it). From `tools/demucs`, run `.\.venv\python.exe -m unittest test_worker -v` for CPU decoder, timeout, lock and no-CPU-fallback checks. Existing `test_smoke` regressions remain available separately.

Automated HTTP checks cover raw/chunked bounds, duplicate/busy behavior, background progress, failure/timeout, unavailable/unsafe artifacts, retry, strict reference bounds, interrupted restart, single-service ownership, corruption cleanup and retention. Frontend helpers reject invalid passages, foreign artifact URLs and invented result provenance.

The 27 October browser check uploaded the creator-provided **Exhilarate by Kevin MacLeod, CC BY 4.0**, through the actual API/RTX 4050 path. Source/credit are in ignored `data/bench/kevin-macleod-exhilarate/`; no audio is committed. All three players loaded 145.476-second distinct artifacts; duplicate click sent one POST; manual 00:30–00:45 confirmation, interval invalidation and reload recovery passed. A corrupt WAV exercised actual decoder failure without CUDA; a synthetic network interruption exercised reconnect. These are technical integration observations, not a human listening/bleed verdict or performance benchmark. Private user-provided music and converted samples stay in ignored local storage and must not be published.
