# Tone reliability 1–4 — predeclared 30 October 2026

Operator Isyraf; baseline staging4e5c8a3. Scope: better objective/validation, bounded chain alternatives, richer harmonic/decay descriptors and staged parameter allocation. Preserve budgets and raw proposals; start with cached real Nano/Super outputs, no new paid calls. Existing full-rig acceptance thresholds remain unchanged.

## Capability gates (before implementation)

- A lower training proxy cannot select a candidate whose separate-source validation spectrum regresses. Preserve original if no safe candidate improves validation; expose whether refinement was retained.
- Keep optimization within the first15s source: first60% (at most9s) training, remaining40% (at most6s) validation. Sources shorter than6s may Check but cannot claim validated refinement. Never fit the existing approximately14.3s final held-out file.
- At most80 actual renders total, including validation and output calibration. Structural hypotheses can add missing amp/cabinet/delay/reverb, swap installed amp/cabinet models and categorical choices; every candidate compiles through the unchanged strict proposal boundary. No factory-preset selection or arbitrary routing.
- Parameter search interleaves amplifier/drive/cabinet, EQ, ambience and dynamics controls so later effects get trials before the budget is exhausted. Multi-stage search includes coarse and fine adjustments; counters prove the bound.
- Add gain-normalized harmonic descriptors with confidence and decay/centered envelope descriptors with uncertainty. JS/Python parity and boundaries; pure sine vs clipped sine distinguishable, echo timing and decay synthetic tests; legacy source/target records without new fields remain valid.
- Retain two seconds of rendered tails for inspection/protection. Active-span features and level matching must not mistake appended silence for target dynamics.

## Quality grading

Frozen evaluation files: data/verification/full-rig-20261030 and external-rig-20261030. Preserve baseline reports/configs/clips before running new evaluation. Reuse all9 v2 Nano plus2 conditional Super controlled proposals and independent Nano; tag new scoring/search version, not a fresh-model claim. No hidden repeat removal, no change to the neutral/paired gate.

Primary outcome: per-case train and untouched held-out raw/RMS-matched multiresolution loss, safe peak/guard fraction, all-run pass counts. Secondary: compare each candidate against its original proposal; count regressions and no-change fallbacks. Do not select parameters using the final held-out scores. Aim to improve failed crunch/ambience cases without losing clean reliability; if unmet report rather than claim accuracy.

## Regression checks

- Deterministic rejection/rollback, search scheduling/structure validity and80-render cap tests, no new runtime dependency.
- Required npm ci/check, audio check:rig, API-local pytest, offline Modal checks and actual browser custom-rig refinement/cancellation/apply/source invalidation; main legacy flow remains supported.
- Only numeric descriptors to model; update versioned cache/prompt provenance if richer measurements are exposed. No budget reset or automatic extra paid call. Existing DSP algorithms, shared engine/recorder and ModelRigPanel styling unchanged.
- Human listening, physical instrument and different-song generalization are still separate acceptance. Report exact commit and evidence, not accuracy percentages.
