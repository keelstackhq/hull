---
name: handoff
description: Write the state of the current task down so a fresh session can continue it. Use before a long task, before stopping mid-task, or when the context is getting full.
---

1. Find the repo's progress notes: `docs/PROGRESS.md` if it exists, else `docs/agents/project.md`.
2. Append, in at most 10 lines: the task, what is done (commits, files), the next steps in order,
   and what is blocked on a human (the exact action they must take).
3. Name the commands that prove the current state (tests, checks) and their last result.
4. Do not commit unless the task says so. Then tell the user that a fresh session can continue
   from these notes; start fresh rather than compacting.
