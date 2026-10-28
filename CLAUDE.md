# hull

An opinionated, AI-native monorepo template (pnpm, Turborepo, TypeScript 7, Vite+, Preact, Astro,
cascivo, Storybook, docspack, Rust, Tauri, Hono on Cloudflare). It owns structure, stack, tool
versions and config, never app logic. Consumers render it with `splice` from
`gh:keelstackhq/hull//template`. Until splice v0.1 exists, `scripts/render.mjs` renders it.

- Design: `docs/superpowers/specs/2026-10-14-hull-design.md` — the source of truth. Read only the
  sections your task touches; change the spec in the same commit when behaviour changes.
- Contract: `docs/template-format.md` — shared with `keelstackhq/splice`, binding (incl. §9).
  Never edit it here alone; changes go to both repos in the same week.
- Plans: `docs/superpowers/plans/` (01 base-renderer, 02 web-pieces, 03 native-docs-dogfood, 04 agent-layer-skeletons).
- Progress: `docs/PROGRESS.md` — one line per finished task, plus Blocked and Status.

## Layout

```
template/splice.toml            template manifest (format 1)
template/pieces/<id>/           piece.toml + files/ (base, preact-app, ui-storybook, astro-site,
                                hono-worker, rust-tool, rust-cli, npm-cli, ts-lib, tauri-app, docs,
                                secrets, circleci, circleci-only)
rigging/                        splice channel template (empty base meta; core, claude, skills; §14)
template-rust/                  pure Rust template (base, rust-cli, circleci, circleci-only; no
                                Node/Turborepo; §15)
scripts/render.mjs, lib/        dev renderer (contract §1-§4, §8, §9; `new` only)
scripts/combos/                 one JSON fragment per combo hull CI renders (+ _vars.json)
scripts/gen-ci.mjs              generates template/ ci.yml from the CI plan (scripts/lib/ci-tasks.mjs)
scripts/dogfood.mjs             render combos, run their CI command
scripts/affected-combos.mjs     which combos a diff touches
scripts/release-tag.mjs         hull's own release: version = top dated CHANGELOG.md heading (§10.5)
renovate/default.json           Renovate preset generated repos extend
tests/                          node:test: renderer units + template invariants + module tests of
                                guard.mjs, agents-index.mjs, release-plan.mjs, release-tag.mjs
```

## Commands

```bash
pnpm install
pnpm test                                   # node --test "tests/**/*.test.mjs"
pnpm lint && pnpm format:check              # vp lint / vp fmt --check on scripts and tests
node scripts/render.mjs new --template template --out /tmp/x --piece preact-app:web --json
node scripts/dogfood.mjs --combo base       # render + install + lint/format/typecheck/test/build
node scripts/dogfood.mjs --combo web --combo site
```

Fast checks before every commit: `pnpm test && pnpm lint && pnpm format:check`. Before pushing a
change under `template/` or `scripts/`, run dogfood for the combos `affected-combos` selects.

## Rules that must never break

- **Template stays inside the contract.** `.jinja` uses only the subset: `{{ var }}`, `| lower`,
  `| upper`, `if/elif/else` on `var` or `"id" in pieces`, `for p in pieces`, comments, and
  `{% raw %}…{% endraw %}` (exact tags, no `-`; needs `min_splice` ≥ 0.2.0; never in paths). No
  `not/and/or`, comparisons, `set`, `{%-`, macros, includes, other filters, `{% if pieces %}`.
- **No app logic in the template.** App source is `seed`; configs/workflows/AI layer are `owned`;
  `package.json`, `turbo.json`, `pnpm-workspace.yaml`, crate `Cargo.toml`, `tauri.conf.json`,
  `wrangler.jsonc` are `shared` with a `[merge]` strategy.
- **Renderer rules** (spec §9): identifiers `[a-z_][a-z0-9_]*` (not `loop/self/range/namespace`), no
  symlinks in the template, portable rendered path segments, no case-insensitive path collisions,
  `[[post]].when` required.
- **Each path in at most one ownership class.** No `{{` in paths under `files/`.
- **Exact versions** in the template's pnpm catalog (spec §7). `vite` is overridden to
  `@voidzero-dev/vite-plus-core` at the same version as `vite-plus`; a combo's lockfile has one vite.
- **Turbo caches, Vite+ does not.** Packages call `vp build/test/lint/fmt/pack`; never `vp run`.
- **CI of generated repos is one job + `ci-ok`**, `pull_request` + `merge_group`, no path filters,
  `fetch-depth: 0` + `filter: blob:none`, `turbo query affected` early exit, `--affected` runs.
  Budget ≤ 45 s typical PR, ≤ 15 s docs-only. Heavy work (Tauri, Storybook build, Playwright)
  never on the PR path.
- **CI task list** is `CI_TASKS` in `scripts/lib/ci-tasks.mjs`; the parity test keeps the generated
  workflow, the base `ci` script and dogfood in sync. `template-rust` uses `RUST_CI_STEPS` likewise.
- **Jobs that decrypt secrets never run on PR-controlled code**: environment-gated, default-branch
  code only (secrets spec `2026-10-27-secrets-and-ci-providers-design.md` §4.4); `preview.yml`
  builds with no secrets, `preview-deploy.yml` deploys.
- **Generated `AGENTS.md` + `CLAUDE.md` ≤ 80 lines** (`AGENTS.md` ≤ 60, `CLAUDE.md` ≤ 20). Per-instance notes:
  `<target>/AGENTS.md` owned, `<target>/CLAUDE.md` seed.
- **No secrets in logs** (hono-worker logs never include query strings, headers or bodies).

## How to work here

- Test first (superpowers:test-driven-development): failing test, watch it fail, implement, pass.
- One plan task per commit, message as in the plan (`feat:`, `fix:`, `test:`, `ci:`, `docs:`).
- Subagents: `Explore` (haiku) for every search or "where is X"; `implementer` (sonnet) writes
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
- pnpm 12 blocks dependency build scripts unless listed in `allowBuilds` (`onlyBuiltDependencies` is
  ignored). `minimumReleaseAge` is strict: a pin younger than 3 days needs `minimumReleaseAgeExclude`.

<!-- splice:decisions:begin — managed by `splice update --channel decisions`; edit the source -->
## Org decisions

Cross-repo decisions from keelstackhq/decisions; follow them. To change one, open a PR there.
`splice update --channel decisions` refreshes this snapshot; commit it alone as `chore: sync org decisions`.

@docs/agents/org-decisions.md
<!-- splice:decisions:end -->
