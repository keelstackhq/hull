# Adopt an existing repo

How an existing repo takes keelstack: hull's template, or only the org channels. A new, empty repo
follows [the start checklist](start-checklist.md) instead. This file is versioned with hull tags.
`TODO(owner)` marks facts not yet written down.

## Which way

- **template/**: the repo is (or will be) a pnpm workspace with TypeScript apps or packages:
  Preact apps, Astro sites, Hono workers, Tauri apps, TS libraries, Rust crates next to them.
- **template-rust/**: the repo is Cargo only, with no package.json: Rust CLIs and library crates.
- **Channels only** (no template): the repo keeps its own stack, CI and layout and takes only the
  org decisions channel and, if wanted, bosun (`bosun init --stack rust|ts-pnpm` only: other
  stacks, such as Python or Go, take the decisions channel only). `ready --assess` says so when it
  finds neither a package.json nor a Cargo.toml; the owner may also pick it for any repo whose CI
  should stay.

## What `ready --assess` looks for

`ready.mjs` runs alone. keelstack.dev hosts a copy per hull tag, pinned and checksummed;
check its sha256 before running it, from the repo root:

```bash
curl -fsSL https://keelstack.dev/assess/v0.8.0.mjs -o /tmp/assess.mjs
echo "ASSESS_SHA256  /tmp/assess.mjs" | sha256sum -c
node /tmp/assess.mjs --assess --json
```

The sha256 is that of hull v0.8.0's `template/pieces/base/files/scripts/ready.mjs` (a hull test
keeps it equal); never use an unpinned latest URL. With a hull clone, run that file directly. It
reads files (regular files up to 1 MB, never symlinks) and writes nothing.

| Signal       | Looks for                                           | Gives            |
| ------------ | --------------------------------------------------- | ---------------- |
| `pnpm`       | pnpm-workspace.yaml or a package.json               | `template/`      |
| `cargo-only` | Cargo.toml and no package.json                      | `template-rust/` |
| `preact`     | a package.json depending on preact                  | `preact-app`     |
| `astro`      | a package.json depending on astro                   | `astro-site`     |
| `hono`       | hono dependency next to a wrangler config           | `hono-worker`    |
| `tauri`      | an @tauri-apps/* dependency or a src-tauri/ dir     | `tauri-app`      |
| `rust-bin`   | a Cargo crate with [[bin]] or src/main.rs           | `rust-cli`       |
| `rust-lib`   | a Cargo crate with src/lib.rs and no binary         | `rust-tool`      |
| `layout`     | apps/, packages/ and crates/ dirs (where pieces go) | where pieces go  |

A Tauri app replaces its preact hit; a workspace root's package.json is not an app. In
template-rust, library crates stay with the base (no piece). Each piece has a move: apps, sites,
workers and Tauri apps go to `apps/<name>`, crates to `crates/<name>`, with the name taken from
the directory (or package.json / Cargo.toml for the repo root). Code already in place does not
move; code elsewhere is moved by hand on the branch, before `splice adopt`.

`--assess` is **unsure** (`confidence: low`) and asks the owner instead of guessing when:

- a name fails splice's name rule (`^[a-z][a-z0-9-]*$`): the owner names the piece;
- Cargo crates come with only a small JS part: template/ if the JS stays, template-rust if it is
  tooling only;
- the repo uses npm or yarn: template/ moves it to pnpm 12;
- preact sits under `packages/`: a UI library (`ui-storybook`) or an app.

## Output of --assess --json

| Field        | Type                                  | Meaning                                                    |
| ------------ | ------------------------------------- | ---------------------------------------------------------- |
| `schema`     | string                                | always `hull.assess/1`                                     |
| `template`   | `"template"`, `"template-rust"`, null | the hull template that fits; null: channels only           |
| `stack`      | `"ts-pnpm"`, `"rust"`, null           | `bosun init --stack` value for the template (null if none) |
| `confidence` | `"high"`, `"low"`                     | low when `unsure` is not empty                             |
| `unsure`     | string[]                              | questions for the owner; never guessed                     |
| `pieces`     | object[]                              | pieces that fit, each with a move                          |
| `signals`    | object[]                              | what was found: `id`, `signal`, `evidence` (string[])      |
| `clashes`    | object                                | `owned`, `shared`, `seed`, `targets`: string[] of paths    |
| `next`       | string                                | the `splice adopt` command to review, or why there is none |

Each piece item has the keys `piece`, `name`, `from`, `to`, `reason` and `unsure`, in that order,
all strings except `unsure`, which is a string (the question for the owner) or null when sure;
`name` is the last segment of `to`. Every field is always present. The `schema` string changes
on any breaking change (a removed, renamed or retyped field); otherwise fields are only added.

## What clashes

`--assess` lists the repo's files that the template's base would write, by class (the lists are
`CLASH` in `ready.mjs`; a test keeps them equal here and to a fresh render):

- **owned**: refused when it exists and differs from the template's (dry-run action `conflict`,
  message "refuse: `<path>`"; an identical file is `skip`); `--force` would replace it (`update`,
  "replace: `<path>`").
  - `template/`: `.claude/hooks/guard.mjs`, `.claude/hooks/session-start.sh`, `.claude/hooks/stop-checks.sh`, `.claude/loop.md`, `.claude/settings.json`, `.claude/skills/add-piece/SKILL.md`, `.claude/skills/docs-lookup/SKILL.md`, `.claude/skills/ready/SKILL.md`, `.claude/skills/verify/SKILL.md`, `.claude/statusline.sh`, `.github/scripts/affected.mjs`, `.github/scripts/preview.mjs`, `.github/scripts/release-plan.mjs`, `.github/scripts/rust-affected.mjs`, `.github/workflows/ci.yml`, `.github/workflows/desktop.yml`, `.github/workflows/preview-deploy.yml`, `.github/workflows/preview.yml`, `.github/workflows/release.yml`, `.github/workflows/splice.yml`, `.gitattributes`, `.gitignore`, `.node-version`, `CLAUDE.md`, `Cargo.toml`, `renovate.json`, `rust-toolchain.toml`, `scripts/agents-index.mjs`, `scripts/ready.mjs`, `tsconfig.base.json`, `vite.config.ts`, `packages/shared/tsconfig.json`, `packages/shared/vite.config.ts`
  - `template-rust/`: `.claude/hooks/guard.mjs`, `.claude/hooks/session-start.sh`, `.claude/hooks/stop-checks.sh`, `.claude/loop.md`, `.claude/settings.json`, `.claude/skills/add-piece/SKILL.md`, `.claude/skills/ready/SKILL.md`, `.claude/skills/verify/SKILL.md`, `.claude/statusline.sh`, `.config/nextest.toml`, `.github/scripts/docs-only.mjs`, `.github/scripts/release-pending.mjs`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/splice.yml`, `.gitattributes`, `.gitignore`, `CLAUDE.md`, `deny.toml`, `renovate.json`, `rust-toolchain.toml`, `rustfmt.toml`, `scripts/agents-index.mjs`, `scripts/ready.mjs`
- **shared**: merged (dry-run action `merge`, or `conflict` when both sides changed).
  - `template/`: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/shared/package.json`
  - `template-rust/`: `Cargo.toml`, `crates/common/Cargo.toml`
- **seed**: kept as they are (dry-run action `skip`).
  - `template/`: `AGENTS.md`, `README.md`, `docs/agents/onboarding.toml`, `docs/agents/project.md`, `scripts/ci-pre.sh`, `scripts/ci-extra.sh`, `packages/shared/src/**`
  - `template-rust/`: `AGENTS.md`, `README.md`, `docs/agents/onboarding.toml`, `docs/agents/project.md`, `hoist.toml`, `scripts/ci-pre.sh`, `scripts/ci-extra.sh`, `crates/common/src/**`
- **targets**: a piece's target directory that already exists and is not the piece's source.

Every other file the template writes is new (`create`). Pieces add more files under their target.

## Order

1. **assess**: `node ready.mjs --assess --json` (read-only); show the owner the template, the
   pieces with their moves and reasons, the unsure notes and the clashes.
2. **confirm**: the owner confirms the template, the pieces and their names, the moves, and each
   owned clash (keep theirs or take the template's) in Claude Code forms.
3. **branch**: work on a new branch, with a clean working tree (`splice adopt` refuses a dirty
   tree unless `--allow-dirty`); the default branch stays untouched until the PR merges.
4. **dry-run**: move code into place as confirmed, then run the `next` command from `--assess`,
   which needs splice >= 0.4.0:
   `splice adopt gh:keelstackhq/hull//<template> --piece <id>:<name> ... --dry-run --json`
   (syntax: `adopt <src> [--ref R] [--piece ID[:N]]... [--data K=V]... [--dry-run] [--force]
   [--allow-dirty] [--no-post] [--json]`; a repo that already has a lock is refused, exit 2).
5. **review**: the owner reviews the change list: every `conflict` (refused owned files, merge
   conflicts) and every `replace`. Nothing has been written yet.
6. **adopt**: run the same command without `--dry-run`. Add `--force` only if the owner chose
   the template's version of every refused file; otherwise settle each one first.
7. **fix**: resolve merge conflicts and anything the dry-run flagged; run the repo's checks. The
   lock is written even when shared files conflict, and `splice check` fails until every
   conflict marker is resolved.
8. **ready**: run the `ready` skill: the onboarding questions, then every check, as for a new repo.
9. **pr**: open the PR with the change list and the owner's choices; it merges like any gated PR.
10. **channels**: after the merge, add the org decisions channel
    (`splice channel add gh:keelstackhq/decisions//channel --track main --piece import-project`,
    D-004) and, if wanted, bosun (`bosun init --stack rust|ts-pnpm`, start checklist item 8;
    other stacks take the decisions channel only).
11. **hoist**: `hoist apply` sets the `ci-ok` ruleset, the environments with branch policies and
    the Actions settings (start checklist items 4-6); `hoist check` exits 0 when done. It does not
    set the `release-tags` ruleset (item 5) or the `release` reviewer (item 6): those stay manual.

Channels-only repos skip steps 4-9 and start at step 10.

## What stays the owner's

- Existing CI the owner keeps: an owned workflow they keep is a refused clash; adopt it with the
  template's CI later, or take channels only.
- Names, moves and which pieces to take: `--assess` only proposes them.
- Secrets, environments, rulesets and App installs: as in the start checklist; agents never hold
  secrets.
- Deleting anything: adoption never removes the repo's own files; the owner decides what goes.
