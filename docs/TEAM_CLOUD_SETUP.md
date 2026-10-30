# Shared hackathon cloud access

Isyraf's chosen setup: share the existing hackathon credentials privately with Dinnie and Shazlin. Each laptop runs the frontend and lightweight local API; **Cloud API** sends only separation to the deployed Modal worker. Neither teammate needs CUDA, Demucs, Torch or a local GPU. Nebius Token Factory remains the preset provider.

## Transfer these two files privately

| File from Isyraf's checkout | Put it at the same relative path on each laptop |
|---|---|
| `data/modal/config.toml` | Modal workspace token pair/profile |
| `services/api/.env` | Token Factory key and its server-side settings |

Use an encrypted file transfer or AES-encrypted archive; send its password separately. Do not send the plaintext files through a group chat or GitHub. Do not put them in the frontend, a `VITE_*` variable, screenshots, logs or a commit. Git ignores both paths. Keep an existing teammate `.env` backup privately before replacing it; never overwrite their credentials automatically.

The shared Modal token grants workspace access beyond just one inference function. All three people share the same credit balance and durable usage ledgers. On **31 October 2026**, Isyraf authorized removing application attempt and spending caps for separation, tabs and Nebius generation. Preserve all existing ledgers; usage continues accumulating without an application stop. Provider credit/rate limits still apply and charges can continue. Older overnight allowance snapshots are historical. The initial token expires **5 November 2026**; Isyraf must renew/re-share for later use. Revoke shared credentials after the event. [Modal authentication and workspaces](https://modal.com/docs/guide/workspaces).

## Run the full app without a GPU

1. Pull/merge the reviewed Isyraf integration through the team's normal branch workflow. Run `npm ci` at the repository root. Install the normal Python 3.12 API environment from `services/api/requirements-lock.txt` as in [DEVELOPMENT.md](DEVELOPMENT.md).
2. Create the separate Modal client environment, from the repository root:

   ```powershell
   python -m venv tools/modal/.venv
   .\tools\modal\.venv\Scripts\python.exe -m pip install -r tools/modal/requirements-lock.txt
   ```

3. Place the two private files at the paths above. Run the local API on port 8000 and `npm run dev` as documented. Open the main app, select **Tone Match → Cloud API**, choose a song and press **Separate guitar**. Local remains the default and requires the local GPU environment; Cloud API never silently falls back to Local.
4. For custom rig generation, keep `NEBIUS_RIG_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` and `NEBIUS_RIG_FALLBACK=1`. A configured backend key now enables uncapped manual generation. `NEBIUS_BUDGET_USD` and `NEBIUS_MAX_REQUESTS` are retired and ignored, including old zero or exhausted values; no private credential edits are required. An invalid Nano rig can trigger one counted Super repair. Nano/Super and all failed attempts continue accumulating in each laptop's existing inference ledger. Update your branch from staging and restart the local API to load this behavior. Shared Modal worker updates take effect for every laptop; updating also removes the old tabs-client preflight stop.

No model-service keys are required in the browser. In the main app choose **Guitar audio → Use supplied dry guitar**, or upload a clean recording, to calibrate and test without an instrument. The CC BY 4.0 sample and credits are included in the app. File mode never requests microphone access; its prepared recording also becomes the main dry audition source. **Live guitar** still needs the physical instrument/interface and permission. Switching source invalidates the previous calibration and generated result.

After separation, listen and confirm a passage. Choose **Generate custom rig**, wait for automatic local refinement and its safety check, then deliberately **Apply custom rig**. Use **Play dry recording** and the actual model controls to listen. The AI proposes explicit values for each selected model's controls; factory presets are not the answer space. Refinement runs on the laptop CPU, makes no extra model calls and preserves output protection. All processing/playback remains in the main app; `separation.html` has been removed. Spectral/dynamics comparisons are diagnostic and do not certify audible matching or physical interface latency.

Use at least **six seconds** of clear source audio for independently validated refinement (the supplied sample qualifies). Shorter valid calibrations can still generate/check a rig. Refinement can add/swap supported effects, tests a separate excerpt and retains original timbre settings if validation fails. **Restore original proposal** returns to the model's untouched settings and requires a fresh Check before Apply. An improved feature score still needs listening review.

**Refine automatically after generation** is on by default. Uncheck it before Generate for the manual Check/Refine workflow. Each explicit Generate/Retry can start local refinement once, including a cached response. Reconnect, reopening a project, navigation, Restore and cancellation cannot restart it. Cancel/source/reference/project changes stop pending work; render errors and short recordings leave the original available for manual Check. Nothing automatically applies, plays or requests a microphone.

For a stable production preview, run `npm run build`, then `npm run preview` and open **http://127.0.0.1:4173** with the API on 8000. Development uses 5173; both previews proxy the same local API. Do not rebuild or edit the development app during a long calibration/refinement session: refresh/HMR can discard in-memory audio and recordings.

For live play-along, **Start live input** and **Play backing passage** can be used in either order. Backing pause/restart keeps the same explicit input capture; **Stop audio** or navigation stops both. Original/extracted-guitar previews and local file/test-signal auditions retain exclusive playback. A saved performance records the processed guitar only. Synthetic native-browser checks cover these paths; physical interface/feedback, tight synchronization and measured latency still need the [hardware checklist](DEMO_ACCEPTANCE.md#connected-guitar-acceptance--20-minutes-hardware-required).

## Failure and retention

Missing SDK/credentials, queue/worker failures and cancelled transfers appear as Cloud API failures. Check private `data/jobs/<job-id>/worker.log` or the Modal dashboard before manually retrying; failed attempts can incur charges. The local API bounds the entire remote operation to 20 minutes and attempts cancellation on timeout. Modal bounds GPU execution separately to ten minutes. A forced laptop/API crash can leave the remote job running until cancellation or its provider timeout; abandoned cloud audio is removed by the existing hourly expiry task after 24–25 hours.

See [the Modal worker setup](../tools/modal/README.md) for deployment, billing, token renewal and stopping the service. Sharing files and activating paid generation are manual operator actions; this setup guide contains no keys and sends nothing to teammates automatically.
