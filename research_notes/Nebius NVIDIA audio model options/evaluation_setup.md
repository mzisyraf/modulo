# Modulo evaluation and setup experiments

Research checked 25 October 2026 MYT. This is a proposed protocol, not benchmark results. No account, credits, provider calls, installations, browser tests or GPU jobs were performed. Human operator: Isyraf; research scope: issue #3 with issue #2 context. Existing code was inspected at `d98dee47c59c221a0b9465a12cea76fd2cdc278c`. Other researchers cover catalog/price verification and separation model selection.

## What should we compare and what would count as success?

### Takeaway

Compare a deterministic baseline with two NVIDIA text models on the same measured features and the actual six-control engine. Schema reliability, musical usefulness, latency and price are separate outcomes; a valid JSON object cannot prove a successful tone match.

### Cited Findings

- The shared runtime preset is schema version `1`, with only `input_gain_db` (-24 to 12), `drive` (0 to 1), `bass_db`/`mid_db`/`treble_db` (-12 to 12) and `master_gain_db` (-36 to -6). It rejects unknown keys, requires provenance, and has draft status. Delay, cabinet, compression and reverb must not appear in model output yet. [Repository schema](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/contracts/preset.schema.json)
- `app.contracts.validate_preset` already loads that schema and extends numeric validation to reject booleans and non-finite floats. API tests already cover unknown controls, invalid provenance and shared parameter cases. Reuse them rather than maintaining another Python preset definition. [Validator](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/services/api/app/contracts.py), [API tests](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/services/api/tests/test_api.py)
- NVIDIA's Nano card documents text input/output and configurable reasoning. Its self-hosted `chat_template_kwargs.enable_thinking` example is not evidence that Nebius forwards the same parameter. Verify the serving endpoint before setting it. [NVIDIA Nano model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)
- Nebius offers serverless inference for evaluation/prototyping, avoiding a dedicated serving VM for the first text-model comparison. This is a hosting recommendation, not proof of this user's access. [Nebius Token Factory](https://nebius.com/services/token-factory)

### Inferences

**Proposed candidates, contingent on authenticated catalog and inference checks:** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` first; `nvidia/nemotron-3-super-120b-a12b` challenger. Public catalog IDs/prices were supplied by the platform researcher; the final report should cite that research. Do not substitute a similarly named Hugging Face revision or claim account availability from these strings.

Use two local baselines: the existing labelled manual fixture as a fixed control, plus one frozen deterministic feature-to-six-control mapping written only when measured features exist. The latter is proposed work, not an existing feature. It helps answer whether the text model adds useful behavior. No generic formula can establish a uniquely correct drive/EQ value for an arbitrary recording, so do not grade against invented knob “ground truth.” A small paired dry/processed recording made through this same engine is useful for calibration; choose a preset on held-out musical content and measure/listen to the result, allowing equivalent settings.

Freeze three rights-cleared positive clips: clean, distorted and dense guitar mixes, ideally 60 seconds each, with aligned stems when available. Add silence, no-guitar/percussion-only, clipped and malformed/short audio cases. Keep raw audio under the ignored root `data/` directory; put only a rights/fixture manifest and permitted small metadata in version control. Manifest fields: fixture ID, permission/source, input SHA-256, intended condition and allowed use. Do not normalize stem and mix independently before reference selection.

Before tuning prompts, write these pass/fail gates:

| Gate | Proposed initial threshold and grader |
|---|---|
| Invalid input | Every invalid/unsupported input is rejected before separation or paid inference; deterministic code assertions. |
| Unusable reference | Every silence/clipping rejection remains a failure without a fabricated preset. No-guitar presence needs labelled listening or a later calibrated detector: the current energy selector cannot establish it. |
| Preset safety | Every accepted preset passes `validate_preset`, JS `parsePreset` and engine validation. Unknown controls, NaN, infinity, booleans, missing keys, out-of-range values and false provenance are rejected. |
| Text-model reliability | Three positive fixtures × three independent first attempts = nine outputs/model. Require 9/9 accepted after at most one bounded extra attempt per trial; separately report first-attempt pass@1 and every repair. All three successful runs on each fixture is stability evidence, not a population guarantee. |
| Truthful failures | Mock 401/402/404, 429/5xx, timeout, truncated/invalid JSON and refusal; no failure is displayed as generated success. These are offline provider-client regression tests, not calls to deliberately bad paid requests. |
| Musical utility | Three listeners, three randomized clip comparisons = nine ratings/model against baseline; require at least 6/9 preference wins, no clipping/unusable result, and retain individual notes/ties. This is a small screening gate, not statistically robust proof. |
| Latency | Record all attempts. Existing project target is preset inference within 15 seconds, warmed 60-second separation within 90 seconds. A miss is recorded rather than hidden by dropping failed attempts. |

For listening, use the same dry guitar take, implementation/engine version and playback level for every candidate, randomize labels/order and loudness-match comparison renders without changing preset parameters. First listen to the selected target reference, then compare each processed dry take. Ask “closer to the target?” and record brightness, distortion, low-end balance, artifact and playability comments. Different performances/pickups remain a confound. A language-model judge may check explanation wording; it should not be the only musical grader. Keep one clip held out from prompt tuning; if the prompt changes, run that clip and the full safety checks again.

### Gaps

- No real feature extractor, deterministic mapping, cloud inference, connected job path or musical benchmark currently exists. A winning model cannot be declared from this protocol.
- The current six-control browser chain has a limited attainable tone space. If both models perform similarly, prefer Nano on measured latency/cost; if neither beats the baseline, investigate features and engine limits before trying larger models.

## What is the smallest safe sequence from offline checks to real evidence?

### Takeaway

Do existing local checks first, establish account/model access second, run a two-call smoke third, and only then run a small approved comparison. Keep cloud analysis outside live guitar playback.

### Cited Findings

- Development setup specifies Node 24.15.0, Python 3.12, root `npm ci`/`npm run check`, and API-local `.venv` with `requirements-lock.txt`. It truthfully labels `POST /api/jobs` as unavailable (HTTP 501). [Development guide](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/docs/DEVELOPMENT.md)
- The existing reference CLI takes aligned PCM16 WAVs, scans eligible intervals, and supports a 10–20-second whole-second manual override. Its energy ratio is not a bleed/guitar-presence detector; every result retains `separation_quality_unverified`. [Analysis guide](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/docs/ANALYSIS.md)
- `.gitignore` excludes root `data`, `uploads`, `artifacts`, `models` and `separated` directories plus common weight extensions and `.env` files. These exclusions do not authorize committing other audio paths or credentials. [Ignore rules](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/.gitignore)

### Inferences

**Stage 0 — no spend.** Set up only the documented local environments. The following are future operator commands, not checks run for this research:

```powershell
# Repository root
npm.cmd ci
npm.cmd run check
cd services/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
.\.venv\Scripts\python.exe -m pytest
# Once actual aligned, rights-cleared PCM16 exports exist:
.\.venv\Scripts\python.exe -m app.reference '..\..\data\bench\guitar.wav' '..\..\data\bench\mix.wav'
.\.venv\Scripts\python.exe -m app.reference '..\..\data\bench\guitar.wav' '..\..\data\bench\mix.wav' --start-seconds 20 --end-seconds 35
```

**Stage 1 — account discovery.** Complete Nebius signup and inspect eligibility, credit expiry, billing terms, region and quotas without launching a VM. The platform research flags a card/automatic-charge setup: free credits must not be treated as a hard spending limit. Create a server-only Token Factory key and call the documented model-list endpoint. Capture exact IDs/capabilities. A model-list success is authentication/catalog evidence, not successful inference or billing entitlement. No key in frontend variables, issue comments, shell history or research files.

**Stage 2 — approved tiny smoke.** With an explicit cap, send one fixed synthetic feature object to each candidate: same controls/schema, system/user content and supported sampling settings. Mark synthetic features as such. Ask only for supported parameters and short descriptive fields; attach trusted provider/model/generated provenance server-side after a completed response. Merge measured quality flags server-side rather than trusting invented model confidence. Validate the complete envelope locally. The platform researcher found neither candidate tagged for JSON mode in the public catalog; do not assume strict JSON Schema support. Test a documented structured mode only if advertised for the actual endpoint; otherwise prompt for JSON and validate locally. A capability-probe request counts within the smoke/extra-attempt allowance.

**Stage 3 — approved bounded comparison.** Extract real features once and freeze them. Alternate Nano/Super call order across the three fixtures; perform three independent trials/model/fixture. Do not repair a prompt while scoring its competitor. If a model cannot finish within the frozen token/latency limits, record that result; changing limits creates a new comparison. Separately benchmark the separator first/cold and warmed runs, recording hardware, model revision and conversion/alignment details. Listen to the stem and automatic passage before judging presets.

**Stage 4 — integration evidence.** Only a selected valid preset applied in the browser to a known dry take proves an audible integrated effect. Repeat bypass/start/stop and check finite bounded output. Live interface input requires Dinnie's actual rig, channel/driver checks and measured round-trip latency; the existing ≤30 ms goal is separate from cloud/model timing.

### Gaps

- Authenticated catalog/response shapes, model reasoning controls and budget enforcement are unverified. Do not copy self-hosted model-card flags into Nebius blindly.
- No browser behavior changes were made, so no application/browser checks were run for these research notes.

## How should cost, failure handling and future implementation scope stay bounded?

### Takeaway

One small experiment needs no new orchestration framework or model router. Keep an explicit call ceiling, reserve worst-case call cost before each attempt, and record enough metadata to reproduce both successes and failures.

### Cited Findings

- Existing JS contract parsing and `AudioEngine.applyPreset` validate presets, while the frontend currently fetches only the manual-example endpoint. A future cloud result must preserve these boundaries. [JS contract](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/contracts/src/index.ts), [engine](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/packages/audio/src/index.ts), [frontend](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/apps/web/src/App.tsx)
- NVIDIA documents reasoning as additional generated text and provides budget-control examples. Their settings differ by backend; the provider's accepted output-limit semantics and billed usage must be verified before treating a token-cost estimate as a cap. [NVIDIA Nano card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)

### Inferences

**Proposed, unapproved inference cap: US$1, at most 40 total requests.** Two smoke requests plus 18 independent comparison requests are 20 initial calls. Allow at most one additional request per logical trial, used for either a transient retry or one invalid-output repair, never a nested retry tree: maximum 40 including failed/billed attempts. No live provider calls were authorized or made.

Illustrative pricing from the platform research: Nano US$0.06 input/US$0.24 output per million tokens; Super US$0.30/US$0.90. If every attempt fits 3,000 input and 1,500 total billable output tokens (including reasoning), 20 attempts/model cost:

`20 × [(3000×0.06 + 1500×0.24) + (3000×0.30 + 1500×0.90)] / 1,000,000 = US$0.0558`.

This is conditional arithmetic, not a quote or proven cap. It excludes GPU/storage/tax and assumes provider limits cover all billable reasoning. The platform researcher identifies `max_completion_tokens` as the current documented reasoning-plus-visible bound; verify it on the actual selected endpoint and record truncation rather than silently raising it. No universal thinking toggle was verified. Confirm current prices, token limits and usage reporting; a repair prompt also must fit the input envelope. Stop before another request when accrued cost plus its conservative reservation exceeds the approved cap, or after the request ceiling. If a safe reservation cannot be established, stop for a revised bound. A timeout may have consumed billable generation; reserve it rather than assuming zero. GPU separation needs its own approved instance/time/storage cap and shutdown verification.

For an eventual client, use a finite timeout; retry only connection failures, 429 or appropriate 5xx within the global allowance, respecting server retry guidance. Fail promptly on bad auth, payment exhaustion, missing model or malformed request. One schema repair may include concise validation errors; if it still fails, return an explicit failure. A baseline must remain labelled fixture/manual; never call it generated or silently convert a provider failure to success.

Record JSONL/CSV locally: run ID/time, source/fixture permission and hashes, mix/stem/reference boundaries, separator/feature versions, repository commit, schema/prompt hashes, exact requested/returned model and endpoint, settings/token ceilings, elapsed time, finish reason/status, raw first-attempt validity, repair count, token usage/price version/cost, quality flags and listener votes. Sanitize provider errors and never log keys/raw audio. Report pass@1 as x/9, after-repair success as y/9, per-fixture all-three success, and median/max latency; p95 from nine calls is descriptive only. Preserve failures in denominators.

Future scope, when implementation is authorized: add a small server-side provider/feature path under `services/api/app`, test its HTTP/error/validation boundary in `services/api/tests`, reuse `app.contracts`, and agree job/result/error fixtures with Shazlin. Current API `main.py` remains an honest stub until that path exists. `contracts/preset.schema.json`, fixtures, frontend consumption and audio engine are shared/other-owner boundaries requiring coordination; no schema/effect expansion, new SDK, queue service, fine-tuning or automatic model routing is necessary for this first comparison.

### Gaps

- Dollar and request limits above are proposals only; there is no budget approval or implemented cost guard today.
- All numerical pass/fail thresholds here are initial experiment decisions, not measured model capability. Replace assumptions with actual denominators, listening evidence and observed billing before selecting a winner.
