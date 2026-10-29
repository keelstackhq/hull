---
name: ready
description: Check that this repo is ready for autonomous agent work (the hull project-start checklist). Use first in a new repo or a new environment, before any autonomous task.
---

# ready

1. Run `node scripts/ready.mjs` from the repo root. Each line is `pass`, `fail` or `manual`, with
   the fix step and a link to the item in hull's `docs/start-checklist.md`.
2. On `fail`: do the fix if it is an agent step (for example a plan file); otherwise send the
   owner the failing items, with their fix lines, in one message. Re-run after each fix.
3. On exit 0: list the `manual` items and ask the owner to confirm each one.
4. Do not start autonomous work until `ready` exits 0 and the owner has confirmed every manual item.
