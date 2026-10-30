# Scorer and render efficiency — declared 30 October 2026

Baseline staging9eb58fa; Isyraf. User approves recommendations1+2 only. No new cloud inference/deploy/LLM calls, training or increased budgets. Stop optional scoring experiments at20:30MYT and preserve a stable fallback.

## Speed gate

- Decode once per source window (original/training/validation: three total) per refinement. Search/validation buffers bypass per-candidate PCM WAV encoding and decoding; existing renderRigFile/download callers keep their encoded-file API. Two one-time excerpt WAV conversions preserve browser-specific PCM normalization exactly; direct hand normalization failed the parity gate and is rejected.
- Same DSP, calibration, protected two-second tails, output bounds, source windows,80-render cap, abort/cleanup and scoring/search decisions. Preserve the former PCM16 search excerpt quantization rather than silently changing inputs.
- Native-browser before/after benchmark on identical licensed source/proposal/target; record wall time, decode count, WAV blob count, proposal/output/score parity. Multiple runs, no promised speedup before measurement. Candidate buffer/file renders must match samples within1e-7 for clean/drive/ambience chains.
- Reject invalid buffers/options/unsupported rates/nonfinite PCM and cancelled calls before inappropriate allocations. Required JS/API/Modal plus actual browser auto/manual/cancel/restore/source/live-backing regression gates.

## Learned metric gate

- Benchmark an available licence-compatible pretrained effects encoder offline first; record source revision/checkpoint hash, device, inference time, normalization and failures. Do not replace production scoring from literature claims.
- Known same-effect/different-performance positives versus different-effect/same-performance negatives; include clean/crunch/ambience, nearby parameter negatives and level controls. Keep evaluation performances independent of any choice of scorer weighting.
- A candidate metric must improve declared retrieval/ranking against current descriptors without losing clean reliability, and requires listening confirmation before broad quality claims. No metric tuning on the final held-out quality files. A small controlled benchmark is not fresh-song/model reliability.
- If checkpoint/dependency/time feasibility or ranking fails, publish the reproducible benchmark/evidence and leave the existing production metric intact. Encoder failure must never silently substitute a claimed learned result. No copyrighted source/weights/secrets enter Git.
