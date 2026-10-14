Build hull from the plans, one task per iteration. Follow docs/BUILD_PROMPT.md section A exactly.

Short form:
1. Read CLAUDE.md, docs/PROGRESS.md, and only the spec sections the next task touches.
2. Next task = first unchecked task in plan order 01 → 02 → 03 that is not under Blocked.
3. Dispatch `implementer` (test first), then `reviewer`; fix every "must" finding.
4. Verify with real output: `pnpm test && pnpm lint && pnpm format:check` and dogfood for the
   combos the task touches.
5. Tick checkboxes, add one PROGRESS line, commit with the plan's message, push.
6. Human-only or upstream-blocked → Blocked in PROGRESS with the exact action; move on.
7. Milestone finished → superpowers:requesting-code-review, fix, note it in PROGRESS.
Stop when everything is checked or only Blocked items remain; then write Status in PROGRESS.
