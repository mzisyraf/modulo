# Local Demucs testing

This is a separate Windows/CUDA testing environment for Isyraf's separation work. It does not change the API's Python 3.12 environment, connect song analysis to the browser, or use Nebius credentials. The generated-signal smoke test checks installation and GPU execution; it cannot establish guitar isolation quality.

## Install

Run from the repository root using an existing Conda installation. The environment, package cache, model weights and generated audio stay in Git-ignored locations. Allow several GB for CUDA packages and their download cache.

```powershell
$env:CONDA_PKGS_DIRS = Join-Path $PWD 'data\conda-pkgs'
conda create --prefix ./tools/demucs/.venv --override-channels -c conda-forge python=3.10.22 ffmpeg=9.0.2 pip -y
$env:PIP_CACHE_DIR = Join-Path $PWD 'data\pip-cache'
.\tools\demucs\.venv\python.exe -m pip install --index-url https://pypi.org/simple -r tools/demucs/requirements-lock.txt
.\tools\demucs\.venv\python.exe -m pip check
```

The direct dependencies are in [requirements.txt](../tools/demucs/requirements.txt); the resolved Python packages are in [requirements-lock.txt](../tools/demucs/requirements-lock.txt). Use the lock for normal installation. Demucs's archived dependency range needs older TorchAudio; do not upgrade this stack or install it into `services/api/.venv` without a new smoke test. PyTorch's CUDA wheel includes its runtime; this setup does not require a separate global CUDA toolkit installation.

Sources: [Demucs Windows setup](https://github.com/facebookresearch/demucs/blob/main/docs/windows.md), [minimal separation dependencies](https://github.com/facebookresearch/demucs/blob/main/requirements_minimal.txt), [official PyTorch 2.0.1 / TorchAudio 2.0.2 CUDA 11.8 pairing](https://pytorch.org/get-started/previous-versions/#v201).

## Run the synthetic GPU check

Run the quick failure regressions first; they generate temporary WAVs and mock GPU/model execution, so they need no GPU or model download:

```powershell
.\tools\demucs\.venv\python.exe -m unittest discover -s tools/demucs -p 'test_*.py' -v
```

These cover valid outputs, missing/corrupt stems, wrong sample rate/length/channel count/PCM encoding, non-finite decoded samples, missing FFmpeg/CUDA, model failure/timeout, missing outputs after a zero exit, and truthful synthetic success metadata. Validation uses explicit errors and remains active under `python -O`.

Then run the actual model/GPU check:

```powershell
.\tools\demucs\.venv\python.exe tools/demucs/smoke.py
```

The check requires CUDA, generates a 12-second stereo PCM16 signal, runs `htdemucs_6s` with five-second processing segments, and checks all six output stems for finite samples, matching length/channels/sample rate and PCM16 encoding. It sets the model cache to `models/torch` and adds the environment's FFmpeg directory only to the subprocess environment.

Each run creates a new ignored `artifacts/demucs-smoke-*` folder containing `synthetic.wav`, `demucs.log`, the six separated WAVs, and a `result.json` written only after all checks pass. A failed command exits unsuccessfully and prints its log location. The JSON records hardware, versions, elapsed time including model loading/download, output paths and peaks. First-run time is not a warmed benchmark. A second successful run uses cached weights. Keep the log if a run fails; do not describe a CPU fallback as a GPU pass.

The synthetic input has no labelled guitar stem. Quiet or implausible guitar output does not prove a separator failure or success; this test proves the pipeline executes and produces valid files only. No audio playback is started automatically.

## Verified local result — 27 October 2026

Windows, NVIDIA GeForce RTX 4050 Laptop GPU (6 GB), driver 621.01. Both runs passed the six-stem checks on 529,200 stereo frames at 44.1 kHz (12 seconds):

| Run | Demucs subprocess time, including loading | Local evidence |
|---|---:|---|
| First model download/load | 12.915 seconds | `artifacts/demucs-smoke-w59zdpnv/result.json` |
| Cached-weight repeat | 6.226 seconds | `artifacts/demucs-smoke-0a2a4w_4/result.json` |

The working stack is Python 3.10.22, FFmpeg 9.0.2, Demucs 4.0.1, Torch 2.0.1+cu118, TorchAudio 2.0.2+cu118, NumPy 1.26.4 and SoundFile 0.13.1. The official cached checkpoint is `5c90dfd2-34c22ccb.th` (54,996,327 bytes), SHA-256 `34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd`.

Evidence folders remain local and ignored. These are two execution checks, not a real-music quality or 60-second performance benchmark. The subprocess timings exclude the smoke script's own initial imports and signal generation. Do not infer hardware/live-input or NVIDIA/Nebius preset acceptance from these results.

## Test real audio next

Prepare three rights-cleared, short clean/distorted/dense mixes as aligned 44.1 kHz PCM16 WAVs under ignored `data/bench`. In this PowerShell session, set the local paths and call the upstream CLI:

```powershell
$env:TORCH_HOME = Join-Path $PWD 'models\torch'
$env:PATH = (Join-Path $PWD 'tools\demucs\.venv\Library\bin') + ';' + $env:PATH
.\tools\demucs\.venv\python.exe -m demucs -n htdemucs_6s -d cuda --segment 5 -o separated 'data/bench/clean.wav'
```

Listen to `separated/htdemucs_6s/clean/guitar.wav` alongside the original mix. Record bleed, missing notes, distortion/smearing, exact model/stack, elapsed time and cold versus warmed runs. Keep the aligned non-guitar stems for later backing-track experiments. The default four-source model has no guitar stem; select `htdemucs_6s` explicitly. See [upstream usage and model limits](https://github.com/facebookresearch/demucs/blob/main/README.md).

Five-second segments are a starting setting for the RTX 4050's 6 GB VRAM. Close other GPU-heavy applications if memory is tight. A smaller segment or explicit `-d cpu` can diagnose memory problems, but any changed setting/device needs its own recorded result.

Demucs normally rescales individual output stems to avoid clipping. Record that behavior before computing stem/mix energy ratios; do not independently normalize exports. The existing [reference selector](ANALYSIS.md) requires matching sample rates/frame counts and time alignment. Only use its energy proxy after validating export scaling; listening remains necessary for bleed and guitar-presence checks. Keep uploads, weights and generated stems out of Git.
