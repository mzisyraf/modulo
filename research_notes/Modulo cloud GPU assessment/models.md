# Model strategy and competition fit

## Which models does modulo need now?

### Takeaway
Only two learned models belong in the current core workflow: Demucs `htdemucs_6s` for separation, and NVIDIA Nemotron 3 Nano through Nebius Token Factory for a proposed six-control preset. Only Demucs needs a GPU we deploy; the provider runs Nemotron's GPUs.

### Cited Findings
- Current code selects `htdemucs_6s`, validates the official checkpoint hash and six output sources, runs five-second GPU segments with one shift, and creates a guitar stem plus a backing track by summing the five remaining stems. These are one model pass, not separate guitar-removal and backing-generation models. — [worker.py](../../tools/demucs/worker.py:50)
- Upstream documents `htdemucs_6s` as the model adding guitar/piano to the standard four sources. It is experimental; piano bleed/artifacts are specifically noted. The upstream repository is archived and its successor only receives important fixes. Two-stem output still separates the whole mixture and does not inherently save processing. — [Demucs upstream](https://github.com/facebookresearch/demucs/blob/main/README.md)
- Current exact text model is `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, enforced by configuration and response validation. It receives numeric source/target features, relative spectral-band differences, baseline gain, supported controls and actual DSP semantics. It returns strict schema-constrained JSON, not audio. Source spectra come from the browser; target spectra from the confirmed guitar WAV. — [provider code](../../services/api/app/preset_generation.py:16), [payload](../../services/api/app/preset_generation.py:154)
- Today's public catalog still lists that Nano ID as active text-to-text, 262144 max context, $0.06 input/$0.24 output per million tokens. Super `nvidia/nemotron-3-super-120b-a12b` is active at $0.30/$0.90. Catalog presence does not establish current account entitlement or output quality. — [Nebius public catalog, checked 29 October 2026](https://tokenfactory.nebius.com/api/public/models_info)
- Project evidence records 3/3 old real Nano smoke outputs passing the six-control schema, 2/3 satisfying every original smoke check and variation on identical synthetic inputs. Later evaluation says adding source/target spectra improved EQ but not reliable drive selection, while deterministic local rendered refinement improved controlled cases. No broad musical/hardware acceptance follows from these checks. — [preset generation evidence](../../docs/PRESET_GENERATION.md:76), [evaluation](../../docs/PRESET_EVALUATION.md:50)
- The current controls are input gain, drive, bass, mid, treble, output gain. The engine currently lacks cabinet/circuit modelling, compressor, delay and reverb. A larger model cannot generate these missing DSP capabilities. — [prompt](../../services/api/app/preset_generation.py:181), [evaluation limitations](../../docs/PRESET_EVALUATION.md:58)

### Inferences
- Keep Nano now. Super is an optional controlled challenger only if Nano loses listening tests to a simple baseline; changing it also requires changing the Nano-only code/budget guard and tests. No reason to self-host either LLM on the separation GPU within a $20 cap.
- A separation GPU serves occasional batch requests; it is not required while users play, adjust EQ, record or replay. Backing creation, reference selection, spectral feature extraction and the browser's bounded local preset refinement need no additional learned model.
- Main product bottlenecks are separator quality, limited DSP effect space and calibration/listening evidence. Spending on larger LLMs or an audio-language stack does not resolve them automatically.

### Gaps
- Cloud Demucs quality/runtime and a fresh live calibrated Nano comparison have not been tested by this research. Existing local smoke is execution evidence; it is not a full-song cloud benchmark.

## Which additional model ideas should stay optional?

### Takeaway
Do not deploy additional models before the deadline unless a concrete acceptance failure requires them. Short tabs are optional; named chord recognition remains a separate unconfirmed requirement.

### Cited Findings
- The plan explicitly defers short tabs and separates named chord recognition from the tone/level analysis of a played calibration exercise. Current calibration source labels itself quality heuristics, not chord recognition. — [plan](../../docs/PLAN.md:46), [calibration](../../packages/audio/src/calibration.ts:1)
- NVIDIA Nemotron Nano Omni accepts audio/video/images/text and outputs text. Its card describes enterprise/audio understanding rather than guitar-stem extraction; listed minima include H100 80GB BF16, L40S 48GB FP8, and RTX5090 32GB NVFP4. — [NVIDIA model card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16)
- CLAP creates learned audio and text representations for downstream tasks. — [LAION official README](https://raw.githubusercontent.com/LAION-AI/CLAP/main/README.md)
- Spotify Basic Pitch transcribes audio to MIDI/note events, supports polyphonic instruments, and works best on a single instrument. Lightweight alternate runtimes include ONNX/TFLite. — [Spotify official README](https://github.com/spotify/basic-pitch)
- Neural Amp Modeler's repository trains and exports `.nam` models; separate partner software plays trained models in real time. — [NAM official README](https://raw.githubusercontent.com/sdatkinson/neural-amp-modeler/main/README.md)

### Inferences
- **Audio-language/Omni:** optional descriptions or future richer audio understanding. It does not replace Demucs; huge compared with our small separator, unproven benefit for supported knobs. No deployed Nebius audio endpoint verified here.
- **CLAP/embeddings:** optional future semantic passage retrieval or similarity experiments, not needed for the existing waveform/manual selection and measured-band comparison. Semantic embedding similarity is not automatically a calibrated guitar-timbre score.
- **Basic Pitch/pitch/chord models:** optional transcription/tabs or an explicitly agreed named-chord feature; not required for tone matching. MIDI alone does not identify a unique guitar string/fret fingering.
- **Neural amp/custom training:** changes the engine/data problem; not necessary for browser waveshaper/EQ playback. Do not reserve training GPUs for the current submission.
- **Alternative guitar separators/RoFormer:** conditional quality fallback only after rights, checkpoint and actual listening tests; not a second production model needed alongside working Demucs.

### Gaps
- None of those optional models has been integrated or evaluated in this checkout. No claim of new weights/licence approval or production readiness.

## Does the split deployment meet the hackathon requirements?

### Takeaway
Use serverless GPU hosting for Demucs wherever practical while retaining actual NVIDIA Nano inference through Nebius Token Factory. That keeps the required platform/model path and avoids self-hosting the LLM.

### Cited Findings
- The official FAQ says runtime use of an NVIDIA model through Token Factory satisfies the platform requirement and the rest of the app need not be hosted on AI Cloud. Its promotional code and Builder Program grants cover Token Factory; there is no separately published AI Cloud grant. The FAQ rejects replacing the required Nebius runtime with only another provider's NVIDIA model API. — [Hackathon official FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs)
- The project plan deadline is 31 October 2026, 01:00 MYT, with a working submission target three hours earlier. — [plan](../../docs/PLAN.md:16)

### Inferences
- Demucs on Modal/Runpod plus Nano on Token Factory meets the published split-hosting requirement, provided the real runtime call and other submission requirements are actually demonstrated. Demucs itself is not an NVIDIA-authored open model merely because it executes on NVIDIA hardware.
- Preserve exact requested/returned model, actual validated result and sanitized provider evidence. Leave failed/fixture paths honestly labelled; do not count this research as a real call.
- Keep existing short-lived local browser processing; deploy only heavy separation inference, not the whole app. No $20 GPU allocation is needed for the hosted text model itself; Token Factory bills tokens separately.

### Gaps
- No paid calls, cloud provisioning, account-credit verification, cloud benchmark, hardware tests or licensing/publication decisions were performed. Rules compliance also requires the remaining submission deliverables and judging access.
