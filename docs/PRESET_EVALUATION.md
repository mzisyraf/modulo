# Preset quality evaluation

Schema validity, successful generation and audible playback do not establish a tone match. The original provider received only input level and target energy, so it could not infer EQ or distortion reliably. The current pipeline adds measured spectra and engine semantics, evaluates rendered audio, and offers local refinement without further AI calls.

## What runs

`tools/evaluation/preset_eval.py` prepares a rights-cleared mono PCM16/44.1kHz DI performance, a 15-second calibration excerpt and a disjoint held-out excerpt of at least three seconds. Two known reachable targets apply EQ or distortion through the actual `AudioEngine`. The provider receives source measurements and measured target descriptors, never the hidden target settings. Its raw proposal remains saved separately from local refinement.

`tools/verification/preset-quality.browser.js` uses `AudioEngine.renderFile`, which initializes the exact production graph in an OfflineAudioContext. There is no second Python amp implementation and no speaker/microphone context. Source/target/neutral/AI/refined use the same performance, sample rate and alignment. Identical target re-renders must score zero; intentionally wrong controls must score worse. The renderer-only refactor was also checked against earlier target WAVs: both exported target files stayed byte-identical.

The numeric grader uses sampled multi-resolution STFT (512/1024/2048, <=128 uniformly distributed Hann frames per resolution, 20Hz–20kHz), spectral convergence and mean log-magnitude error. It reports raw and RMS-matched losses plus level difference, waveform ESR, peak and output-guard occupancy. Louder audio cannot masquerade as better tone. Silent, nonfinite, unpaired or different-length audio rejects; >20dB level mismatch requires inspection. Lower diagnostic error is better; there is no “accuracy percentage.” The metric family is described in [auraloss](https://github.com/csteinmetz1/auraloss); our small deterministic implementation has no PyTorch dependency and is not a perceptual metric certified against listeners.

The predeclared provisional gate requires safe output and improvement over neutral in both raw loss and RMS-matched loss, with >=10% improvement for the latter. The refined result must also beat the raw proposal and improve on the held-out excerpt **without tuning on that excerpt**. `verify` exits unsuccessfully when a gate fails, metadata/source hashes change, or controls fail. These thresholds are diagnostic and need held-out listening calibration before any release-quality claim.

## Run locally

Use Node24, the API venv and the existing Vite setup. No GPU, paid infrastructure or additional dependencies are needed for rendering/tests. Source audio is not checked into Git.

1. Start `npm run dev` on `127.0.0.1:5173`. Prepare a new output directory:

   ```powershell
   .\services\api\.venv\Scripts\python.exe tools/evaluation/preset_eval.py prepare data/verification/my-preset-eval --source "path-to-cleared-di.wav"
   ```

2. Serve only that benchmark directory:

   ```powershell
   .\services\api\.venv\Scripts\python.exe tools/evaluation/preset_eval.py serve data/verification/my-preset-eval
   ```

3. Run `tools/verification/preset-quality.browser.js` through the existing Playwright `browser_run_code_unsafe` filename interface. This first pass renders known targets/controls and saves `report.json`, `report.html` and WAVs, with `NEEDS_PROPOSAL` until proposals exist. The bounded loopback receiver writes only allowlisted report/audio filenames, <=2MiB, with same-origin CORS and an ephemeral token. A generic static HTTP server cannot receive the outputs.

4. To request at most two real proposals, deliberately run the following with an already approved runtime allowance. It uses the existing private .env/normal durable ledger; defaults remain disabled. Cached proposals are reused; failed requests are not automatically retried. Then rerun the browser script, which renders/refines locally and makes no provider requests.

   ```powershell
   .\services\api\.venv\Scripts\python.exe tools/evaluation/preset_eval.py propose data/verification/my-preset-eval --generate
   ```

5. Run the gate and open `http://127.0.0.1:5175/report.html` for matched-RMS listening copies:

   ```powershell
   .\services\api\.venv\Scripts\python.exe tools/evaluation/preset_eval.py verify data/verification/my-preset-eval
   node --test tools/evaluation/metrics.test.mjs
   ```

Stop the local receiver when finished. Preserve separate output directories for before/after comparisons; do not overwrite an old run or reset the real budget ledger.

## Product flow and scope

Recording calibration now measures six normalized bands (40/120/350/1000/3000/8000/16000Hz edges), centroid, flatness and crest factor. Browser/Python parity is tested. Source measurements remain explicitly browser-measured; the local API measures the confirmed target WAV itself. Numeric descriptors and fixed engine semantics are sent to Nemotron. Invalid/missing spectral pairs fail before reservation. Reference/expiry is rechecked after target analysis, before billing. Full source metadata scopes the cache, so the same file with newly added spectra cannot silently reuse an old level-only proposal. Legacy level-only API requests retain their warnings.

On a generated preset, **Check rendered tone** compares the actual rendered candidate and neutral rig against target descriptors locally. Since a user's recording and a song contain different notes/technique, this is a **spectral proxy**, not the paired benchmark or perceptual accuracy. A failed/no-improvement result remains visible; Apply never follows automatically.

**Refine locally** runs a deterministic bounded search of at most 49 cached candidate renders on up to the first 15 seconds, starting from clean and saturated alternatives and adjusting supported EQ/drive. It preserves calibrated input gain, penalizes output-guard saturation, and preserves the current input/output gains in the product UI. The paired benchmark can explicitly match target RMS within schema/headroom bounds; a quiet separated stem does not automatically set product listening volume. It makes no AI request. Cancellation/navigation/source or parameter changes discard stale results. **Use refined controls** edits the proposal and requires a separate Apply; the raw provider result is unchanged. Edited controls require another check. Normal playback stays separate.

The initial real level-only benchmark failed the EQ case and improved the distortion case only provisionally. Adding spectra helped EQ but did not reliably fix drive. Local refinement improved both controlled targets and transferred to their held-out excerpts. Exact measured results and source/engine hashes live in ignored run artifacts, not hardcoded as universal acceptance. The downloaded Guitar-TECHS source includes CC BY4 attribution alongside the report.

Remaining acceptance: more players/pickups/interfaces, clean/crunch/dense and sparse/bleeding separated targets, repeated independent proposals, level-matched blind listening and actual hardware latency. The engine still has no cabinet/amp circuit model, compressor, delay or reverb. This pipeline cannot certify a tone outside that effect space, guarantee guitar separation quality, or identify equipment. Human listening approval is still required for musical-quality claims.

## Listening comparison

The standalone recording comparison enables `Match listening levels` by default. It measures actual offline Original/bypass and Rig output, then sets transient independent dry/wet route gains after effects and before master/output protection. It targets at most -24dBFS RMS with peak headroom and bounded +/-48dB compensation. These are not preset parameters and do not alter input drive/EQ or shared live playback defaults. Each mode keeps the same source/time position. Playback recalculates after edits; toggling matching stops playback and requires Play. Synthetic test signals use raw preset levels. RMS matching reduces loudness bias but is not perceptual/LUFS certification.

Provider generation now requests documented strict JSON-schema output using the same six-control schema and bounded name/description. Backend validation still rejects malformed, truncated, out-of-range or wrong-model output without fallback/retry; safe rejection-stage labels assist diagnosis. This prevents a valid playback test from being mistaken for valid model output.
