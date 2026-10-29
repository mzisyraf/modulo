# Nebius inference API

Scope confirmed by Isyraf, 29 October 2026: **host inference only, not the web app**. Approved total new cloud spending: **US$20**, including VM, storage, networking and provider calls. No cloud resources have been created yet.

## Request flow

Your local backend or another HTTP client uploads audio to the GPU service, polls the job and downloads guitar/backing WAVs. Reuse the existing bounded FastAPI job implementation and isolated Demucs environment rather than inventing a second inference protocol. One API worker serializes GPU work; a small HTTPS gateway authenticates every request. There is no frontend build or static website in these images.

The web app, browser amp, live guitar calibration and recording stay where they run today. Wiring the local backend to this remote service is a separate integration step; these files do not silently redirect existing local requests. Keep service credentials server-side. This deployment shares jobs among authorized clients and is intended for the small demo team.

The [competition rules](https://nebiusglobalaihackathon.devpost.com/rules) require Nebius usage and an NVIDIA open-source model. Cloud Demucs supplies GPU separation; the existing NVIDIA Nemotron Token Factory path supplies NVIDIA model inference. Demucs on an NVIDIA GPU alone does not establish NVIDIA-authored model use. Preserve real sanitized inference evidence for both. A long-lived judging service needs funding beyond this short test allowance.

## Provisioning prerequisites

1. Create a project at [Nebius AI Cloud](https://console.nebius.com/) and confirm billing/credits and one-GPU quota. A Token Factory API key cannot provision a VM. Share the project name or existing VM SSH host, never private keys or tokens.
2. Prefer an available L40S for the tested Torch 2.0.1/CUDA 11.8 stack, at least 32 GB RAM and initially 60 GB disk. Newer GPU generations require a separately validated Torch upgrade. Confirm Docker Compose GPU support and the complete VM/disk/IP price before launch.
3. Reserve at most $15 for a timed VM test, $1 for Token Factory and $4 contingency for storage/network/tax. Reduce runtime to match the actual console quote. Configure a provider-side stop schedule before launch and verify stopped state afterward; budget alerts and stopping containers do not enforce a dollar cap. Reconcile actual spend before another run.
4. Point an available HTTPS domain to the VM. Expose only 80/443 plus SSH restricted to the operator; leave port 8000 private. Confirm [current prices](https://nebius.com/prices) and [billing rules](https://docs.nebius.com/compute/resources/pricing). Retained disks remain chargeable after stopping compute.

## Build on the Linux GPU host

Use the reviewed source commit. Run from the repository root; never copy Windows virtual environments or local uploads to the host.

```sh
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
docker run --rm -it caddy:2.10.2 caddy hash-password
```

Set `MODULO_DOMAIN` and the single-quoted password hash in ignored `deploy/.env`. The HTTP username is `judge` (a service credential shared privately). Leave generation budgets at zero during separation setup. Then:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm api tools/demucs/.venv/bin/python -c 'from demucs.pretrained import get_model; get_model("htdemucs_6s")'
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm api tools/demucs/.venv/bin/python -c 'import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

The worker verifies the existing checkpoint SHA-256 and fails on missing/different weights. Persistent volumes retain jobs, model cache and the existing provider budget ledger. The API uses Python 3.12; Demucs uses Python 3.10. The Linux decoder is the distribution FFmpeg and requires a real-audio regression before cloud acceptance. Keep one API replica.

## Call the API

Replace the example domain, audio path and returned job ID. `curl -u judge` prompts privately for the password. Upload WAV/MP3, 10–295 seconds, at most 50 MiB (the proxy may enforce a slightly smaller boundary).

```sh
curl --fail -u judge https://inference.example.com/api/health
curl --fail -u judge -H 'Content-Type: audio/wav' -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" --data-binary @licensed-clip.wav https://inference.example.com/api/jobs
curl --fail -u judge https://inference.example.com/api/jobs/JOB_ID
curl --fail -u judge -o guitar.wav https://inference.example.com/api/jobs/JOB_ID/audio/guitar
curl --fail -u judge -o backing.wav https://inference.example.com/api/jobs/JOB_ID/audio/backing
```

Poll until the job reports ready or failed before downloading. Reuse the same idempotency UUID when retrying the same upload; do not launch duplicate work. The original aligned mixture is available as `/audio/mix`. Job failures remain explicit; there is no CPU fallback. Stored audio expires after the existing 24-hour retention period. External `/docs` is intentionally not exposed by the gateway; endpoint definitions remain in `services/api/app/main.py`.

Validate authentication rejection, health, one real rights-cleared upload, status polling, distinct playable aligned outputs, retry and restart recovery. Record VM GPU, model/checkpoint and elapsed time. Local unit tests and image builds alone do not prove cloud separation quality.

For Nemotron, keep using the existing local Token Factory integration unless deliberately moving that orchestration too. No GPU VM is needed for Token Factory requests. Do not copy its API key into the browser. Provider inference stays disabled in this stack until a bounded allowance is allocated; preserve its durable ledger across restarts.

## Stop and rollback

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

Stop the VM in Nebius and verify billing state. Account for retained disk/IP costs. Do not use `down -v` to erase evidence or reset the budget ledger. Roll back by rebuilding the previous reviewed source with the same volumes. There is no schema migration, staging/main promotion, repository publication or licence change. Compose intentionally does not auto-restart the service after VM reboot.
