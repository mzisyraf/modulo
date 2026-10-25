# ToneForge collaboration across three laptops

Start at the [development hub, issue #11](https://github.com/mzisyraf/toneforge/issues/11). It links work issues, progress, blockers, the working baseline and review queue. Use it with any AI tool. GitHub holds the shared record; each laptop keeps its own clone, local environment and credentials.

## Ownership and identity

| Human / GitHub | Owns | Typical work |
|---|---|---|
| Isyraf / `mzisyraf` | `services/api/`, ML/provider integration | #1–3, integration/submission coordination |
| Dinnie / `dinni3` | `packages/audio/` | #4–5, live rig and DSP evidence |
| Shazlin / `shazlinn` | `apps/web/` | #6, UX and frontend integration |

Declare the human operator, GitHub identity, issue and scope at session start. Do not infer ownership from an AI login or a chat's previous author. Each person uses their own GitHub login and local Git author settings; verify the connected identity before posting, pushing or reviewing. Do not silently change global identity or publish under a teammate's account.

OpenAI accounts are for individual use; Dinnie should use his own Codex login. [Official account-sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy). The coordination workflow works independently of the chosen AI tool. Local worktrees/branches isolate edits; they do not synchronize separate laptops. [Official Codex worktree documentation](https://learn.chatgpt.com/docs/environments/git-worktrees).

## Before editing

1. Read this repo's instructions, the hub, the work issue's latest updates/acceptance criteria and linked PRs. Inspect Git status first and preserve all existing local edits. Fetch remote refs; do not reset or pull over a dirty tree.
2. Confirm the working baseline in the hub. Until #9 merges, it is `origin/scaffold/development-starter`; `main` is still planning-only. Isyraf announces baseline changes in the hub. Never merge #9 automatically to simplify setup.
3. Check active claims and overlapping PRs. One active editor per scoped task. Split work into explicit nonoverlapping scopes, or get a recorded release/reassignment from the owner/coordinator. A quiet/stale claim does not expire automatically. Claims are advisory records, not atomic locks; if simultaneous claims race, resolve them before editing the overlap.
4. Append a START update on the work issue with the scope/branch/base commit. Re-read after posting for a competing claim. Use a new feature branch such as `isyraf/2-reference`, `dinnie/4-live-input` or `shazlin/6-flow`; do not rename existing branches just for this convention. Use a separate worktree for additional simultaneous sessions on one laptop, not two editors switching one checkout.
5. Agree shared interfaces with the affected owners before changing them. Preserve unrelated files, inspect existing listeners before starting servers and keep keys/uploads/weights/music out of Git.

If GitHub is unavailable or authenticated as the wrong person, prepare the update in chat as **not posted**. Do not claim shared ownership, take over an existing claim or publish as another person. Reconnect the correct account before shared writes; keep any offline local work clearly labelled as uncoordinated.

## Updates and handoffs

Append a START and HANDOFF to the work issue, plus material blockers/interface changes. Keep updates concise and timestamped in MYT; no per-command activity feed. HANDOFF releases the editing claim even if the task remains in progress or review. A BLOCKED update must say which files, if any, remain reserved. Use the hub's standard format:

```text
START | HANDOFF | BLOCKED — YYYY-MM-DD HH:mm MYT
Human / GitHub: ...
Agent / session: ... (short local identifier)
Issue / scope: #... / files or acceptance item
State: Ready | In progress | Review | Blocked | Done
Branch / base / head commit: ...
PR: ... or not opened
Changed / demonstrated: ...
Checks: command, result, tested commit; run now / reported earlier / not run
Blockers / dependencies: ...
Next step / requested reviewer: ...
Claim: active | released | blocked (list files still reserved)
```

The latest timestamped issue update and linked evidence are authoritative. Only Isyraf or an agent explicitly acting for him refreshes the hub body, after reading current issue/PR state; other agents append to their own work issue. This avoids three agents overwriting one dashboard document. Isyraf refreshes the summary at the daily integration check or on a significant handoff. Treat its date as a snapshot, not a live monitor of unpushed laptop changes.

“In progress” can mean partial work with no active session. “Review” means a reviewable PR exists. “Blocked” names the dependency and next action. “Done” requires the issue's acceptance evidence and affected human approval, with the code merged into the announced working baseline. Partial offline/synthetic work keeps the core issue open. Do not auto-close a broad issue from one partial PR.

## Reviews and integration

Use a small PR linked to the issue; include the human author, files/scope, base/head commit, observed behavior, exact checks and gaps. Use the PR template once available, or copy its fields manually. Record changed code after a check as untested until the relevant check is rerun. Distinguish tests run by this session from earlier reported results.

| Boundary | Affected reviewers |
|---|---|
| API / ML | Isyraf; another teammate checks integration |
| DSP | Dinnie |
| Frontend | Shazlin |
| Preset schema | Isyraf + Dinnie; Shazlin reviews displayed controls |
| Job/result/errors | Isyraf + Shazlin |
| Engine lifecycle / device controls | Dinnie + Shazlin |
| Coordination instructions | All three |

An author's agent reviewing its own work is a self-check, not independent approval. AI review supports the affected humans' GitHub review. Reviewer requests and this guide are coordination rules, not enforced branch protection; none is configured by this change. PR/issue templates appear automatically after reaching the default branch; until then use the files on the coordination branch. [GitHub template documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository).

Run `npm ci` / `npm run check` and the API's local-venv tests when relevant, as documented in DEVELOPMENT.md. Browser/audio changes need browser evidence; hardware and model acceptance need actual measurements/calls. A local pass does not prove another laptop or the latest remote commit works. No CI service or automatic status refresh is introduced here.

Keep `main` usable and leave merging to the authorized human. No force pushes, automatic merging, repository publication, licence choice or paid infrastructure without explicit authorization. Keep analysis fixtures labelled; merged code and a green test do not establish real separation, NVIDIA/Nebius access or live latency.

## Start with the project skill

The repo contains `.agents/skills/toneforge/SKILL.md`. After the coordination PR is reviewed and merged into the announced working baseline, each person updates their own checkout without overwriting local work, opens that folder in Codex and starts with their line:

```text
$toneforge Isyraf
$toneforge Dinnie
$toneforge Shazlin
```

Use only your own line, not all three. The skill reads live GitHub updates, reports the latest evidenced state, chooses your next unfinished task, records a scoped START and proceeds. Your declared name plus verified GitHub identity determine ownership. Bare `$toneforge` works once your name is established in that chat; an unknown operator gets one identity question. Ensure your AI tool can read/write this private repo through your own GitHub account.

Use `$toneforge status` for a read-only progress review and `$toneforge handoff` before ending a work session. Codex discovers repo skills under `.agents/skills`; if it does not appear, reopen/restart Codex. [Official skill documentation](https://learn.chatgpt.com/docs/build-skills). Before the PR merges, preview the skill on its coordination branch; do not make that unreviewed branch the team's integration baseline.

For another AI tool without repo-skill discovery, say: `Read and follow .agents/skills/toneforge/SKILL.md. I am Shazlin. Continue my next ToneForge task.` Use the actual person's name. This reuses the same file without adding or editing another tool's configuration.
