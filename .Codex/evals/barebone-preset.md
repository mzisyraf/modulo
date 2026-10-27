# Barebone preset integration eval

Defined before implementation, 27 October 2026. Personal modulo project; Isyraf owns this integration. Provider transport is injected in tests; no paid requests or quality refinement.

Code/schema graders:
- Ready, unexpired, SERVER-confirmed reference required. No client features/paths/provenance accepted.
- Default-disabled provider and provider failures preserve separated audio/reference and never produce a fallback preset.
- Duplicate generation coalesces; a success caches for that exact reference revision. Changing/reconfirming a passage invalidates previous/late generation. Restart fails an in-flight attempt without resetting its durable reservation.
- Six implemented controls only, strict generated provenance and trusted source_calibration_missing / target_energy_only / tone_matching_unverified disclosures. Existing 28 provider tests remain green.
- Expiry/capacity cannot remove active generation data; no main store lock is held over provider I/O. No automatic paid retry.

Browser graders (synthetic separation input and clearly named injected-provider preset):
- Upload -> job -> passage -> Generate -> candidate -> deliberate Apply -> edit -> Play/Stop works.
- No automatic playback or apply on generation; editing changes the existing AudioEngine and backing/reference stay outside its graph.
- Edited passage clears the current candidate/applied state and stops audio. Failures/reconnect cannot revive stale UI.
- Missing-calibration/energy-only/uncertain-match warnings remain visible through editing/apply. Existing main UI remains connected.

Threshold: all deterministic capability/regression checks pass; critical budget and stale-completion tests pass in 3/3 repeated runs. This is code-path stability, not repeated real-model reliability. Musical quality, calibrated matching and real-model pass@k are deferred; paid calls = 0 for this task.
