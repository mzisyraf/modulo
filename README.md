# modulo

Turn a guitar sound in a mixed song into a browser preset you can play through.

## Judges: open the live application

**Demo: [modulo — Tone Match](https://modulo.69-169-102-112.sslip.io)**

Use username **`judge`** and the application password supplied in the **Devpost testing instructions**. No installation, provider API keys or dedicated GPU is required. The password is deliberately absent from this public-facing repository; it is not the team's Token Factory or Modal credential.

1. Open the demo in current desktop Chrome or Edge. For the full live tone workflow, connect a guitar/audio interface, use headphones and select **Tone Match → Connect**. Allow input access and play notes/chords during the silent ten-second calibration.
2. Open **Choose sound**, upload a song you have permission to process and press **Prepare song**. WAV/MP3 files must be 10 seconds–4:55 and at most 50 MiB. Listen to Song/Guitar/Backing, select a 10–20 second guitar passage and press **Use this sound**.
3. Press **Match tone**. NVIDIA Nemotron proposes individual gear settings and the browser automatically refines them. Press **Use this tone** when ready; nothing starts playing automatically.
4. Open **Play & record → Start playing**. The visual signal chain stays editable. Recording options includes backing, camera and countdown; download takes before refreshing or closing the tab. **Stop all** stops playback and capture.
5. For tablature, expand **Play & record → Practice with full-song tabs → Generate full-song tabs** after preparing a song. This covers the whole song and requires no guitar calibration or instrument.

Without a guitar/interface, judges can still explore songs, generate draft full-song tabs and inspect the rig editor. Live calibration, tone matching and guitar performance require the instrument. Tone matching is an approximation and tabs are draft suggestions; neither promises exact equipment recovery or perfect transcription.

**Where the AI runs:** NVIDIA Nemotron on **Nebius Token Factory** generates supported gear models and parameter values from measured source/reference descriptors. Modal GPUs run Demucs separation and Basic Pitch transcription. Live audio and refinement use browser CPU, keeping the guitar's real-time signal off the network. [Hosting and testing details](docs/JUDGE_HOSTING.md).

## Project status

**Status:** Tone Match follows **Connect → Choose sound → Match tone → Play & record**. The app uses cloud guitar separation, live-interface calibration and NVIDIA/Nebius generation of individual rig parameters, followed by automatic browser refinement and an explicit **Use this tone** action. The visual pedal/amp chain remains editable. [Cloud setup](docs/TEAM_CLOUD_SETUP.md) requires no local GPU. A backend key enables manual generation without application usage caps. [Current flow and verification](docs/GUIDED_FLOW.md). Audible matching and physical-interface acceptance remain open.

- **Team:** Isyraf — AI/backend/integration; Dinnie — browser audio/DSP; Shazlin — frontend/UX.
- **Deadline:** 31 October 2026, 01:00 MYT (30 October, 17:00 UTC).
- **Working target:** complete submission by 30 October, 22:00 MYT.
- **Track proposal:** Best Apps and Agents, Nebius x NVIDIA Global AI Hackathon.

Start with the [development setup](docs/DEVELOPMENT.md), [consolidated plan](docs/PLAN.md), and your [team handoff](docs/TEAM_HANDOFF.md).
Use the [development hub](https://github.com/mzisyraf/modulo/issues/11) for current progress, ownership, blockers and reviews. The [collaboration guide](docs/COLLABORATION.md) gives every laptop and AI agent the same start/handoff workflow.
After updating to the shared skill, start a Codex session with `$modulo Isyraf`, `$modulo Dinnie` or `$modulo Shazlin`.

## MVP

1. Upload a mixed-song WAV/MP3.
2. Separate the guitar and automatically select a useful reference passage.
3. Analyse that passage and use an NVIDIA open-source model through Nebius to generate a validated tone preset.
4. Apply the preset to a working browser amp/effects chain.
5. Play through it with a guitar audio interface and optionally record guitar, backing and camera.

Full-song draft tablature now uses a separate private Modal GPU worker; see [song tabs](docs/SONG_TABS.md) for playback, setup, usage accounting and accuracy limits. It transcribes the complete extracted guitar track independently of tone-reference selection.
modulo aims for a useful approximation, not exact amp identification or perfect tone cloning.

## Repository layout

```text
apps/web/            React + TypeScript UI; Shazlin
packages/audio/      TypeScript Web Audio engine; Dinnie
services/api/        FastAPI orchestration, analysis, inference; Isyraf
contracts/           Draft preset schema and runtime validator; shared
fixtures/            Manual example preset; shared
docs/                Requirements, architecture and team handoffs
```

## Run locally

Use Node.js 24.15.0. From the root:

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Run `npm run check` for TypeScript, unit checks and the production build. Run the API with the team's configured cloud credentials for song preparation and tone generation. A guitar/interface is required for calibration and live playing; song exploration and full-song tabs can be used without one. See [cloud setup](docs/TEAM_CLOUD_SETUP.md).

Python 3.12 API setup and tests are in [DEVELOPMENT.md](docs/DEVELOPMENT.md). The API exposes health, a manual example preset, bounded separation jobs and a separate confirmed-reference [starting-preset action](docs/PRESET_GENERATION.md). A separated song does not imply a generated preset or calibrated matching. The shared preset schema remains a reviewable draft with implemented controls only.

## Working agreement

Develop on your named branch: `Isyraf`, `Dinnie` or `Shazlin`. Isyraf coordinates direct merges into `staging`, where the combined code is tested before pushing. No PR is required for staging; keep scope, reviews, tested commits and handoffs in the work issue. Merge `staging` back into your personal branch regularly. `main` receives only an explicitly approved, tested staging release; creating these branches does not mean the MVP is finalized. See [COLLABORATION.md](docs/COLLABORATION.md) for the merge sequence. Preserve teammates' edits and keep API keys, uploads, model weights and unlicensed music out of Git.

Team-authored source is released under the [MIT License](LICENSE). Third-party libraries, model weights and credited audio retain their respective licences. The public repository and hosted demo are provided for hackathon judging.

Preset quality checks and the controlled same-performance/held-out benchmark are documented in [PRESET_EVALUATION.md](docs/PRESET_EVALUATION.md). Passing software tests alone does not establish a musical tone match.
