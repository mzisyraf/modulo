# ToneForge coding context

This is a personal hackathon project. Keep work out of Wiz work records.
Read README.md, docs/DEVELOPMENT.md, docs/PLAN.md and docs/TEAM_HANDOFF.md before changes.
For development tasks, also follow docs/COLLABORATION.md and read the live development hub at https://github.com/mzisyraf/toneforge/issues/11. Identify the human operator and work issue explicitly; never infer ownership from the AI account. Read current issue updates/PRs, record a scoped START before editing and a HANDOFF afterward. Claims are advisory; resolve overlapping claims before changing those files. If GitHub access or identity is wrong, report the update as not posted; do not impersonate another developer or claim a shared lock.

Ownership: Isyraf owns services/api and ML/provider integration; Dinnie owns packages/audio; Shazlin owns apps/web. contracts and fixtures are shared. Preserve other people's changes. Use small feature branches and PRs.

The starter has real browser sample processing and a fixture API. It does not implement guitar separation, automatic reference selection, cloud inference or live interface input. Do not report those as completed. contracts/preset.schema.json is the single runtime preset definition used by JavaScript and Python; it is a draft for team review and currently includes only implemented controls.

Keep the core mixed-song → reference → NVIDIA/Nebius preset → browser amp → live input goal. Short tabs are optional. Deadline: 31 October 2026, 01:00 MYT.

Use npm ci and npm run check. Run Python tests from services/api with a local virtual environment. Verify changed browser behaviour. Do not commit secrets, uploads, model weights or unlicensed music; do not turn on paid infrastructure without a budget. Repository publication and licence choice remain team decisions.
