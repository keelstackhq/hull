# Changelog

hull is a template: a version is a git tag `v<semver>` on this repo, and `splice update` moves a
generated repo between versions (`docs/template-format.md` §7).

Releases are automatic: merging a change to `main` whose top heading is a new dated version tags
`v<version>` and publishes the GitHub release after the owner approves the `release` environment.
Keep `unreleased` while changes accumulate.

## v0.4.0 — unreleased

**Upgrade: move `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the `preview` environment
(Deployment branches → `main`), then delete the repository-level `CLOUDFLARE_*` secrets.**

- PR previews run in two phases: `preview.yml` builds with no secrets and uploads `preview-<pr>`;
  `preview-deploy.yml` (environment `preview`, default-branch code only) deploys `<app>-preview`.
- `min_splice` rises to 0.2.0 (raw blocks in `preview-deploy.yml.jinja`).

## v0.3.1 — 2026-10-27

**Security: symlink-safe agent guard. Update with `splice update`.** In a repo opened through a
symlink (for example `~/code` pointing at another disk), `.claude/hooks/guard.mjs` compared
`process.argv[1]` with `import.meta.url`. Node resolves symlinks in only one of them, so the check
failed and the hook exited 0 without checking anything: the agent safety guard denied nothing.

- Both templates' `guard.mjs` now compare real paths and are fail-safe: when the check is unsure
  (no `argv[1]`, or a path that cannot be resolved) the guard runs. It is skipped only when it is
  imported by another module. Also covered: `node --preserve-symlinks-main` and `node -e import()`.
- The other generated scripts with the same check now compare real paths too, so they no longer
  silently do nothing in a symlinked checkout: `.github/scripts/{affected,preview,release-plan,
  rust-affected}.mjs`, `scripts/agents-index.mjs`, docs `scripts/docs-packs.mjs`, npm-cli
  `scripts/stage.mjs`, and template-rust `.github/scripts/{release-pending,docs-only}.mjs` and
  `scripts/agents-index.mjs`.
- `template/`'s generated `.github/workflows/ci.yml` gains `# step: <id>` comment lines. hull now
  generates the file from one step list (`scripts/gen-ci.mjs`); the steps themselves are unchanged.
- Contract rule 9.27 (empty re-render removes an owned or shared file) is added to
  `docs/template-format.md`. It takes effect with splice 0.3.0; hull's templates do not rely on it
  yet.

## v0.3.0 — 2026-10-26

**New: pure Rust repos.** A third template, `gh:keelstackhq/hull//template-rust` (spec §15). It
has no Node, pnpm or Turborepo: measured, a Turborepo cache hit saved about 1 s over a warm cargo
no-op, while Node setup cost about 10 s per PR.

- `splice new gh:keelstackhq/hull//template-rust <dir> --piece rust-cli:cli`: a cargo virtual
  workspace (`crates/*`, seed crate `crates/common`), Rust 1.99.1 in `rust-toolchain.toml`,
  `rustfmt.toml`, a root `deny.toml`, a nextest `ci` profile.
- One CI job + `ci-ok`: docs-only early exit, rust-cache, then fmt, clippy, cargo-deny, nextest and
  doc tests. Measured on `keelstackhq/rust-canary`: docs-only PR 7 s, crate PR 34 s warm
  (budgets 15 s and 45 s).
- `release.yml` releases through hoist (as berth and bosun do); nothing releases until the
  repository variable `HOIST_RELEASE` is `enabled`. `splice.yml` is the update bot.
- The same AI layer as `template/`, with cargo commands; the generated README names the rigging
  and decisions channel adds.
- hull's tooling renders combos from either template (combo `rust`).
- Both templates' `.claude/settings.json` run bosun's hooks (`bosun hook pre-tool-use`,
  `bosun hook session-start`) when the repo uses bosun: each is a no-op unless `bosun` is on
  `PATH` and `.bosun/bosun.toml` exists. bosun's channel cannot own that file in a hull repo.

## v0.2.2 — 2026-10-22

- PR previews no longer go red on a fresh Cloudflare account. `wrangler versions upload` refuses a
  Worker that was never deployed, so `preview.yml` now runs `.github/scripts/preview.mjs` (new,
  owned): it skips such an app, writes the one-time `pnpm turbo run deploy --filter=<pkg>` to the job
  summary and a notice, and still fails on any other error. A PR never deploys production.
- The `AGENTS.md` of preact-app, astro-site and hono-worker names that one-time deploy
  (astro-site and hono-worker now render it from `AGENTS.md.jinja`, same path and class).

## v0.2.1 — 2026-10-22

Fixes found adopting v0.2.0 in a repo first rendered before v0.1.0.

- `splice update` deletes a leftover `.claude/agents/explorer.md` (base shipped it before v0.1.0,
  then renamed it `explore.md`). No splice lock tracks it, so `migrations/0.2.1.toml` uses a step,
  not a `[[remove]]`: it deletes the file when it is the copy hull shipped and reports an edited
  copy, which it keeps.
- The generated `CLAUDE.md` no longer says to run `splice update` (it is owned, so whoever reads it
  has already updated). It names `splice channel add gh:keelstackhq/hull//rigging --piece claude`
  only for a repo whose `.claude/agents/` lacks the subagents. The upgrade order stays under
  "Upgrading to 0.2.0" in the README.
- `base` is implicit: the README and hull's notes no longer show `--piece base`, and the dev
  renderer CLI refuses it (exit 2) with splice 0.2.0's messages.

## v0.2.0 — 2026-10-22

**Breaking for repos generated from v0.1.0:** the four subagents left `base`.

- `base` no longer ships `.claude/agents/{explore,implementer,reviewer,ci-fixer}.md`. They are in
  hull's `rigging` channel (piece `claude`). `migrations/0.2.0.toml` removes base's unedited
  copies; edited ones are kept and reported. To upgrade, in this order:
  `splice update`, then `splice channel add gh:keelstackhq/hull//rigging --piece claude`.
- Generated CI uses [hoard](https://github.com/keelstackhq/hoard) (`keelstackhq/hoard@v0`) as the
  Turborepo remote cache instead of `actions/cache` on `.turbo/cache`.
- Hull's own CI renders its combos with splice 0.2.0 and tests the dev renderer against it
  (identical trees for every combo) and `splice update` from the previous tag. A weekly splice
  update bot (`.github/workflows/splice.yml`) keeps the org-decisions channel current once
  splice's Action tag `v1` carries its channel-only fix.

## v0.1.1 — 2026-10-22

- splice 0.2.0 can render the template again: dropped `template/migrations/.gitkeep`, which
  splice refuses ("migration files must be named <semver>.toml"). The dev renderer applies the
  same check now. Otherwise identical to v0.1.0.

## v0.1.0 — 2026-10-22

First tag. splice 0.2.0 refuses this tag (`template/migrations/.gitkeep`); use v0.1.1, or render
it with `scripts/render.mjs` (the dev renderer).

**Pieces** (`base` is always included; the others are opt-in, some `multiple`):

| Piece | What it adds |
|---|---|
| `base` | pnpm 12 workspace with an exact catalog, Turborepo, TypeScript 7, Vite+ (one Vite per repo), one-job CI with an affected early exit, Renovate preset, release workflow, AI layer |
| `preact-app` | Preact app on Vite+ with cascivo components, deployed to Cloudflare static assets |
| `ui-storybook` | Preact UI package on cascivo with Storybook 10.6 |
| `astro-site` | Astro 7 static site with Preact islands on the shared Vite+ core |
| `hono-worker` | Hono on Cloudflare Workers: JSON request logs without query strings, headers or bodies; optional scrubbed Sentry |
| `rust-tool` | Rust crate in a root Cargo workspace, run by Turborepo (clippy, rustfmt, nextest) |
| `rust-cli` | Production Rust CLI: one JSON object per run, fixed exit codes, pinned toolchain, cargo-deny |
| `npm-cli` | npm launcher and per-platform packages that ship a `rust-cli` binary (requires `rust-cli`) |
| `ts-lib` | Publishable ESM TypeScript library with publint and attw |
| `tauri-app` | Tauri v2 desktop shell around a `preact-app`; Rust builds only in the scheduled `desktop.yml` |
| `docs` | docspack: local, version-locked docs for agents, with a packs manifest |

**AI layer.** A canonical `AGENTS.md` (≤ 60 lines) with a thin `CLAUDE.md` (≤ 20), the subagents
`Explore` (haiku), `implementer`, `reviewer`, `ci-fixer`, the skills `verify` and `add-piece`, a
PreToolUse guard hook (denies publish, force and tag pushes and secret reads; asks before editing
template-owned files), a generated docs index with a CI check, and per-instance `AGENTS.md`.

**CI budget.** A generated repo's CI is one job plus `ci-ok`, on `pull_request` and `merge_group`,
running only affected tasks. Budget: ≤ 45 s for a typical PR, ≤ 15 s docs-only. Measured on
`keelstackhq/cli-canary` (2026-10-21, warm): npm-cli-only PR 26 s, docs-only 9 s, crate worst case
42 s (n = 3, p50 26 s). Tauri, Storybook builds and Playwright stay off the PR path.

**Known limits.**

- The Tauri `.deb` build (`desktop.yml`) and the Cloudflare preview deploy (`preview.yml`) have
  not run against a real account or runner yet.
- Whether an empty `vars.SENTRY_DSN` in `wrangler.jsonc` overrides a `wrangler secret put`
  value is unverified.
- The `@docspack-community/*` packs are not published, so `pnpm docs:packs --online` lists them
  as missing.
- The first real npm release of a generated tool (provenance, trusted publishing, the
  cross-built macOS x86_64 binary) has not been run.
