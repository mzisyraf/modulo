# Local separation checkpoint

The main **Tone Match** view at **http://127.0.0.1:5173** and standalone **/separation.html** connect real local upload to cached `htdemucs_6s` CUDA separation. Both provide original mix, guitar and guitar-reduced backing players, explicit 10–20-second reference confirmation and budget-gated starting presets. Neither needs a guitar/interface for sample audition. Tone Match preserves calibration, projects and recordings; generation still lacks source-guitar features and calibrated matching.

This is an Isyraf integration preview for #2/#3/#6, with the proposed job boundary in #1/#6 awaiting Shazlin's review. The confirmed passage now connects to [budget-gated starting presets](PRESET_GENERATION.md), editable Apply and browser audition. It does not freeze the shared contract or establish broad separation quality, calibrated tone matching, real source features, recording or synchronized live play-along acceptance. No extra paid call is enabled by the integration.

## Run

Follow [DEVELOPMENT.md](DEVELOPMENT.md) for Node and the API venv, and [DEMUCS.md](DEMUCS.md) for the isolated separator environment and cached model. Do not install Torch/Demucs into the API environment. The worker requires the tested checkpoint SHA256 and actual CUDA; it neither downloads a missing model nor falls back to CPU.

1. From the root, run `npm ci` and `npm run dev`.
2. From `services/api`, run `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. Use one API worker and no reload during a job.
3. Open **Tone Match** (or `/separation.html`), choose a rights-cleared WAV/MP3, and select **Separate guitar**.
4. Compare the tracks, then choose **Suggested passages** or **Manual selection** on the shared full-song waveform. Suggested regions have fixed bounds; Manual permits drag/move/resize, keyboard and timestamp editing. Select the listening source, preview, then select **Confirm reference**. The starting-preset panel then exposes provider availability, Generate, editable controls, deliberate Apply and separate Play; generation stays disabled until a separately approved runtime allowance is configured.

The standalone page remembers its job ID in session storage and reconnects after refresh. Tone Match saves a job ID with each in-tab project; navigation keeps the current job, and reopening another project reconnects to its own job. Refresh clears these in-memory projects, files and calibration takes. Starting another project during an upload aborts the browser request; an already accepted server job may continue until expiry. Changing bounds clears the displayed confirmation; invalid selections never silently choose another passage. Native players can audition the entire tracks; the passage buttons start at the chosen time and stop near its end using browser time updates. Only one of this page's players plays at a time. Tracks go directly to the browser output, outside the guitar amp.

## Limits and storage

- WAV/MP3 only; decoded mono/stereo at 8â€“192 kHz, 10â€“295 seconds, upload at most 50 MiB. The 295-second limit keeps 44.1 kHz stereo PCM16 exports below the existing reference selector's 50 MiB limit. File extensions/MIME are checked at the UI boundary; FFprobe/FFmpeg validate the actual content in the worker.
- One active upload/job, one separator process, 60-second upload timeout, 600-second worker timeout. Duplicate submissions reuse their idempotency key. A different active job gets an actionable busy response.
- Up to four jobs under ignored `data/jobs/`; jobs expire after 24 hours and the oldest completed job may be evicted sooner. Cleanup runs on requests, startup and every minute. Expired open files are inaccessible and deletion retries after players release them. Raw uploads are removed on success/failure. Four maximum-length jobs use roughly 625 MB of exported WAVs, plus one bounded upload and small metadata/logs.
- Atomic metadata updates recover interrupted uploads/runs as failed after restart. A service lock excludes multiple API processes using the same directory. A worker lock excludes an orphan application worker after a crash; unrelated research programs do not use this lock, so coordinate GPU experiments separately.
- Bind only to localhost. Host and mutation-Origin checks prevent arbitrary web origins from launching work. No permissive CORS, remote authentication or public hosting is added. Provider keys stay server-side; generation defaults to disabled and needs a separately approved runtime allowance. Remote deployment needs a separately designed access boundary.

## Draft HTTP boundary

| Request | Behavior |
|---|---|
| `POST /api/jobs` | Raw file body; `Content-Type: audio/wav` or `audio/mpeg`, `Idempotency-Key: <UUID>`. Returns HTTP 202 `{job_id,status}`. No client filename/path becomes a storage path. |
| `GET /api/jobs/{id}` | Server UUID; `queued`, `running`, `ready` or `failed`, stage and expiry. Result exists only when ready; errors contain `{code,message,retryable}`. |
| `GET /api/jobs/{id}/audio/{mix\|guitar\|backing}` | Fixed allowlisted PCM16 WAVs, browser Range support, no-store responses. No raw-upload/log/metadata path access. |
| `GET /api/jobs/{id}/references` | Cached local contrasting options (0–3) plus bounded mix/guitar waveform peaks. No reference confirmation or provider call. |
| `POST /api/jobs/{id}/reference` | Strict JSON `{start_seconds,end_seconds}`; 10â€“20 whole seconds within the song. Returns validated manual selection, metrics, explanation and quality flags. No preset. |

Ready results identify `provenance.kind: local_separation`, model/device, sample rate/duration, common gain, fixed artifact URLs, optional suggested interval and separately confirmed reference. The health response retains `mode: scaffold` for the existing fixture UI, with `separation_available: true` identifying the implemented endpoint capability; per-job failures report missing CUDA/model/FFmpeg. `analysis_available` remains false for unimplemented calibrated analysis; `preset_generation_available` reflects the configured provider allowance and is false by default. Generation uses a separate status and never implies separation itself generated a preset.

The worker decodes into finite stereo 44.1 kHz audio, uses five-second CUDA model segments and exports three aligned PCM16 tracks. Backing sums non-guitar stems. One common gain on mix, guitar and backing prevents per-stem rescaling from distorting energy ratios. Neither energy ranking nor matching file lengths establishes separation accuracy or independently measured musical alignment. The complete checkpoint checksum/scaling report remains beside each local job.

## Checks and evidence

Run root `npm ci` / `npm run check`, then API-local `.\.venv\Scripts\python.exe -m pytest` (use a fresh ignored project `--basetemp` if Windows requires it). From `tools/demucs`, run `.\.venv\python.exe -m unittest test_worker -v` for CPU decoder, timeout, lock and no-CPU-fallback checks. Existing `test_smoke` regressions remain available separately.

Automated HTTP checks cover raw/chunked bounds, duplicate/busy behavior, background progress, failure/timeout, unavailable/unsafe artifacts, retry, strict reference bounds, interrupted restart, single-service ownership, corruption cleanup and retention. Frontend helpers reject invalid passages, foreign artifact URLs and invented result provenance.

The 27 October browser check uploaded the creator-provided **Exhilarate by Kevin MacLeod, CC BY 4.0**, through the actual API/RTX 4050 path. Source/credit are in ignored `data/bench/kevin-macleod-exhilarate/`; no audio is committed. All three players loaded 145.476-second distinct artifacts; duplicate click sent one POST; manual 00:30â€“00:45 confirmation, interval invalidation and reload recovery passed. A corrupt WAV exercised actual decoder failure without CUDA; a synthetic network interruption exercised reconnect. These are technical integration observations, not a human listening/bleed verdict or performance benchmark. Private user-provided music and converted samples stay in ignored local storage and must not be published.


## Main Tone Match integration

`App` owns the single amp engine for sample audition and live input. Embedded `StartingPresetPanel` delegates deliberate Apply to that owner and exposes no second audition graph. Proposal edits require Apply again; after Apply, the shared amp controls update its sound directly. Reference/backing players stay outside the amp. Source previews, navigation and project switches stop prior playback/capture; reference changes or known job expiry invalidate a generated preset. Calibration remains local and is not sent to generation. The standalone page retains its own deliberate Apply/Play controls.

The repeatable browser regression is `tools/verification/tone-match.browser.js`, run through Playwright's `browser_run_code_unsafe` filename argument against a dev server on `127.0.0.1:5174`. It intercepts all API requests with labelled TEST ONLY data and uses real Web Audio for graph checks; it makes no GPU/model call or automatic microphone request. Run `npm ci` and `npm run check` as normal; use an isolated tracked-source copy when a running Windows dev server locks dependencies.


The waveform/suggestion details and limitations are in [ANALYSIS.md](ANALYSIS.md). Reproduce synthetic UI interactions with `tools/verification/reference-waveform.browser.js` through the Playwright browser runner, against the isolated dev server on port 5174. It intercepts every API request and does not establish listening quality. The existing `tone-match.browser.js` also checks the new selector alongside shared-amp generation behavior.


## Recorded-guitar comparison

Open `http://127.0.0.1:5173/separation.html` for the complete local workflow and its four-step guide. Choose/separate a target song, confirm a suggested or manual passage, generate a starting preset, then deliberately Apply. Existing jobs reconnect in the same tab without another separation or generation.

Under **06 / Your guitar**, choose a locally recorded guitar WAV/MP3 (up to 20 MiB), press **Play guitar recording**, and switch **Original guitar / Rig applied** while playback continues from the same position. Original neutralizes preset input gain and bypasses drive/EQ; both modes retain the preset output level and engine output protection. They are not loudness matched, and Original is not a bit-exact export. Edits preserve the selected mode; switching back restores the current rig settings. Stop stops playback; Play restarts it. Video files may need their audio extracted to WAV first.

The separated song guitar is the target, not the input to this comparison. The user's recording stays in the browser; it is still not analysed or supplied to the provider as source calibration. This UI does not establish tone similarity, physical-interface latency or processed-audio export.

## Windows cleanup and upload recovery

Changing songs or leaving a project releases the native audio source (`pause`, remove `src`, `load`) so old range streams do not retain files. If Windows/OneDrive leaves an empty directory behind after all its files were deleted, retention drops that job from memory and defers the empty-folder cleanup; it cannot occupy a job slot indefinitely. A directory that still contains locked audio continues to return `storage_busy` and requires its player to be closed. The same empty-directory handling applies when recovering jobs at API startup. No arbitrary folder or nonempty locked artifact is silently discarded.
