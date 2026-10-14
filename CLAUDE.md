# hull

An opinionated, AI-native monorepo template (pnpm, Turborepo, TypeScript 7, Vite+, Preact, Astro,
cascivo, Storybook, docspack, Rust, Tauri, Hono on Cloudflare). It owns structure, stack, tool
versions and config, never app logic. Consumers render it with `splice` from
`gh:keelstack/hull//template`. Until splice v0.1 exists, `scripts/render.mjs` renders it.

- Design: `docs/superpowers/specs/2026-10-14-hull-design.md` — the source of truth. Read only the
  sections your task touches; change the spec in the same commit when behaviour changes.
- Contract: `docs/template-format.md` — shared with `keelstack/splice`, binding (incl. §9).
  Never edit it here alone; changes go to both repos in the same week.
- Plans: `docs/superpowers/plans/` (01 base-renderer, 02 web-pieces, 03 native-docs-dogfood).
- Progress: `docs/PROGRESS.md` — one line per finished task, plus Blocked and Status.

## Layout

```
template/splice.toml            template manifest (format 1)
template/pieces/<id>/           piece.toml + files/ (base, preact-app, ui-storybook, astro-site,
                                hono-worker, rust-tool, tauri-app, docs)
scripts/render.mjs, lib/        dev renderer (contract §1-§4, §8, §9; `new` only)
scripts/combos.json             piece combinations hull CI renders
scripts/dogfood.mjs             render combos, run their CI command
scripts/affected-combos.mjs     which combos a diff touches
renovate/default.json           Renovate preset generated repos extend
tests/                          node:test: renderer units + template invariants
```

## Commands

```bash
pnpm install
pnpm test                                   # node --test "tests/**/*.test.mjs"
pnpm lint && pnpm format:check              # vp lint / vp fmt --check on scripts and tests
node scripts/render.mjs new --template template --out /tmp/x --piece base --piece preact-app:web --json
node scripts/dogfood.mjs --combo base       # render + install + lint/format/typecheck/test/build
node scripts/dogfood.mjs --combo web --combo site
```

Fast checks before every commit: `pnpm test && pnpm lint && pnpm format:check`. Before pushing a
change under `template/` or `scripts/`, run dogfood for the combos `affected-combos` selects.

## Rules that must never break

- **Template stays inside the contract.** `.jinja` uses only the subset: `{{ var }}`, `| lower`,
  `| upper`, `if/elif/else` on `var` or `"id" in pieces`, `for p in pieces`, comments. No
  `not/and/or`, comparisons, `set`, `{%-`, macros, includes, other filters, `{% if pieces %}`.
- **No app logic in the template.** App source is `seed`; configs/workflows/AI layer are `owned`;
  `package.json`, `turbo.json`, `pnpm-workspace.yaml`, crate `Cargo.toml`, `tauri.conf.json`,
  `wrangler.jsonc` are `shared` with a `[merge]` strategy.
- **Each path in at most one ownership class.** No `{{` in paths under `files/`.
- **Exact versions** in the template's pnpm catalog (spec §7). `vite` is overridden to
  `@voidzero-dev/vite-plus-core` at the same version as `vite-plus`; a combo's lockfile has one vite.
- **Turbo caches, Vite+ does not.** Packages call `vp build/test/lint/fmt/pack`; never `vp run`.
- **CI of generated repos is one job + `ci-ok`**, `pull_request` + `merge_group`, no path filters,
  `fetch-depth: 0` + `filter: blob:none`, `turbo query affected` early exit, `--affected` runs.
  Budget ≤ 45 s typical PR, ≤ 15 s docs-only. Heavy work (Tauri, Storybook build, Playwright)
  never on the PR path.
- **CI task list** is `CI_TASKS` in `scripts/lib/ci-tasks.mjs`; the parity test keeps the generated
  workflow, the base `ci` script and dogfood in sync.
- **Generated `CLAUDE.md` ≤ 80 lines.** Per-instance notes go in `<target>/CLAUDE.md`.
- **No secrets in logs** (hono-worker logs never include query strings, headers or bodies).

## How to work here

- Test first (superpowers:test-driven-development): failing test, watch it fail, implement, pass.
- One plan task per commit, message as in the plan (`feat:`, `fix:`, `test:`, `ci:`, `docs:`).
- Subagents: `explorer` (haiku) for every search or "where is X"; `implementer` (sonnet) writes
  code for one task; `reviewer` (opus) reviews read-only. Keep their reports ≤ 15 lines.
- Read files by section (offset/limit or grep), not whole, unless they are short.
- Verify with real output before claiming a pass (superpowers:verification-before-completion).
- Dependencies: ask before adding anything not in the plan's Tech Stack.
- Version facts: check with `npm view <pkg> version` and record the date; never guess.
- Human-only or cross-repo items (splice/hoard releases, Cloudflare token, npm scopes, GitHub repo
  settings, cascivo access, tags) go to Blocked in `docs/PROGRESS.md` with the exact action.

## Gotchas

- Nunjucks must run with `autoescape: false`, `trimBlocks: false`, `lstripBlocks: false`; keep the
  source's final newline (contract §9.4). `throwOnUndefined: true` catches typos.
- A pieces-dependent root file lives in `base` (targets cannot write root files). Use an
  `if/elif` chain marked `{# same-branches #}` when "any of several pieces" is needed.
- Storybook 10.6 declares `vite-plus` ^0.1/^0.2 as an optional peer; `peerDependencyRules` accepts 1.x.
- `astro check` may not work with TypeScript 7 (no JS API); astro-site uses `tsc --noEmit`.
- oxlint does not lint `.astro` templates; oxfmt `.astro` support is experimental (off).
- Tauri needs webkit2gtk to compile; its Rust builds only in `desktop.yml`. Rust scripts use `-p`.
- docspack: `sync` (deps), `index --repo` (own docs), `ask "<q>" --json` (agents).
- pnpm 12 blocks dependency build scripts unless listed (`onlyBuiltDependencies`; check the name).
