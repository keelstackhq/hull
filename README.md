# hull

An opinionated, AI-native monorepo template. Pick the pieces you need; hull owns the structure,
stack, tool versions and config, and keeps them current. Your app code stays yours. Part of
[keelstack](https://github.com/keelstack): tools for bootstrapping projects.

> Status: pre-0.1, no release tag yet. Design: `docs/superpowers/specs/2026-10-14-hull-design.md`;
> per-piece reference: `docs/pieces.md`.

## Quick start

`@keelstack/splice` is not released yet, so today you render with hull's dev renderer
(needs Node 24 and pnpm 12; run `pnpm install` once in a hull checkout):

```bash
node scripts/render.mjs new --template template --out ../my-repo \
  --piece base --piece preact-app:web --piece hono-worker:api --data scope=acme
cd ../my-repo && git init && pnpm install && pnpm run ci
```

The renderer only supports `new`; there is no `add` or `update` until splice ships. To render
piece combinations and run their CI command the way hull's CI does:

```bash
node scripts/dogfood.mjs --combo base
node scripts/dogfood.mjs --combo web --combo site
```

When splice 0.1 is out, the equivalent is
`pnpm dlx @keelstack/splice new gh:keelstack/hull//template my-repo --piece ...` (flags unconfirmed),
later `splice add`, `splice update` (owned files replaced, shared files merged, your source never
touched) and `splice check` in CI.

## Pieces

| Piece | What you get |
|---|---|
| `base` | pnpm workspace with a version catalog, Turborepo, TypeScript 7, Vite+ lint/format, Renovate, one-job CI, Claude Code layer |
| `preact-app` | Preact app on Vite+ with cascivo, deployable to Cloudflare Workers static assets |
| `ui-storybook` | Preact component package with Storybook 10.6 |
| `astro-site` | Astro 7 static site sharing the Vite+ core |
| `hono-worker` | Hono on Cloudflare Workers with JSON request logs, Workers Logs, optional Sentry; OTel export unverified (see Logging) |
| `rust-tool` | Rust crate in a root Cargo workspace, orchestrated and cached by Turbo |
| `tauri-app` | Tauri v2 desktop shell around a preact-app, built on a schedule |
| `docs` | docspack: versioned docs for every tool, searchable by agents offline |

## CI in seconds

One job plus a `ci-ok` check, on `pull_request` and `merge_group`. Turbo runs only affected tasks
and exits early when nothing relevant changed. Target: 45 s or less for a typical PR, 15 s or less
for docs-only, on GitHub's own runners. These are targets: the reference canary repo is not set up
yet, so no CI p50 has been measured. Heavy work (Tauri, Storybook build) stays off the PR path.
`keelstack/hoard@v1` as a shared remote cache is planned, not yet released.

### Custom runners

Not a template option. To use Blacksmith, Namespace or Depot, change `runs-on` in
`.github/workflows/ci.yml`; their sticky disks replace the pnpm store cache step.

## Built for Claude Code

A lean `CLAUDE.md`, subagents with fixed models (`explorer` haiku, `implementer` sonnet,
`reviewer` opus, `ci-fixer` sonnet), skills (`verify`, `add-piece`, `docs-lookup`), a `/loop`
default that iterates until checks pass, an opt-in Stop hook, and superpowers + caveman enabled
for the team.

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
