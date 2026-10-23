# hull 05 — `template-rust/` (pure Rust repos)

Spec: §15 of `docs/superpowers/specs/2026-10-14-hull-design.md`. Contract: unchanged (format 1).
Tech stack: nothing new for hull itself. Generated repos use the pins hull already uses: Rust
1.99.1, cargo-nextest 0.9.148, cargo-deny 0.20.2, the §6.10 crate pins, and hoist 0.2.0 (npm).
Checked with `npm view @keelstackhq/hoist version` on 2026-10-23.

Fast checks before every commit: `pnpm test && pnpm lint && pnpm format:check`.

## Task 1: tooling knows more than one template

- Test: `affected-combos` maps `template-rust/pieces/<id>/…` to the combos whose `template` is
  `template-rust` and that use `<id>`. `template-rust/splice.toml` and `template-rust/pieces/base/`
  map to every `template-rust` combo. `template/…` no longer selects `template-rust` combos.
- Test: `comboSteps` for a `template-rust` combo is `git init` (dev renderer only),
  `cargo generate-lockfile` (dev renderer only), `node scripts/agents-index.mjs`, each of
  `RUST_CI_STEPS`, then `agents-index --check`. No pnpm and no turbo.
- Implement `RUST_CI_STEPS` in `scripts/lib/ci-tasks.mjs`, the combo `template` and `vars` fields,
  a snapshot per template in dogfood, and `snapshotTemplate(dir, root, name)`.
- Commit: `feat: combos can render template-rust`

## Task 2: `template-rust` base piece

- Tests (`tests/rust-template.test.mjs`): the manifest loads; the template invariants hold (subset,
  one class per path, no symlinks, portable paths); the rendered base has no `package.json`,
  `pnpm-workspace.yaml` or `turbo.json`; `ci.yml` runs exactly `RUST_CI_STEPS` after the skip
  guard; the `AGENTS.md` + `CLAUDE.md` budgets hold; `guard.mjs` and `statusline.sh` are
  byte-identical to `template/`'s.
- Unit tests for `.github/scripts/docs-only.mjs` (`classify(paths)`) and
  `scripts/agents-index.mjs` (Rust variant).
- Commit: `feat(template-rust): base piece`

## Task 3: `rust-cli` piece in template-rust

- Test: `src/**` and `tests/**` are byte-identical to `template/pieces/rust-cli/files`; no
  `package.json` or `turbo.json`; `deny.toml` only at the root.
- Commit: `feat(template-rust): rust-cli piece`

## Task 4: release through hoist

- Tests for `release-pending.mjs` (`pending({ crates, tags, head, tagFormat })`): the gate is off
  by default; `publish = false` and a missing version are skipped; a tag on HEAD is pending.
- The workflow test: `publish` has `environment: release` and `id-token: write`, and hoist is pinned.
- Commit: `feat(template-rust): release with hoist`

## Task 5: combo `rust`, hull CI, docs

- `scripts/combos.json`: `{ "name": "rust", "template": "template-rust", "pieces": ["base", "rust-cli:cli"], "vars": {} }`.
- hull `ci.yml`: the Rust step also covers `template-rust` combos; the rust-cache workspace covers
  `combos/rust`.
- Dogfood `rust` is green with both renderers. Update `README`, `CLAUDE.md` layout, `PROGRESS.md`.
- Commit: `ci: dogfood the rust combo`
