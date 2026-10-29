# Shared hackathon cloud access

Isyraf's chosen setup: share the existing hackathon credentials privately with Dinnie and Shazlin. Each laptop runs the frontend and lightweight local API; **Cloud API** sends only separation to the deployed Modal worker. Neither teammate needs CUDA, Demucs, Torch or a local GPU. Nebius Token Factory remains the preset provider.

## Transfer these two files privately

| File from Isyraf's checkout | Put it at the same relative path on each laptop |
|---|---|
| `data/modal/config.toml` | Modal workspace token pair/profile |
| `services/api/.env` | Token Factory key and its server-side settings |

Use an encrypted file transfer or AES-encrypted archive; send its password separately. Do not send the plaintext files through a group chat or GitHub. Do not put them in the frontend, a `VITE_*` variable, screenshots, logs or a commit. Git ignores both paths. Keep an existing teammate `.env` backup privately before replacing it; never overwrite their credentials automatically.

The shared Modal token grants workspace access beyond just one inference function. All three people share the same credit balance and the same ten-attempt cloud ledger (**seven remained at the 30 October planning check**, after three reservations). That counter must not be reset to bypass limits. The initial token expires **5 November 2026**; Isyraf must renew/re-share for later use. Revoke shared credentials after the event. [Modal authentication and workspaces](https://modal.com/docs/guide/workspaces).

## Run the full app without a GPU

1. Pull/merge the reviewed Isyraf integration through the team's normal branch workflow. Run `npm ci` at the repository root. Install the normal Python 3.12 API environment from `services/api/requirements-lock.txt` as in [DEVELOPMENT.md](DEVELOPMENT.md).
2. Create the separate Modal client environment, from the repository root:

   ```powershell
   python -m venv tools/modal/.venv
   .\tools\modal\.venv\Scripts\python.exe -m pip install -r tools/modal/requirements-lock.txt
   ```

3. Place the two private files at the paths above. Run the local API on port 8000 and `npm run dev` as documented. Open the main app, select **Tone Match → Cloud API**, choose a song and press **Separate guitar**. Local remains the default and requires the local GPU environment; Cloud API never silently falls back to Local.
4. For preset generation, the copied `.env` must contain an approved nonzero `NEBIUS_BUDGET_USD` and `NEBIUS_MAX_REQUESTS`. A key alone does not enable generation. Each laptop has its own local inference ledger; these per-laptop allowances do **not** enforce one global Token Factory cap. Divide the agreed allowance among laptops rather than each copying the full allowance or using `unlimited`.

No model-service keys are required in the browser. Source guitar calibration/live amp/recording remain in the browser, so an actual instrument/interface is still needed for live calibration; cloud processing does not simulate hardware input. All job playback and generated preset controls remain in the main app. The standalone `separation.html` has been removed.

## Failure and retention

Missing SDK/credentials, exhausted shared allowance, queue/worker failures and cancelled transfers appear as Cloud API failures. Check private `data/jobs/<job-id>/worker.log` or the Modal dashboard before manually retrying; failed attempts can incur charges. The local API bounds the entire remote operation to 20 minutes and attempts cancellation on timeout. Modal bounds GPU execution separately to ten minutes. A forced laptop/API crash can leave the remote job running until cancellation or its provider timeout; abandoned cloud audio is removed by the existing hourly expiry task after 24–25 hours.

See [the Modal worker setup](../tools/modal/README.md) for deployment, billing, token renewal and stopping the service. Sharing files and activating paid generation are manual operator actions; this setup guide contains no keys and sends nothing to teammates automatically.
