---
name: add-piece
description: Add a template piece (preact-app, ui-storybook, astro-site, hono-worker, rust-tool, rust-cli, tauri-app, ts-lib, npm-cli, docs) to this repository with splice. Use when asked to add an app, package, worker or docs to the repo.
---

1. Run `pnpm dlx @keelstackhq/splice add <id> [--name <name>] --data <k>=<v> --yes --json` (for example `add preact-app --name web --yes --json`).
2. Read the JSON `changes` list. Report what was created, merged or skipped, and any conflicts.
3. Run the install the piece declares: `pnpm install --no-frozen-lockfile`.
4. Run `pnpm agents:index` so `docs/agents/index.md` lists the new package.
5. Run the `verify` skill and report its result.

Use a `--name` no other piece instance has (rust-tool and preact-app both named `web` collide).

Do not resolve conflicts by overwriting local edits; list them and ask.
