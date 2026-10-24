# ToneForge — team setup and handoffs

Read [PLAN.md](PLAN.md) first. The plan is a requirements baseline and proposed design, not implemented software. Deadline: **31 October 2026, 01:00 MYT**; submission target **30 October, 22:00 MYT**.

## Everyone

- Accept the repository invitation and clone `https://github.com/mzisyraf/toneforge.git` into a local working folder. Isyraf's clone is already in the requested `Winrina NVIDEA Hackathon` folder.
- Install Git, an editor and a current supported Node.js LTS. The first frontend/audio implementation must pin and document the same tested Node version and commit its package lock.
- Use desktop Chrome/Edge, headphones and rights-cleared audio. Do not exchange cloud keys in repository files, issue comments or frontend environment variables.
- Work on a short feature branch and open a small PR. Do not rewrite teammates' edits. Include what works, how to reproduce it and known limits.
- Freeze the preset, job and engine contracts together before depending on them. Label synthetic fixtures; never present them as live AI output.

Do not install every proposed audio/ML project on every laptop. Dinnie and Shazlin can build against fixtures and the shared dev API without a local GPU.

## Isyraf — AI/backend and integration

Own `services/api/`, analysis, NVIDIA/Nebius usage, deployment and final integration. Prepare an isolated Python environment with a version supported by the selected separation/PyTorch stack; pin versions after a smoke test. Plan FastAPI/Pydantic, an ASGI server, audio decoding/FFmpeg, NumPy/audio feature tools and a tested GPU separation environment. Install only as needed after the feasibility check. GPU drivers/CUDA packages depend on the actual cloud image; do not guess a global Windows CUDA setup.

First tasks:

1. Verify account credits, exact NVIDIA model availability and a real Token Factory response.
2. Run the guitar separator on varied clips and save listening/runtime findings.
3. Propose automatic reference-window scoring and expose quality flags.
4. Agree engine controls with Dinnie, then publish job/result/failure fixtures for Shazlin.
5. Make a generated preset pass validation and change actual browser audio.

Handoff: model identifiers, measured features, valid preset examples, error cases and minimal API instructions. A text Nemotron model receives measured features and schema; it is not assumed to perform source separation or understand raw audio.

## Dinnie — browser audio/DSP

GitHub account supplied: [dinni3](https://github.com/dinni3), profile name Muhammad Dinnie Haiqal bin Muhammad Salman.
Own `packages/audio/` and its narrow public API. Prepare Node.js/Git, a guitar, instrument cable, interface, manufacturer drivers if applicable, and wired headphones. Check interface input/channel routing and driver settings on the actual presentation machine.

First tasks:

1. Play a known dry guitar take through an audible gain/drive/EQ chain.
2. Get live interface input working immediately and measure the demo rig.
3. Publish supported controls, units, safe ranges and engine lifecycle methods.
4. Add cabinet shaping, delay/reverb, bypass, conservative output and smooth changes.
5. Test repeated start/stop, device disconnect, channel choice and finite output.

Handoff: one working engine import with no React dependency, a small fixture preset, and instructions Shazlin can use to connect controls. No cloud inference in the real-time audio path.

## Shazlin — React frontend and UX

GitHub account supplied: [shazlinn](https://github.com/shazlinn). The profile exists but does not display a personal name.
Own `apps/web/`. Prepare Node.js/Git, editor, desktop browser and headphones. Start with React/TypeScript/Vite and simple semantic controls; add dependencies only for a concrete gap.

First tasks:

1. Build the whole journey using labelled fixture data: upload, stage progress, reference player, preset and amp controls.
2. Use the agreed job schema and show failure/retry/low-confidence states.
3. Wire the DSP engine lifecycle, device/channel controls and stop/mute action.
4. Replace fixtures with real API calls; keep fixture mode visibly distinct.
5. Make a judge-friendly dry/processed audition and record the final demonstration.

Handoff: frontend startup instructions, all job/audio states, labelled controls and an end-to-end UI that does not require a physical interface for basic audition.

## Suggested 30-minute kickoff

1. Five minutes: confirm scope, deadline and everyone's available hours.
2. Ten minutes: settle the first preset, job response and audio engine interfaces.
3. Ten minutes: identify GPU, model, audio rig and fixture blockers; agree a spending cap.
4. Five minutes: choose today's individual deliverable and the next shared integration check.

## Prompt for the next Codex coding chat

Paste into a new chat after opening this repository folder as a Codex project:

> Continue ToneForge from the repository documents. Read README.md, docs/PLAN.md, docs/TEAM_HANDOFF.md and relevant GitHub issues before making changes. This is a personal hackathon project, outside Wiz work systems. The team is Isyraf (AI/FastAPI/Nebius/NVIDIA/analysis), Dinnie (TypeScript Web Audio DSP), and Shazlin (React/TypeScript frontend). Preserve mixed-song guitar isolation, automatic passage selection, real NVIDIA/Nebius preset generation, functional browser processing, and live interface input as core. Short tabs are optional. Deadline 31 October 2026, 01:00 MYT. Inspect existing files and Git status; preserve others' changes. Start with the agreed requirements and first contract issue, then scaffold only the smallest runnable vertical slice. Label all mocks and fallbacks. Do not assume any model, GPU access, latency, separation quality or app feature is verified without running it. Never publish secrets or unlicensed music. Confirm open design questions through useful implementation checks and team input.
