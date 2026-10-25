# Issue #1: preset and interface review

Reviewed against scaffold `d900017` on 24 October 2026. This is a proposal for Dinnie and Shazlin to review, not team approval or a frozen contract. No runtime fields or engine methods change in this review.

## Implemented preset v1

`contracts/preset.schema.json` remains the runtime authority for Ajv and Python jsonschema. Every field is required; neither validator inserts defaults. The manual example supplies these starting values:

| Parameter | Unit | Inclusive range | Example value | Engine behavior |
|---|---|---|---|---|
| `input_gain_db` | dB | −24 to +12 | 0 | Linear gain `10 ** (dB / 20)`, before drive and bypass split |
| `drive` | normalized | 0 to 1 | 0.25 | Identity at 0; normalized tanh curve with amount `1 + 40 * drive` otherwise; 2× oversampling |
| `bass_db` | dB | −12 to +12 | +1 | Low shelf at 250 Hz |
| `mid_db` | dB | −12 to +12 | +2 | Peaking filter at 1 kHz, Q 0.8 |
| `treble_db` | dB | −12 to +12 | −1 | High shelf at 3 kHz |
| `master_gain_db` | dB | −36 to −6 | −18 | Gain after dry/processed routing, then bounded output waveshaper |

Gain/EQ updates use a 15 ms `setTargetAtTime` time constant; drive replaces a curve directly. Bypass switches drive/EQ routing and retains input gain, master gain and the output guard. The guard bounds output to approximately ±0.95; gain alone does not establish loudness safety or a latency measurement.

The TypeScript `Preset`, UI sliders and engine parameter reads agree with all six schema names and ranges. Compressor, cabinet, delay, reverb and live input are absent and must not appear in generated presets yet. Schema extensions need Dinnie's DSP semantics and Shazlin's control review first.

Both validators reject unknown fields, missing controls, unsupported versions, booleans/numeric strings and non-finite control values. `fixtures/preset.parameter-cases.json` adds shared minimum/maximum and invalid-control cases to both test suites. Review found one Python bug: `math.isfinite(10**400)` overflowed before range validation. The number checker now lets integer bounds reject that value normally, with a regression test.

`provenance.kind` is `fixture` or `generated`. Generated presets require nonempty provider/model identifiers; this validates shape only, not evidence of a provider call. The manual example remains `fixture` with null provider/model and `fixture_only`/`not_tone_matched` flags. The schema currently permits strings on fixture provenance too; keep the manual fixture convention explicit until the team agrees additional fallback kinds. No automatic fallback is implemented.

## Actual interfaces versus the plan

The engine currently exposes `new AudioEngine(preset)`, `playTestSignal()`, `playFile(file)`, `applyPreset(preset)`, `setBypass(boolean)`, `stop()`, `dispose()` and optional `onEnded`. Playback returns `Promise<boolean>`; false means canceled. `initialize()` is private. `playFile` accepts up to 20 MiB, decoded locally; `dispose()` prevents reopening. The proposed public `initialize`, `startSample` and `startLive` in PLAN.md are future interfaces, not available imports. Dinnie and Shazlin should settle these before adding live input.

The API still exposes health, a manual preset and HTTP 501 for analysis. No job/result/error schema has been agreed. The proposed lifecycle and job fixtures in PLAN.md remain pending. Avoid freezing a successful job fixture before a real separator/provider path establishes its result shape. The offline reference selector's output is an internal prototype, not a new HTTP contract.

## Review still needed

- Dinnie: approve gain/drive/EQ/bypass semantics, ranges and example values; settle engine lifecycle and next supported effects.
- Shazlin: confirm units, labels, provenance presentation and cancellation behavior; agree job/result/error fixtures with Isyraf before wiring the upload flow.
- Isyraf: retain the single schema at provider validation; record real model evidence separately from shape validation. Agree job artifacts and errors after the first separator benchmark.

Issue #1 stays open until affected owners approve and job/failure fixtures exist. PR #9 remains a draft for the scaffold review.
