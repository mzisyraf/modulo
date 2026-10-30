# Dinnie continuation prompt — Isyraf handoff, 30 October 2026

> **Handoff cancelled by Isyraf on 30 October 2026.** Execution has returned to the Isyraf session/branch, as recorded in issue11 and issue6. This historical prompt remains a testing/delivery blueprint; it no longer assigns Dinnie an editing claim. Its implementation-state statements below describe the original handoff, not the current branch. Check the latest issue handoff and setup docs for current behavior.

I am Dinnie (`dinni3`), working on the `Dinnie` branch. Isyraf has explicitly handed me the remaining scoped implementation/integration work below because his laptop is running out of battery. Continue useful work autonomously, with honest evidence and the stop criteria below. Do not impersonate Isyraf or assume that every broad project issue is complete.

## 1. Establish the correct code without losing my work

Read AGENTS.md, .agents/skills/modulo/SKILL.md, README.md, docs/DEVELOPMENT.md, docs/PLAN.md, docs/TEAM_HANDOFF.md and docs/COLLABORATION.md. Read live issue11 and relevant issues1/3/4/5/6/7/8, current claims and published handoffs. Verify GitHub identity is dinni3 before shared writes; if identity/tools are unavailable, clearly mark updates not posted and use manual human coordination. Never post as mzisyraf.

Inspect status and fetch origin. Stay on Dinnie. Preserve my uncommitted work; do not reset, clean, force-push, automatically stash/pop or overwrite my files. Resolve overlap explicitly. Safely bring Dinnie up to date with its own remote and merge origin/staging into Dinnie without rewriting history. Runtime baseline is Isyraf/staging3fc6b88, containing source29d7de5 plus documentation. Dinnie's previously published baseline65428d6 alone DOES NOT include Isyraf's cloud/full-rig/refinement integration.

This handoff document/evaluation/fixture may be newer on Isyraf than staging. Read `git show origin/Isyraf:docs/DINNIE_CONTINUATION_PROMPT.md` before merging if the file is missing locally. Compare `git log origin/staging..origin/Isyraf` and relevant diffs. Include necessary Isyraf commits by a normal reviewed merge into Dinnie when staging does not contain them; do not blindly cherry-pick duplicate work or switch/edit the Isyraf branch. If staging advances, incorporate it and rerun affected checks. Claims are advisory: post a named, scoped START before editing, resolve overlap, and release the claim at HANDOFF.

Isyraf delegates the listed frontend/provider/integration continuation scopes to me; Shazlin's unrelated UI/CSS and unpublished work remain hers. Preserve her ModelRigPanel/ModelControls/CSS. Follow the repository's serialized staging coordination. Push my tested source to Dinnie and record Ready for staging; do not impersonate the Isyraf coordinator. A staging push requires applicable explicit authorization/coordination. Main promotion, licence selection, repository publication, buying infrastructure and sending credentials are not authorized by this prompt.

## 2. Exact state at handoff

Working and tested on staging3fc6b88: main Local/Cloud selection; private Modal Demucs htdemucs_6s separation; confirmed guitar passages; Live guitar/Guitar audio calibration; licensed supplied dry DI; Nano/Super individual model-owned rig parameters; real shared browser DSP/editor; manual Check/Refine/Apply; processed recording/backing transport. No local GPU/Torch/Demucs is needed for Cloud mode. Refinement/playback/live DSP use CPU, not cloud GPU.

Requested automatic refinement is NOT IMPLEMENTED yet. Isyraf stopped before changing runtime code. .Codex/evals/automatic-rig-refinement.md defines the intended behavior. Do not report automation complete merely because manual refinement already works.

Read docs/TONE_RELIABILITY_RESULTS.md and docs/PRESET_GENERATION.md. Most recent source checks: clean npmci/check131 tests + TypeScript/build/catalog, audio check:rig, API179, Modaloffline7, browserlegacy36/custom16. Those are Isyraf's earlier results, not checks run on my future changes.

Frozen cached Nano benchmark improved4/9 to8/9 held-out passes: clean2/3(previous3/3), crunch3/3(previous1/3), ambience3/3(previous0/3). Clean repeat1 regressed; repeat2 also worsened numerically despite passing. Cached Super difficult cases2/2. Independent amp held1/1, training0/1, original timbre retained. All12 final cached candidates safe. One real new v3 Nano crunch response compiled/refined and passed; it is one smoke, not fresh repeated-model evidence. Aggregate grading informed development; do not call this a new blind evaluation or an accuracy percentage.

## 3. Credentials, startup and hard spending limits

Isyraf must privately supply TWO ignored files: `services/api/.env` (NEBIUS_API_KEY/settings), `data/modal/config.toml` (Modal token ID+secret/profile). Put them at the same relative paths in my clone. Never print, commit, screenshot or paste secret contents. No additional NVIDIA/HuggingFace/SSH key is needed. Do not depend on Isyraf's running localhost services; run my own API/frontend.

For a FRESH teammate setup, replace Isyraf's copied budget settings with NEBIUS_BUDGET_USD=1.5 and NEBIUS_MAX_REQUESTS=6, keep NEBIUS_RIG_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B and NEBIUS_RIG_FALLBACK=1. Existing local ledgers must be preserved, not reset to make these values work. If already used/exhausted, inspect cumulative usage before further calls. Global approved service ceilings remain US$10 Modal and US$10 Token Factory INCLUDING all laptops, prior use, credits and reservations. Local counters do not globally enforce a shared key cap; coordinate usage.

Last known Token Factory ledger on Isyraf:40 cumulative attempts/US$5.05741824 reserved. His max46 is HIS cumulative stop, not six free requests on every laptop. My fresh six-attempt allocation is at most six counted model calls, including repairs, within US$1.50 and the remaining shared US$10. Keep Nano as primary; at most one Super repair per invalid Nano response, no paid loops. Do not start a new model/service or training job.

Last shared Modal ledger:6/10 attempts, four remaining. For THIS handoff reserve at most ONE new cloud separation attempt and leave at least three for team/demo; verify fresh ledger first. Reuse its stems/reference for repeated CPU refinement tests. Do not redeploy/reset the shared ledger or create a VM. Worker is deployed, private, scale-to-zero; last status had zero GPU runners/backlog. Token expires5November2026; later judging access needs renewal. Billing snapshots may lag.

Use Node24.x (repo requires >=24 <25) and Python3.12. Follow docs/TEAM_CLOUD_SETUP.md and DEVELOPMENT.md: root npmci; API venv from services/api/requirements-lock.txt; separate tools/modal/.venv from its requirements-lock.txt. On Windows use Scripts/python.exe, macOS/Linux bin/python. API8000, npm run dev5173; stable npm run build then npm run preview4173. Bind localhost. No CUDA/Torch/Demucs install on my laptop for Cloud mode. Missing private credentials blocks paid smoke only, not offline implementation/tests.

## 4. Implement automatic local refinement first

Start in apps/web/src/RigGenerationPanel.tsx. Reuse existing refineRig, scoreRig, strict parsing, cancellation and shared-engine Apply callback. The matching algorithm is in refineRig.ts/rigSearch.ts; do not rewrite it just to automate scheduling.

Default behavior: explicit Generate/Retry -> matching ready proposal -> automatic CPU refinement/render check -> show retained/refined result -> user deliberately Applies and plays. No automatic playback, microphone capture, live monitoring or Apply. No extra AI request during refinement. A default-on opt-out is acceptable; preserve manual Check/Refine/Restore controls.

Consume automatic work once per explicitly requested ready response. Polling, Reconnect, reopening saved projects, navigation, cancelled work and Restore original must not loop/restart refinement. An explicit Generate returning an existing cached response may refine it; simply discovering an old response must not start costly CPU work. Track request/source identity rather than using draft changes as a trigger. Guard duplicate effects and late promises.

Source/reference/project changes, inactive navigation, stop and unmount cancel pending/running work. Cancel retains a usable raw proposal and does not auto-retry. A source shorter than6seconds can generate/check but must skip automatic validated refinement with clear guidance. Refinement errors preserve the original for manual Check/Apply and never silently certify it. Disable competing actions while running. Reuse progress/cancel UI and the80-actual-render bound. Preserve input calibration, separately bounded output gain and cached raw provider result.

Update the custom-rig and real-cloud browser verification scripts for the default so they do not manually refine twice. Do NOT run the paid real-cloud script casually; it requires explicit authorization and a new shared GPU attempt. Update setup/generation docs to the simpler default flow. Save existing recordings before refreshing a user tab.

## 5. Verify with available tools; Playwright is not assumed

Inventory my tools first. Use existing browser automation only if available. `tools/verification/*.browser.js` files contain functions for a browser harness; running them with Node alone DOES NOT execute browser assertions. Do not fabricate automation results or spend more than15minutes installing/debugging tool infrastructure. No Playwright MCP is required to use the app.

If automation is missing, run terminal tests and have me execute the explicit browser checklist below. Use an installed browser/DevTools for errors and actual audio. Record manual results as manual, failures as failures, unrun as unrun. Screenshots, exported rig JSON, processed takes and a short screen recording are acceptable evidence; keep sensitive audio and all credentials ignored/local. Ask Dinnie for the hardware/listening actions that the agent cannot perform; do not claim to hear/measure them without evidence.

Automated terminal gates: npm run check; npm run check:rig --workspace @modulo/audio; API-local venv pytest; tools/modal venv unittest discover -s tools/modal -p test_*.py. Use a clean copy for npmci if a running Windows server locks dependencies. Do not lower Node requirements or install API packages globally to mask setup failures. Treat missing environment separately from regressions.

Manual browser gates: default refinement starts once after Generate; Apply stays manual/disabled until safe check finishes; no sound/mic starts; progress/Cancel works; cancellation/reconnect/navigation/Restore cannot restart it; opt-out retains manual flow; short source/errors retain original with guidance; switching source/reference/project discards late results; applied shared rig edits, recordings, backing and narrow layout still work. Watch DevTools console. A new paid request count must not appear for CPU refinement.

Offline audio regression fixture: fixtures/rig-regression.proposals.json contains12 sanitized historical real responses (11v2 controlled + onev3 crunch). They are cached evidence, NOT fresh inference, and preserve historical prompt/DSP provenance. Validate proposal values against current registry; do not pass an old response off as a current-model result.

The licensed29.292s dry DI is already in apps/web/public/audio/guitar-techs-dry-di.wav with attribution. Rebuild controlled cases using tools/evaluation/rig_eval.py prepare --source THAT_FILE into an ignored data directory; copy the proposal fixture to its proposals.json and use tools/evaluation/rig-cases.ts targets. Browser DSP renders the targets/rigs; Python receiver alone does not render audio. If the browser harness is unavailable, use the native workbench/manual comparisons and record quantitative grading as not rerun. Never substitute synthetic fixture success for a real service/hardware test.

Isyraf's ignored listening reports/amp archive are NOT guaranteed to exist on my laptop. Optional private transfer directories are data/verification/rig-reliability-20261030, external-reliability-20261030, rig-v3-smoke-20261030. If unavailable, use the committed DI/fixture and label independent-amp recheck unavailable. Prior results are documented in docs/TONE_RELIABILITY_RESULTS.md.

## 6. Blueprint: test with my guitar connected

A. Connect guitar -> instrument/Hi-Z input of my audio interface -> computer; wired headphones on interface. Begin with low headphone/output volume. Disable direct monitoring when checking the processed browser path so a hidden dry path cannot mask/double it. Choose the correct physical input/channel. Note interface, driver, browser, OS, sample rate and available buffer settings; do not guess hardware latency.

B. First prove the existing supplied-file flow works without requesting a mic. Then select Live guitar, choose interface/channel and grant permission only after explicit capture. Calibrate with around10seconds of clear notes/chords and short gaps/decays, without clipping. Calibration should be silent/release capture as designed. Fix hardware gain/channel issues before AI tuning; keep pickup/tone/volume and interface gain stable. Changing them needs recalibration. Record clipping warnings and chosen gain, not secrets.

C. Test neutral/manual rig at a comfortable level before cloud inference. Play soft/hard notes/chords, sustain then mute strings. Check gate behavior, gain stability, finite/safe output, bypass, model edits and Stop. Investigate the previously unaccepted self-building Drive/feedback behavior if reproduced. Do not keep raising volume through a feedback problem.

D. Use one rights-cleared30–60s mixed clip through Cloud API, listen to extracted guitar, choose/confirm a clear10–20s passage. Reuse this one job. Use my live-calibrated dry take as source, then Generate. Verify default local refinement completes without further model requests, no auto-Apply/play, and source identity is correct. Apply deliberately and start live monitoring explicitly.

E. Play similar notes/rhythm/articulation to the reference. Compare original/extracted target, initial proposal and refined rig at comparable listening loudness, keeping output protection on. Judge brightness/body, saturation, attack/dynamics and ambience/decay separately. Different performances/pickups/separation bleed confound matching: do not use waveform error as reconstruction accuracy for an unrelated performance. Do not calibrate from an already effected song stem and call it dry input.

F. Record5–10seconds of processed live output, Finish, verify the saved take decodes/plays non-silent, download it and save the actual rig JSON locally. Test live start/stop repeatedly, input switching, source-mode switching, navigation, disconnect/late permission, and cancel during automatic refinement. Capture should release; nothing may revive stale monitoring.

G. Test backing separately and test intended live play-along explicitly. Existing regressions intentionally stop amp audition when backing starts; simultaneous live guitar/backing has NOT been accepted. Do not claim synchronized play-along simply because both transports work separately. If it fails, document/reconcile sample-audition stop versus live-monitor behavior without breaking the shared engine. Report baseLatency/outputLatency only as browser estimates; claim measured round-trip latency only with a genuine loopback measurement. Human playability feedback is useful, but not a fabricated millisecond value.

## 7. Stop criteria for AI/tone enhancement

First finish automation and hardware verification; do not immediately replace Nano, add a learned audio model, train networks or expand infrastructure. Use cached fixtures and CPU rendering before paid calls. Predeclare any changed scoring thresholds/windows; preserve raw/baseline/failure results and never fit the final held-out samples. Do not cherry-pick the best repeat or call8/9 an accuracy percentage.

Time-box optional further tone tuning to TWO hypothesis-driven iterations or120minutes total, whichever comes first. Stop earlier if a repeatable improvement has passed regression/listening gates. If neither iteration improves a declared metric without a meaningful regression, retain/revert to the best verified candidate, document the limit and move to demo/setup. No endless prompt tweaking or paid retries.

Desired controlled acceptance: safe finite output, peak<=0.951 and guard fraction<0.01 on fixtures; clean/crunch/ambience each3/3 under the unchanged gate (lower raw loss and RMS-matched spectral loss<90% of neutral). Currentclean2/3 is a known failure, not permission to lower the gate. Report independent-amp training/held results separately. A fresh different-source test and human level-matched listening are needed before broad quality claims. Distinguish repeated cached-solver trials from independently generated model responses; six paid calls cannot prove nine fresh model trials.

Hard-stop paid paths on: service/global allocation uncertainty, exhausted request/attempt/cost guard, auth failure, missing secrets, unsafe output or repeated schema failure. Preserve ledgers and remaining demo attempts. Never reset counters, switch to unlimited, buy capacity or bypass approval/tool restrictions. Stop enhancements90minutes before the team submission target (30Oct22:00MYT; hard deadline31Oct01:00MYT), sooner if demo stability needs it. Isyraf being offline is not permission for a public release.

## 8. Remaining Isyraf-side delivery and handoff

Within the above limits: finish automatic refinement; verify own-laptop GPUless Cloud/Nemotron flow and real guitar calibration/playing/recording; resolve or clearly report the clean regression, feedback/latency and live-play-along limits; make cloud/provider failures actionable; preserve original/manual fallback. Coordinate Shazlin's UX and unpublished CSS rather than overwriting it.

Prepare reproducible setup, a dry-sample fallback, actual inference provenance, rights/attribution notes, an English demo walkthrough/video outline and a judge test path. Recheck current official competition requirements (including any required platform feedback) using official sources. Licence choice, public repository visibility, final main promotion and submission/hosting authority still require the proper human decision. Flag credential expiry5Nov before promising later judge access; do not expose localhost/keys to create a public demo accidentally.

Commit small changes on Dinnie, test the combined source, push Dinnie, post HANDOFF with exact source head, checks run now versus earlier/manual/unrun, costs/counts, known failures and next reviewer; release claims. Request serialized staging integration under the existing coordinator protocol. Leave main unchanged unless Isyraf explicitly approves the exact tested release. Final response should say what actually works, the exact branch/commit, how I test it, spending/remaining attempts and what is still unverified. Do not call the whole project done from green software tests.
