# ToneForge

Turn a guitar sound in a mixed song into a browser preset you can play through.

**Status:** runnable development scaffold. Browser sample processing and a fixture API work; song analysis, AI generation and live input are not implemented yet.

- **Team:** Isyraf — AI/backend/integration; Dinnie — browser audio/DSP; Shazlin — frontend/UX.
- **Deadline:** 31 October 2026, 01:00 MYT (30 October, 17:00 UTC).
- **Working target:** complete submission by 30 October, 22:00 MYT.
- **Track proposal:** Best Apps and Agents, Nebius x NVIDIA Global AI Hackathon.

Start with the [development setup](docs/DEVELOPMENT.md), [consolidated plan](docs/PLAN.md), and your [team handoff](docs/TEAM_HANDOFF.md).
Use the [development hub](https://github.com/mzisyraf/toneforge/issues/11) for current progress, ownership, blockers and reviews. The [collaboration guide](docs/COLLABORATION.md) gives every laptop and AI agent the same start/handoff workflow.
After updating to the shared skill, start a Codex session with `$toneforge Isyraf`, `$toneforge Dinnie` or `$toneforge Shazlin`.

## MVP

1. Upload a mixed-song WAV/MP3.
2. Separate the guitar and automatically select a useful reference passage.
3. Analyse that passage and use an NVIDIA open-source model through Nebius to generate a validated tone preset.
4. Apply the preset to a working browser amp/effects chain.
5. Play through it with a guitar audio interface, or audition a provided dry guitar recording.

Short tabs are optional and start only after the core flow passes acceptance checks.
ToneForge aims for a useful approximation, not exact amp identification or perfect tone cloning.

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

Open **http://127.0.0.1:5173**. Run `npm run check` for TypeScript, unit checks and the production build. The app can audition a synthetic test signal or your own dry recording without a backend. No audio is uploaded by the scaffold.

Python 3.12 API setup and tests are in [DEVELOPMENT.md](docs/DEVELOPMENT.md). The API exposes a health check and an explicitly manual example preset; analysis requests return HTTP 501 until implemented. The shared preset schema is a reviewable draft with only implemented audio controls.

## Working agreement

Use short feature branches and small pull requests. Keep `main` usable. Review changes across ownership boundaries together. Do not commit API keys, local uploads, model weights or unlicensed music. Team members are building in parallel; preserve one another's edits.

The repository is private during planning. The [event rules](https://nebiusglobalaihackathon.devpost.com/rules) require public source and an open-source licence for submission. The team must settle the licence and authorize publication before the deadline.
