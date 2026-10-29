# modulo

Turn a guitar sound in a mixed song into a browser preset you can play through.

**Status:** browser amp/live capture and a fixture preset API work. The main Tone Match [workflow](docs/LOCAL_SEPARATION.md) connect live-guitar level/spectral measurements, real upload, CUDA guitar/backing separation, reference confirmation and budget-gated starting rigs with editable Apply/Play. The main page compares the same captured live exercise with the rig on/off. Generation is disabled by default; rendered checks/local refinement are available; broad audible tone-match and physical-rig acceptance remain incomplete.

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
5. Play through it with a guitar audio interface, or audition a provided dry guitar recording.

Short tabs are optional and start only after the core flow passes acceptance checks.
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

Open **http://127.0.0.1:5173**. Run `npm run check` for TypeScript, unit checks and the production build. The existing app can audition a synthetic test signal or your own dry recording without a backend. For real local song upload/separation, open **Tone Match** with the API and isolated separator running; see [the checkpoint setup and limits](docs/LOCAL_SEPARATION.md).

Python 3.12 API setup and tests are in [DEVELOPMENT.md](docs/DEVELOPMENT.md). The API exposes health, a manual example preset, bounded separation jobs and a separate confirmed-reference [starting-preset action](docs/PRESET_GENERATION.md). A separated song does not imply a generated preset or calibrated matching. The shared preset schema remains a reviewable draft with implemented controls only.

## Working agreement

Develop on your named branch: `Isyraf`, `Dinnie` or `Shazlin`. Isyraf coordinates direct merges into `staging`, where the combined code is tested before pushing. No PR is required for staging; keep scope, reviews, tested commits and handoffs in the work issue. Merge `staging` back into your personal branch regularly. `main` receives only an explicitly approved, tested staging release; creating these branches does not mean the MVP is finalized. See [COLLABORATION.md](docs/COLLABORATION.md) for the merge sequence. Preserve teammates' edits and keep API keys, uploads, model weights and unlicensed music out of Git.

The repository is private during planning. The [event rules](https://nebiusglobalaihackathon.devpost.com/rules) require public source and an open-source licence for submission. The team must settle the licence and authorize publication before the deadline.

Preset quality checks and the controlled same-performance/held-out benchmark are documented in [PRESET_EVALUATION.md](docs/PRESET_EVALUATION.md). Passing software tests alone does not establish a musical tone match.
