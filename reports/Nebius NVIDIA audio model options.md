# Nebius NVIDIA audio model options

**Start with Demucs `htdemucs_6s` for guitar separation and Nebius Token Factory hosting Nemotron Nano for preset generation; compare Nano with Super before choosing.** This is the smallest practical route to modulo's mixed-song → reference → preset → browser-amp goal. It uses a guitar-capable separator for audio and an NVIDIA text model for converting measured features into supported controls. Native-audio Nemotron Omni is a worthwhile optional experiment, but its public model card does not establish accurate guitar-tone matching or an available Nebius audio endpoint. The decisive test is whether the generated preset sounds closer to the reference than a simple baseline through the actual browser engine. Public documentation was checked on **25 October 2026 MYT**; live catalogs can change and do not establish account access. Isyraf currently has no account or credits, and **no spending, account creation, installation or runtime inference was performed for this research**.

## Separate audio extraction from preset reasoning

Nebius is the hosting platform; NVIDIA supplies model families and GPU hardware; the selected model determines the task. Running any separator on an NVIDIA GPU does not itself establish use of an NVIDIA-authored model. The official competition requires NVIDIA-model usage with Nebius runtime infrastructure, and the Best Apps and Agents description specifically connects Nemotron with Token Factory. Its deadline converts to **31 October 2026, 01:00 MYT**. A working judging path must remain available into December, so deployment cost extends beyond submission day. ([Official rules](https://nebiusglobalaihackathon.devpost.com/rules))

The following shortlist avoids building an LLM-serving stack before knowing whether it improves this six-control task. The exact Nano and Super aliases and token prices come from the current public Nebius catalog; preserve capitalization and verify them with the eventual account. Prices are USD per million input/output tokens, excluding taxes and additional attempts. ([Nebius public catalog](https://tokenfactory.nebius.com/api/public/models_info))

| Option | Concrete use in modulo | Hosting and price | Decision |
|---|---|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Measured features → supported preset and short explanation | Token Factory; **$0.06 input / $0.24 output** | First candidate |
| `nvidia/nemotron-3-super-120b-a12b` | Same task, testing whether extra capacity improves useful output | Token Factory; **$0.30 / $0.90** | Challenger using identical inputs |
| Demucs `htdemucs_6s` | Mixed audio → guitar stem | Separate local environment or approved Nebius GPU VM | Separation baseline; not NVIDIA's model |
| Nemotron Nano Omni Reasoning | Reference audio → additional tone descriptions | NVIDIA-hosted prototype or self-hosting; Nebius audio serving unverified | Optional after the core path works |
| Guitar-trained RoFormer | Alternative extraction when Demucs fails listening checks | Exact checkpoint/config and weight rights must be established | Conditional fallback |

Demucs's six-source model includes guitar; its usual four-source model does not. Upstream describes the six-source version as experimental and the project as no longer actively maintained. The repository has MIT terms. This gives us a documented starting point, not a quality guarantee. Its default clipping protection can rescale individual stems, which matters when comparing guitar energy with the original mix. ([Demucs README](https://github.com/facebookresearch/demucs/blob/main/README.md))

NVIDIA's actual audio checkpoint is `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`. Its card accepts audio alongside other modalities and documents WAV/MP3 input. Self-hosting is substantially larger than a separator experiment: the listed minimums are an H100 80 GB for BF16 or L40S 48 GB for FP8. A native-audio model returning text still does not return an isolated guitar stem. ([NVIDIA Omni card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16))

NVIDIA Build separately lists hosted ID `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` and prototype access. Actual audio requests, eligibility and quotas remain untested. A server-local `file://` example from a self-hosted card is not a remote upload procedure. More importantly, Nebius's cookbook mentions Omni while its examined live catalog has no Omni entry. Treat **model capability, provider availability and accepted input format as three separate checks**. ([NVIDIA Build](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning), [Nebius cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md), [Nebius catalog](https://tokenfactory.nebius.com/api/public/models_info))

Speech products do not solve guitar analysis. Parakeet is speech recognition, and Canary-Qwen explicitly distinguishes transcription from reasoning over a transcript. Riva and NeMo provide speech services and development tooling rather than a ready guitar-isolation model. Neural Amp Modeler requires a dry test signal and reamped target recording, a different data problem from an existing song. ([Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Canary-Qwen](https://huggingface.co/nvidia/canary-qwen-2.5b), [Riva](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/index.html), [NAM capture guide](https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/colab.html))

A guitar-specialist RoFormer is credible as a comparison, but architecture names alone do not establish target stems. MVSep documents a guitar/other API model; that does not establish downloadable weight rights. The inspected `becruily` guitar checkpoint exposes files without a visible model card or licence, so it is not an approved deployment choice. Resolve model-specific rights and checkpoint provenance before loading or shipping it. ([MVSep API](https://mvsep.com/en/full_api), [Publisher files](https://huggingface.co/becruily/mel-band-roformer-guitar/tree/main))

## Establish account access before spending on compute

**First, inspect the actual offers and billing terms.** The Nebius Builder Program advertises $25 Token Factory credit through joining, email verification and claiming the offer. This is an advertised opportunity, not credits already granted to Isyraf; eligibility, expiry and service restrictions require confirmation. No guaranteed hackathon GPU grant or redemption code was established; inspect the organizer registration email/dashboard for any participant-specific offer. ([Builder Program](https://dev.nebius.com/builders))

Token Factory's billing documentation separately describes bank-card onboarding and a $1 trial valid for 30 days. It also describes automatic charging when a balance goes negative, at month start or a configured threshold. Do not assume trial and Builder offers stack, or that a credit balance prevents charges. If an actual promo code is supplied, redeem it through balance → Top up → With promo code, then inspect Transactions and record its value, expiry and covered service. ([Token Factory billing](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new))

**Second, create the Token Factory project and server-side key** after reviewing those terms. Follow the quickstart, inspect the public catalog, and then call authenticated `GET https://api.tokenfactory.nebius.com/v1/models`. A successful list establishes authentication and discovery, not inference entitlement or musical quality. Keep the key out of `VITE_` variables, Git, issue comments and commands saved in shell history. ([Quickstart](https://docs.tokenfactory.nebius.com/quickstart), [Model discovery](https://docs.tokenfactory.nebius.com/api-reference/models/list-models))

The following documentation example uses the API's existing Python environment and standard library. Save it temporarily outside Git and run with `services/api/.venv/Scripts/python.exe` from a normal terminal. It reads the key at a hidden prompt and performs **discovery only**, with no inference POST. It has not been run against an account. The [platform research notes](../research_notes/Nebius%20NVIDIA%20audio%20model%20options/nebius_platform.md) also contain an optional bounded first-call standard-library example; that call checks connectivity only and does not establish preset acceptance.

```python
import getpass
import json
import urllib.error
import urllib.request

request = urllib.request.Request(
    "https://api.tokenfactory.nebius.com/v1/models",
    headers={"Authorization": "Bearer " + getpass.getpass("Token Factory key: ")},
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        models = json.load(response)["data"]
    print(sorted(item["id"] for item in models if item["id"].startswith("nvidia/")))
except urllib.error.HTTPError as error:
    raise SystemExit(f"Discovery HTTP {error.code}; no retry.")
except (urllib.error.URLError, TimeoutError):
    raise SystemExit("Discovery failed; check connectivity and account setup.")
```

**Third, agree a cap before one preset smoke request per model.** Send the same explicitly synthetic feature object, supported controls and descriptive-output instructions to `POST /v1/chat/completions`. Use the exact discovered model ID and an explicit `max_completion_tokens`, initially 1,500 for the proposed comparison. The API documents this as including visible and reasoning tokens. No universal Nebius thinking-disable switch was verified; do not copy self-hosted `enable_thinking` settings blindly. Empty or truncated content is a failed attempt, not a reason to silently increase the budget. ([Chat API](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion))

Strict structured output is also a test gate. Nebius documents `json_schema` and `json_object` modes with model-dependent support, but the examined Nemotron entries lack its JSON-mode tag. Use plain JSON prompting and local validation unless the actual serving endpoint proves the requested mode works. Any capability probe consumes the same request allowance. ([Structured outputs](https://docs.tokenfactory.nebius.com/ai-models-inference/json))

The server must attach trusted provider/model/generated provenance and measured quality flags after successful inference. The model supplies candidate parameters and explanatory text; it cannot certify its own origin or invent reliable confidence. Validate the complete envelope with existing `app.contracts.validate_preset`, then preserve JS `parsePreset` and audio-engine validation. ([Python validator](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/services/api/app/contracts.py), [JS validator](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/contracts/src/index.ts))

## Prepare local fixtures and one isolated separator environment

The current runtime contract supports only six controls: input gain **−24 to 12 dB**, drive **0–1**, bass/mid/treble **−12 to 12 dB**, and master gain **−36 to −6 dB**. Cabinet, compressor, delay and reverb are outside the implemented schema. Keeping this boundary prevents an impressive explanation from promising an effect the engine cannot produce. ([Runtime schema](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/contracts/preset.schema.json))

Use the documented Node 24.15.0 and Python 3.12 environments. The commands below are setup instructions, **not checks rerun during this research**; create `.venv` only on first setup and otherwise reuse it. ([Development guide](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/docs/DEVELOPMENT.md))

```powershell
# Repository root
npm.cmd ci
npm.cmd run check
cd services/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
.\.venv\Scripts\python.exe -m pytest
# After obtaining aligned PCM16 guitar and mixture exports:
.\.venv\Scripts\python.exe -m app.reference '..\..\data\bench\guitar.wav' '..\..\data\bench\mix.wav'
# Optional manual 15-second passage:
.\.venv\Scripts\python.exe -m app.reference '..\..\data\bench\guitar.wav' '..\..\data\bench\mix.wav' --start-seconds 20 --end-seconds 35
```

Prepare three rights-cleared positive mixes: clean guitar, distorted guitar and a dense arrangement, ideally 60 seconds each. Self-recorded mixes with known stems give stronger evidence than unidentified commercial songs. Add silence, no-guitar/percussion-only, clipped, short and malformed negatives. Keep audio/weights under ignored local storage and version only the permitted fixture manifest: source/permission, hash and intended condition. The reference selector already accepts aligned PCM16 files and manual 10–20-second whole-second intervals, but its energy heuristic cannot reliably detect absent guitar or bleed. Listening or labelled evidence remains necessary. ([Analysis guide](https://github.com/mzisyraf/modulo/blob/d98dee47c59c221a0b9465a12cea76fd2cdc278c/docs/ANALYSIS.md))

For Demucs, keep the separator environment separate from the API lockfile. A short CPU trial can expose decoding/dependency problems before cloud rental. The exploratory Linux commands below follow upstream usage; **they are not a tested version pin**. Select compatible Python/PyTorch/torchaudio and decoding dependencies, run the tiny fixture, and freeze the environment and checkpoint hash only after success. ([Demucs setup](https://github.com/facebookresearch/demucs/blob/main/setup.py))

```bash
python3 -m venv /path/outside-repo/modulo-separator
/path/outside-repo/modulo-separator/bin/python -m pip install demucs
/path/outside-repo/modulo-separator/bin/python -m demucs \
  -n htdemucs_6s -d cpu -o /path/artifacts /path/rights-cleared-short-mix.wav
# Repeat with -d cuda only after the separate GPU budget is approved.
```

For GPU benchmarking, quote a **single feasible GPU preset**, compatible Ubuntu/driver image, CPU/RAM, disk and network together; verify quota and run `nvidia-smi`. Nebius lists L40S GPU components separately from full presets, with public presets from $1.55/hour; H100 is $4.50/GPU-hour after October 1. Those rates do not establish available capacity or the final bill. AI Cloud also lists a $25 minimum first payment, separate from the tiny inference cost. ([Compute pricing](https://docs.nebius.com/compute/resources/pricing), [Pricing summary](https://nebius.com/prices), [Compute setup](https://docs.nebius.com/compute/quickstart))

Record cold download/load time separately from warm inference, then inspect output duration, sample alignment, peaks and audible bleed. Keep stem and mixture scaling consistent before ratio features; record any separator rescaling rather than independently normalizing both. Download needed results, stop the VM, and inspect retained disks/filesystems: stopped compute can still leave storage charges. Delete only explicitly identified test resources after preserving results. A containerized job can follow a successful environment; neither separation nor model inference belongs in live guitar playback.

## Choose with a small controlled comparison

Freeze one simple feature-to-control mapping as a deterministic baseline once real measured features exist; retain the current labelled manual preset as another control. Neither feature extraction nor that mapping is implemented today. Use the same schema, measured feature objects, prompt, output bound and supported sampling settings for Nano and Super. Hold one clip out from prompt tuning, and rerun the fixed comparison if the prompt changes. There is no uniquely correct set of knobs recoverable from an arbitrary song, so score useful behavior and audible similarity rather than invented parameter ground truth.

The proposed batch contains **two smoke calls plus three clips × three independent trials × two models: 20 initial calls**. Permit at most one extra attempt per logical trial, used for either repair or a transient retry, giving **40 total requests maximum**. Capability probes must replace an allocated smoke/extra attempt or wait for a revised plan. The proposed ceilings are **US$1 for inference and a separate US$5 for compute**. Both are unapproved; neither is an implemented provider spending limit.

With at most 20 attempts per model, each bounded to 3,000 input and 1,500 total billable output tokens, catalog-rate arithmetic is:

`20 × [(3000×0.06 + 1500×0.24) + (3000×0.30 + 1500×0.90)] / 1,000,000 = US$0.0558`.

This conditional estimate excludes GPU/storage/tax and assumes the endpoint enforces the reasoning-inclusive bound. Before each attempt, reserve its conservative cost against the approved allowance; count timeout outcomes as potentially billed. Stop at the dollar or request limit, and stop if a reliable reservation cannot be made. Repair prompts must fit the same input envelope. No nested retry tree or automatic model escalation is needed.

| Outcome | Proposed screening gate |
|---|---|
| Safety | Every accepted preset passes Python, JS and engine validation; unknown controls, non-finite values, booleans and unsafe bounds fail. |
| Reliability | Report first-pass validity **x/9 per model** and success after the allowed extra attempt **y/9**; require 9/9 eventual valid results for this initial screen. |
| Honest failures | Offline mocks cover auth/payment/model errors, 429/5xx, timeout, refusal and invalid/truncated JSON; none becomes fake generated success. |
| Musical usefulness | Three listeners × three clips = nine ratings/model against baseline; **at least 6/9 preference wins**, no unusable/clipping result, and individual notes retained. |
| Runtime | Measure against project targets: preset inference ≤15 seconds and warmed separation of 60 seconds ≤90 seconds; retain failed/slow attempts. |

For listening, predeclare each clip's representative as its first valid independent trial, and report repeated-trial variation separately. Randomize labels and order, use the same dry performance and engine version, and loudness-match comparison renders without changing their preset settings. Listeners hear the target reference first, then judge closeness, brightness, distortion, low end and artifacts. Ties are not wins. Different instruments, pickups and playing remain confounds. Nine ratings are a practical screen, not statistical proof; a language-model judge cannot substitute for hearing the result.

Record exact requested/returned model, endpoint, repository commit, schema/prompt/feature versions, source and reference hashes/bounds, separator revision, settings, finish reason, validity, repairs, elapsed time, tokens, price snapshot and listener votes. Report median/max latency; a p95 from nine calls is descriptive only. Retry only suitable transient failures within the allowance; fail promptly on auth, payment, unavailable model or malformed requests. A failed provider call must remain a failure or an explicitly labelled manual baseline.

## Let evidence determine the next implementation

If Nano and Super perform similarly, choose Nano on measured latency and cost. If Super wins clearly through the actual engine, the small token-price difference can be justified. If neither beats the baseline, first inspect separator bleed, measured features and the engine's attainable tone space; a larger language model cannot create unsupported DSP effects. Omni earns further work only by improving that same comparison enough to justify audio-serving complexity.

The next implementation scope is a small server-side feature/provider path under `services/api/app`, boundary tests under `services/api/tests`, and agreed job/result/error fixtures with Shazlin. Reuse the existing contract; coordinate any effect expansion with Dinnie. Real acceptance still requires a separated reference, a real validated Nebius/NVIDIA response applied audibly in the browser, and Dinnie's measured live-interface demonstration. This report supplies the selection and setup process; it does not establish those outcomes or a tested cloud environment.

Skipped paid inference, GPU provisioning, installations and application/browser/hardware tests. Account eligibility, credit terms, hosted capabilities and actual musical quality remain unverified.
