# Automatic custom-rig refinement — 30 October 2026

Baseline staging3fc6b88. Isyraf requests refinement by default. Preserve measured matching limits and the80-render bound; no new provider or GPU calls for this change.

- A user Generate/Retry that yields a new matching ready request starts one local refinement by default, with visible progress. Apply/play remain manual; no audible graph/microphone or extra model request.
- Automatic rendering is consumed once per requested response. Polling, Reconnect, navigation, cancelling and restoring original cannot retrigger it. Cached ready responses returned by an explicit Generate may refine; merely reopening an existing result must not start work.
- Source/reference/project changes, navigation and unmount cancel pending/running refinement. Late work cannot mutate the new source or apply/play. Cancel leaves the raw proposal checkable and does not retry automatically.
- A manual opt-out keeps existing Check/Refine workflow. Sources shorter than6s and refinement failures leave the original available with clear guidance; no silent validation or paid retry. Error cannot loop.
- Browser tests use intercepted API plus actual DSP to verify default, opt-out, once-only, cancel/no restart, restore/recheck, stale source and narrow layout. Meaningful scheduler unit tests cover request/source matching, and failed/short/off states. Required clean npmci/check, check:rig and API pytest remain green. Matching/DSP algorithm unchanged, so prior tone measurements are retained rather than regraded as new evidence.

## Integration evidence — 30 October 2026

Isyraf cancelled delegation; Dinnie published completed6a7497f before observing reassignment. Mergeb60fb81 preserves his acknowledged-request scheduler and this session's broader regressions. Runtime49640f4 also fixes live/backing coexistence. Source/solver/provider/DSP limits are unchanged by scheduling.

- Clean tracked-source npmci/check134 tests, catalog parity, TypeScript/build and check:rig pass on49640f4; API-local179 and Modaloffline7 pass. Existing bundle-size/Starlette advisories remain.
- Main intercepted browser36, automatic custom-rig actualDSP23 (including finite non-silent1.56s processed recording), controlled async scheduling20x3 and synthetic live-calibration7 pass on49640f4. Failed/short/off/cached/late-source/project/navigation/final-score-error cases are included. Intercepted POST counts are fixtures, not provider calls.
- Dinnie's native component suite32 assertions executed with real OfflineAudioContext onb60fb81. Its component/helper/refiner files are identical in49640f4. The dependency-free CDP runner was retained with portable ignored output paths and syntax-checked; the CLI itself was not run here.
- Final production asset index-DXcswAwZ.js repeats custom-rig23 and live/backing16 successfully, with finite/non-silent saved takes and no page errors. No paid cloud/model inference was used for implementation. Token Factory authenticated catalog and Modal deployment/ledger were queried read-only; these do not replace fresh inference or hardware evidence.

Tone-quality results remain those in docs/TONE_RELIABILITY_RESULTS.md, including the clean2/3 regression. Physical guitar/feedback/latency, independent teammate-laptop acceptance and fresh model/song generalization remain unverified. The paid real-cloud runner was adapted to wait for automatic refinement but was not executed.
