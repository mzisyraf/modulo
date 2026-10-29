# Run Demucs on demand with Modal

**Use Modal with one L4 GPU for Demucs, and keep NVIDIA Nemotron Nano on Nebius Token Factory.** Only separation currently needs a GPU that modulo deploys. The other implemented steps use ordinary CPU calculations or the browser's audio engine. This split meets the published hackathon platform requirement when the real NVIDIA/Nebius inference path works, while keeping the app where it runs today. Start with scale-to-zero and one concurrent separation, then compare L4 with T4 using actual cost per completed song. The approved **US$20 total** is a spending ceiling, not a requirement to spend it. This assessment checked repository implementation and provider documentation on **29 October 2026**; it did not deploy a service or run paid benchmarks.

## Two models cover the current workflow

| Work | Model or method | Where it belongs and why |
|---|---|---|
| Mixed song → guitar and backing | **Demucs `htdemucs_6s`** | On-demand GPU. Its six sources include guitar; one pass supplies both guitar and the sum of the other five sources. |
| Measured source/target → preset proposal | **`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`** | Nebius Token Factory. Hosted text inference returns the supported preset JSON; no self-hosted LLM GPU is needed. |
| Reference suggestions, waveform and target spectrum | Energy/dynamics heuristics and FFT | Existing CPU API. These are calculations, not extra neural models. |
| Dry calibration, amp, recording and preset refinement | Browser measurements and Web Audio | User's computer. Keeps live monitoring out of network latency and GPU billing. |

Demucs is the appropriate existing baseline because its normal four-source model lacks a guitar output. `htdemucs_6s` adds guitar and piano, but upstream labels it experimental; larger GPU memory does not remove bleed or artifacts. The current worker validates a checkpoint hash, runs five-second processing segments and exports aligned guitar/backing audio using shared scaling. It needs **one separator invocation**, not a separate guitar-removal or backing-generation model. ([Demucs documentation](https://github.com/facebookresearch/demucs/blob/main/README.md), [implemented worker](https://github.com/mzisyraf/modulo/blob/507e291/tools/demucs/worker.py#L51))

Nano receives measured spectral bands, dynamics, source/target differences and the supported six-control schema. **It does not listen to uploaded raw audio or identify the original equipment.** The present engine implements input gain, drive, three-band EQ and output gain. A larger language model cannot add cabinet simulation, compression, delay or reverb that the engine does not implement. ([Provider payload](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/preset_generation.py#L148), [evaluation limitations](https://github.com/mzisyraf/modulo/blob/507e291/docs/PRESET_EVALUATION.md#L48))

The current public catalog lists Nano at **$0.06 input/$0.24 output per million tokens**. Keep it rather than deploying its 30B-parameter model ourselves. Super is a possible controlled challenger if listening tests justify it; it is not a second required service. Catalog presence does not establish this account's current entitlement. ([Nebius catalog](https://tokenfactory.nebius.com/api/public/models_info))

Omni/audio-language models would add audio descriptions, CLAP would add learned similarity representations, and Basic Pitch would add note/MIDI transcription. None is integrated or necessary for the current reference-selection and six-control task. Named chord recognition is separate from calibration, and tablature remains optional. Neural amp training also needs a different capture/data workflow. These ideas should earn a separate scope through an observed acceptance failure, rather than expanding today's GPU bill. ([NVIDIA Omni card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16), [CLAP](https://github.com/LAION-AI/CLAP), [Basic Pitch](https://github.com/spotify/basic-pitch), [project scope](https://github.com/mzisyraf/modulo/blob/507e291/docs/PLAN.md))

## Modal L4 is the best first deployment

| Provider | Fit for modulo | Decision |
|---|---|---|
| **Modal Functions, L4 24 GB** | Python GPU functions, asynchronous invocation and automatic scale-to-zero; advertised Starter compute allowance | **First choice**, subject to account/quota and runtime validation |
| **Runpod Serverless Flex, 24 GB class** | Docker job handler and provider queue; zero Active workers permits scale-to-zero | **Runner-up**, especially if conventional Docker packaging matters most |
| **Beam Serverless** | Python endpoints and task queues; attached CPU/RAM charges materially affect the bill | Viable, but no decisive advantage for this implementation |
| **Nebius Serverless Endpoint** | Documented compute/storage charges continue while the deployment runs | Poor fit for unattended request-only billing under this cap |

Modal fits the existing Python separator without moving the frontend or keeping a whole Uvicorn GPU service alive. Its functions scale to zero; configure **`min_containers=0`, `buffer_containers=0`, `max_containers=1`**, initially with **`scaledown_window=2` seconds**. Loading and the warm waiting period are billable: scale-to-zero is not a promise that every idle second is free. The default warm tail is longer, so set it deliberately. ([Autoscaling](https://modal.com/docs/guide/scale), [cold starts](https://modal.com/docs/guide/cold-start), [function settings](https://modal.com/docs/sdk/py/latest/Function))

L4 provides 24 GB memory headroom at a moderate rate. Existing local evidence shows segmented Demucs executing on a 6 GB RTX 4050, so **there is no demonstrated need for H100, A100 or multiple GPUs**. That evidence is a 12-second synthetic execution check, not a cloud/full-song benchmark or minimum-memory determination. Validate the pinned Torch 2.0.1/CUDA 11.8 environment on L4; avoid newer GPU generations that force an untested stack upgrade. T4 is the cheaper-rate benchmark alternative, but a slower card can cost more per completed job. ([Local evidence](https://github.com/mzisyraf/modulo/blob/507e291/docs/DEMUCS.md#L43))

Runpod Flex is a credible alternative with **Active workers=0 and maximum workers=1**. Its 24 GB tier is a GPU class, not guaranteed selection of a particular card; constrain compatibility. It bills initialization, execution and the configured idle tail, with storage separate. Nebius's managed endpoints instead run until stopped/terminated as documented; the word “serverless” alone does not establish request-driven shutdown. ([Runpod billing](https://docs.runpod.io/serverless/pricing), [Nebius overview](https://docs.nebius.com/serverless/overview), [Nebius billing](https://docs.nebius.com/serverless/pricing-quotas))

## Pay for occupied seconds, not song length

The following is **illustrative arithmetic**, assuming the stated occupied duration and, for Modal/Beam, two physical CPU cores plus 8 GiB RAM. It excludes extra startup/warm-tail time, storage, egress and tax. Sixty GPU-seconds does **not** mean sixty seconds of audio.

| Configuration | 60 occupied seconds | 180 occupied seconds |
|---|---:|---:|
| Modal L4 + CPU/RAM | **$0.01596** | **$0.04787** |
| Modal T4 + CPU/RAM | $0.01248 | $0.03743 |
| Runpod 24 GB class, listed worker rate | $0.01150 | $0.03450 |
| Beam 4090 + CPU/RAM | $0.02676 | $0.08028 |

These use current published rates and are not equivalent-performance measurements. Modal meters requested/actual resources according to its rules; Beam's attached CPU/RAM prices explain why its inexpensive GPU sticker is not the whole cost. Compare the **invoice increment per successful identical clip**, including cold starts and failed attempts. ([Modal prices](https://modal.com/pricing), [resource metering](https://modal.com/docs/guide/resources), [Runpod prices](https://www.runpod.io/pricing), [Beam prices](https://www.beam.cloud/pricing))

Modal advertises **$30/month included compute** on Starter, but requires billing onboarding/payment-method checks; this account's credits and quota remain unverified. Set both a gross-usage budget and a net-spend limit, and retain a cumulative project allowance because monthly reset limits do not enforce a US$20 lifetime total. Allocate at most **US$2 new cash for the initial bounded comparison**, using confirmed included credit where available. The hackathon FAQ explicitly says its advertised credits are for Token Factory, and permits the rest of the app outside Nebius when an NVIDIA model runs through Token Factory. ([Modal billing](https://modal.com/docs/guide/billing), [budgets](https://modal.com/docs/guide/budgets), [official hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs))

## A small remote adapter makes this truly serverless

The current API returns HTTP 202 and continues separation in an in-process background thread using local disk. Deploying that unchanged inside a short-lived HTTP container risks losing work when the container scales down. The uncommitted Compose draft also assigns a GPU to the entire API, including polling and artifact serving. **Neither is the final scale-to-zero architecture.** Keep today's local API/job contract and replace only the local subprocess boundary with remote submit, poll and download. A provider-owned function/job must remain alive until separation and output persistence finish. ([Current job lifecycle](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L60), [subprocess boundary](https://github.com/mzisyraf/modulo/blob/507e291/services/api/app/jobs.py#L187))

Use asynchronous invocation: Modal's HTTP request boundary is 150 seconds even though underlying functions can run longer. Preserve the current ten-minute execution bound with a separately bounded startup, explicit failure and cancellation. Keep status polling and downloads off the GPU. Initialize the validated model once per warm container and cache its weights in the image/platform volume. Cache successful separation using input content hash **plus checkpoint/version, decoding and separation settings**; do not rerun it when the user changes a passage or preset. These are implementation requirements, not features already completed. ([HTTP timeouts](https://modal.com/docs/guide/webhook-timeouts), [function timeouts](https://modal.com/docs/guide/timeouts), [remote invocation](https://modal.com/docs/guide/trigger-deployed-functions))

Audio transport needs explicit limits: at the 295-second bound, stereo PCM16 guitar plus backing total approximately **104 MB**, calculated from 44,100 frames/second × two channels × two bytes. Do not embed those WAVs in JSON/base64. Use authenticated downloads or short-lived URLs to controlled private storage, preserve the existing 24-hour expiry and bind results to the submitting job. A local prototype can download results into its existing job store; persistent judging access needs durable artifacts. Exact provider payload limits remain unverified, so direct 50 MiB HTTP transfer is not promised.

**Next decision: select Modal L4 for a bounded cold/warm Demucs test, with T4 as its cost comparison.** The smallest implementation is one remote separator adapter with durable results, authenticated job access and the existing frontend response shape. No new models, app hosting, training service or LLM-serving GPU is justified by the current workflow.

Skipped deployment, paid calls and new quality/hardware tests. Actual cloud per-song cost, startup latency, account credit eligibility and musical acceptance remain unverified.
