# Refinement speed and effects-encoder checkpoint — 30 October 2026

The product refinement is faster with the same selected settings and scores. AFx-Rep is an optional offline research benchmark, not the production scorer. No cloud requests, deployment, training or budget changes were needed.

## Measured speed and unchanged audio

On this laptop/browser, three complete 78-render searches on the same licensed development input and cached clean proposal took:

| | Baseline staging9eb58fa | Optimized |
|---|---:|---:|
| Run1 | 23.128s | 15.735s |
| Run2 | 23.884s | 15.885s |
| Run3 | 22.891s | 15.787s |
| Mean | 23.301s | 15.802s |
| Decodes per search | 79 | 3 |
| WAV creations per search | 80 | 2 |

Mean wall time fell32.18% (1.47× throughput for this case). This is not a promised song/cloud latency. All runs selected identical modules, parameters, output level and exact training/validation losses. Native file-versus-prepared-buffer renders were sample-identical for clean/crunch/ambience and both input channels; two-second tails and cancellation also passed.

`renderRigBuffer` is the prepared-audio path. Existing `renderRigFile` download callers retain their WAV response. Refinement decodes the source and each of its two search windows once, then scores the prepared buffers. Two one-time PCM16 excerpt conversions preserve the browser's original PCM normalization; direct hand-normalization was rejected because it changed diagnostics. The FFT caches only twiddles up to8192 points (under128KiB), preserving arithmetic. Search policy,80-render cap, calibration, validation and safety limits are unchanged.

Raw local evidence: `data/scorer/render-baseline.json`, `render-final-checked.json`. Reproduce with Vite5173 and `tools/verification/render-efficiency.browser.js` through Playwright's filename runner. It requires the existing licensed development fixture directory and cached proposals under `data/verification/rig-reliability-20261030/`; these private audio/evidence files are deliberately not committed. `render-parity.browser.js` checks native channel/tail/cancellation parity using synthetic input and the same target definitions. Normal application refinement requires none of these benchmark artifacts.

Changing audio package source changes the API's engine fingerprint, even when PCM is unchanged. Restart the API after updating; old cached rigs may require deliberate Generate again. No provenance/hash check was weakened and no old benchmark was relabelled as a new quality run.

## Learned scoring: promising, offline only

The pretrained [AFx-Rep encoder](https://huggingface.co/csteinmetz1/afx-rep) retrieved the exact effect condition in6/6 queries; the current spectral/temporal metric retrieved4/6. Both retrieved2/2 clean conditions. Current misses were the nearby crunch gain and nearby delay time. Six half-amplitude controls passed with maximum embedding drift<=1e-4.

This is twelve actual engine renders: clean/crunch/ambience targets plus a nearby parameter alternative, each rendered on two disjoint six-second phrases from the first15 seconds of one licensed recording. Queries from phraseB retrieve among phraseA candidates. No final held-out audio was used or tuned. The recording, player and instrument are shared: this does not establish different-player/song reliability or that an optimized rig sounds closer to a song. No scorer weight was fitted.

On the local RTX4050 Laptop6GB, model load was4.614s; first forward174.5ms and warm forwards15.8–16.7ms per eight-second stereo clip. These GPU forward timings exclude file loading, resampling, transfer and cold process startup. This model is not loaded by the web app/API and teammates do not need a GPU for the existing product flow. Cloud integration is deferred pending independent listening and a larger cross-performance ranking test.

## Reproduce the optional encoder benchmark

Upstream code is Apache2; the adapted PANNs file also carries its MIT attribution. The checkpoint is Apache2. Keep code/weights/dependencies in ignored `data/scorer/`, separate from API and product environments. The tested local environment reused the existing Demucs Python3.10/Torch2.0.1+cu118/torchaudio2.0.2 CUDA installation through an isolated `--system-site-packages` venv; API Python3.12 has no Torch requirement. The optional direct requirements are `tools/evaluation/scorer-requirements.txt`.

```powershell
# Run from repository root, only with the existing compatible Demucs environment.
tools/demucs/.venv/python.exe -m venv --system-site-packages data/scorer/.venv
data/scorer/.venv/Scripts/python.exe -m pip install -r tools/evaluation/scorer-requirements.txt
git clone https://github.com/csteinmetz1/st-ito data/scorer/st-ito
git -C data/scorer/st-ito checkout ec50e0cc647cc3637d0cbbfc01d059c682c9fb27
```

Download `afx-rep.ckpt` from the official model repository at revision `6582cb5414094146759319819a4242967ecc7e39` to `data/scorer/afx-rep/afx-rep.ckpt` (1,156,477,784 bytes). Required SHA256: `3587c4f3a1a8ecbc53b8023c480a0e6ff80719bcc26ce6ee6d08b8daf41d75d4`. The runner verifies this hash and source revision before importing the reviewed encoder file. It uses restricted `weights_only=True` loading and explicitly allows only the standard `collections.Counter` required by this verified checkpoint; never change it to unrestricted pickle loading.

Create `data/scorer/cases/`. Serve the existing bounded loopback receiver with `services/api/.venv/Scripts/python.exe tools/evaluation/rig_eval.py serve data/scorer/cases --port 5175`. With Vite5173 running, execute `tools/verification/scorer-cases.browser.js` through Playwright's filename runner to render the twelve cases. The script reads only the licensed development fixtures named above. The receiver keeps its origin/token/size/path restrictions; stop it after use.

```powershell
data/scorer/.venv/Scripts/python.exe tools/evaluation/scorer_benchmark.py data/scorer/cases --device cuda
# Use --device cpu when a compatible CPU Torch environment is installed; timing will differ.
```

The script rejects missing/duplicate cases, changed weights, unexpected PCM and failed level controls. It writes `data/scorer/cases/scorer-report.json`. Upstream downloads, model weights, music and environment folders remain untracked. Do not run upstream download helpers or reset existing provider ledgers.

## Stop and promotion criteria

Keep the faster deterministic scorer as the product default. Stop optional model work at20:30MYT; no repeated model/provider experiments for this increment. Promote learned scoring only after independent performances, clean/crunch/ambience nearby-parameter controls and level-matched listening show improvement without clean regression, with bounded end-to-end latency/cost and a tested explicit failure path. The6/6 development retrieval result alone does not pass that gate. Real guitar/interface latency and fresh separated-song accuracy remain open.
