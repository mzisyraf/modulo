# Automatic custom-rig refinement — 30 October 2026

Baseline staging3fc6b88. Isyraf requests refinement by default. Preserve measured matching limits and the80-render bound; no new provider or GPU calls for this change.

- A user Generate/Retry that yields a new matching ready request starts one local refinement by default, with visible progress. Apply/play remain manual; no audible graph/microphone or extra model request.
- Automatic rendering is consumed once per requested response. Polling, Reconnect, navigation, cancelling and restoring original cannot retrigger it. Cached ready responses returned by an explicit Generate may refine; merely reopening an existing result must not start work.
- Source/reference/project changes, navigation and unmount cancel pending/running refinement. Late work cannot mutate the new source or apply/play. Cancel leaves the raw proposal checkable and does not retry automatically.
- A manual opt-out keeps existing Check/Refine workflow. Sources shorter than6s and refinement failures leave the original available with clear guidance; no silent validation or paid retry. Error cannot loop.
- Browser tests use intercepted API plus actual DSP to verify default, opt-out, once-only, cancel/no restart, restore/recheck, stale source and narrow layout. Meaningful scheduler unit tests cover request/source matching, and failed/short/off states. Required clean npmci/check, check:rig and API pytest remain green. Matching/DSP algorithm unchanged, so prior tone measurements are retained rather than regraded as new evidence.
