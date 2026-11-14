---
name: ready
description: Check this repo against the hull project-start checklist and print the human-only steps once. Use in a new repo or environment. Advisory: it never blocks work.
---

# ready

Never blocks: start the task, run this beside it.

1. Run `node scripts/ready.mjs` from the repo root. Each line is `pass`, `fail`, `ask`, `warn`,
   `manual` or `skipped`, with the fix step and a link to the item in hull's `docs/start-checklist.md`.
   Onboarding questions have defaults (update bot = session, secrets = none, bosun by `.bosun/`,
   approvals per D-012): do not ask them up front.
2. Print every `manual` item once as one checklist (D-009): mark each phone or computer and say how
   an agent verifies it, computer steps first. Then continue; do not wait for the owner.
3. Agent steps (`fail`, `warn`): fix them as part of the task (a missing plan is a warning: write
   `docs/superpowers/plans/<name>.md` or `## Steps` before a long task).
4. Ask the owner only when secrets or a release are about to be used and the answer is not
   recorded: `node scripts/ready.mjs --questions` (JSON, with `default`), ask that one question
   with AskUserQuestion, then `node scripts/ready.mjs --answer <id>=<value>` and commit
   `docs/agents/onboarding.toml`.
