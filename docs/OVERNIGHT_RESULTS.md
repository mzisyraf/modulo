# Overnight integration evidence — 30 October 2026

Operator: Isyraf. Approved ceilings: US$10 Modal and US$10 Token Factory, including earlier usage. This is a working integration checkpoint; **close audible matching across arbitrary songs has not passed acceptance**. Main/publication/licence decisions remain separate.

## What was demonstrated

The built main app on 4173 completed actual Modal separation → confirmed passage → supplied dry-guitar calibration → actual NVIDIA/Nebius custom rig → safe offline check → individual-parameter refinement → deliberate Apply → dry playback → processed recording → backing playback. The saved take decoded to 2.040 seconds of finite, non-silent audio (RMS 0.02054). File mode requested microphone access zero times. The generated rig used the one existing model engine; the legacy controls were disabled while active. Desktop and 390px checks passed. Private job: `251886cd-1bac-4141-b113-4ac6da717cf6`.

Nano's main-flow response was rejected as an invalid rig without applying it. One deliberate, counted Super repair succeeded (`nvidia/nemotron-3-super-120b-a12b`, prompt `rig-features-v2`). The implemented optional fallback makes at most one such repair after invalid Nano output; errors cannot trigger an unlimited paid loop. Model output specifies each selected implemented control, not a factory preset. Both API and browser validate it against the actual catalog before use.

A separate rights-cleared 145.476-second full-song Cloud request completed on T4: 14.682 seconds GPU execution, 176.611 seconds end to end, three aligned WAV artifacts. This includes queue/startup/transfer overhead. It is one observed run, not a latency guarantee. The API and Modal client virtual environments contain neither Torch nor Demucs: separation really ran remotely. Team setup is in [TEAM_CLOUD_SETUP.md](TEAM_CLOUD_SETUP.md).

## Sound-quality experiment

Acceptance was declared in [.Codex/evals/full-rig.md](../.Codex/evals/full-rig.md) before prompt changes. Sources are the licensed Guitar-TECHS DI03 and matching independent amp microphone recording. Controlled targets were declared from the actual browser DSP. Training uses the first 15 seconds; refinement sees at most 10 seconds. The remaining approximately 14.3 seconds is held out. Failed earlier iterations and all repeats are retained locally.

The gate requires safe output, lower raw loss than neutral, and at least 10% lower RMS-matched multiresolution spectral loss than neutral. This is a diagnostic margin, **not a percentage of tone accuracy**.

| Case | Final Nano train / held-out pass | Conditional Super train / held-out pass |
|---|---|---|
| Clean / EQ | 3/3 · 3/3 | Not needed |
| Crunch / amp + cabinet | 1/3 · 1/3 | 0/1 · 0/1 |
| Delay / reverb | 0/3 · 0/3 | 0/1 · 0/1 |
| Independent amp microphone | 0/1 · 1/1 | Not requested |

All 12 final evaluated candidates rendered safely in training and held-out audio. The independent amp held-out RMS-matched loss changed from 0.4933 neutral to 0.4357 refined. Its training improvement did not reach the declared margin. The controlled Nano sound gate passed 4/9 runs, so repeatability acceptance failed. Super did not rescue the difficult controlled cases. No human listening approval or physical guitar/interface/round-trip latency was obtained.

Some refinements improved the optimization proxy while worsening the independent spectral metric. The UI labels these as feature comparisons and leaves Apply deliberate; a lower proxy must not be presented as assured audible improvement. Six coarse spectral bands and envelope timing cannot reliably identify distortion or distinguish playing rhythm from delay. Further work needs better audio descriptors or audio-aware inference and listening validation, rather than selecting a more expensive text model alone.

Local listening artifacts (ignored, not published):

- `data/verification/full-rig-20261030/listening-report.html`: all controlled outcomes and RMS-matched Target / Neutral / Nemotron / Refined players.
- `data/verification/external-rig-20261030/listening-report.html`: independent amp comparison, with training-only alignment/level calibration.
- Each folder retains raw WAVs, `rig-report.json`, `config.json`, `proposals.json`, source/engine hashes and earlier reports. The independent source archive's official MD5 was verified before use.
- `data/overnight-run/actual-flow-result.json`, `actual-applied-rig.json` and production screenshots retain the actual main-flow evidence.

## Spending and remaining allowance

At 02:30 MYT, the shared Modal ledger had **6/10 attempts reserved, four remaining**, with zero queued inputs and zero GPU runners. Three new GPU attempts were used overnight, within the four-attempt limit. The latest billing snapshot reported US$0.04041824 metered, US$0 billed after adjustments; provider billing can lag. The worker remains deployed and scales to zero. The approved US$10 ceiling is unchanged.

Token Factory's preserved local ledger had **39 cumulative attempts, US$4.85741824 reserved**, including prior usage: **23 new requests**, of which 20 Nano and three Super. A failed or timed-out call retains its reservation. Actual billed spend may differ; reservation is the conservative local accounting basis, not a provider invoice. No ledger was reset. Isyraf's cumulative stop remains 46 (seven attempts left); two fresh teammate allocations of US$1.50 / six attempts each fit alongside that remaining reservation allowance under the US$10 team ceiling. These are coordinated local limits, not global enforcement across a shared API key.

## Morning acceptance

Use [TEAM_CLOUD_SETUP.md](TEAM_CLOUD_SETUP.md) to transfer the two ignored private files directly; no keys were sent automatically. Dinnie and Shazlin must each confirm startup on their own laptop. Listen to the comparison reports before claiming tone accuracy. Physical guitar/interface calibration, feedback safety and latency need the real hardware. Keep #1/#3/#4/#5/#6/#7 quality and affected-human acceptance open where applicable. Repository publication, licence, main release and submission packaging still need the team's explicit decisions.
