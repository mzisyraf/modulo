# Preset and custom model-rig generation

Status: main Tone Match supports a full model rig with explicit individual parameters, alongside the legacy six-control preset under its disclosure. The standalone `/separation.html` page was removed. Runtime generation remains disabled by default; offline API/browser tests inject transport. Explicit operator configuration enables paid manual generation. Full rigs require a bounded numeric allowance; the legacy uncapped option does not enable them. Technical checks and spectral proxies do not establish musical quality.

## Custom model rigs

`POST /api/jobs/{job_id}/rig` uses the confirmed reference revision plus validated live/file source calibration. Existing async job status, expiry, stale-result checks and durable request reservations are reused. Generation is tagged `kind=rig_proposal` and returns `rig_proposal` rather than a legacy `preset`; old requests remain on `/preset`.

The installed TypeScript model registry owns supported controls. `node tools/evaluation/export-rig-catalog.ts` generates `contracts/rig-proposal.schema.json`, `rig-catalog.json` and its hash; `npm run check` verifies parity. A proposal contains 1–8 ordered model IDs, enabled states and complete own-parameter values. The backend and browser reject unknown/missing/unsafe values; the browser compiles through the real model adapters into a validated RigPreset. Input calibration and a protected output are added by trusted code. No factory-preset identifier, custom IR asset or arbitrary routing is accepted from the model.

The main flow offers live capture or a locally decoded dry recording, including the licensed supplied DI. Only numeric descriptors go to Token Factory. Generate automatically refines and safety-checks the matching ready proposal once by default; Apply and playback remain deliberate. Unchecking **Refine automatically after generation** preserves manual Check/Refine. Reconnect, navigation, Restore, cancellation and reopening an existing result never authorize another automatic attempt. An explicit Generate returning a cached response does authorize one. Short source recordings and rendering failures preserve the original with manual Check guidance; stale work cannot update another source/project. Check renders the actual graph.

The unchanged `validated-structure-v2` refiner performs at most **80 actual renders including validation and output calibration**. It tests bounded installed amp/cabinet/delay/reverb alternatives and discrete choices, then interleaves important amp, EQ, ambience and dynamics parameters with coarse/fine steps. These are individually fitted hypotheses, not factory-preset selection; raw provider output remains available through **Restore original proposal**. Automation makes no extra model/GPU requests and does not alter the documented tone-quality results.

Validated refinement requires at least six seconds of prepared source. Only its first15 seconds are eligible: first60% (at most9s) trains and the rest validates, with each portion at least3s. Server-measured reference windows use the same60/40 division. Old cached results without windows use the fixed whole-reference descriptors and still validate on a separate source excerpt. Finalists must improve training and separate-excerpt validation, without validation-spectrum regression beyond a small numerical tolerance; otherwise the original timbre settings are retained. The approximately14.3s final benchmark holdout is never supplied to refinement. This is validation of a feature proxy, not proof of perceived improvement.

Rendering retains two seconds of tails for safety inspection; appended silence is excluded from active-span features/RMS. Output is separately calibrated within -36 to -6dB and peak headroom; source input gain stays fixed. Rich descriptors add eight log-band cepstral coefficients, estimated first-six-harmonic power/confidence, centered envelope correlations at10ms intervals, and isolated-attack decay ratios with observation counts. Periodicity confidence is reduced when usable frames are scarce. These are uncertain signal measurements, not a learned embedding, effect classifier or equipment identification. Browser/Python implementations are parity-tested. Review/apply remains deliberate; model controls stay editable. Approximate processors, different notes/pickups and separation bleed limit accuracy.

Exact runtime IDs: Nano `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, conditional approved Super `nvidia/nemotron-3-super-120b-a12b`, selected by backend `NEBIUS_RIG_MODEL`. Full-rig calls reserve US$0.20 before transport against the existing shared local ledger; errors retain reservations. This exceeds the worst-case full 262144-token context plus 10000 output at Super's US$0.30/US$0.90 per million, checked against the official catalog on 30 October. A 180-second transport timeout allows bounded reasoning. Explicit `NEBIUS_RIG_FALLBACK=1` permits one Super repair only after invalid Nano rig output; both attempts reserve funds. Auth, rate, transport and budget failures do not trigger this repair. Super has a durable six-request stop. A numeric US$0–10 allowance and cumulative request limit are required. These remain local controls, not a global cap on a shared key.

Cache scope includes source measurements, reference revision, catalog, all audio source files, model and prompt/analysis versions. New rich-feature requests use `rig-features-v3`; cached v2 outputs remain valid inputs for offline search comparisons and are labelled as cached, not fresh inference. Catalog or response mismatches fail before application. See [the approved execution plan](OVERNIGHT_EXECUTION_PLAN.md), [declared evaluations](../.Codex/evals/tone-reliability.md) and [GPUless team setup](TEAM_CLOUD_SETUP.md).

## Scope

Use the confirmed local guitar passage to request a six-control Nano starting preset. The selector supplies server-measured energy, stem/mix ratio, quiet fraction and clipping fraction. Live instrument calibration supplies browser-measured input levels and a neutral gain baseline before generation. Optional source/target spectral descriptors now guide generation, with rendered checks/local refinement; exact tone matching and equipment identification remain unverified. See [PRESET_EVALUATION.md](PRESET_EVALUATION.md). The shared preset schema is unchanged; the engine adds offline rendering and transient listening gains using the existing effect graph.

## Live instrument measurements

Select the physical instrument device/channel and play notes/chords for 10 seconds using **Calibrate live guitar**. Capture uses the existing dry-input worklet with monitoring disabled; the device is released after measurement or cancellation. No guitar recording upload is accepted. Trim quiet 50 ms blocks from the ends and require at least three seconds of active-span audio; reject silent, clipped or nonfinite input. The temporary captured sample supports optional comparison and stays in browser memory.

The browser sends `{id, method, duration_seconds, rms_dbfs, peak_dbfs, clipped_fraction, tone_features?}` as optional `source_calibration` beside `reference_revision`. `id` is SHA-256 of the prepared WAV, method is `browser_level_v1`; names, paths and audio are excluded. These are bounded **browser measurements**, not independently server-measured source features. Pydantic rejects unexpected fields, invalid types, NaN/infinity, inconsistent RMS/peak and unusable ranges before reservation. Target metrics still come exclusively from the server's confirmed reference.

Trusted baseline input gain is `round(clamp(min(-24 - RMS, -6 - peak), -24, 12), 1)` dB, with neutral drive/EQ and -12 dB initial output. The prompt receives this baseline plus source levels and server target energy, proposing final drive/EQ/output settings. After strict model validation, trusted code preserves the baseline input gain. Level-only results carry `source_level_calibrated`, `spectral_calibration_missing`, `target_energy_only`, `tone_matching_unverified`; their description does not claim audible matching. Original mode bypasses calibration input gain and effects but retains final output gain/protection. Standalone recording comparison now offers transient RMS matching, enabled by default; synthetic signals and comparison with matching disabled retain raw levels.

Generation caches include the full calibration object and reference revision. Different source measurements cannot reuse a previous result; concurrent replacement waits for the active attempt. Snapshots persist with generation, so restart does not lose source identity. Temporary live PCM stays in browser memory; recalibrate after refreshing or switching projects. Selecting/reconfirming references still invalidates old presets. Legacy requests without `source_calibration` retain their original uncalibrated behavior and warnings; new UI generations require usable live instrument calibration. No automatic paid request or retry is introduced.

## Integrated files and ownership

Isyraf's application-integration session incorporated the research chat's released provider/test/docs draft as the sole source writer. `main.py`/`jobs.py` now expose reference-scoped generation, and `StartingPresetPanel.tsx` provides generated controls and deliberate apply/play in the separate preview. The subsequent main Tone Match integration preserves calibration/session/recordings and delegates Apply to App's existing engine. The standalone preview retains its independent audition; embedded mode creates no second engine. Shared UX review remains in issue #6.

## Provider boundary

```python
from app.preset_generation import PresetGenerator, PresetError

generator = PresetGenerator.from_env()
generator.available  # key and a configured allowance; not live account verification
preset = generator.generate(confirmed_reference)
```

`generate` is synchronous and performs blocking HTTPS. Run it in a worker/thread, not directly in an async route. `confirmed_reference` is the SERVER-LOADED result of `select_reference`, including its metrics/flags. Optional source levels use only the strict `SourceCalibration` boundary above; client target features, paths and provenance remain rejected. `PresetError` exposes only sanitized `code`, `message` and `status` for the API's existing error envelope. A provider timeout may have been billed and is not retried.

Return values pass `contracts/preset.schema.json` via the existing strict Python validator. Model candidates require exactly `name`, `description`, `parameters`; extra effects/metadata, malformed/nonfinite/duplicate JSON, truncation, wrong model and unsupported values fail with no manual-fixture fallback. Provider/model provenance, quality flags and final descriptions come from trusted code. Legacy results disclose missing calibration; calibrated results disclose level-only calibration and unverified spectral tone/similarity. The model's description is validated but is not shown to users.

## App wiring acceptance

1. The Generate action requires a ready, unexpired job and explicit confirmed passage. Read its metrics on the server. Missing provider configuration is an actionable disabled state.
2. One generation action per job/reference may run at once. Cache a successful result for that exact reference; retries after ambiguous failures must be deliberate and consume a new allowance. Changing/reconfirming the interval invalidates old results and any late response. Do not hold the main job-store lock across the provider HTTP call.
3. Show generating/ready/failed status independently of successful separation; a model failure must keep the valid separated audio/reference usable. Never invent a preset on failure.
4. Show the generated starting preset with explicit missing-calibration/target-energy-only/uncertain-match labels. Require deliberate Apply; existing six controls stay editable. Preserve raw/backing players outside the guitar processing chain. No automatic loud playback.
5. Cover ready/expired/missing reference, duplicate generation, provider disabled/error, invalid response, changed-reference late completion, successful apply and preserved editable controls in API/UI checks. Inject a fake transport only in tests; label test evidence as such. No additional paid model call is authorized by this integration request.

The additive route/job fields below remain reviewable in #1/#6; this implementation does not silently freeze a shared contract.

## Local route and UI flow

- Confirm a passage using the existing reference endpoint. Each confirmation increments `result.reference_revision`, clears prior generation, and invalidates late responses even when the same bounds are reconfirmed.
- `POST /api/jobs/{id}/preset` accepts `{reference_revision: <whole number>, source_calibration?: <bounded numeric source object>}`. The server loads the matching confirmed reference and returns HTTP 202 generation state. Missing/expired/unconfirmed/stale references fail before provider work; client target metrics/paths are rejected. The full source snapshot is returned on calibrated generations.
- `GET /api/jobs/{id}` keeps separation `status: ready`; its independent `generation` contains a request UUID, reference revision and `generating|ready|failed`, plus validated `preset` or sanitized `error`. Duplicate in-flight/successful requests reuse that attempt/result. A failed attempt is retried only by another deliberate action.
- One preset thread runs independently of the separator. The store lock is released over provider I/O. Active generation pins its files; queued work rechecks expiry/revision before reserving budget. Restart fails in-flight generation without resetting the ledger. Provider/storage failures never convert a successful separation into failure or silently apply a fallback.
- After generation, edit the existing six controls and press **Apply starting preset**. Apply does not start playback. **Play test signal** is explicitly synthetic; a selected dry recording is local-only and is not source calibration. Further edits update the applied amp; preview/backing playback stops amp audition. Changing the passage unmounts/disposes the old audition and clears its candidate.

The panel owns its isolated AudioEngine. When Shazlin moves the flow into Tone Match, choose one engine owner and preserve its stop/dispose/device lifecycle; do not run two competing amp engines. Reuse the API client/parser and trusted warnings rather than rebuilding a separate job contract.

## Runtime configuration

The existing private `services/api/.env` stays unchanged. Environment variables override the same names in that file. Only the official fixed HTTPS Nano endpoint is accepted; redirects cannot forward the credential. No dependency is added.

```dotenv
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
# Default disabled. Set only an explicitly approved separate runtime allowance.
NEBIUS_BUDGET_USD=0
NEBIUS_MAX_REQUESTS=0
```

The previous US$0.10 / three-request experiment is finished; do not reuse its unused dollars as authorization for more requests. Integrate without changing the real .env or making live calls. Add the two zero-default fields to .env.example and explain activation only when the split includes that file.

The local starter accepts a numeric US$0–1 budget, or the explicit `unlimited` value to remove its dollar cap, with 0–100 configured requests. These settings are not provider-side billing limits. The durable `data/preset-inference/budget.json` reserves US$0.01608864 BEFORE each call. This overcounts an entire 262144-token input context plus 1500 completion tokens at the public Nano rates US$0.06/US$0.24 per million checked 27 October 2026. Recheck rates/model context before enabling a new allowance. The request itself is much smaller. Limits are cumulative against that directory; restart does not reset them. Corrupt/busy budget data fails closed. Errors/timeouts retain the reservation; do not delete/reset this ledger to retry. Local reservation is not a provider-side billing cap or invoice. Cloud deployment needs its own access/rate/budget design.

## Current evidence and remaining gaps

Existing real Nano smoke: 3/3 responses satisfy the six-control preset schema, 2/3 satisfy all original checks, with inconsistent settings for identical synthetic inputs. That is access/format evidence only. The integrated provider/API/browser checks use injected transport; the browser harness uses synthetic separation input and a preset named TEST ONLY. They establish wiring, warnings, controls/lifecycle and cost guards, not hosted generation, real source calibration, listening quality or tone similarity. See `artifacts/nebius-model-access-20261027T143605Z/RESULTS.md` for the earlier real results. No additional paid request is authorized or performed by this integration.

Official references: [chat completion limits](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion), [public model/rate catalog](https://tokenfactory.nebius.com/api/public/models_info).


## Explicit operator opt-in without a dollar cap

An operator may set `NEBIUS_BUDGET_USD=unlimited` and `NEBIUS_MAX_REQUESTS=100` in their ignored local `.env`, then restart the API without zero-valued process overrides. Only the explicit text `unlimited` removes the monetary check; invalid/NaN/infinite numeric inputs still fail closed. Zero defaults keep new checkouts disabled. The cumulative 100-request stop, 1500 completion tokens, single output, manual action/no automatic retry, strict validation and durable reservation ledger remain. Existing reservations and failed attempts are not reset. The health response exposes `preset_budget_unlimited`; enabled uncapped UI states disclose that new generations/retries can incur charges. Unlimited local dollars do not remove provider charges or account credit limits.

For this Isyraf session, the user explicitly requested removing the dollar cap on 28 October 2026; that instruction supersedes the earlier consumed smoke-only allowance for subsequent local manual generation. The feature does not authorize deployment or a team-wide `.env` change. New real-flow evidence uses the already-confirmed server reference and prepared user recording; it still does not supply source-calibration features or establish musical similarity.


### Recorded-guitar live checkpoint — 28 October 2026

After the user explicitly removed the local dollar cap, a real Nano request for the retained confirmed Maroon 5 00:00–00:15 reference returned a schema-valid generated starting preset. Deliberate Apply and brief playback of the user-provided 68.9-second guitar recording, bypass, real drive-curve edits and Stop passed in the browser with one audio context and no page errors. The source WAV was prepared locally from video with 1.068 dB conversion attenuation to leave headroom; the guitar recording was not sent to the provider. Ledger records one reserved request; reservation is not an invoice. No source-calibration/tone-similarity, live hardware or recording/play-along acceptance is inferred. Audio, preset and screenshots remain ignored local evidence under data/verification/guitar-audition.

## Spectral path and rendered feedback

New recordings add validated `spectral_bands_v1` descriptors: six normalized bands, centroid, flatness and crest. The server measures the confirmed target from its protected WAV, rechecks source/reference/expiry before spending, and sends source/target descriptors, relative band deltas and actual drive/EQ semantics to Nemotron. Missing or malformed spectral pairs fail before reserve. Ready generation metadata includes `target_tone_features` and `target_rms_dbfs`; trusted flags are `source_level_calibrated`, `spectral_features_measured`, `tone_matching_unverified`. Legacy requests remain supported. Full source metadata, not file ID alone, scopes reuse.

`Check rendered tone` and `Refine locally` reuse the same protected engine offline, never cloud calls or speaker contexts. Their cross-performance feature proxy is not the controlled paired benchmark. Local refinement is labelled separately, preserves raw provider data, supports cancel/stale-result cleanup, and requires deliberate Use refined controls then Apply. See [PRESET_EVALUATION.md](PRESET_EVALUATION.md) for the bounded algorithm, gate, reports, numerical limits and human-listening requirements.
