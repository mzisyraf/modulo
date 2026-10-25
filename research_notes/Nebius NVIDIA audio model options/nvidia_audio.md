# NVIDIA audio models and guitar separation

Checked 25 October 2026 MYT. Research only: no accounts, inference, installation, downloads or listening tests. Repository constraints and current six-control preset are supplied by the coordinating session. Public model cards can change after initial release; these observations establish what the pages expose now, not a version-pinned historical catalog. An NVIDIA model checkpoint, a NVIDIA-hosted API ID and a Nebius serving ID are different identifiers.

## Which NVIDIA models fit modulo?

### Takeaway

Use a small NVIDIA text model available to the eventual Nebius account to map measured features into the existing six-control preset. Native-audio Nemotron models do exist; they are useful experimental comparators, but their published capabilities do not establish guitar separation or accurate guitar-tone control estimation.

### Cited Findings

- **Text baseline:** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` is NVIDIA's instruction/reasoning model, not the `...Base-BF16` pretraining checkpoint. It takes and returns text, has roughly 30B total parameters/3.5B active, permits switching reasoning off and is described as commercially usable under the NVIDIA Nemotron Open Model License. Its card lists structured-output training; this does not guarantee a particular provider's JSON Schema enforcement. The exact Nebius serving alias and availability require that provider's catalog and an authenticated test. [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16).
- **Native-audio experimental candidate:** `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` is an audio/image/video/text-to-text model released 28 April 2026. Its card specifies WAV/MP3 up to one hour at sample rates of 8 kHz or greater, one-dimensional audio, English support and JSON output. The card's local serving example uses an `audio_url` content item pointing to a file URI; a local file URI works only when that serving process can access the file. BF16 requires an H100 80 GB minimum, FP8 an L40S 48 GB minimum; cited weight sizes are 62/33 GB respectively. The card uses vLLM 0.20.0 plus its audio extra. These are current documentation requirements, not tested versions for our environment. NVIDIA Open Model Agreement applies. No verified non-reasoning/base Omni checkpoint was found; do not shorten this into an invented checkpoint ID. [NVIDIA Omni model card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16).
- **NVIDIA-hosted Omni is a distinct route:** Build lists `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, endpoint `https://integrate.api.nvidia.com/v1/chat/completions`, audio among input modalities, and an available free prototype endpoint. Quota, eligibility and actual audio request behavior remain untested. The displayed example is an image request, so do not copy the local vLLM file-URI example into this remote API and assume it works. This route alone is not evidence of Nebius runtime usage. [NVIDIA Build](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning).
- **Audex:** `nvidia/Nemotron-Labs-Audex-30B-A3B` handles speech and general audio input/output, including audio understanding and generation, with thinking/non-thinking modes. Its card gives a 8 June 2026 release date but links a July-numbered paper; preserve those labels rather than inventing chronology. The NVIDIA OneWay Noncommercial License applies. Hugging Face currently lists no inference provider. It is not our default deployment recommendation. [NVIDIA Audex card](https://huggingface.co/nvidia/Nemotron-Labs-Audex-30B-A3B).
- **Speech is a separate capability:** `nvidia/parakeet-tdt-0.6b-v3` is a roughly 600M-parameter multilingual speech recognition model under CC-BY-4.0. Its published task is speech-to-text, not music tone analysis. [NVIDIA Parakeet card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3). `nvidia/canary-qwen-2.5b` is especially clear: its ASR mode only transcribes; LLM mode reasons over the transcript and does not understand the original raw audio. CC-BY-4.0 applies. [NVIDIA Canary card](https://huggingface.co/nvidia/canary-qwen-2.5b).
- **Framework versus model:** Riva provides speech recognition/synthesis and related speech services, while NeMo is a model-development toolkit. These names do not themselves specify a guitar model or make one available on Token Factory. [NVIDIA Riva documentation](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/index.html), [NVIDIA conversational AI overview](https://developer.nvidia.com/topics/ai/conversational-ai/).
- **Embedding research:** `nvidia/omni-embed-nemotron-3b` accepts audio alongside other modalities and returns 2048-dimensional retrieval embeddings. It is not a preset generator. Its card's architecture is about 4.7B parameters despite the short name and is governed by NVIDIA OneWay Noncommercial plus additional Qwen research terms. The card lists specialized dependencies/custom code and NVIDIA GPU/Linux integration. Treat it as a retrieval experiment requiring use-case validation and licensing review, rather than the hackathon's default model. [NVIDIA embedding card](https://huggingface.co/nvidia/omni-embed-nemotron-3b).

### Inferences

- The smallest complete route remains separator -> measured features -> NVIDIA text model -> existing validator -> browser audio. An audio-language model could add descriptive evidence such as clean/crunch/distorted or bright/dark, but that must improve blind listening results over feature-only inference to justify its hosting cost.
- A native-audio model that returns text does not return a guitar stem. None of the examined NVIDIA cards establishes mixed-song guitar extraction, exact amplifier identification, or calibrated mapping from audio to our six DSP values.
- Keep speech-to-text, spoken assistants, embedding databases, audio generation and custom training outside core scope. If exploring Omni, use the same reference clip and downstream preset controls as the text baseline, with bounded reasoning and visible output using only verified serving options. Do not assume the eventual hosted endpoint supports switching thinking off. Never pass its reasoning as executable configuration.

### Gaps

- No authenticated Nebius catalog or audio request was possible. Token Factory availability of an Omni model does not prove its audio front end is enabled; inspect the provider's per-model modality contract before sending bytes.
- No measured guitar-tone benchmark, latency, GPU utilization, cost or actual model outputs were produced. The supplied API deadline and UI controls remain project requirements, not demonstrated results.
- Public pages do not resolve competition acceptance of noncommercial models. Avoid Audex/Omni Embed as the required open-source-model choice unless organizers and licence review explicitly support that use.

## Which separator should we test first?

### Takeaway

Start with Demucs `htdemucs_6s`. Compare one guitar-capable RoFormer only if the baseline fails listening checks and weight provenance/licensing can be resolved; popular vocal-removal checkpoints do not isolate guitar.

### Cited Findings

- **Demucs baseline:** `htdemucs_6s` adds guitar and piano to the standard four stems. Upstream calls it experimental and says the project is no longer actively maintained. The repository is MIT licensed. CPU mode exists; default outputs are PCM16 WAV. Default clipping avoidance can independently rescale stems, altering relative levels. Do not use the README's general memory/runtime figures as measured six-stem performance on our hardware. [Demucs upstream README](https://github.com/facebookresearch/demucs/blob/main/README.md).
- **Guitar specialist alternative, conditional:** MVSep's official API identifies model type `31` as guitar/other and lists specialized MelRoFormer and BS RoFormer options; current default BS Roformer SW reports SDR 9.05. Those are vendor-reported metrics, not comparable to our Demucs test. An API product is not proof that its weights may be downloaded/self-hosted. [MVSep official API](https://mvsep.com/en/full_api).
- **Downloadable candidate with unresolved rights:** `becruily/mel-band-roformer-guitar` exposes a roughly 45.1 MB checkpoint plus guitar configs, but has no model card or licence visible in the inspected tree. Hugging Face reports pickle tensor imports. Public download availability is insufficient evidence of redistribution or deployment permission. Pin the exact repository revision and review the checkpoint loader before use; do not approve this candidate for shipping yet. [Publisher repository](https://huggingface.co/becruily/mel-band-roformer-guitar), [published files](https://huggingface.co/becruily/mel-band-roformer-guitar/tree/main).
- **Another explicit guitar-capable checkpoint:** ZFTurbo's MVSep Mega 53-stem release, BS RoFormer-based, includes acoustic guitar, electric guitar and guitar outputs. Its author recommends at least 16 GB VRAM, warns individual stems can underperform specialist models, and states stems overlap rather than summing to the original mix. The code repository has MIT terms; checkpoint-specific rights still need confirmation. This is a larger fallback experiment, not a lightweight drop-in. [Publisher release](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.21), [code licence](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/LICENSE).
- The universal training/inference repository supports `bs_roformer`/`mel_band_roformer` and separate config/checkpoint inputs. Its published pretrained table distinguishes vocals/other, other and six-stem guitar outputs. Selecting an architecture name is not selecting a guitar-trained model. [Inference README](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/README.md), [pretrained-model table](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md).

### Inferences

- Demucs has the clearest minimal documented setup and target-stem provenance of the options examined. Its maintenance risk is manageable only after an isolated, pinned smoke test.
- Loud cymbal bleed can inflate measured brightness; vocal spill changes midrange; separation smearing can resemble sustain/reverb. Evaluate the stem and the full downstream preset together. Do not aggressively dereverb or denoise a tone reference unless demonstrating that this preserves the target tone.
- Use clean guitar, distorted guitar and dense mixes plus a no-guitar negative. Prefer self-recorded mixes with known isolated stems. Compare loudness-matched stems and actual browser renderings, not only vendor SDR. If quality is inadequate, expose low-quality flags and manual passage selection rather than silently analyzing the whole mixture.

### Gaps

- No guitar-specialist downloadable RoFormer found with sufficiently clear model-specific licence, training provenance and reproduced benchmark to recommend unconditional deployment. Code MIT does not answer weight rights.
- No rights-cleared audio or GPU environment was supplied, so no separator is a measured winner. CPU feasibility is not proof of meeting the project's warmed 60-second/90-second target.

## What is the minimum safe setup and experiment sequence?

### Takeaway

Keep the API environment stable; prepare a separate separator environment only after selecting hardware and a budget. Establish the text-model baseline first and keep Omni as a bounded optional trial.

### Cited Findings

- Demucs packaging requires Python 3.8 or newer and loads separation dependencies separately from development/training extras. This lower bound is not proof that the latest Python/PyTorch combination works. [Upstream packaging](https://github.com/facebookresearch/demucs/blob/main/setup.py).
- Exploratory commands below follow the documented install/CLI; they are unexecuted, not a tested lockfile. Use an isolated Linux CPU/GPU environment with compatible PyTorch/torchaudio, decoding support and storage outside Git. First 10–20 seconds should be rights-cleared. [Demucs upstream usage](https://github.com/facebookresearch/demucs/blob/main/README.md).

```bash
# Separate environment; choose an interpreter supported by the resolved stack.
python3 -m venv /path/outside-repo/modulo-separator
/path/outside-repo/modulo-separator/bin/python -m pip install demucs
/path/outside-repo/modulo-separator/bin/python -m demucs -n htdemucs_6s -d cpu -o /path/artifacts /path/rights-cleared-short-mix.wav
# After GPU approval, repeat with -d cuda; record cold and warmed runtimes.
```

- RoFormer inference needs the exact model type, matching config and checkpoint, input directory and output directory. Do not mix arbitrary YAML files and similarly named weights. [Publisher inference instructions](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/README.md).
- Neural Amp Modeler trains and exports `.nam` models; its training guide requires an input test signal plus its reamped output through the target amp/pedal. This is a different data problem from an already-mixed song. [NAM repository](https://github.com/sdatkinson/neural-amp-modeler), [NAM reamping guide](https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/colab.html).

### Inferences

1. Before spending: claim applicable credits, verify expiration/quota and set a total cap. Prepare rights-cleared clips; define the unchanged six-control schema and record model/feature/separator versions.
2. Run one NVIDIA text request on measured features; validate through existing project code and listen through the actual browser graph. Compare with a hand-tuned or deterministic feature baseline, because valid JSON can still sound wrong.
3. Smoke-test short CPU separation if local resources permit, then benchmark three fixed clips on one approved GPU session. Record environment freeze, checkpoint revision/hash, cold download/load time, warm inference, output duration/alignment/peak and listening notes. Lock only a stack that actually passes.
4. If separation is unacceptable, evaluate one conditional guitar specialist after rights/provenance confirmation. Do not train a new separator before the deadline.
5. Only if core works, try Omni for additional tone descriptions on the same clips. Compare blind preference, abstention on no-guitar input, latency and cost against feature-only preset inference. Keep live playing entirely in the local browser graph.

### Gaps

- No setup commands were executed, no environment pinned and no raw-audio upload performed. No application, browser, hardware or billable API tests were run.
- Default choice is a practical recommendation, not a measured best model. NVIDIA-hosted prototype access may help investigation but does not replace the required real Nebius runtime path.
