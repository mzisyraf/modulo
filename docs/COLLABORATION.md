# ToneForge collaboration across three laptops

Start at the [development hub, issue #11](https://github.com/mzisyraf/toneforge/issues/11). GitHub holds shared progress, blockers, decisions and evidence. Each laptop keeps its own clone, local environment and credentials.

## Ownership and branch flow

| Human / GitHub | Branch | Owns | Starting work |
|---|---|---|---|
| Isyraf / `mzisyraf` | `Isyraf` | `services/api/`, ML/providers, integration | #1-3, #7-8 coordination |
| Dinnie / `dinni3` | `Dinnie` | `packages/audio/`, live rig | #1 boundaries, #4-5 |
| Shazlin / `shazlinn` | `Shazlin` | `apps/web/`, UX | #1 boundaries, #6 |

`Isyraf` / `Dinnie` / `Shazlin` -> `staging` -> `main`.

The personal branches are persistent development lanes. `staging` is the shared integration/test baseline; `main` is reserved for finalized, approved releases. No PR is required for staging. Old scaffold/feature branches and existing PRs stay intact as history/review context; do not use them to bypass staging. Branch setup leaves main unchanged and does not establish completed MVP acceptance.

Declare the human, GitHub identity and work issue at session start. Never infer ownership from an AI account, old chat author or current branch. Verify the connected GitHub identity before posting/pushing/reviewing; use each person's own Git author settings and do not change global identity silently. OpenAI accounts are individual: [official account-sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy).

## Before editing

1. Read repo instructions, this guide, the live hub, the work issue's latest comments/acceptance and linked commit/PR evidence. Inspect Git status and preserve local changes; do not reset or pull over a dirty tree.
2. Fetch remote refs. Check out your exact named branch, fast-forward from its remote updates, then merge current `origin/staging` into it without rewriting unmerged work. Resolve divergence/conflicts explicitly; never force push. One active writer per personal branch; do not switch two running sessions through one checkout.
3. Check active claims and overlapping work. Split scopes or obtain an explicit release/reassignment before editing overlap. A quiet/stale claim does not expire automatically. Claims are advisory, not atomic locks.
4. Append a scoped START to the work issue, including branch/base/head. Re-read for a competing claim before editing. Keep small commits and work within the agreed scope; do not write to another person's branch.
5. Agree shared interfaces with affected owners. Inspect listeners before starting servers and keep keys, uploads, weights and unlicensed music out of Git.

If live GitHub access is unavailable or authenticated as the wrong person, show the intended update in chat as **not posted**. Do not fabricate latest progress, impersonate a teammate or claim shared ownership. Any offline preparation is explicitly uncoordinated.

## Updates and handoffs

Append START and HANDOFF to the work issue, plus material blockers/interface changes. No per-command activity feed. A HANDOFF releases editing claims even while the task remains in progress/review. A BLOCKED update lists any files still reserved.

```text
START | HANDOFF | BLOCKED - YYYY-MM-DD HH:mm MYT
Human / GitHub: ...
Agent / session: ... (short local identifier)
Issue / scope: #... / files or acceptance item
State: Ready | In progress | Review | Ready for staging | Blocked | Done
Branch / base / head commit: ...
Commit / staging merge / optional PR: ...
Changed / demonstrated: ...
Checks: command, result, tested commit; run now / reported earlier / not run
Blockers / dependencies: ...
Next step / reviewer / integration request: ...
Claim: active | released | blocked (list files still reserved)
```

Latest timestamped issue updates and linked evidence are authoritative. Only Isyraf or an agent explicitly acting for him refreshes the hub body, after reading current issue/remote state; other agents append to their work issues. Isyraf refreshes the summary at integration checks or significant handoffs. The hub's date marks a snapshot, not live monitoring of unpushed changes.

"In progress" can mean partial work with no active session. "Review" names a commit/scope needing feedback, without requiring a PR. "Ready for staging" identifies a checked, pushed personal commit ready to integrate. "Blocked" names the dependency/next action. "Done" requires issue acceptance, affected human approval and staging integration. Partial synthetic/offline work keeps the broader issue open.

## Reviews and direct staging integration

The work issue records human author, scope, personal branch/source commit, observed behavior, checks, limitations and affected owners' feedback. A PR remains optional for a discussion that benefits from a diff. Changed code after a check is untested until relevant checks run again; distinguish this session's checks from earlier reported results.

| Boundary | Affected reviewers |
|---|---|
| API / ML | Isyraf; a teammate checks integration |
| DSP | Dinnie |
| Frontend | Shazlin |
| Preset schema | Isyraf + Dinnie; Shazlin reviews displayed controls |
| Job/result/errors | Isyraf + Shazlin |
| Engine lifecycle / device controls | Dinnie + Shazlin |
| Coordination instructions | All three |

An author's agent self-check is not independent human approval. Feedback can be recorded in the work issue; formal PR approval is not required for staging. These are coordination rules, not enforced branch protection; no protection settings change here.

1. The developer commits/pushes only their own branch, then posts a HANDOFF marked **Ready for staging**, with exact source commit, scope, relevant checks, gaps and shared-owner feedback.
2. Isyraf's coordinator session claims a scoped integration in #11 and serializes staging writes. Fetch current refs, start from up-to-date staging and merge the recorded source commit. A ready handoff is enough for routine staging integration; no separate PR/permission loop is required.
3. Resolve conflicts with affected owners. Test the **combined candidate**, not just a personal branch: documented JS/API checks for code integration plus relevant browser/manual checks. Use a clean checkout/copy for `npm ci` if a server locks dependencies. If checks fail, keep the candidate unpublished, record its head/failure and coordinate a fix. Do not report staging green.
4. Recheck remote staging before a normal push. If it advanced, incorporate that work and rerun affected checks. Record source commits, tested combined head, outcomes and gaps in the issue/hub. Never force push staging.
5. Developers merge `origin/staging` back into their personal branches without rewriting their own unmerged work. Keep these branches for continued development.
6. Promote to `main` only when Isyraf approves the exact tested staging commit and release acceptance is supported. Fast-forward main to that commit; if main diverged, reconcile through staging and test again. Passing unit tests alone do not finalize the mixed-song/model/live-input MVP. This setup leaves main unchanged.

Run `npm ci` / `npm run check` and the API's local-venv tests as documented in DEVELOPMENT.md. Changed browser/audio behavior needs browser evidence; hardware/model acceptance needs real measurements/calls. Keep fixtures labelled. No force pushes, main promotion, publication, licence choice or paid infrastructure beyond explicit authorization. No CI service or automatic status refresh is introduced here. Optional issue/PR templates appear automatically once on the default branch.

## Start with the project skill

All three personal branches contain `.agents/skills/toneforge/SKILL.md`. Inspect Git status and fetch remote refs first. For a first checkout, use `git switch --track origin/Dinnie` (substitute your branch). If it already exists, use `git switch Dinnie`, then fast-forward its remote updates. Preserve local work rather than switching over a dirty tree. Open that folder in Codex and use your own line:

```text
$toneforge Isyraf
$toneforge Dinnie
$toneforge Shazlin
```

The skill reads live state, selects your next unfinished task, records START and proceeds on your named branch. Bare `$toneforge` works once your human identity is established in that chat; otherwise it asks. Your verified GitHub identity must match before shared writes.

Use `$toneforge status` for a read-only review and `$toneforge handoff` before ending. Codex discovers repo skills under `.agents/skills`; reopen/restart if it is missing after checkout. [Official skill documentation](https://learn.chatgpt.com/docs/build-skills).

For another AI tool without discovery: `Read and follow .agents/skills/toneforge/SKILL.md. I am Shazlin. Continue my next ToneForge task.` Use the actual person's name. No other tool's configuration changes.
