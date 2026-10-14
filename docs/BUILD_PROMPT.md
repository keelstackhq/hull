# Build prompt

Paste one of the prompts below into Claude Code at the root of this repo. The superpowers plugin
must be installed (`.claude/settings.json` registers it; accept the prompt to install it).

## A. Self-paced loop (recommended)

No interval: the loop paces itself, one plan task per iteration.

```
/loop Build hull from the plans in this repo, one task per iteration, until all three plans are done.

You are a thin orchestrator. Keep your own context small: read files by section (grep, offset/limit),
delegate every search or "where is X" to the `explorer` subagent, and ask every subagent for a
report of at most 15 lines.

Each iteration:
1. Read CLAUDE.md, docs/PROGRESS.md, and from docs/superpowers/specs/2026-10-14-hull-design.md only
   the sections the next task names (its Spec line and Files list tell you which).
2. Pick the next unchecked task in plan order: 01-base-renderer, then 02-web-pieces, then
   03-native-docs-dogfood (docs/superpowers/plans/2026-10-14-hull-*.md). Skip tasks listed under
   "Blocked" in docs/PROGRESS.md unless the blocker is resolved.
3. Dispatch the `implementer` subagent (sonnet) with the plan path, the task number and the spec
   sections. It works test-first and does not commit.
4. Dispatch the `reviewer` subagent (opus) on the resulting diff, against the task, the spec,
   docs/template-format.md (including §9) and CLAUDE.md. Fix every "must" finding (send it back to
   `implementer`), then re-review if anything changed beyond one-line fixes.
5. Verify with superpowers:verification-before-completion: run `pnpm test && pnpm lint &&
   pnpm format:check`, and `node scripts/dogfood.mjs --combo <c>` for every combo the task touches
   (use `node scripts/affected-combos.mjs --base HEAD` when unsure). Read the real output; never
   claim a pass you did not see.
6. Tick the task's checkboxes in the plan, add one line to docs/PROGRESS.md (date, plan/task,
   commit, test summary, timing if measured), commit with the message from the plan, and push.
7. If a step needs something only a human or another repo can provide (splice release, hoard
   release, Cloudflare account/token, cascivo package access, npm scope, GitHub repo or settings,
   a tag), do every part you can locally, write the exact remaining action under "Blocked" in
   docs/PROGRESS.md, and move on to the next task that does not depend on it. Never fake a result,
   skip or weaken a test, or mark a blocked task done.
8. When a milestone's tasks are all done (or blocked), run superpowers:requesting-code-review on the
   whole milestone, fix the findings, and note "Milestone N reviewed" in docs/PROGRESS.md.

Stop the loop when all three plans are fully checked, or only blocked tasks remain, and every
milestone review is recorded. Then write the "Status" section in docs/PROGRESS.md: what works, how
to try it (commands), measured CI and dogfood times against the budgets, and the Blocked list for me.
```

## B. One long session (no /loop)

```
Build hull by executing the three plans in docs/superpowers/plans/ in order (01, 02, 03) with
superpowers:subagent-driven-development, using the repo's subagents: `explorer` for searches,
`implementer` per task (test first), `reviewer` after each task. Follow CLAUDE.md, the spec and
docs/template-format.md (incl. §9). One commit per task with the plan's message, progress in
docs/PROGRESS.md, every claim backed by real command output (superpowers:verification-before-completion),
including dogfood for the combos each task touches. Anything that needs a human or an unreleased
upstream (splice, hoard, Cloudflare, cascivo access, npm scope, tags) goes under "Blocked" in
docs/PROGRESS.md; continue with independent tasks. Request a code review at the end of each
milestone. Keep going until all tasks are done or only blocked ones remain, then write Status.
```

## C. What you will need to provide (expected blockers)

- The GitHub repo `keelstack/hull` (push target, hull's own CI, the scheduled `desktop.yml` run).
- `@keelstack/splice` 0.1 on npm (plan 03 Task 7) — built in parallel in `keelstack/splice`.
- `keelstack/hoard@v1` released (plan 03 Task 6).
- A Cloudflare account with secrets `CLOUDFLARE_API_TOKEN` (Workers edit) and
  `CLOUDFLARE_ACCOUNT_ID` on a test repo, for one PR-preview smoke test (plan 02 Task 6).
- Confirmation of the cascivo packages for Preact and access to them if not public (plan 02 Task 2).
- A canary repo `keelstack/hull-canary` rendered from the `web` combo, for CI timing (plan 03 Task 4).
- The npm scope `@docspack-community` (or another owner) to publish community docspacks (plan 03 Task 3).
- Approval and the `v0.1.0` tag push (plan 03 Task 8).
