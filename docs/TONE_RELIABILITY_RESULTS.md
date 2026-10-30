# Tone refinement 1–4 — 30 October 2026

Implemented and tested from source `29d7de57993b851089c208fcdab010e157952104`, based on staging `4e5c8a3`. The four requested improvements are present. **Overall controlled Nano pass count improved from4/9 to8/9; one previously passing clean case now fails. Full repeatability and human listening acceptance remain open.** This is a private staging review candidate, not an accuracy or release claim.

## Implemented behavior

1. **Comparison and rollback:** score separates spectrum, harmonics, dynamics and timing. Search uses up to9s training plus6s source validation, only within the first15s. Finalists must improve both development excerpts and cannot worsen validation spectrum beyond numerical tolerance. Otherwise original timbre parameters remain. Output gain is separately calibrated. Restore original proposal resets the draft and requires Check before Apply.
2. **Actual chain alternatives:** bounded installed-model candidates can remove several unnecessary modules, add missing amp/cabinet/delay/reverb and try discrete model/microphone/switch choices. Each proposal uses explicit own-parameter values and passes the unchanged compiler/strict validators. No factory rig is selected.
3. **Richer observations:** gain-normalized log-band cepstral shape, estimated six-harmonic power/confidence, centered envelope correlations every10ms and isolated-attack decay ratios/counts. Periodicity is uncertain with polyphony and pickups. JS/Python parity is tested; optional fields retain compatibility with old records. Rich requests have prompt version `rig-features-v3` and their own cache scope. No learned audio model was added.
4. **Staged allocation:** fit basic timbre, revisit ambience after EQ improves, then fine-adjust controls across families. A broad rising/boundary autocorrelation is not accepted as a confident echo estimate. Six finalists at most get separate-source validation. All renders, validation and output calibration fit the80-render limit; observed maximum was78. Rendering includes two seconds of tails for protection checks, excluded from active-span RMS/features.

Calibration still accepts3–90s; independently validated refinement needs at least6s. Source/reference/project invalidation, cancellation, deliberate Apply, one shared engine and protected recording remain in place. Dinnie's DSP/model definitions and Shazlin's editor/CSS were not changed.

## Frozen regression comparison

Same licensed Guitar-TECHS DI03 source, declared target chains, cached real v2 proposals and unchanged original gate: safe finite output, lower raw multiresolution loss than neutral, RMS-matched loss below90% of neutral. Existing approximately14.3s final audio is never passed to the optimizer. Development decisions have seen aggregate grading results during iteration, so this is a regression comparison, **not a new blind generalization test**.

| Case | Previous Nano held-out pass | New Nano train / held-out pass | New cached Super train / held-out pass |
|---|---|---|---|
| Clean/EQ | 3/3 | 2/3 · 2/3 | Not requested |
| Crunch/amp+cab | 1/3 | 3/3 · 3/3 | 1/1 · 1/1 |
| Delay/reverb | 0/3 | 3/3 · 3/3 | 1/1 · 1/1 |
| Independent amp microphone | 1/1 | 0/1 · 1/1 | Not requested |

All12 final cached-proposal candidates rendered safely. The independent amp case retained the original timbre settings when no independently validated refinement won; protected output was still calibrated. Its held-out loss was0.4211 versus0.4933 neutral. Training still missed the10% margin.

The failed clean repeat1 has held-out loss0.4083 versus0.2162 neutral; the previous optimizer reached0.0590 on that repeat. Clean repeat2 also has a higher loss than the previous optimizer while still passing the threshold. A lower new development proxy therefore does not establish universal improvement over the previous algorithm. Do not present8/9 as a tone-accuracy percentage. Some accepted configurations include effects absent from the declared target: matching diagnostic characteristics does not recover exact original gear/settings.

The first search iteration and all failures remain in `iteration1-report.json`; original baseline results remain in `baseline-report.json`. No repeats were discarded or thresholds relaxed. The browser tool's300s response timeout did not stop the offline controlled evaluation; incremental files were inspected and completion confirmed before grading.

## Actual richer-feature model check

One new real Nano v3 request on the controlled crunch case returned a strictly valid individual-parameter rig. Its untouched chain was treble boost/EQ/compressor, demonstrating that richer text descriptors alone still do not reliably identify an amplifier. Local fitting added the required useful structure. Its processed result passed the train/held-out gate (RMS-matched loss0.0930 training,0.0971 held-out). This is one smoke case, not a new three-repeat reliability result. No Super repair or GPU request was made for this follow-up.

Final preserved Token Factory ledger: **40 cumulative attempts, US$5.05741824 reserved**; one new US$0.20 reservation. Existing US$10 /46 cumulative stop stays unchanged. This makes24 new requests since the overnight baseline, within the approved30. Failed historical calls retain reservations; this is not a billing invoice. Modal remained6/10 attempts, four remaining, zero backlog/runners; latest metered snapshot US$0.04041824, billedUS$0 after adjustments, subject to lag. No keys, limits or ledgers were reset.

## Checks and listening evidence

- Clean tracked-source `npm ci`, `npm run check`:131 tests, TypeScript, generated-catalog parity and production build; audio `check:rig` passed.
- API-local venv pytest179 passed; Modal offline7 passed. Existing Starlette deprecation and bundle-size advisories remain.
- Main browser legacy36 and expanded custom-rig16 checks passed: actual offline render/search/validation,80-render cap, cancellation with no extra model call, restore/check/apply gating, zero microphone requests, stale source invalidation, shared engine and390px layout. These use labelled synthetic API transport.
- Separate actual v3 Nano response was validated, compiled, rendered/refined and graded with the real browser DSP. No new mixed-song/GPU smoke was necessary because that path/DSP implementation was unchanged.

Ignored local reports contain RMS-matched Target / Neutral / Raw Nemotron / Refined audio, raw WAVs and full hashes/metrics:

1. `data/verification/rig-reliability-20261030/listening-report.html` — all frozen controlled repeats.
2. `data/verification/external-reliability-20261030/listening-report.html` — independent amp recording.
3. `data/verification/rig-v3-smoke-20261030/listening-report.html` — one real richer-feature request.

Next acceptance is human listening and a fresh different-song/source test, especially the regressed clean case. Physical guitar/interface feedback/latency and teammates' own-laptop setup are still unverified. Audio-aware similarity remains a possible later step; it is not part of this implementation. Main/publication/licence/submission decisions remain with the team.
