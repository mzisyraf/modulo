# ToneForge

Turn a guitar sound in a mixed song into a browser preset you can play through.

**Status:** planning and requirements baseline; application code has not been scaffolded or implemented.

- **Team:** Isyraf — AI/backend/integration; Dinnie — browser audio/DSP; Shazlin — frontend/UX.
- **Deadline:** 31 October 2026, 01:00 MYT (30 October, 17:00 UTC).
- **Working target:** complete submission by 30 October, 22:00 MYT.
- **Track proposal:** Best Apps and Agents, Nebius x NVIDIA Global AI Hackathon.

Start with the [consolidated plan](docs/PLAN.md), then read your [team handoff](docs/TEAM_HANDOFF.md).
Work packages are tracked in [GitHub Issues](https://github.com/mzisyraf/toneforge/issues).

## MVP

1. Upload a mixed-song WAV/MP3.
2. Separate the guitar and automatically select a useful reference passage.
3. Analyse that passage and use an NVIDIA open-source model through Nebius to generate a validated tone preset.
4. Apply the preset to a working browser amp/effects chain.
5. Play through it with a guitar audio interface, or audition a provided dry guitar recording.

Short tabs are optional and start only after the core flow passes acceptance checks.
ToneForge aims for a useful approximation, not exact amp identification or perfect tone cloning.

## Proposed repository layout

```text
apps/web/            React + TypeScript UI; Shazlin
packages/audio/      TypeScript Web Audio engine; Dinnie
services/api/        FastAPI orchestration, analysis, inference; Isyraf
contracts/           Agreed preset, job and engine interfaces; shared
fixtures/            Licensed small test data and expected results; shared
docs/                Requirements, architecture and team handoffs
```

Only the documentation exists today. Runtime setup commands and pinned dependencies will be added with the first implementation changes; there is no runnable application yet.

## Working agreement

Use short feature branches and small pull requests. Keep `main` usable. Review changes across ownership boundaries together. Do not commit API keys, local uploads, model weights or unlicensed music. Team members are building in parallel; preserve one another's edits.

The repository is private during planning. The [event rules](https://nebiusglobalaihackathon.devpost.com/rules) require public source and an open-source licence for submission. The team must settle the licence and authorize publication before the deadline.
