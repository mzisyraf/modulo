# Overnight integration plan — 30 October 2026

Status: **approved by Isyraf in chat on 30 October 2026; implementation in progress**. The revised US$10 per-service ceilings and individual-parameter generation requirement apply. Preparation and the published-baseline merge were completed before approval.

## Approved policy and intended result

Operator: Isyraf / mzisyraf. Work on Isyraf; serialize integration through issue #11. Isyraf revised the spending ceilings to **US$10 Modal and US$10 Token Factory**, replacing the earlier US$5 overnight allocation. The combined ceiling remains US$20; prior usage and outstanding reservations count toward the applicable ceilings, and credits count as usage. A bounded Nemotron Super fallback is allowed only if Nano fails the declared tests. The US$30 Modal balance does not enlarge these caps. Tested work may be pushed to staging. Main, repository publication and licence selection remain separate decisions.

Deliver a working path: mixed song → Cloud API guitar/backing separation → listen and confirm a guitar segment → choose live guitar or recorded dry guitar → calibrate → NVIDIA/Nebius proposes an implemented rig → render and compare → deliberately apply → audition/play/record. Dinnie and Shazlin run the frontend and lightweight API locally, without a dedicated GPU.

“Close match” must be demonstrated with audio and declared measurements. Recovering the exact original equipment or guaranteeing identical tone from an arbitrary mix is outside what these models and recordings establish.

## Baseline established before implementation

| Item | Evidence/current state |
|---|---|
| Published integration | Isyraf `e69b9e88699741fb75442b5c6605bfe7ebd401ad`, pushed; merges staging/Dinnie `65428d6` into prior Isyraf `59dfd17` |
| Dinnie rig | Real shared model registry, model processors, chain/parallel paths, editable controls, render/record support and React ModelRigPanel are included |
| Rig meaning | 57 algorithmic model definitions across 14 categories; approximation models and synthetic IRs, not evidence of 57 accurately reproduced physical products |
| Shazlin progress | Latest #6 handoff `6501961135`: equipment visuals/searchable library/editor refinement, locally reviewed with checks; two files remain uncommitted on her laptop and are unavailable to merge |
| Checks run here | Clean tracked-source copy: npm ci, npm run check (120 tests, TypeScript, build), audio check:rig; API-local pytest 165 passed; main synthetic browser regression 36 checks, no page errors |

Merge reconciliation preserves Local/Cloud selection, silent live calibration, real job/reference provenance, Dinnie's smoothed drive, one shared audio engine and rig disposal. The drive regression now observes AudioParam changes rather than the old curve replacement. Staging and main were not changed during this baseline update. Synthetic/browser checks do not establish musical matching or hardware acceptance.

Before implementation, re-read #1–#7/#11 claims and fetch remote refs. Post a scoped START. Include any subsequently published Shazlin work only after its handoff and compatible combined checks. Preserve unpublished work; a released claim does not make unpushed files accessible. No new messaging to teammates is assumed authorized.

## Architecture and model choice

| Component | Execution | Purpose |
|---|---|---|
| Demucs `htdemucs_6s` | Existing private Modal GPU function, L4 preferred/T4 fallback | Extract a guitar stem and aligned guitar-reduced backing from a mixed song |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Nebius Token Factory | Reason over measured source/target features and the implemented model catalog; propose a bounded chain and physical parameter values |
| `nvidia/nemotron-3-super-120b-a12b` | Token Factory, conditional only | Retry failed evaluation cases if Nano cannot meet the declared structure/quality gates; retain exact model provenance |
| Existing browser Web Audio DSP | Local CPU on all three laptops | Calibration, full-rig rendering/refinement, live playing, audition and recording; no network round trip in the live audio path |

Both exact Nemotron IDs appeared in the authenticated account model catalog during planning. Catalog visibility is not a successful inference test. Verify current primary-source pricing, model availability and worst-case reservation before enabling paid calls. The current provider permits Nano only and returns the legacy six-control preset; full-rig integration is new work.

**AI output is a custom configuration of individual implemented parameters, not a factory-preset selection.** Choose appropriate gear models and order, then generate explicit values for every parameter of each selected model, including relevant delay/reverb, amplifier, cabinet, EQ and dynamics settings. Use only the controls and units actually present in that model's registry metadata; do not invent unsupported knobs or include an effect merely to fill a category. Validate explicit categorical/on-off choices as well as numeric values. Factory rigs serve as optional test/neutral baselines, not the AI's answer space. Render-based refinement must be able to change supported individual values beyond factory settings.

No extra GPU services, embedding model, transcription model, model training or always-on VM are required for this scope. Keep optional tabs and physical-product identification outside tonight's critical path.

## Credentials: share the existing access, without new accounts

There are **three secret values in two private files**:

| Secret | Isyraf's source file | Destination inside each teammate's own clone |
|---|---|---|
| Modal token ID and token secret/profile | `data/modal/config.toml` | `<clone>/data/modal/config.toml` |
| `NEBIUS_API_KEY` | `services/api/.env` | `<clone>/services/api/.env` |

Transfer these existing files directly to each person with an end-to-end encrypted one-to-one file transfer, or an AES-encrypted archive whose password travels separately. Never post their contents in GitHub, group chat, screenshots or frontend variables. Back up a teammate's existing private configuration before replacing it. Do not create plaintext transfer copies in the repository. This plan does not send files automatically.

Use the same relative paths on Windows/macOS/Linux; the absolute clone directory can differ. These files are Git-ignored. Secrets stay with the local backend/Modal SDK; no key goes into VITE_* or browser storage. No NVIDIA, Hugging Face, SSH or additional model credential is required for the selected runtime.

The setup uses normal Node dependencies, the API Python 3.12 venv and the separate pinned Modal client venv (`tools/modal/.venv`). Teammates do not install CUDA, Torch or Demucs. Follow TEAM_CLOUD_SETUP.md for commands and ports. Replace unlimited generation settings with deliberately allocated nonzero allowances; do not copy the full budget to every laptop. Local ledgers do not impose a global shared-key cap.

The shared Modal token has broad workspace privileges and initially expires **5 November 2026**. Renew/re-share it for later judging access and revoke shared keys after the event. Preserve the shared cloud attempt ledger. Do not solve expiry by committing credentials.

## Implementation sequence — estimated 6–8 hours after approval

### 1. Define the contract and evaluations first — 60–90 minutes

1. Record the exact rig registry/DSP version and predeclare structure, safety and rendered-audio gates before changing prompts. Keep earlier legacy-preset results separate.
2. Add a versioned rig proposal contract beside the existing preset contract. AI proposes ordered installed model IDs, enabled state and explicit model-owned physical parameter values for each selected module. Missing values must not silently turn the response into a factory preset. Start with a serial chain capped at eight processing modules; preserve existing manual parallel/MIDI features.
3. Export the backend catalog/schema from the TypeScript registry. Compile proposals through existing createGearModule/setGearParameter and RigPreset validation. Do not maintain a second handwritten Python gear catalog or ask the LLM to invent generic DSP internals.
4. Reject unknown IDs, values, fields, unsafe gain/routing, unavailable IRs and nonfinite parameters at server and browser boundaries. Only built-in IRs are eligible unless a real provided asset exists. Keep legacy presets/imports working.
5. Hash all relevant graph, processors, models and IR sources for evaluation/cache provenance. Dinnie's changed drive invalidates old prompt assumptions and tone-quality benchmarks; regenerate current-engine targets.

Likely touch points: contracts, services/api/app/preset_generation.py and adjacent generation tests, packages/audio/src/rig metadata/compilation boundary, evaluation hashing/tools and fixtures. Use existing validators and helpers wherever possible.

### 2. Add live/file source selection — 45–75 minutes

1. Add a clear **Live guitar / Guitar audio** selector to the main flow; file mode offers upload and the previous licensed dry recording. It must not request microphone permission.
2. Reuse existing feature extraction and validation for both sources. Label origin, reject silence/clipping/invalid files and link calibration to the file hash or device/channel/settings.
3. Use the same chosen dry recording for calibration, on/off audition, quality rendering and recorded-source tests. Keep uploaded dry/live takes local; send only derived numeric source features to the provider.
4. Invalidate dependent proposals on source/mode/device/reference/project changes, stop stale audio and cancel pending work. Preserve one shared live/audition engine and conservative output.
5. Verify browser permission/error/lifecycle cases and responsive controls. A file calibration describes the recording, not the physical interface or a future player's pickup.

Previous sample: `data/verification/online-di/guitar-techs-dry-di.wav`, 29.292 seconds, mono PCM16/44.1 kHz, CC BY 4.0 with local attribution. Retain its source and transformation credits. Include a licensed demo copy or reproducible retrieval path so teammates also have it; do not merely reference Isyraf's ignored local file.

Likely touch points: App.tsx, SourceCalibration/LiveCalibrationControl, audition/refinement helpers and narrowly scoped audio APIs. Keep Shazlin's model panel styling independent unless published and necessary integration requires an agreed split.

### 3. Generate, render and improve the actual rig — 90–150 minutes

1. Provide Nano the confirmed extracted passage features, source calibration, supported model catalog and strict rig proposal schema. Display actual provider/model/reference provenance; generation never automatically plays or applies a rig.
2. Compile the response into the same RigPreset used by the real panel and shared engine. Show individually generated values in the actual model controls with editable explanations. Verify that changing one returned parameter reaches the corresponding DSP control and changes its rendered response. Preserve a user's working rig if generation fails.
3. Render the source through that actual rig. Reuse renderRigFile/RigGraph and existing comparison/refinement code; extend measured timbre/dynamics/temporal features only where needed and test those additions.
4. Bound local refinement to at most 80 short candidate renders over a 5–10 second training excerpt, with progress/cancellation. Refine a small set of effective controls; avoid combinatorial catalog search or repeatedly calling the LLM per knob change.
5. Compare raw proposal, refined proposal and neutral rig with level-matched previews. Keep the best validated result and an honest weak-match status if the target is not reproducible. Cache only against source/reference/calibration/model/schema/catalog/DSP versions.

The text model reasons from descriptors; it is not assumed to hear raw audio. A model description is insufficient evidence: actual parameter changes must alter actual rendered audio. Delay/reverb estimates may remain ambiguous in dense mixes; expose uncertainty instead of inventing equipment certainty.

### 4. Run bounded real-model/cloud and quality tests — 90–120 minutes

1. **Controlled tone cases:** clean/EQ, crunch/amp+cab, ambience/delay/reverb targets rendered through implemented DSP from the licensed DI. Use the first 15 seconds for development; reserve the remaining approximately 14.3 seconds for held-out evaluation. Never optimize on the held-out interval.
2. **Repeatability:** three independent Nano generations for each of three cases, recording all runs. Critical schema/application/safety behavior must pass every run. Allow at most one repair for a malformed response, counted against paid limits. Trigger Super only on a failed predeclared Nano case and rerun comparable inputs.
3. **Quality gates:** finite/safe output; peak at most 0.951 and guard fraction below 0.01 on declared fixtures; refined result improves over its raw proposal when refinement changes it and beats neutral on held-out audio. Existing provisional paired gate requires lower raw loss and at least 10% lower RMS-matched spectral loss than neutral. Report absolute losses and all failures. A 10% loss improvement is not “90% accuracy.”
4. **Independent/real music checks:** use the paired amp-mic recording corresponding to Guitar-TECHS DI03 if obtainable within 30 minutes; align its documented timing offset before paired metrics. Also run the rights-cleared mixed-song → extracted segment path and save matched-level A/B clips. Different performances permit timbre proxies, not waveform-reconstruction scores. If external data cannot be obtained, label the controlled benchmark limitation rather than silently treating self-rendered targets as independent proof.
5. **Full GPUless flow and failures:** actual local API → Modal → downloaded stems → confirmed passage → actual Token Factory proposal → browser render/apply. Include a full-length rights-cleared song within current upload/duration bounds, cold/warm timings when observable, aligned artifacts, cancellation, cleanup, exhausted quota, provider failure, stale responses, no silent Local fallback, no backing through the guitar rig, recording/play-along and desktop/narrow UI regressions.

Use licensed sources with attribution. Keep existing commercial-song experiments private; do not upload new commercial music or commit any full music/weights. Rights-cleared song evidence is available under `data/bench/kevin-macleod-exhilarate/`. Preserve original separate labels for synthetic, paired real recordings and unpaired song evidence.

Live guitar/hardware latency, physical feedback and human perceptual acceptance cannot be certified without the guitar/interface and listeners. Provide listenable comparisons for the morning review; do not substitute an automated score for those missing checks.

### 5. Publish the tested team handoff — 45–60 minutes

1. Test a clean dependency install, npm run check, check:rig, API-local pytest, relevant offline Modal checks and changed browser/rig/audio behavior. Simulate the no-GPU setup without any Demucs environment in its selected path; do not claim to have tested teammates' physical laptops.
2. Re-fetch staging and current handoffs, incorporate compatible published changes, rerun affected combined tests and push the tested candidate normally to staging. Never force-push or overwrite teammate work.
3. Update setup instructions, actual provider IDs/budgets, known issues and labelled audio/evaluation evidence. Record exact tested commit and cloud timing/billing/quota snapshots; publish no secrets/audio of unclear rights.
4. Post HANDOFF in relevant work issues and refresh #11 as coordinator. Distinguish automated checks from human approvals. Release claims and sync integration back into Isyraf without rewriting history.
5. Leave a morning checklist: open the main flow, play the supplied dry sample A/B, repeat from a GPUless laptop, then obtain Dinnie/Shazlin's hardware/UX review. If functional checks fail, retain the last working candidate and report the blocker instead of publishing broken staging or claiming completion.

## Spending and unattended stop rules

| Limit | Policy |
|---|---|
| Combined ceiling | US$20 across Modal and Token Factory; credits, prior usage and outstanding reservations count toward these ceilings |
| Allocation | Up to US$10 Modal and US$10 Token Factory; no transfer between service caps or extra spend without a later explicit decision |
| Modal | At most four new reserved GPU attempts from the seven currently remaining; preserve the existing ten-attempt ledger and leave at least three for teammate/demo use |
| Token Factory | At most 30 paid requests including repairs; at most six Super requests; input/output/context reservations must fit the remaining US$10 service ceiling before every call |
| Retries/concurrency | One GPU runner, no blind paid retries; one deliberate schema repair maximum, counted; failed requests can cost money |

Before calls, establish a run-specific bounded allowance and conservative per-request worst-case cost using verified current rates. Preserve historical ledgers. The current private legacy configuration is unlimited/100 requests; do not carry that into the new run. Inspect usage before and after and stop before the next reservation can exceed the remaining allowance. Billing can lag, and a local meter is not a provider-enforced global cap; include running reservations/CPU/storage overhead and stop paid work if a safe bound cannot be established. Do not let teammates concurrently consume an assumed exclusive budget unnoticed.

If auth expires, quota is exhausted, GPU capacity is unavailable, automatic approval rejects an operation or an external dependency fails, stop that dependent path, record the reason and continue useful offline tests/docs. Do not bypass limits, reset ledgers, buy capacity or wake the user for routine choices. Preserve the best working implementation; leave incomplete acceptance explicit. Use the final 60–90 minutes for regression checks/handoff, not optional feature expansion. No unattended overnight public app deployment, main promotion, licence choice or credential transmission is included.

## Cloud readiness at planning time

| Service | Verified | Still to prove overnight |
|---|---|---|
| Modal `modulo-demucs` | Deployed/private authenticated SDK API; prior T4 synthetic smoke; prior local-API Cloud path produced ready validated artifacts; no running/queued GPU inputs at inspection | Real-music quality, cold/warm/end-to-end and full-length behavior on combined UI |
| Shared attempts | Three reserved out of ten, seven left; no resets | Report new count after the bounded tests |
| Modal billing snapshot | Metered US$0.02041824, billed US$0 after adjustments at inspection; lag possible | Fresh snapshot and conservative outstanding-cost reconciliation |
| Token Factory | Authenticated model listing succeeds; exact Nano and approved Super IDs present; prior legacy generation evidence exists | Full-rig structured responses and repeatable rendered quality |

The Modal worker scales to zero; min/buffer zero, max one, two-second idle, 600-second execution and 240-second startup timeout, no configured retries. Its hourly CPU cleanup removes abandoned audio after about 24–25 hours; successful downloads remove their remote directory. No Nebius AI Cloud project or VM is required for this architecture. Modal is a private callable inference service through the local backend, not a public URL for browser-held keys.

## Submission needs outside code completion

1. Recheck the competition's current official checklist and runtime eligibility: actual NVIDIA/Nemotron through Nebius evidence, required platform feedback and clear attribution. A Modal separator does not replace the required Nebius inference integration.
2. Prepare a short English demo/video and judge setup/test path with the confirmed segment, real generation, actual rig change, dry-sample fallback and honest limitations. Do not label cached results as fresh inference.
3. Flag public-source/licence and final main release for the team's explicit decision. These do not block private staging integration tonight, but may block submission.
4. Resolve judging availability/credential expiry before promising access beyond the event. Keep GPU inference scale-to-zero; any hosted CPU frontend/API or public access path needs an explicit design and authorization, not an accidental exposed development server.
5. Preserve the 30 October 22:00 MYT submission target, before the 31 October 01:00 hard deadline. Morning human listening/hardware and fresh-laptop rehearsal remain necessary even if every automated test passes.

## Approval boundary

Approval of this plan authorizes the five implementation phases and their bounded tests, associated private branch commits, issue handoffs and tested staging push. The two selected policy answers above remain in effect. Without overall plan approval, stop after publishing this planning artifact and the requested baseline merge.
