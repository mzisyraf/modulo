# Shared hackathon cloud access

Isyraf's chosen setup: share the existing hackathon credentials privately with Dinnie and Shazlin. Each laptop runs the frontend and lightweight local API; **Cloud API** sends only separation to the deployed Modal worker. Neither teammate needs CUDA, Demucs, Torch or a local GPU. Nebius Token Factory remains the preset provider.

## Transfer these two files privately

| File from Isyraf's checkout | Put it at the same relative path on each laptop |
|---|---|
| `data/modal/config.toml` | Modal workspace token pair/profile |
| `services/api/.env` | Token Factory key and its server-side settings |

Use an encrypted file transfer or AES-encrypted archive; send its password separately. Do not send the plaintext files through a group chat or GitHub. Do not put them in the frontend, a `VITE_*` variable, screenshots, logs or a commit. Git ignores both paths. Keep an existing teammate `.env` backup privately before replacing it; never overwrite their credentials automatically.

The shared Modal token grants workspace access beyond just one inference function. All three people share the same credit balance and the same ten-attempt cloud ledger (see [the latest overnight snapshot](OVERNIGHT_RESULTS.md)). That counter must not be reset to bypass limits. The initial token expires **5 November 2026**; Isyraf must renew/re-share for later use. Revoke shared credentials after the event. [Modal authentication and workspaces](https://modal.com/docs/guide/workspaces).

## Run the full app without a GPU

1. Pull/merge the reviewed Isyraf integration through the team's normal branch workflow. Run `npm ci` at the repository root. Install the normal Python 3.12 API environment from `services/api/requirements-lock.txt` as in [DEVELOPMENT.md](DEVELOPMENT.md).
2. Create the separate Modal client environment, from the repository root:

   ```powershell
   python -m venv tools/modal/.venv
   .\tools\modal\.venv\Scripts\python.exe -m pip install -r tools/modal/requirements-lock.txt
   ```

3. Place the two private files at the paths above. Run the local API on port 8000 and `npm run dev` as documented. Open the main app, select **Tone Match → Cloud API**, choose a song and press **Separate guitar**. Local remains the default and requires the local GPU environment; Cloud API never silently falls back to Local.
4. For custom rig generation, keep `NEBIUS_RIG_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` and `NEBIUS_RIG_FALLBACK=1`. Each fresh teammate setup can use `NEBIUS_BUDGET_USD=1.5` and `NEBIUS_MAX_REQUESTS=6` within the team's approved US$10 Token Factory ceiling. An invalid Nano rig can trigger one counted Super repair; six attempts allow at least three such generation pairs. **Replace Isyraf's overnight allowance with this allocation before using the transferred `.env`.** A key alone does not enable generation. Each laptop has its own cumulative inference ledger; these allowances do **not** enforce one global shared-key cap. Preserve any existing ledger; an exhausted counter needs operator review rather than deletion. Rig generation requires a numeric bounded budget and rejects `unlimited`.

No model-service keys are required in the browser. In the main app choose **Guitar audio → Use supplied dry guitar**, or upload a clean recording, to calibrate and test without an instrument. The CC BY 4.0 sample and credits are included in the app. File mode never requests microphone access; its prepared recording also becomes the main dry audition source. **Live guitar** still needs the physical instrument/interface and permission. Switching source invalidates the previous calibration and generated result.

After separation, listen and confirm a passage. Choose **Generate custom rig → wait for automatic local refinement/output checking → review → Apply custom rig**, then use **Play dry recording** and the actual model controls. The AI proposes explicit values for each selected model's controls; factory presets are not the answer space. Refinement runs once on the laptop CPU after an explicit Generate/Retry, makes no extra model calls and preserves output protection. Apply and playback remain manual. Turn off **Automatically refine after generation** for the existing manual Check/Refine flow. Reconnect, reopening a project, Cancel and Restore never start automatic refinement. All processing/playback remains in the main app; `separation.html` has been removed. Spectral/dynamics comparisons are diagnostic and do not certify audible matching or physical interface latency.

Use at least **six seconds** of clear source audio for independently validated refinement (the supplied sample qualifies). Shorter valid calibrations can still generate/check a rig; automatic refinement is skipped with guidance. Cancellation or refinement errors leave the proposal available for a manual Check without retrying automatically. Refinement can add/swap supported effects, tests a separate excerpt and retains original timbre settings if validation fails. **Restore original proposal** returns to the model's untouched settings and requires a fresh Check before Apply. An improved feature score still needs listening review.

For a stable production preview, run `npm run build`, then `npm run preview` and open **http://127.0.0.1:4173** with the API on 8000. Development uses 5173; both previews proxy the same local API. Do not rebuild or edit the development app during a long calibration/refinement session: refresh/HMR can discard in-memory audio and recordings.

## Failure and retention

Missing SDK/credentials, exhausted shared allowance, queue/worker failures and cancelled transfers appear as Cloud API failures. Check private `data/jobs/<job-id>/worker.log` or the Modal dashboard before manually retrying; failed attempts can incur charges. The local API bounds the entire remote operation to 20 minutes and attempts cancellation on timeout. Modal bounds GPU execution separately to ten minutes. A forced laptop/API crash can leave the remote job running until cancellation or its provider timeout; abandoned cloud audio is removed by the existing hourly expiry task after 24–25 hours.

See [the Modal worker setup](../tools/modal/README.md) for deployment, billing, token renewal and stopping the service. Sharing files and activating paid generation are manual operator actions; this setup guide contains no keys and sends nothing to teammates automatically.
