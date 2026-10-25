---
name: modulo
description: Start or resume modulo development, review live team progress, or hand off a session. Reads shared GitHub progress and routes the next scoped task for Isyraf, Dinnie or Shazlin. Use for this project's session coordination, not unrelated repositories.
---

# modulo session coordination

Use `$modulo Isyraf`, `$modulo Dinnie` or `$modulo Shazlin` to start or resume. With a human already established in this session, `$modulo` is enough. `status` means read-only progress review; `handoff` means close the current session without starting another task.

## Establish the operator and current state

- Use the human explicitly named in this request or current session. If unknown or ambiguous, ask which of the three is operating before selecting work or writing to GitHub. Never infer the human from a shared AI account, an earlier chat's author or the current branch name.
- Work in the existing `mzisyraf/modulo` checkout. Inspect Git status and remote; preserve local edits and teammates' branches. Do not recreate or reset the repository.
- Follow repository-root AGENTS.md and [the collaboration guide](../../../docs/COLLABORATION.md). Read their required project docs. They hold the update format, claim rules, reviewers and acceptance boundaries; do not invent a second workflow.
- Read the live hub https://github.com/mzisyraf/modulo/issues/11, relevant work issues including their latest comments, and linked PRs including review/merge state. Fetch remote refs and compare the actual working baseline from the hub. Resolve disagreement using current GitHub evidence, not private chat memory or this skill's age. No baseline commit or current progress is hardcoded here.
- Prefer the connected GitHub tools; otherwise use an available authenticated GitHub CLI or browser. Confirm the authenticated GitHub identity matches the declared human before any shared write. No credentials in chat, logs or Git. If live access is unavailable or the identity is wrong, state what could not be verified, mark proposed updates **not posted**, and do not invent latest progress, post as a teammate or claim shared ownership. Local preparation remains explicitly uncoordinated.

## Route the next task

| Operator / expected GitHub | Development branch | Area | Starting issues and priorities |
|---|---|---|---|
| Isyraf / `mzisyraf` | `Isyraf` | `services/api/`, ML/providers, integration | #1 contract decisions, #2 isolation/reference, #3 NVIDIA/Nebius; coordinate #7 integration and #8 submission |
| Dinnie / `dinni3` | `Dinnie` | `packages/audio/`, live rig | Pending #1 DSP/lifecycle decisions, #4 live input/latency, #5 DSP/effects |
| Shazlin / `shazlinn` | `Shazlin` | `apps/web/`, UX | Pending #1 frontend/API/engine decisions, #6 fixture-to-real frontend flow |

These are routing seeds, not fixed task status. Also check newer assigned issues and dependencies. Choose the next unfinished, unclaimed, useful item in the operator's scope based on current acceptance criteria and handoffs. A merged partial PR does not complete its parent issue. Prioritize core-flow blockers and requested boundary reviews; optional tabs remain last. If a task is blocked, report the dependency and choose another useful unblocked item within scope. Do not start paid cloud/model work without an explicit approved cap or substitute synthetic evidence for real audio/model/hardware acceptance.

Briefly report the latest evidenced state, the selected issue/scope and next concrete deliverable. For a status-only request, stop after the read-only report: do not claim work, create a branch or edit/post progress.

## Continue development

- Check claims and overlapping PRs before editing. Post a scoped START to the work issue using the collaboration guide, then re-read for competing claims. Claims are advisory, not locks; obtain an explicit split/release/reassignment before touching overlap. Do not assume silence releases another session's claim.
- Develop on the operator's exact persistent branch: `Isyraf`, `Dinnie` or `Shazlin`. Fetch and safely fast-forward that branch from its remote, then merge `origin/staging` into it without rewriting unmerged work; staging is the integration baseline. Preserve dirty/diverged work and resolve conflicts with the owners. One active writer per personal branch; do not switch two sessions through one checkout or write to another operator's branch. Coordinate shared interfaces with affected owners.
- Continue the authorized task after the brief report; do not stop merely to offer a plan or ask permission for routine local work. Preserve existing validation and truthful fixture/provenance labels. Run relevant documented checks and verify changed browser behavior; actual model/separation/live latency acceptance needs actual evidence.
- Keep progress and review evidence in work issues/commits, never Wiz records. No PR is required for staging. A checked, pushed commit with a Ready for staging handoff may be integrated directly by Isyraf's coordinator session, following the guide's serialized merge/test/push sequence. Test the combined candidate before pushing staging; failed candidates stay unpublished. Do not force push, promote main, publish, pick a licence or start paid infrastructure beyond the appropriate explicit authorization.

## Handoff

At completion or an explicit handoff request, append a HANDOFF to the same work issue with human/session, scope, state, branch/base/head commit, staging merge or optional PR, demonstrated changes, checks tied to their tested commit, gaps, blockers and next action/reviewer. Distinguish checks run now from earlier reported results. Release the editing claim; a blocked update names any files still reserved. If writing fails, show the update as **not posted** and never claim it succeeded. Do not run a new development task for a handoff-only request.

Only Isyraf's coordinator session integrates into staging and refreshes the hub body, after re-reading current issue/commit/PR evidence to preserve others' updates. Other operators update their work issues and personal branches. After integration, merge staging back into personal branches without rewriting history. Main is reserved for finalized releases: promotion requires Isyraf's approval of the exact tested staging commit, never a routine resume action. Do not mark broad acceptance done without the affected humans' approval and real evidence. End with what changed, where to review it, what was checked and remaining limits.
