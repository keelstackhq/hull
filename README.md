# hull

An opinionated, AI-native monorepo template. Pick the pieces you need; hull owns the structure,
stack, tool versions and config, and keeps them current. Your app code stays yours. Part of
[keelstack](https://github.com/keelstackhq): tools for bootstrapping projects.

> Status: pre-0.1, no release tag yet. Design: `docs/superpowers/specs/2026-10-14-hull-design.md`;
> per-piece reference: `docs/pieces.md`.

## Quick start

`@keelstackhq/splice` is not released yet, so today you render with hull's dev renderer
(needs Node 24 and pnpm 12; run `pnpm install` once in a hull checkout):

```bash
node scripts/render.mjs new --template template --out ../my-repo \
  --piece preact-app:web --piece hono-worker:api --data scope=acme
cd ../my-repo && git init && pnpm install && node scripts/agents-index.mjs && pnpm run ci
```

`base` is always rendered; like splice, the dev renderer refuses `--piece base` (exit 2).
The dev renderer runs no `[[post]]` hooks, so run `node scripts/agents-index.mjs` yourself after
rendering to create the docs index (splice will run it).

The renderer only supports `new`; there is no `add` or `update` until splice ships. To render
piece combinations and run their CI command the way hull's CI does:

```bash
node scripts/dogfood.mjs --combo base
node scripts/dogfood.mjs --combo web --combo site
```

With splice (0.2.0 or later) the equivalent is
`pnpm dlx @keelstackhq/splice new gh:keelstackhq/hull//template my-repo --piece preact-app:web ...`
(`base` is always included), later `splice add`, `splice update` (owned files replaced, shared
files merged, your source never touched) and `splice check` in CI. hull's own CI renders its
combos with splice; `node scripts/dogfood.mjs --renderer dev` uses the dev renderer instead.

## Pure Rust repos

For a Rust-only project use the second template, `template-rust` (spec §15): a Cargo workspace
(`crates/*`), pinned toolchain, cargo-deny, cargo-nextest, one CI job with a docs-only exit,
releases through hoist, and the same AI layer. It has no Node, pnpm or Turborepo.

```bash
pnpm dlx @keelstackhq/splice new gh:keelstackhq/hull//template-rust my-repo --piece rust-cli:cli
node scripts/dogfood.mjs --combo rust   # hull: render it and run its cargo CI steps
```

## Pieces

| Piece | What you get |
|---|---|
| `base` | pnpm workspace with a version catalog, Turborepo, TypeScript 7, Vite+ lint/format, Renovate, one-job CI, Claude Code layer |
| `preact-app` | Preact app on Vite+ with cascivo, deployable to Cloudflare Workers static assets |
| `ui-storybook` | Preact component package with Storybook 10.6 |
| `astro-site` | Astro 7 static site sharing the Vite+ core |
| `hono-worker` | Hono on Cloudflare Workers with JSON request logs, Workers Logs, optional Sentry; OTel export unverified (see Logging) |
| `rust-tool` | Rust crate in a root Cargo workspace, orchestrated and cached by Turbo |
| `rust-cli` | Rust CLI skeleton with a JSON/exit-code contract, pinned toolchain and cargo-deny; distributable |
| `npm-cli` | npm launcher plus per-platform packages that ship a `rust-cli` binary, published with provenance |
| `ts-lib` | ESM TypeScript library checked by publint and attw |
| `tauri-app` | Tauri v2 desktop shell around a preact-app, built on a schedule |
| `docs` | docspack: versioned docs for every tool, searchable by agents offline |

## CI in seconds

One job plus a `ci-ok` check, on `pull_request` and `merge_group`. Turbo runs only affected tasks
and exits early when nothing relevant changed. Target: 45 s or less for a typical PR, 15 s or less
for docs-only, on GitHub's own runners. These are targets: the reference canary repo is not set up
yet, so no CI p50 has been measured. Heavy work (Tauri, Storybook build) stays off the PR path.
The Turborepo cache is [hoard](https://github.com/keelstackhq/hoard) (`keelstackhq/hoard@v0`), a
remote cache stored in the GitHub Actions cache: no account, no token.

### Custom runners

Not a template option. To use Blacksmith, Namespace or Depot, change `runs-on` in
`.github/workflows/ci.yml`; their sticky disks replace the pnpm store cache step.

## Upgrading to 0.2.0

hull 0.2.0 moves the four subagents (`.claude/agents/{explore,implementer,reviewer,ci-fixer}.md`)
out of `base` into the `rigging` channel. In that order:

```bash
pnpm dlx @keelstackhq/splice update      # removes base's unedited agent files (edited ones are kept and reported)
pnpm dlx @keelstackhq/splice channel add gh:keelstackhq/hull//rigging --piece claude
```

`channel add` refuses while base's copies are still there, so run `update` first. Delete or move
any edited copy it reports before the `channel add`.

## Built for Claude Code

A canonical `AGENTS.md` (read by any agent) with a thin `CLAUDE.md` on top, subagents from the
`rigging` channel (`splice channel add gh:keelstackhq/hull//rigging --piece claude`: a project
`Explore` on haiku plus `implementer` sonnet, `reviewer` opus and `ci-fixer` sonnet), skills
(`verify`, `add-piece`, `docs-lookup`), a `/loop` default that iterates until checks pass, a
PreToolUse guard hook (denies publish, force or tag pushes and secret reads; asks before editing
template-owned files), a generated docs index (`docs/agents/index.md`), an opt-in Stop hook, and
superpowers + caveman enabled for the team.

## Logging

`hono-worker` writes one JSON line per request (`level`, `requestId`, `method`, `path`, `status`,
`durationMs`); never query strings, headers or bodies. Workers Logs indexes the fields. Sentry is
off unless `SENTRY_DSN` is set, and scrubs requests before sending. Optional OTel export (for
example Axiom) is configured in the Cloudflare dashboard; the syntax is unverified.

## Known limits

- oxlint does not lint `.astro` templates; oxfmt `.astro` support is experimental and off.
  `astro check` does not support TypeScript 7, so astro-site typechecks with `tsc --noEmit`.
- Storybook 10.6 lists Vite+ 0.x as its peer; hull accepts 1.x (`peerDependencyRules`), not tested upstream.
- Cloudflare preview URLs are public unless Access protects them, and do not work with Durable Objects.
- A PR preview needs its Worker to exist. On a fresh Cloudflare account, deploy each app once
  (`pnpm turbo run deploy --filter=@scope/<app>`); until then `preview.yml` skips it with a notice.
- Workers Logs free tier drops to 0.5 GB/day from 2026-12-01; lower `observability.head_sampling_rate`
  in `wrangler.jsonc` to stay under it.
- The template contract cannot emit GitHub's `${{ }}` from a `.jinja` file, so `ci.yml` and
  `preview.yml` are plain workflows with runtime guards (`hashFiles(...)`, a detect step) instead of
  being conditional on the chosen pieces. `desktop.yml` is a `.jinja` rendered only with `tauri-app`.
- Instance names are not checked across pieces: `rust-tool:web` and `preact-app:web` both become
  `@scope/web`. `scripts/render.mjs` warns in `messages`; rename one.
- Not verified yet: the Tauri desktop build (needs GitHub's runner), the Cloudflare preview deploy
  (needs an account), Renovate's handling of the `vite` override alias, and whether the empty
  `vars.SENTRY_DSN` in `wrangler.jsonc` overrides a `wrangler secret put SENTRY_DSN` value on deploy.
