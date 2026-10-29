# Modulo workload and model inventory

## Which workloads actually need cloud GPUs?

### Takeaway
Only one implemented workload needs a rented GPU: mixed-song separation using Demucs `htdemucs_6s`. NVIDIA Nemotron Nano is a second neural model, but it already runs through Nebius Token Factory and does not require our own GPU endpoint. All other current tone analysis, calibration, reference selection, DSP, recording, rendering and refinement are CPU/browser work.

### Cited Findings
- The separator requires CUDA (no runtime CPU fallback), loads `htdemucs_6s`, validates exactly drums/bass/other/vocals/guitar/piano, then uses five-second segments, shifts=1, overlap=.25. It emits aligned mix/guitar/backing PCM16 stereo 44.1 kHz; backing sums the other five stems, so no second backing-removal model is needed. One shared gain preserves energy ratios. [worker.py lines 51–100](https://github.com/mzisyraf/modulo/blob/507e291/tools/demucs/worker.py#L51).
- Upload bound is 50 MiB; worker validates mono/stereo WAV/MP3, 10–295 seconds and 8–192 kHz input before stereo 44.1 kHz decode. [jobs.py lines 24–26](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L24), [worker.py lines 16–47](https://github.com/mzisyraf/modulo/blob/507e291/tools/demucs/worker.py#L16).
- Documented synthetic smoke ran on RTX 4050 Laptop 6 GB; 12-second signal took 12.915 s on first download/load and 6.226 s cached. This is not a full-song performance benchmark, a minimum-VRAM determination, or listening-quality acceptance. Tested Windows environment: Python 3.10.22, Torch 2.0.1+cu118, TorchAudio 2.0.2+cu118, Demucs 4.0.1, FFmpeg 9.0.2. The checkpoint is 54,996,327 bytes. [DEMUCS.md lines 43–54](https://github.com/mzisyraf/modulo/blob/507e291/docs/DEMUCS.md#L43).
- Exact implemented provider is `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` at `https://api.tokenfactory.nebius.com/v1`. It takes measured numeric source/target descriptors, deltas and supported six-control schema; it does not hear raw audio, isolate guitar, identify real equipment, train amp models, or render DSP. `max_completion_tokens` is 1,500; strict JSON-schema responses are parsed and validated. [preset_generation.py lines 16–19](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/preset_generation.py#L16), [lines 148–218](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/preset_generation.py#L148).
- Source calibration measures in browser from live dry input; only measurements are sent on Generate. Target spectral features are measured server-side on the confirmed guitar WAV: normalized six-band energy, centroid, flatness, crest, using ordinary FFT/math without torch. Named chord recognition is not implemented by these measurements. [recordingCalibration.ts lines 28–60](https://github.com/mzisyraf/modulo/blob/507e291/apps/web/src/recordingCalibration.ts#L28), [tone_features.py lines 1–89](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/tone_features.py#L1), [jobs.py lines 345–366](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L345).
- Automatic reference suggestions/waveform peaks use heuristic energy, brightness and dynamics in CPU Python; manual confirmation validates a 10–20 s interval. No model required. [reference.py lines 65–138](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/reference.py#L65).
- Amp is Web Audio gain, WaveShaper and three Biquad filters; live capture, offline rendering and processed recording all stay browser-local. [audio index.ts lines 87–118](https://github.com/mzisyraf/modulo/blob/507e291/packages/audio/src/index.ts#L87), [lines 154–173](https://github.com/mzisyraf/modulo/blob/507e291/packages/audio/src/index.ts#L154), [lines 254–342](https://github.com/mzisyraf/modulo/blob/507e291/packages/audio/src/index.ts#L254).
- Quality check/refinement uses the same OfflineAudioContext amp graph and CPU spectral comparison, up to 49 cached candidate renders on first 15 seconds, no extra AI calls. No cabinet/circuit model, compressor, delay or reverb exists in the current engine. Bigger cloud GPUs cannot supply unsupported effects. [PRESET_EVALUATION.md lines 48–58](https://github.com/mzisyraf/modulo/blob/507e291/docs/PRESET_EVALUATION.md#L48), [refinePreset.ts lines 9–57](https://github.com/mzisyraf/modulo/blob/507e291/apps/web/src/refinePreset.ts#L9).

### Inferences
- Practical architecture: existing local app/API orchestrates an authenticated serverless Demucs job; uploads/returns audio artifacts; CPU target analysis/reference selection stay on existing API; Nemotron remains Token Factory. No need to move browser or entire API into GPU billing.
- Budget class should start with an existing-generation 16–24 GB GPU (T4/A10/L4 depending actual compatibility/price) rather than H100; 6 GB smoke evidence shows a small card can execute segmented model, but each selected Linux GPU needs a real test. Avoid latest Blackwell GPUs for the old Torch/CUDA lock until validated.
- If separation quality is weak, first inspect bleed and current six-control DSP attainability. A larger LLM does not repair missing guitar isolation or create a cabinet effect.

### Gaps
- No current full-song warmed benchmark, cloud cold-start/queue measurement, varied listening-quality acceptance, or minimum VRAM test is established by these source files.
- Python module docstrings sometimes still say target-energy-only/no spectral matching; executable branches and newer evaluation docs show source/target spectral descriptors are implemented. Do not repeat stale docstrings as current behavior.

## Which extra models are optional rather than required?

### Takeaway
Keep two models for the deadline: Demucs plus hosted Nano. Do not turn optional research candidates into required GPU services.

### Cited Findings
- Current prior research lists Nemotron Super as a challenger to Nano, Omni as optional native-audio experiment, guitar-specialist RoFormer as conditional separator fallback with checkpoint/licence verification required. It is an older 25 October assessment, not current provider availability evidence. [prior report](../../reports/Nebius%20NVIDIA%20audio%20model%20options.md).
- Plan calls short monophonic tabs optional after core acceptance; named chord recognition is a separate unresolved requirement, not implied by source calibration. Custom model training and neural amp capture are explicitly deferred. [PLAN.md lines 70–79](https://github.com/mzisyraf/modulo/blob/507e291/docs/PLAN.md#L70), [lines 116–124](https://github.com/mzisyraf/modulo/blob/507e291/docs/PLAN.md#L116).
- Prior research identifies speech models (Parakeet/Canary/Riva) as unrelated to guitar isolation and NAM as needing paired dry/reamped capture rather than arbitrary songs. Treat as scope exclusions, not current app dependencies. [prior report](../../reports/Nebius%20NVIDIA%20audio%20model%20options.md).

### Inferences
- No reason to rent a second GPU for Super/Omni, speech transcription, chord labels, tablature, neural amp training or embeddings/RAG in the current MVP.
- Future tabs/chord detection deserve a separate scoped model evaluation, not a cloud infrastructure requirement today.

### Gaps
- No new upstream licence/model-card/catalog verification done by this inventory subtask; model-options researcher must verify optional candidates if included in final report.

## What changes does genuine scale to zero require?

### Takeaway
The draft VM/Compose stack is an always-running service layout, not a request-billed worker. A serverless adapter and durable job/artifact handling are necessary; merely putting the existing API on a GPU endpoint risks paying for CPU polling and losing background work.

### Cited Findings
- Existing JobStore uses one API filesystem service lock, one in-process ThreadPoolExecutor for separation and another for preset work. Jobs live under data/jobs and resume queued/running jobs as failures after restart, not durable replay. Max retained jobs=4, 24-hour retention. [jobs.py lines 24–26](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L24), [lines 60–122](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L60).
- API submits background separation and invokes a local `.venv` subprocess with 600-second timeout. It expects source.bin and WAV/report files on shared disk. Worker is a CLI, not an HTTP or provider-handler function. [jobs.py lines 187–218](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L187), [worker.py lines 103–129](https://github.com/mzisyraf/modulo/blob/507e291/tools/demucs/worker.py#L103).
- Reference cache is in memory keyed by job ID. Preset reuse is current reference revision and identical full source metadata; automatic content-hash cross-job separation caching is not implemented by these branches. Provider attempt budget ledger is durable, guarded by a file lock, and failures keep reservations. [jobs.py lines 268–289](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L268), [lines 323–342](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L323), [preset_generation.py lines 106–124](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/preset_generation.py#L106).
- Untracked draft deploy/Dockerfile launches Uvicorn continuously; deploy/compose.yaml requests a GPU for the whole API container and persistent named volumes, with a Caddy gateway. They contain no provider queue handler or scale-to-zero integration. These are local uncommitted artifacts inspected in current workspace, not published code. [draft Dockerfile](../../deploy/Dockerfile), [draft Compose](../../deploy/compose.yaml).
- Preset generator is deliberately pinned to Nano/base URL and the real key/allowance defaults disabled. Budget accepts US$0–1 or explicit unlimited and 0–100 requests; conservative reservation per attempt US$0.01608864 is a guard, not an invoice. [preset_generation.py lines 68–117](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/preset_generation.py#L68).

### Inferences
- Keep CPU job coordinator/polling/artifact streaming off GPU workers. A GPU invocation must encompass actual completed separation, or use provider-native durable jobs; returning HTTP 202 from an in-process thread does not guarantee a serverless container survives scaling down.
- Use server-generated object keys plus short-lived artifact access or authenticated download; local API can download/store results if it stays alive, so an external object store need not be mandatory for a single local demo. For a remotely judged persistent API, durable object storage or proven provider result persistence avoids ephemeral-disk loss. Do not embed 100+ MB WAVs in JSON/base64.
- Cache checkpoint (~55 MB) in the image/platform model volume and initialize once per warm container, rather than reload it for every model invocation. Validate exact hash and preserve shared normalization/export behavior. Existing CLI loads afresh per job; model reuse is an optimization requiring tests.
- Derived data-volume arithmetic: 295 s × 44,100 frames/s × 2 channels × 2 bytes ≈52.04 MB per output WAV plus header. Guitar+backing downloads total ≈104 MB; all three outputs ≈156 MB. This is output data, not billed GPU-seconds. Raw original can add up to 50 MiB. Actual files may be shorter. Avoid egress and storage cost surprises.
- Provider execution timeout must accommodate current ten-minute bound plus startup/upload; choose async job polling instead of a fragile long synchronous browser connection. Uploading and choosing references should not keep a GPU warm.
- Local source/live/processed audio should not be sent to GPU; only selected mixed song needs separation. Nemotron receives numeric descriptors. No inference belongs in live audio monitoring.

### Gaps
- Remote API adapter, artifact transport, authentication integration and content-hash separation cache remain unimplemented. No cloud endpoint can be honestly described as ready from current draft.
- Exact provider scale-to-zero persistence, idle billing, model startup and upload caps need current provider documentation and a real bounded test; no such test was performed here.
