# Progress

One line per finished task: `YYYY-MM-DD · plan/task · commit · test summary (+ timing if measured)`.

## Done

- 2026-10-14 · 01/1 · `feat: scaffold hull and load template manifests` · 9/9 tests, lint+fmt clean (Node 24.21, pnpm 12.11.2). `test` script is `node --test "tests/**/*.test.mjs"` (`node --test tests/` fails on Node 24). Deferred review notes: multiple-piece `name` var → Task 5 invariant; `[merge]` globs vs `shared` → Task 3.
- 2026-10-14 · 01/2 · `feat: check templates against the portable subset` · 58/58 tests, lint+fmt clean. Also rejects bare pieces/piece/template, unterminated tags, double else, keyword identifiers, chained filters. Note for Task 7: GitHub `${{ }}` in a `.jinja` workflow would be rejected — keep workflows non-`.jinja` or avoid `${{` in them.
- 2026-10-14 · 01/3 · `feat: classify ownership and plan renders` · 90/90 tests, lint+fmt clean. Multiple-piece instance names always set `name` and reject empty, `/`, `\`, `..`. `[merge]`-names-a-shared-file check moves to the Task 5 invariant (loader check was stricter than contract §3).
- 2026-10-14 · 01/4 · `feat: dev renderer writes new repos from the template` · 116/116 tests, lint+fmt clean; manual `render.mjs new --piece app --json` → ok, exit 0, root mode 755. Writes via a sibling staging dir renamed into place (no partial output); target/path strings subset-checked; unexpected errors exit 3.
- 2026-10-14 · 01/5 · `test: template invariants and base skeleton` · 135/135 tests, lint+fmt clean. Invariants probed on a broken copy (two classes, `or`, `{%-`, bad merge key, `{{` in path all fail). `assertSameBranches` throws on unmarked/unclosed/single-branch chains.

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
