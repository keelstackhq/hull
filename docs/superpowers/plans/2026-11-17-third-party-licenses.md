# Plan: third-party licenses list

Spec: `docs/superpowers/specs/2026-11-17-third-party-licenses-design.md`. Gated PR, one task.

1. Failing `tests/licenses.test.mjs` (offline cargo and npm fixtures, `--check`, lockfile parser,
   posts, CI plan step, dogfood, agent docs).
2. Script in base (+ `SHARED`, `owned`, `CLASH`), posts, plan step (`gen-ci`), dogfood, AGENTS.md,
   verify skills; update goldens, `pnpm docs:pieces`; `pnpm test && pnpm lint && pnpm format:check`.
3. Dogfood `base`, `cli`, `rust`. Commit `feat: third-party licenses list in generated repos`.
