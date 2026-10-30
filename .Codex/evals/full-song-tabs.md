# Full-song GPU tablature — predeclared 30 October 2026 20:40 MYT

Isyraf approves implementation, deployment and tested staging publication. Baseline9c0f3db. No main/public release. InitialUS$1/four-attempt limit expanded explicitly by Isyraf toUS$2/eight total attempts during implementation, inside existingUS$10 Modal cap; preserve prior reservations. No Token Factory calls/training. Stop GPU feasibility after30min; feature cutoff23:15MYT.

Capability gates: official hash-pinned Basic Pitch0.4 ONNX runs CUDA kernels on Modal L4/T4; no silently CPU-only result. Full10–295s input, overlapping windows and absolute timestamps through the final window. Known clean-note onset F1>=.85 and simple chord-note F1>=.75 within80ms, declared before tuning; one bounded adjustment maximum. Controls are technical accuracy evidence, not arbitrary-song accuracy. Silence must not invent a song. Report failures honestly.

GPU resource gate: one container, no automatic retries, min0, short scaledown,300s execution/180s startup bound. Persistent8-attempt reservation survives restart/redeploy/failure/cancel. Unknown/corrupt/busy ledgers fail closed. Profile CUDA model kernels; provider availability or nvidia-smi alone is insufficient. Record measured full-track latency/cost, not an estimate as evidence.

API gates: explicit action, duplicate reuse/cancellation/cache/source identity, bounded allowlisted artifacts and strict finite note schema, source pinning/expiry/restart, no secret/front-end credentials. Tuning changes reassign notes without inference. Cancellation/new song cannot publish stale output; another device requires no GPU.

Arrangement gates: standard/DropD/capo, pitch-to-string/fret invariance,0–24 bounds, same-string overlaps protected, unassigned/ambiguous notes visible, no silently dropped out-of-range notes. No original fingering guarantee.

Browser gates: whole-song tabs, backing clock highlighting/seek/loop/speed, pause/Stop/navigation/live monitoring lifecycle and downloads. Existing separation/reference/calibration/AI/automatic refinement/recording unaffected. npmci/check, rig check, API and Modal offline tests plus actual browser/runtime GPU verification before staging. Deterministic checks repeat release-critical cancellation/cache/stale paths; paid attempts are not repeated merely for test multiplicity.
