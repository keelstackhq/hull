---
name: add-piece
description: Add a template piece (rust-cli) to this workspace with splice. Use when asked to add a CLI crate to the repo.
---

1. Run `splice add <id> [--name <name>] --yes --json` (for example `add rust-cli --name tool --yes --json`; without splice on PATH: `npx @keelstackhq/splice …`).
2. Read the JSON `changes` list. Report what was created, merged or skipped, and any conflicts.
3. Run `cargo update --workspace` so `Cargo.lock` has the new crate.
4. Run `node scripts/agents-index.mjs` so `docs/agents/index.md` lists the new crate.
5. Run the `verify` skill and report its result.

Use a `--name` no other crate has. Do not resolve conflicts by overwriting local edits; list them and ask.
