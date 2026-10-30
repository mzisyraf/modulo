# Live backing coexistence — 30 October 2026

Define before product edits. Grader: actual browser Web Audio/HTML audio with labelled synthetic capture and intercepted separation API; no physical-interface or timing claim.

- Starting backing while explicit live monitoring/processed recording is active preserves the existing input track and recording, without another permission request.
- Starting explicit live monitoring while backing plays preserves backing; pausing/restarting backing does not recapture input.
- Original-mix/extracted-guitar previews and file/test-signal auditions retain exclusive listening behavior.
- Global Stop and navigation release tracks and pause song players; late permission after Stop cannot revive capture. Input-ended stops monitoring. Recording remains processed guitar only, not the backing mix.
- Existing automatic-refinement, main workflow, file-mode calibration, output protection and source invalidation remain green. Three runs of the critical lifecycle path must pass; physical guitar/driver feedback, audible acceptability and round-trip latency remain unverified.

## Measured software result

The corrected browser regression reproduces the failure on isolatedb60fb81: backing invokes stopEngineAudio and ends the input track. Runtime49640f4 passes all16 assertions three consecutive times. Each run saves a finite/non-silent1.74s processed take; the220Hz synthetic guitar component exceeds the1000Hz backing component by more than10x, confirming guitar-only recording. Both start orders, pause/restart without recapture, preview/sample exclusivity, Stop, navigation, late permission and input-ended cleanup pass. The fake track implements native idempotent Stop; no physical capture was opened.

This establishes browser lifecycle/recording behavior, not hardware listening, acoustic feedback or measured synchronization. No DSP, capture-engine, provider or schema changes; no model/GPU requests.
