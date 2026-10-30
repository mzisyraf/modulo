# Demo and remaining acceptance — 30 October 2026

Execution belongs to Isyraf again; the Dinnie continuation handoff is cancelled. Dinnie published completed source `6a7497f` before seeing the reassignment. Merge `b60fb81` retains his single request-ticket scheduler plus the Isyraf integration/regression checks; both histories are preserved. Subsequent runtime `49640f4` also fixes live/backing co-existence and updates the old live-calibration regression fixture. This checklist prepares delivery, without authorizing publication, hosting, licence selection, main promotion or submission.

## Current competition requirements

Rechecked against the [official rules](https://nebiusglobalaihackathon.devpost.com/rules) and [event requirements](https://nebiusglobalaihackathon.devpost.com/) on 30 October 2026. Working target remains **30 October, 22:00 MYT**; official deadline is **31 October, 01:00 MYT**.

| Required item | Current modulo path / remaining action |
|---|---|
| Runtime Nebius use and an NVIDIA open-source model | Token Factory Nano rig generation; bounded Super repair when needed. Modal hosts separation. Retain actual inference provenance. Whole-app Nebius hosting is unnecessary. |
| Demo/hosted app/test-build URL; description and selected track | Prepare the GPUless setup below and describe Best Apps and Agents. A judge-accessible URL/test build still needs completion. Localhost and a private staging branch are not a delivered judge path. |
| Public source, an open-source licence, reproducible instructions | Setup docs exist. Team must approve licence/public visibility and an exact tested release. Third-party assets retain their own licences. |
| Public YouTube demonstration under three minutes | Record the 2m40 outline below using cleared audio; show actual functioning app and disclose edited waits. Video and URL remain pending. |
| English materials, platform feedback and working judging access | Feedback draft below needs human review. Current judging ends **23 December, 12:00 Pacific / 24 December, 04:00 MYT**. The initial Modal token expires **5 November**, so renewal and continued service access need an explicit plan. |

Those delivery/access requirements come from the [rules, sections 1 and 4](https://nebiusglobalaihackathon.devpost.com/rules). They are not satisfied by passing software tests. Do not publish the team's workspace keys in a repository, video or public test build; a judge-facing service would keep provider credentials on its backend.

## Team rehearsal without a GPU — approximately 10 minutes after installation

1. Preserve local changes, fetch and merge reviewed staging into the operator's named branch. Use Node24 and Python3.12; follow [DEVELOPMENT](DEVELOPMENT.md) and [TEAM_CLOUD_SETUP](TEAM_CLOUD_SETUP.md). Install API and separate Modal-client environments. Privately place the two ignored credential files at their documented paths; preserve existing ledgers.
2. Run the API8000 and frontend5173, or build/preview4173. Choose **Tone Match → Guitar audio → Use supplied dry guitar**. Confirm calibration without a microphone request. Keep browser refresh/HMR away from recordings; download any takes before restarting.
3. With coordinated remaining allowance, upload one rights-cleared30–60s song using **Cloud API**. Listen to guitar/backing, choose a clear10–20s passage and confirm. Reuse that job for later CPU tests. An existing result is reused audio, not a fresh cloud run.
4. Choose **Generate custom rig**. Automatic refinement is on by default and makes no extra model request. Review validation/protection results, deliberately Apply, play the dry recording, change an individual control and record5–10s. Finish, replay/download the take and export rig JSON. Restore/Check permits comparison with the original AI proposal. A short source/error must retain manual recovery.
5. Cancel rendering; reconnect/navigate/return; change source/reference/project. Nothing may restart refinement, resurrect stale results or begin capture/playback. Confirm layout at390px and check browser console. Record exact commit, OS/browser, file/live source, actual provider model, outcomes and any error.

The model may be disabled intentionally in a test API process even when private `.env` is configured. Review the approved allowance and restart the API normally for deliberate service testing; never delete counters or change limits to make a test pass. Missing hardware does not block the supplied-file rehearsal. It does block physical-interface acceptance.

## Connected-guitar acceptance — 20 minutes, hardware required

Use the detailed exercise in [the historical handoff, section6](DINNIE_CONTINUATION_PROMPT.md#6-blueprint-test-with-my-guitar-connected). Record PASS/FAIL/UNRUN and evidence for each row; leave unrun rows open.

| Gate | Required evidence |
|---|---|
| Instrument input and calibration | Interface/driver/browser/OS, physical channel, pickup/guitar/interface gain, reported sample rate/voice-processing settings. Ten seconds of clean dry notes/chords, no clipping. Calibration is silent and releases capture. Wired headphones, low starting level, direct monitor off for processed comparison. |
| Actual live tone | Neutral/bypass and individual amp/EQ/ambience controls audibly change the same input. Muted strings do not produce self-building Drive/feedback. Fix channel/gain/feedback before AI tuning. |
| Generated/refined tone | Deliberately Apply a rig based on the selected target and this calibrated input. Compare initial/refined/target at comparable loudness while playing similar notes and articulation; note brightness, body, saturation, attack and decay separately. |
| Lifecycle and recording | Start/stop/restart, switch input/source, navigate, physically disconnect/reconnect; no stale capture revival. Export a5–10s processed take, verify finite/non-silent decoded audio and save its rig JSON. |
| Backing and latency | Live input and backing now coexist in either start order under synthetic browser regression. Verify this on the actual interface, including Stop/navigation and processed-guitar recording. This does not prove tight synchronization or hardware latency. Record subjective playability; browser latency figures are estimates. Only a real loopback permits a measured round-trip value. |

## Stop criteria and honest claims

The solver/scoring/DSP is unchanged by automation. [Tone reliability results](TONE_RELIABILITY_RESULTS.md) still show cached controlled Nano8/9 passes, with clean2/3 versus its former3/3, and independent-amp training0/1. These are not accuracy percentages or fresh blind generalization. Human listening, fresh-source testing and physical feedback/latency remain separate gates. Do not promise exact equipment recovery or identical sound from arbitrary playing.

Keep optional AI/tone changes to **two declared hypothesis iterations or120minutes**, whichever is first, and stop feature tuning at **20:30 MYT** for the22:00 working target. Never lower the existing gates or fit final held-out samples. If no safe improvement survives regressions, retain the verified candidate, record the limit and stabilize the demo. No new embedding model, training or GPU deployment is needed for automation.

Read-only service snapshot during this continuation: Modal deployed/idle, zero runners/backlog, **7/10** shared attempts reserved; Token Factory catalog authenticated with Nano/Super available. Local Token Factory ledger **41 cumulative /US$5.25741824 reserved**, stop46 /US$10. This is a reservation ledger, not a billing invoice or a global shared-key usage report. Three Modal attempts remain for the team/demo; do not allocate three independently to each laptop. No inference was initiated for this implementation. Review latest counts and coordinated allocations before a new paid smoke.

## Record a 2m40 English demonstration

| Time | Screen / audio / narration |
|---|---|
| 0:00–0:20 | Explain a guitarist's task: take a reference sound from a song and approximate it through editable browser gear. Show the supplied dry recording or the connected instrument, clearly labelled. |
| 0:20–0:55 | Upload a cleared song, select Cloud API, compare extracted guitar/backing and confirm a specific passage. Label any waiting-time edit. Do not show a preloaded job as a new inference. |
| 0:55–1:25 | Show real Nano/Super provenance and individual gear parameters. Explain Token Factory inference versus Modal separation and local CPU refinement. Show automatic progress finishing; no automatic Apply or playback. |
| 1:25–2:15 | Deliberately Apply. Compare target, dry and processed/refined audio at similar listening level. Move one meaningful control; record, finish and replay a short processed take. Use live guitar only if it actually passed the hardware check. |
| 2:15–2:40 | Show rig export and reproducible GPUless path. State approximate matching/clean-case limitations. Close on project/test-build/repository links once those have been approved and made accessible. |

Retain the supplied DI's [attribution](../apps/web/public/audio/ATTRIBUTION.txt). For the local Exhilarate fixture, retain Kevin MacLeod/incompetech credit, CC BY4.0 link and excerpt/conversion disclosure from its ignored attribution file. Exported recordings and videos require their own checked audio/visual permissions. No unlicensed song, keys, model weights or private uploads enter Git.

## Description and feedback drafts for human review

**Description:** modulo helps guitarists approximate a selected song passage with editable browser amp/effects settings. Modal Demucs extracts a guitar reference and backing; NVIDIA Nemotron on Nebius Token Factory proposes supported gear models and explicit parameter values from measured source/target descriptors. Bounded local rendering refines those values against separate development excerpts. The player reviews, applies, plays and records through one browser engine. Cloud separation supports laptops without dedicated GPUs; live audio processing stays local.

**Feedback:** Nano is useful for schema-bounded rig proposals, but richer descriptors alone did not reliably identify missing amplifier structure. Local bounded rendering improved crunch/ambience proxies while exposing a clean regression. Strict catalog validation, actual provenance, persistent request reservations and a single invalid-schema Super repair kept failures reviewable. A clearer per-key usage/cost limit would help this shared hackathon setup. These are project observations, not claims about vendor service guarantees. Modal's L4/T4 capacity fallback is a separate deployment observation, not Nebius AI Cloud experience.

Final human decisions still required: public demo/test-build access, licence/repository visibility, exact main release approval, video publishing/permissions, continued judging access and final Devpost submission. No such external action is performed by this checklist.
