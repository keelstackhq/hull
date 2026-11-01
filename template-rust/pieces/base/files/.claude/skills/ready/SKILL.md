---
name: ready
description: Check that this repo is ready for autonomous agent work (the hull project-start checklist). Use first in a new repo or a new environment, before any autonomous task.
---

# ready

1. Onboarding: run `node scripts/ready.mjs --questions` (JSON). Ask the owner every question
   whose `answer` is null (all of them when the owner wants to change answers) with
   AskUserQuestion: at most 4 per form; use `header`, `question` and `multiSelect` as given; list
   options in order, the `recommended` one first with " (Recommended)" after its label, each with
   its `description`. Map the chosen labels back to option `value`s; if the owner
   answers "Other", re-ask that question with the closest option named as a suggestion.
2. Record them: `node scripts/ready.mjs --answer <id>=<value>[,<value>] ...`, then commit
   `docs/agents/onboarding.toml`.
3. Run `node scripts/ready.mjs` from the repo root. Each line is `pass`, `fail`, `ask`, `manual`
   or `skipped`, with the fix step and a link to the item in hull's `docs/start-checklist.md`.
4. On `fail`: do the fix if it is an agent step (for example a plan file); otherwise send the
   owner the failing items, with their fix lines, in one message. On `ask`: back to step 1.
5. On exit 0: ask the owner to confirm each `manual` item, if any.
6. Do not start autonomous work until `ready` exits 0 and the owner has confirmed every manual item.
