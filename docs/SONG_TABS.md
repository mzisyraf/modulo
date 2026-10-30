# Full-song GPU tabs

After separation, open **Full-song guitar tabs** in Tone Match and press **Generate full-song tabs**. This transcribes the entire extracted guitar track (10 seconds–4:55), independently of the confirmed tone-matching passage. No guitar, calibration or dedicated laptop GPU is required. Generation is explicit and can incur cloud charges.

Use Standard or Drop D tuning and capo0–12. Frets are relative to the capo, within the physical24-fret neck. Tuning changes reuse detected pitches; they do not retune playback. Click a fret or the song-position slider to seek, use **Play backing with tabs**, follow playback or choose another window. Set a loop start/end and enable practice looping;0.5×/0.75× preserves pitch where the browser supports it. Global Stop/navigation stop playback. Tabs use the existing backing clock and preserve the existing live-input/backing path; loop boundaries are browser-timed, not sample-accurate.

Text tabs use absolute timestamps rather than guessed beats/bars. JSON retains note timing, strength, pitch-bend flag, suggested string/fret and unassigned notes. MIDI retains the detected sounding pitches. Download outputs before the underlying job expires or is evicted. The app retains at most four separation jobs for24h; cached tabs belong to that retained job. Reopening/reconnecting it reuses the result. Uploading a song as a new job may require another transcription; there is no cross-job global cache.

## Model and credentials

Spotify Basic Pitch0.4.0, official ICASSP2022 ONNX model, Apache2. Model SHA256: `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec`. Attribution/source: https://github.com/spotify/basic-pitch . The pinned release constructs CPU-only ONNX sessions; our worker explicitly injects an ONNX Runtime CUDA session, disables runtime fallback and checks a kernel profile for real CUDA Conv/MatMul/Gemm execution. CPU audio preparation, note decoding and deterministic bounded fret assignment remain normal. No model training or Nemotron request is involved in tabs; Nemotron still powers rig generation.

The separate private Modal app is `modulo-tabs`, volume `modulo-tabs-jobs`. It uses L4/T4 capacity fallback, one GPU container, min0, two-second scaledown,300s execution/180s startup limits and no automatic retries. Input WAVs and temporary padded audio are deleted on success/failure; interrupted cloud artifacts expire after24–25h. Small retained local artifacts share the song's lifecycle. Source stays private and never enters Git. The frontend has no Modal credentials or direct public inference endpoint.

Dinnie/Shazlin use the same ignored backend files already documented in [TEAM_CLOUD_SETUP](TEAM_CLOUD_SETUP.md): `data/modal/config.toml` for Modal and `services/api/.env` for Token Factory rig generation. Tabs needs only the existing Modal client environment/token, not new keys or local model installations. The initial Modal token expires5November2026; judging access renewal remains a delivery task. Never publish these private files.

## Deployment and allowance

Run from repository root using the existing `tools/modal/.venv` SDK environment:

```powershell
$env:MODAL_CONFIG_PATH = Join-Path $PWD 'data/modal/config.toml'
tools/modal/.venv/Scripts/python.exe -m modal deploy tools/modal_tabs/app.py
```

The CUDA11.8/cuDNN8/Python3.10 image is isolated from Demucs and the API. Its full Python dependency lock is `tools/modal_tabs/requirements-lock.txt`. The older Modal builder compatibility setting matches the existing Python3.10 separator setup. The image verifies the packaged model hash before inference. No weights are committed or downloaded from an arbitrary request URL.

Isyraf expanded the initial four-attempt/US$1 feature allowance to **eight total attempts /US$2**, within the existing **US$10 Modal cap**. All earlier attempts still count. Remote `attempts.json` is reserved and committed before inference; failure/cancel/redeploy does not reset it. At the verified checkpoint,4/8 tabs attempts are consumed, leaving4 shared team attempts. The contemporaneous Demucs ledger reads9/10, leaving1 shared separation attempt; this feature did not change its counter or limits. Review live usage before another cloud separation. Limits are shared, not per laptop. These are conservative attempt guards, not a provider invoice or guaranteed workspace dollar cap; builds/startup/storage/cleanup and other sessions can incur charges. Do not delete/edit ledgers to retry.

## API and failures

`POST /api/jobs/{id}/tabs` with `{}` starts once or reuses ready/running output. A failed/cancelled attempt needs deliberate `{"retry":true}`. `GET` the same URL polls and accepts `?tuning=standard|drop_d&capo=0..12`. `DELETE` requests cancellation; `cancellation_pending` remains true until the submitting worker exits. Unconfirmed remote cancellation is reported explicitly. Work can continue in the background when navigating; reopen the same project to check it. Navigation never starts another inference. Late results are scoped to the old song and discarded after cancellation.

`GET /api/jobs/{id}/tabs/files/{json|txt|mid}` downloads fixed allowlisted formats. The API validates finite sorted notes, bounds, source identity, CUDA/model provenance and response sizes. It pins source files during work, persists the call ID privately, and marks interrupted work failed on restart while requesting cancellation. There are no automatic billed retries. Failures leave the separated tracks and rig flow intact. Inspect private `data/jobs/{id}/tabs-*/worker.log` for operator detail; avoid sharing audio or credentials in issue reports.

## Verification and honest limits

Predeclared gates are in `.Codex/evals/full-song-tabs.md`. The initial24s control exposed extra harmonic notes. One bounded extraction adjustment (frame threshold.5, melodia heuristic off) improved precision. A separate end-window defect was fixed by adding two seconds of context then trimming all notes/MIDI back to the original timeline.

Final295s known-note control: melody onset/pitch F1 **.8696** (gate.85), chord F1 **.8571** (gate.75), final notes **2/2**, long silent section **zero invented notes**, full duration preserved; **5824 CUDA heavy kernels**, **15.781s worker processing**. This is synthetic technical evidence, not a song-accuracy percentage.

Real cleared Exhilarate by Kevin MacLeod, CC BY4.0: full **145.4759s** song separated with local CUDA then transcribed on Modal; **589 notes**, **2912 CUDA heavy kernels**, **15.241s worker processing**, last detected onset144.3348s. Real JSON/text/MIDI, tuning/capo cache, backing playback, whole-song seek and390px layout pass. The final browser rerun reused this result after correcting a test-driver slider value; it made no additional GPU request. Worker timings exclude upload, queue/startup and download, and are not guaranteed user latency. Audio attribution remains in ignored `data/bench/kevin-macleod-exhilarate/ATTRIBUTION.txt`.

Reproduce controlled audio with `tools/verification/prepare-tab-control.py data/tabs/my-control --seconds 295`, run the private `tools/modal_tabs/client.py` explicitly within an approved allowance, then grade with `tools/verification/grade-tab-control.py`. Browser scripts are `song-tabs.browser.js` (injected transport, native playback/UI) and `song-tabs-real.browser.js` (metered unless a retained verification job is available), run through Playwright's filename interface. If Playwright is unavailable, use the manual product steps above and record PASS/FAIL for exports, seek, highlighting, loops, Stop, tuning cache, cancellation and navigation; Node alone does not execute these browser assertions.

Limitations: the model can confuse harmonics, distortion, bleed, bends and overlapping guitar parts. The guitar stem is a combined transcription, not separate lead/rhythm tracks. Suggested fingering is a bounded playability heuristic, not recovered original hand positions or a guarantee every chord is comfortable. Unassigned notes remain visible/exported. No real-guitar or human transcription/listening accuracy approval is claimed; this remains draft tablature.
