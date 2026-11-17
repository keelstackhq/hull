# Plan: third-party licenses list

Spec: `docs/superpowers/specs/2026-11-17-third-party-licenses-design.md`. Gated PR, one task.

## Task 1: `scripts/licenses.mjs` in both templates, CI step, posts, agent docs

1. Failing test `tests/licenses.test.mjs`: cargo fixture (path deps, offline) → sorted
   packages, direct/dev, UNKNOWN warning, deterministic, no timestamps; `--check` pass/stale/missing
   /no-lockfile; npm fixture (`file:` deps, offline); template-rust copy identical; owned + posts;
   `licenses` step after `agents-index` in both plans and dogfood; AGENTS.md + verify skills.
2. Implement the script in `template/pieces/base/files/scripts/`, add it to `SHARED`
   (`node scripts/sync-shared.mjs`), the `owned` lists and `CLASH` in `ready.mjs`, the posts, the
   plan step (`node scripts/gen-ci.mjs`), dogfood steps (rust pieces chain it onto their cargo posts), AGENTS.md lines, verify skills.
3. Update affected tests/goldens, `pnpm docs:pieces`; `pnpm test && pnpm lint && pnpm format:check`.
4. Dogfood: `base`, a rust combo, the template-rust combo.

Commit: `feat: third-party licenses list in generated repos`.
