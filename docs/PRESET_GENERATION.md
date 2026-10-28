# Barebone preset generation integration

Status: integrated into main Tone Match and the standalone `/separation.html` workflow. The provider uses the tested draft without AI quality tuning. Runtime generation remains disabled by default; offline API/browser tests inject transport. Explicit local operator configuration enables paid manual generation, including the opt-in uncapped-dollar mode below. Technical tests do not establish musical quality.

## Scope

Use the confirmed local guitar passage to request a six-control Nano starting preset. The selector supplies server-measured energy, stem/mix ratio, quiet fraction and clipping fraction. A selected recording now supplies browser-measured input levels and a neutral gain baseline before generation. Source/target spectral analysis, calibrated tone matching and equipment identification remain incomplete. Shared preset schema and audio engine stay unchanged.

## Recording-first level calibration

Choose a 3–90 second, <=20 MiB guitar WAV/MP3 before generating. OfflineAudioContext decodes it without audible playback; the stronger mono/stereo channel avoids silent/opposite-polarity channels. Trim 50 ms blocks below -50 dBFS from the ends, require >=3 seconds of active-span audio, reject silence/nonfinite/clipped/overlong input. The original file is unchanged. Both comparison modes use the same prepared mono PCM WAV, with visible skipped-time and playback elapsed indicators.

The browser sends only `{id, method, duration_seconds, rms_dbfs, peak_dbfs, clipped_fraction}` as optional `source_calibration` beside `reference_revision`. `id` is SHA-256 of the prepared WAV, method is `browser_level_v1`; names, paths and audio are excluded. These are bounded **browser measurements**, not independently server-measured source features. Pydantic rejects unexpected fields, invalid types, NaN/infinity, inconsistent RMS/peak and unusable ranges before reservation. Target metrics still come exclusively from the server's confirmed reference.

Trusted baseline input gain is `round(clamp(min(-24 - RMS, -6 - peak), -24, 12), 1)` dB, with neutral drive/EQ and -12 dB initial output. The prompt receives this baseline plus source levels and server target energy, proposing final drive/EQ/output settings. After strict model validation, trusted code preserves the baseline input gain. Calibrated results carry `source_level_calibrated`, `spectral_calibration_missing`, `target_energy_only`, `tone_matching_unverified`; their description does not claim audible matching. Original mode bypasses calibration input gain and effects but retains final output gain/protection; modes are not loudness matched.

Generation caches include the full calibration object and reference revision. Different source measurements cannot reuse a previous result; concurrent replacement waits for the active attempt. Snapshots persist with generation, so restart does not lose source identity. The selected File stays in browser memory and must be selected again after refresh/leaving the page. Selecting/reconfirming references still invalidates old presets. Legacy requests without `source_calibration` retain their original uncalibrated behavior and warnings; new UI generations require a usable recording. No automatic paid request or retry is introduced.

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
