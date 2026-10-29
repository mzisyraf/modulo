# Full-rig acceptance — declared before implementation

Approved: Isyraf, 30 October 2026. Baseline c0738b9. See docs/OVERNIGHT_EXECUTION_PLAN.md for limits.

## Capability gates

- Model catalog/schema is generated from the actual TS registry; regeneration must produce no difference.
- Every selected module has explicit supported own-parameter values; unknown/missing fields, nonfinite/range errors, custom IRs, unsupported routing and more than eight processing modules are rejected before application.
- Proposals compile through the actual model adapter into valid RigPreset; individual model parameters affect real rendered output. Factory preset selection alone fails.
- File calibration uses the licensed previous dry take or upload, never requests microphone access, and supplies the same prepared file to audition/refinement. Live calibration remains silent and is labelled separately.
- Actual Nano inference, actual Modal separation and the combined main workflow must produce usable results without local CUDA/Torch/Demucs in the selected Cloud path.

## Quality experiment

Three controlled cases: clean/EQ, crunch/amp+cab, delay/reverb. Three independent Nano generations per case. Keep every outcome, not only the best. Declare exact target parameters before requests. Use the first 15 seconds of licensed Guitar-TECHS DI03 for development, refine on at most its first 10 seconds; remaining approximately 14.3 seconds is held out and never optimized on.

- All repeated schema/application/safety gates pass (release-critical pass^3 = 1).
- Output is finite, peak <=0.951, guard fraction <0.01.
- A changed refinement improves its original feature loss; held-out paired raw loss is below neutral and RMS-matched spectral loss <=0.9 * neutral.
- Compare raw and refined candidates, neutral, and known target; report absolute metrics and failures. Improvement is not an accuracy percentage.
- If Nano fails these gates, allow at most six Super calls on comparable cases, within the shared service budget/request limits. No blind retry. A malformed response may receive at most one counted repair.

Obtain the matching external amp recording within 30 minutes if available, align its known offset and report it separately. An unpaired extracted song and different dry performance allow feature/timbre proxy comparisons, never waveform-reconstruction claims. Self-rendered targets alone do not establish independent real-world quality.

## Regression gates

- Legacy preset requests/imports, local default/explicit Cloud choice, one shared amp, recordings, backing transport, safe bypass and manual model rigs continue working.
- Source/reference/project/mode changes and late responses cannot apply stale proposals or revive audio.
- Provider/schema/budget/timeout failures preserve the last working rig; no synthetic success or silent Local fallback.
- Live/file calibration, narrow UI and source-to-DSP behavior have real browser checks, with synthetic capture labelled.
- npm ci/check, audio check:rig, API-local pytest and relevant Modal offline checks pass on the combined staging candidate.

## Evidence and completion limits

Record exact code/catalog/DSP/source hashes, model IDs, request failures, cloud billing/quota, latency and clips. Never commit credentials/private music/weights. Human listening, physical guitar/interface feedback and round-trip latency remain unverified until humans perform those checks. Do not mark full audible acceptance done from a proxy score.
