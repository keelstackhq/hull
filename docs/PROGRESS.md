# Progress

One line per finished task: `YYYY-MM-DD · plan/task · commit · test summary (+ timing if measured)`.

## Done

- 2026-10-14 · 01/1 · `feat: scaffold hull and load template manifests` · 9/9 tests, lint+fmt clean (Node 24.21, pnpm 12.11.2). `test` script is `node --test "tests/**/*.test.mjs"` (`node --test tests/` fails on Node 24). Deferred review notes: multiple-piece `name` var → Task 5 invariant; `[merge]` globs vs `shared` → Task 3.
- 2026-10-14 · 01/2 · `feat: check templates against the portable subset` · 58/58 tests, lint+fmt clean. Also rejects bare pieces/piece/template, unterminated tags, double else, keyword identifiers, chained filters. Note for Task 7: GitHub `${{ }}` in a `.jinja` workflow would be rejected — keep workflows non-`.jinja` or avoid `${{` in them.

## Measurements

<!-- Dogfood and CI timings: date, combo(s), cold/warm, seconds, machine or runner. -->

## Blocked

<!-- Task, what is missing, exact action a human (or the upstream repo) must take. Known in advance:
- plan 03 Task 6: keelstack/hoard@v1 not released.
- plan 03 Task 7: @keelstack/splice 0.1 not released (CLI flags unknown).
- plan 03 Task 8: tag v0.1.0 needs human approval.
-->

## Status

<!-- Written when the build loop stops. -->
