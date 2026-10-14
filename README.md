# hull

An opinionated, AI-native monorepo template. Pick the pieces you need; hull owns the structure,
stack, tool versions and config, and keeps them current. Your app code stays yours. Part of
[keelstack](https://github.com/keelstack): tools for bootstrapping projects.

> Status: under construction. See `docs/superpowers/specs/2026-10-14-hull-design.md`.

```bash
pnpm dlx @keelstack/splice new gh:keelstack/hull//template my-repo \
  --piece preact-app:web --piece hono-worker:api --data scope=acme
```

Later: `splice add astro-site:site`, `splice update` (owned files replaced, shared files merged,
your source never touched), `splice check` in CI.

## Pieces

| Piece | What you get |
|---|---|
| `base` | pnpm workspace with a version catalog, Turborepo, TypeScript 7, Vite+ lint/format, Renovate, one-job CI, Claude Code layer |
| `preact-app` | Preact app on Vite+ with cascivo, deployable to Cloudflare Workers static assets |
| `ui-storybook` | Preact component package with Storybook 10.6 |
| `astro-site` | Astro 7 static site sharing the Vite+ core |
| `hono-worker` | Hono on Cloudflare Workers with JSON request logs, Workers Logs, optional Axiom export and Sentry |
| `rust-tool` | Rust crate in a root Cargo workspace, orchestrated and cached by Turbo |
| `tauri-app` | Tauri v2 desktop shell around a preact-app, built on a schedule |
| `docs` | docspack: versioned docs for every tool, searchable by agents offline |

## CI in seconds

One job plus a `ci-ok` check. Turbo runs only affected tasks and exits early when nothing relevant
changed. Target: ≤ 45 s for a typical PR, ≤ 15 s for docs-only, on GitHub's own runners.
Add `keelstack/hoard@v1` for a shared remote cache.

## Built for Claude Code

A lean `CLAUDE.md`, subagents with fixed models (`explorer` haiku, `implementer` sonnet,
`reviewer` opus, `ci-fixer` sonnet), skills (`verify`, `add-piece`, `docs-lookup`), a `/loop`
default that iterates until checks pass, an opt-in Stop hook, and superpowers + caveman enabled
for the team.

## Known limits

- oxlint does not lint `.astro` templates; oxfmt `.astro` support is experimental and off.
- Storybook 10.6 lists Vite+ 0.x as its peer; hull accepts 1.x (not tested upstream).
- Cloudflare preview URLs are public unless Access protects them, and do not work with Durable Objects.
- Workers Logs free tier is 0.5 GB/day from 2026-12-01.

License: MIT.
