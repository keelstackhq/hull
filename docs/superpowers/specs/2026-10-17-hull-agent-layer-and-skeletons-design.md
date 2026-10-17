# hull — agent layer v2 and skeleton pieces (design)

Date: 2026-10-17 · Status: draft for review · Amends `2026-10-14-hull-design.md` (the base spec). Evidence: `reports/Developer and agent DX ecosystem.md`, sections "Small, human-written, enforced
context beats more agents" and "Hull's skeletons are stubs where agents most need depth".

Two changes. (A) The generated AI layer: `AGENTS.md` becomes canonical, `CLAUDE.md` thin, the
built-in `Explore` runs on haiku, "never" rules are enforced by a PreToolUse hook, and a generated
docs index replaces guessing. (B) Three skeleton pieces with the shape keelstackhq's own tools
(splice, hoard, hoist) already use, so those tools could be rendered from hull: `rust-cli`,
`npm-cli`, `ts-lib`.

## 1. Goals and non-goals

Goals:
1. One instruction file every agent reads (`AGENTS.md`); Claude-only notes stay in `CLAUDE.md`.
   Instruction text (`AGENTS.md` + `CLAUDE.md`) stays ≤ 80 rendered lines for every combo.
2. Cheap exploration by default: the built-in `Explore` subagent runs on haiku.
3. The "never" rules that cause real damage are enforced by a hook, not only by prose.
4. Agents find repo docs and commands from a compact, generated, CI-checked index (≤ 8 KB).
5. `rust-cli` + `npm-cli` + `ts-lib` give a day-one production skeleton: tested output and exit
   contract, pinned toolchain, supply-chain checks, tag-driven release with provenance and no
   long-lived publish token.
6. Everything stays inside the contract subset, ownership rules, exact pins and CI budgets.

Non-goals: config files/XDG handling, network or TLS code in the Rust skeleton (only a ban on
OpenSSL), changesets, a GitHub Action piece, MCP/plugin pieces, `.agents/tasks` coordination files,
`.claude/rules/` path-scoped rules, per-agent `maxTurns` tuning, Windows/macOS on the PR path,
crates.io publishing (hoist §9.3 covers it later), migrating `rust-tool` consumers (there are none).

## 2. Decisions on the open questions

| # | Question | Decision | Rationale |
|---|---|---|---|
| D1 | Where do imports live? | `CLAUDE.md` holds every `@import`; `AGENTS.md` has none, only plain path pointers. | Codex and other agents do not resolve `@path`; Claude follows imports recursively, so Claude still loads everything through `CLAUDE.md`. |
| D2 | Root `CLAUDE.md` class | `owned` (as today). | Its content is template knowledge (subagents, skills, hooks). User notes keep going to the seed `docs/agents/project.md`. |
| D3 | Per-instance notes | `<target>/AGENTS.md` [owned] + `<target>/CLAUDE.md` [seed] whose only line is `@AGENTS.md`. | Fixes today's contradiction: the generated rules tell users to put local notes in a package `CLAUDE.md`, but that file is owned. The seed file is now the local-notes file. |
| D4 | Explore override | Replace `explorer` with `Explore` (`.claude/agents/explore.md`, `name: Explore`, `model: haiku`). | Defining only `explorer` leaves the built-in Explore on the main model. Two exploration agents is a routing ambiguity. |
| D5 | Which rules a hook enforces | Publish, force-push, tag push, reading secret files: **deny**. Editing a template-owned file: **ask**. Editing `.splice/lock.toml`: **deny**. | These cause irreversible or silent damage. Owned edits are sometimes intended (the user asks for one), so the hook asks the human instead of blocking. `vp run` and style rules stay prose: no damage, and the reviewer catches them. |
| D6 | How the hook reads ownership | From `.splice/lock.toml` `[files]` entries with `class = "owned"` (contract §6 shape, regex-parsed, no deps). No lock → the owned rule is off; the other rules still apply. | The lock is the only authoritative record of rendered owned paths, including instance paths the template cannot know. A hand-kept list would drift from `piece.toml`. Dev-renderer repos have no lock yet; the rule activates when splice ships. |
| D7 | Docs index: static or script | Script `scripts/agents-index.mjs` [owned, base, zero deps] writes `docs/agents/index.md` (generated, committed, never in the template). CI checks it is current. | Static template text cannot list instance names or user docs and goes stale. docspack is optional (`docs` piece), retrieves third-party docs on demand and needs an install; the index is the always-loaded map of this repo. With `docs`, the index adds one docspack line. |
| D8 | Rust CLI: replace `rust-tool` or new piece | New piece `rust-cli`; `rust-tool` stays (internal crate, now with the D3 file split only). | `src/**` is seed, so upgrading `rust-tool` in place could never reach existing repos and would mix old sources with new deps. A small internal crate (build helper, codegen) is still a valid use. No consumer uses `rust-tool` today (example-app: web combo; keelstack: base + astro-site). |
| D9 | Exit codes | 0 ok · 1 negative result (drift, findings, check failed) · 2 usage (clap's default) · 3 config/environment/runtime error. | Matches splice and contract §8. hoist differs (2 = human step pending, usage → 3); the enum is seed, so hoist-like tools remap. |
| D10 | JSON shape | `{"version":1,"command","ok","exit_code","messages":[],…}`, command-specific keys flattened in; errors add `"error":{"kind","message"}`. Exactly one object on stdout, also for clap errors when `--json` is in argv. | Superset of splice (`ok`, `command`, `messages`) and hoist (`version`, `exit_code`). |
| D11 | Release flow | Tag-driven now: a human pushes `<instance>-v<semver>`; one owned `release.yml` publishes. No changesets. | hoist §9 already designs conventional-commit release PRs that render `release.yml` from hull; changesets would be thrown away. A tag is a deliberate human act; agents are denied tag pushes (D5). |
| D12 | Release workflow file | One plain (non-`.jinja`) `.github/workflows/release.yml` in `base`, gated at runtime by a `plan` job. | Workflows need `${{ }}` (matrix, outputs) which the subset cannot emit (base spec §4.3 item 8); pieces with `target` cannot write root files. Same pattern as `preview.yml`. Tag-only trigger, so a repo without publishable pieces never runs it. |
| D13 | Publish-time metadata | Launcher `optionalDependencies` and `repository.url` are written at release time, never committed. | Unpublished platform packages in a committed `optionalDependencies` would break `pnpm install` in the workspace. `repository.url` must match the repo for provenance, and the template has no repo var (base spec §5). The workflow has `GITHUB_REPOSITORY`. |
| D14 | Naming collision rust-cli/npm-cli | rust-cli's private workspace package is `@<scope>/<name>-crate`; npm-cli publishes `@<scope>/<name>` and `@<scope>/<name>-<os>-<cpu>`. | Both default to instance name `cli`; workspace package names must be unique, and the published name is the one users type. |
| D15 | PR-path build of rust-cli | `build` = debug build (`cargo build -p <name> --locked`); release binaries only in `release.yml`. | A release build recompiles every dependency in a second profile (lto); clippy, check and nextest already share the dev profile. Keeps the 45 s budget (§8). |
| D16 | Package checks for ts-lib | `build` = `vp pack && publint && attw --pack . --profile esm-only`. | publint/attw check the built artifact, so they belong to the task that produces it; `CI_TASKS` and parity stay unchanged. ESM-only (no CJS build). |

## 3. (A) Agent layer in `base`

### 3.1 Files

| Path | Class | Change |
|---|---|---|
| `AGENTS.md.jinja` | owned | Was a one-line pointer; now canonical (≤ 60 lines) |
| `CLAUDE.md.jinja` | owned | Thin (≤ 20 lines): imports + Claude-only notes |
| `.claude/agents/explore.md` | owned | New; replaces `explorer.md` (removed) |
| `.claude/hooks/guard.mjs` | owned | New PreToolUse hook (§3.4) |
| `.claude/settings.json` | owned | `hooks.PreToolUse` entry; deny list kept as a second layer |
| `.claude/skills/verify/SKILL.md` | owned | Adds `node scripts/agents-index.mjs --check` |
| `.claude/skills/add-piece/SKILL.md` | owned | Lists the new pieces; runs `pnpm agents:index` after `add` |
| `scripts/agents-index.mjs` | owned | New (§3.5) |
| `.github/workflows/ci.yml` | owned | Index check step before the early-exit step; `cargo-deny` in the Rust tool install (§3.6, §4.1) |
| `.gitignore` | owned | Adds `.env*`, `!.env.example`, `.dev.vars` |
| `package.json.jinja` | shared json | Script `agents:index` = `node scripts/agents-index.mjs` |
| `piece.toml` | — | `owned` lists the new paths; `[[post]]` `node scripts/agents-index.mjs`, `when = ["new","add","update"]` |
| `<target>/AGENTS.md[.jinja]` | owned | Every piece with notes: today's `CLAUDE.md` content moves here (≤ 20 lines) |
| `<target>/CLAUDE.md` | seed | One line `@AGENTS.md` (plain file, no `.jinja`) |

Pieces affected by the D3 split: preact-app, ui-storybook, astro-site, hono-worker, rust-tool,
tauri-app (and the new pieces). Each `piece.toml` moves `CLAUDE.md` from `owned` to `seed` and adds
`AGENTS.md` to `owned`.

### 3.2 `AGENTS.md` (canonical) and `CLAUDE.md` (thin)

`AGENTS.md`: title `{{ scope }}`, two-line description (from `template.name`/`template.version`),
commands block (`pnpm install`, `pnpm check`, `pnpm run ci`, `pnpm format`, `pnpm agents:index`),
rules (test first; verify with real output; small focused changes; catalog pins; owned files come
from the template, local notes go to `docs/agents/project.md` or a package `CLAUDE.md`/notes
section; never read `.env*`/`.dev.vars`; releases are tag pushes by a human), the `## Pieces`
same-branches chain (moved from `CLAUDE.md`, plus bullets for rust-cli, npm-cli, ts-lib), and a
`## Where to look` block with plain pointers: `docs/agents/project.md` (read first),
`docs/agents/index.md` (docs and commands map), `docs/agents/docs.md` when docs is present,
`<dir>/AGENTS.md` per package. Operating one-liners from the report, only those with an observed
failure mode: "at most 2–3 parallel agents, on low-overlap files"; "write next steps to
`docs/agents/project.md` before a long task, start fresh rather than compacting". No layout tree,
no file-by-file overview (ETH study: no gain).

`CLAUDE.md`:

```
@AGENTS.md
@docs/agents/project.md
@docs/agents/index.md{% if "docs" in pieces %}
@docs/agents/docs.md{% endif %}

## Claude Code
- Subagents: `Explore` (haiku, search/read), `implementer` (sonnet), `reviewer` (opus, read-only),
  `ci-fixer` (sonnet). Keep reports ≤ 15 lines.
- Skills: `verify`, `add-piece`[, `docs-lookup`]. `/loop` runs `.claude/loop.md`.
- Hooks: `guard.mjs` denies publish/force-push/tag push/secret reads and asks before editing
  template-owned files; `stop-checks.sh` is opt-in (`HULL_STOP_CHECKS=1`).
```

### 3.3 `Explore` subagent

Frontmatter: `name: Explore`, `description` (use proactively for searches, "where is X",
multi-file reads; returns paths + ≤ 15-line summary; read-only), `tools: Read, Grep, Glob`,
`model: haiku`. Body = today's `explorer.md` body. `implementer`, `reviewer`, `ci-fixer` unchanged
except that their text says `Explore` where it said `explorer`.

### 3.4 PreToolUse guard `.claude/hooks/guard.mjs`

settings.json: `hooks.PreToolUse: [{ matcher: "Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit",
hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs\"", timeout: 10 }] }]`.
Node is present in every generated repo; `jq` is not, so no bash hook.

Input: hook JSON on stdin (`tool_name`, `tool_input`). Output: nothing and exit 0 (allow), or a
`hookSpecificOutput` object with `hookEventName: "PreToolUse"`, `permissionDecision: "deny" | "ask"`
and a one-line `permissionDecisionReason` that says what to do instead. Exported pure function
`decide(input, { lockText, projectDir }) → null | { decision, reason }` for tests; the CLI wrapper
reads stdin and the lock. Any internal error → allow (exit 0) and one stderr line: a broken guard
must not brick a session; the settings deny rules remain as the second layer.

| Rule | Tools | Match | Decision |
|---|---|---|---|
| publish | Bash | `npm\|pnpm\|yarn\|bun publish`, `npm unpublish\|dist-tag`, `cargo publish`, `changeset publish`, `gh release create\|upload` | deny: "Releases run in CI from a tag a human pushes (release.yml)." |
| force push | Bash | `git [global opts] push` with `-f`, `--force`, `--force-with-lease`, `--force-if-includes`, or a `+refspec` | deny |
| tag push | Bash | `git push` with `--tags`, `--follow-tags`, or a ref matching `*-v<digit>*` / `refs/tags/*` | deny: "a tag push publishes" |
| secret files | Read, Grep, Glob, Edit, Write, Bash | a path/pattern/token whose basename matches `.env`, `.env.*`, `.dev.vars` (allow `.env.example`, `.env.sample`, `.env.template`) | deny |
| lock | Edit, Write, MultiEdit, Bash (`>`/`sed -i` target) | `.splice/lock.toml` | deny: "only splice writes the lock" |
| owned edit | Edit, Write, MultiEdit, NotebookEdit | normalised repo-relative `file_path` listed `class = "owned"` in the lock | ask: "owned by the template: `splice update` overwrites it; put local changes in seed files or docs/agents/project.md" |

The path a file tool acts on is `targetPath(tool_input)` = `file_path ?? notebook_path ?? path`
(NotebookEdit uses `notebook_path`, Grep and Glob use `path`). The secret check also looks at a
Grep `glob` and a Glob `pattern`. The owned rule normalises `targetPath` relative to
`projectDir`; owned paths come from the `[files]` lines of the lock (contract §6 shape).

Bash parsing is a tokenizer, not a shell: split on `;`, `&&`, `||`, `|`, newlines; strip leading
`VAR=x`, `env`, `sudo`, `command`, `time`, `pnpm exec`, `npx`; recurse once into `bash|sh -c '<s>'`;
`git` global options (`-C <d>`, `-c k=v`, `--git-dir=…`) are skipped before the subcommand (the
settings deny rules miss `git -C . push -f`). Known gaps, documented in the hook header: `eval`,
scripts that publish, editing owned files through Bash. The hook is a guard rail, not a sandbox.

### 3.5 Docs index `scripts/agents-index.mjs`

`node scripts/agents-index.mjs` writes `docs/agents/index.md`; `--check` exits 1 with
"docs/agents/index.md is stale: run `pnpm agents:index`" when the file differs or is missing.
Zero dependencies, Node built-ins only, deterministic (sorted paths, no dates), `\n` endings.

Content, pipe-delimited (Vercel-style), header line "generated by scripts/agents-index.mjs; do not edit".
Rows sit inside ` ```text ` fences so `vp fmt` leaves them alone; `## Commands` lists the root scripts:

````
## Commands
```text
|script|command
|ci|turbo run lint format:check typecheck test build --affected
```
## Packages
```text
|path|name|scripts
|apps/web|@acme/web|build,dev,format:check,lint,test,typecheck
```
## Docs
```text
|path|title
|docs/agents/project.md|Project notes
|packages/ui/AGENTS.md|UI components
```
````

Sources: root `package.json` scripts; workspace packages from `pnpm-workspace.yaml` globs (one
level: `apps/*`, `packages/*`, `crates/*`; a directory with `package.json`); Markdown under `docs/`
plus each package's `AGENTS.md` and `README.md`, title = first `# ` heading else file name. Skips
`node_modules`, `dist`, `target`, `.turbo`, `.astro`, `.docspack`, `docs/agents/index.md`. With
`docspack` in root devDependencies, one line: "library docs: `pnpm exec docspack ask "<q>" --json`".
Budget 8192 bytes: only rows under `docs/` are dropped, deepest path first (ties: reverse sort
order), and replaced by the last docs row "… N more under docs/ (ls docs)"; commands, packages and
the packages' `AGENTS.md`/`README.md` rows are never dropped. If commands and packages alone still
exceed the budget, the script prints one warning on stderr and exits 0 (also with `--check`); the
file is written as is.

Where it runs: base `[[post]]` (splice), dogfood (the dev renderer does not run post), the
`verify` skill, and CI (§3.6). Claude loads it through `@docs/agents/index.md`; other agents read it
via the `AGENTS.md` pointer.

### 3.6 CI changes (`ci.yml`, owned)

A separate step after checkout and before the early-exit step, no `if`, using the runner's `node`
(as `affected.mjs` already does): `node scripts/agents-index.mjs --check`. It runs on every PR,
including docs-only ones, costs < 1 s, and is not a turbo task, so `CI_TASKS` and the parity test
are unchanged. A failure fails `ci` with the fix command.

## 4. (B) Skeleton pieces

Common to all three: `multiple = true`, `requires = ["base"]`, piece var `name`
(`^[a-z][a-z0-9-]*$`), per-instance `AGENTS.md` [owned] + `CLAUDE.md` [seed] (D3), and a
`"hull": { "release": "<piece-id>" }` field in the instance `package.json` that `release-plan.mjs`
reads (§4.4). Every task the CI runs exists as a package script, except npm-cli `build` (nothing to
build; staging runs in `release.yml`).

### 4.1 `rust-cli` (target `crates/{{ name }}`, default name `cli`)

| Path (under target) | Class | Content |
|---|---|---|
| `Cargo.toml.jinja` | shared toml | `[package]` name `{{ name }}`, version `0.0.0`, edition 2024, `rust-version` = toolchain pin, `publish = false`; `[[bin]]`; `[lints] workspace = true`; deps pinned `=x.y.z`: `clap` (derive, env), `clap_complete`, `clap_mangen`, `thiserror`, `serde` (derive), `serde_json`, `tracing`, `tracing-subscriber` (env-filter, fmt); dev-deps `assert_cmd`, `predicates`, `insta` (json), `tempfile` |
| `package.json.jinja` | shared json | name `@{{ scope }}/{{ name }}-crate` (D14), private, `hull.release = "rust-cli"`; scripts: `build` `cargo build -p {{ name }} --locked` (D15), `lint` `cargo clippy -p {{ name }} --all-targets --locked -- -D warnings && cargo deny --manifest-path Cargo.toml --config deny.toml check bans licenses sources` (`--manifest-path` and `--config` are global options of cargo-deny 0.20, so they precede `check`), `format:check` `cargo fmt -p {{ name }} --check`, `typecheck` `cargo check -p {{ name }} --all-targets --locked`, `test` `cargo nextest run -p {{ name }} --locked` |
| `turbo.json.jinja` | owned | extends `//`; inputs `src/**`, `tests/**`, `Cargo.toml`, `deny.toml`, `$TURBO_ROOT$/Cargo.{toml,lock}`, `$TURBO_ROOT$/rust-toolchain.toml`; build outputs `$TURBO_ROOT$/target/debug/{{ name }}` |
| `deny.toml` | owned | bans `openssl`, `openssl-sys`, `native-tls` (rustls only); license allow-list (MIT, Apache-2.0, BSD-2/3, ISC, Unicode-3.0, Zlib); `sources`: crates.io only; advisories configured but checked only in `release.yml` (§4.4), never on PRs (a new advisory must not fail an unrelated PR) |
| `src/main.rs` | seed | `fn main() -> ExitCode`: `Cli::try_parse_from`; clap error → exit 2 (help/version → 0), as a JSON error object when `--json` is in argv; init tracing; `run::run`; print report; return its exit code |
| `src/run.rs` | seed | `pub fn run(cli: Cli) -> Result<Report, Error>`; dispatch. The crate is binary-only: a seed `main.rs` cannot name an instance-dependent lib crate (`my-cli` → `my_cli`), so there is no `src/lib.rs`; `unsafe_code` is forbidden by the workspace lints |
| `src/cli.rs` | seed | clap derive: global `--json`, `-C <dir>`, `-v…` (count), `-q`; subcommands `hello [--name N]` (the example, returns `{greeting}`), `completions <shell>` (clap_complete to stdout), `man` (clap_mangen roff to stdout) |
| `src/exit.rs` | seed | `#[repr(u8)] enum Exit { Ok = 0, Failure = 1, Usage = 2, Error = 3 }` → `ExitCode` (D9) |
| `src/error.rs` | seed | `thiserror` enum `Error { Usage, Config, Io, … }`, `exit()` mapping; messages say how to fix |
| `src/output.rs` | seed | `Report { version: 1, command, ok, exit_code, messages, #[serde(flatten)] data }`; `render_json` (one object + `\n`), `render_human` (terse lines); nothing else writes stdout |
| `src/log.rs` | seed | tracing-subscriber to **stderr**, filter from `RUST_LOG` else `-v`/`-q`; ANSI off when `NO_COLOR` is set or stderr is not a TTY |
| `tests/common/mod.rs` | seed (plain, no `.jinja`) | `cli()` = `assert_cmd::cargo::cargo_bin_cmd!()` (the package name is the binary name) with `env_clear()`, then only `PATH`, `HOME`/`XDG_*` = a fresh tempdir, `NO_COLOR=1`; a test can never see the developer's tokens or config. No test sets process env (`set_var` is unsafe in edition 2024); a test asserts on the built command's `get_envs()` |
| `tests/cli.rs` | seed | inline insta snapshots (no `.snap` files, no `{{ }}` paths): `--help` (after `String::replace(env!("CARGO_PKG_NAME"), "[BIN]")`, because insta's `filters` feature would add `regex`), `hello --json`; `--json` stdout parses as exactly one object; usage error → exit 2 and still one JSON object with `--json`; nothing on stdout without `--json` goes to stderr; `completions bash` and `man` non-empty; `RUST_LOG=trace` output only on stderr |
| `AGENTS.md` | owned | the output/exit/logging contract above, test helper rule ("always `common::cli()`"), `cargo insta review` (never blind-accept), "network code must use rustls; deny.toml enforces it" |
| `CLAUDE.md` | seed | `@AGENTS.md` |

`[[post]]`: `cargo generate-lockfile` on `new`, `cargo update --workspace` on `add` (as rust-tool).
Rust sources contain no `{{`/`{%`/`{#` and no instance name; no Rust file is a `.jinja` template.

Base changes for rust-cli (all `{# same-branches #}` chains gain a `rust-cli` branch first):
`Cargo.toml.jinja` (members `crates/*` for rust-tool or rust-cli), `rust-toolchain.toml.jinja`
(with rust-cli: `channel = "<pinned 1.x.y>"`, components clippy + rustfmt; otherwise unchanged),
`turbo.json.jinja` globalDependencies (Cargo files; two constructs, a marked `rust-cli`/`rust-tool` chain for the multi-line block and an unmarked chain whose `else` is today's one-line form, so both layouts stay byte-identical), `.github/scripts/rust-affected.mjs.jinja`
(rendered for rust-cli too), `ci.yml` taiki-e `tool: cargo-nextest,cargo-deny` (runtime guard
unchanged: only when an affected package has a `Cargo.toml`). The release-mode musl, macOS and
Windows builds are never on the PR path.

### 4.2 `npm-cli` (target `packages/{{ name }}`, default name `cli`)

Piece var `crate` (default `cli`, `^[a-z][a-z0-9-]*$`): the rust-cli instance it ships. Checked
as a pattern only (like tauri-app's `frontend`); the version-sync test fails when the crate is
missing.

| Path (under target) | Class | Content |
|---|---|---|
| `package.json.jinja` | shared json | name `@{{ scope }}/{{ name }}`, version `0.0.0`, `type: module`, `bin: { "{{ crate }}": "bin/launcher.js" }`, `files: ["bin"]`, `publishConfig: { access: "public", provenance: true }`, `hull.release = "npm-cli"`; no `optionalDependencies` (D13); devDependency `"@{{ scope }}/{{ crate }}-crate": "workspace:*"` so turbo `--affected` runs this package's tests when the crate changes; scripts `lint`, `format:check`, `typecheck` (`node --check` on the five JS files, see below), `test` (`vp test run`) |
| `turbo.json` | owned | extends `//`; `test.dependsOn: []` and `typecheck.dependsOn: []` (no build of the crate for a unit test or a typecheck, so a launcher-only PR never runs cargo) |
| `tsconfig.json` | owned | extends base, `allowJs`, `checkJs`, includes `bin`, `scripts`, `test` |
| `vite.config.ts` | owned | test options only |
| `bin/launcher.js` | owned | plain JS, `// @ts-check`, no `.jinja`: binary name = the `bin` key pointing at itself; platform package = `${name}-${process.platform}-${process.arch}`; resolve via `createRequire(import.meta.url).resolve(pkg + "/package.json")`; `<BIN>_BINARY` env override for local dev (`<BIN>` = `bin.toUpperCase().replaceAll("-", "_")`, so `my-cli` gives `MY_CLI_BINARY`); `spawnSync` with inherited stdio, forwards exit code, re-raises the child's signal; unsupported platform or missing package → one stderr line naming the platform and a source-install fallback (`cargo install --locked --git <repository.url> <bin>` when `package.json` has `repository.url`, else `cargo install --locked --path crates/<bin>`; never `cargo install <bin>`: the crate is `publish = false`), exit 3. No postinstall, no download, no network |
| `scripts/stage.mjs` | owned | release-time only: `--artifacts <dir>` (`<target>/<bin>[.exe]`) → `dist-npm/`: one package per platform (`os`, `cpu`, `bin/<bin>[.exe]`, `files`, `license` copied, `repository.url` from `GITHUB_REPOSITORY`), and the launcher package with exact-version `optionalDependencies` for all five. Fails unless the launcher version equals the crate `Cargo.toml` version and every artifact exists |
| `test/launcher.test.js` | owned | fake platform package in a temp `node_modules` with a tiny executable script: exit-code forwarding, stdio, env override, unsupported-platform message |
| `test/stage.test.js` | owned | staged package.json set: names, `os`/`cpu`, exact versions, no `scripts`, `repository`; missing artifact fails |
| `test/version-sync.test.js` | owned | `package.json` version == `../../crates/<bin>/Cargo.toml` version; message names both files |
| `README.md` | seed | install/usage stub (npm page) |
| `AGENTS.md` / `CLAUDE.md` | owned / seed | how the launcher resolves binaries; "never add postinstall"; bump both versions together |

`typecheck`: `tsc --noEmit` with `checkJs` passes under TypeScript 7 (verified 2026-10-17, §9 item 8), but
only with `@types/node`, which the catalog does not pin and the plan did not list; the script is therefore
`node --check` on `bin/launcher.js`, `scripts/stage.mjs` and the three tests until that dependency is
approved. The `tsconfig.json` stays, but editors show `node:*` errors until `@types/node` is installed.

Platforms (as splice §12): `linux-x64`/`linux-arm64` (static musl, so no `libc` field),
`darwin-x64`, `darwin-arm64`, `win32-x64` (`x86_64-pc-windows-msvc`).

### 4.3 `ts-lib` (target `packages/{{ name }}`, default name `lib`)

| Path (under target) | Class | Content |
|---|---|---|
| `package.json.jinja` | shared json | name `@{{ scope }}/{{ name }}`, version `0.0.0`, `type: module`, `exports: { ".": { types: "./dist/index.d.mts", default: "./dist/index.mjs" }, "./package.json": "./package.json" }`, `files: ["dist"]`, `sideEffects: false`, `publishConfig: { access: "public", provenance: true }`, `hull.release = "ts-lib"`; scripts `build` (D16), `lint`, `format:check`, `typecheck`, `test` (`vp test run`); devDependencies `vite-plus`, `typescript`, `publint`, `@arethetypeswrong/cli` (all `catalog:`) |
| `vite.config.ts` | owned | `pack: { entry: ["src/index.ts"], format: ["esm"], dts: true }` |
| `tsconfig.json` | owned | extends base; `isolatedDeclarations: true` (fast, tool-independent `.d.mts` with TypeScript 7, which has no JS API) |
| `src/index.ts`, `src/index.test.ts` | seed | one exported function with an explicit return type, one test |
| `README.md` | seed | npm page stub |
| `AGENTS.md` / `CLAUDE.md` | owned / seed | public API = `exports`; explicit return types (isolatedDeclarations); `build` runs publint + attw; bump `version` and push `<name>-v<version>` to release |

Base: `pnpm-workspace.yaml` catalog gains `publint` and `@arethetypeswrong/cli` (unused entries are
harmless, base spec §6.1). `packages/shared` stays internal and unchanged.

### 4.4 Release (`base`, owned, plain files)

`.github/scripts/release-plan.mjs` (Node built-ins only, exported `plan(tag, fs)` with
`fs = { read(rel): string | null, list(rel): string[] }`, and
`TAG_RE = /^(.+)-v(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/`, so instance names may contain hyphens):
parses `GITHUB_REF_NAME` = `<instance>-v<semver>`. Pairing rule: candidates are
`crates/<instance>` and `packages/<instance>` whose `package.json` has a `hull.release` field; the
**primary** is the one `rust-cli` or `ts-lib` candidate. For a `rust-cli` primary (version and
`[[bin]]` name from its `Cargo.toml`) the companions are **all** `npm-cli` packages under
`packages/*` (any directory name) whose `bin` key equals the binary name; each companion's version
must equal the tag too. A ts-lib primary (version from `package.json`) is its own `npm_dirs`.
Outputs `kind`, `dir`, `bin` (empty for ts-lib), `version`, `npm_dirs` (JSON) as `key=value`
lines; errors exit 1 with the reason and nothing publishes: tag not matching `TAG_RE` (or an
instance that is not a plain directory name) or no candidate → `unknown tag <tag>`; two primaries
→ `ambiguous: <dir>, <dir>`; an `npm-cli` candidate whose `bin` is not the primary's →
`ambiguous: …`; only an `npm-cli` candidate → `<dir> is an npm-cli package: push <crate>-v<version>
…`; a version mismatch → `tag <tag> is version <v> but <file> has <found>`. Workflow details: base
spec §8.7.

`.github/workflows/release.yml`: `on: push: tags: ["*-v[0-9]*"]`; `permissions: contents: read`
at the top; `concurrency: release-${{ github.ref }}` (no cancel).

| Job | Runs when | Does |
|---|---|---|
| `plan` | always | `release-plan.mjs`; for rust-cli also `cargo deny check advisories` (install via taiki-e) |
| `binaries` | kind = rust-cli | matrix of the five targets on native runners (`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest` for both darwin targets, `windows-latest`); `rustup target add`, `musl-tools` on Linux; `cargo build --release --locked -p <bin> --target <t>`; archive `<bin>-<target>.tar.gz` (`.zip` on Windows); upload artifact. One Linux leg also writes `completions/` (bash, zsh, fish, powershell) and `<bin>.1` from the built binary |
| `github-release` | kind = rust-cli | `contents: write`, `id-token: write`, `attestations: write`; `SHA256SUMS`; `actions/attest-build-provenance` on archives; `gh release create <tag> --verify-tag` with archives, checksums, completions/man |
| `npm` | `npm_dirs` non-empty or kind = ts-lib | `environment: release`, `id-token: write`, no `NODE_AUTH_TOKEN`/npm secret anywhere. npm-cli: `stage.mjs` from the binary artifacts, publish each platform package, then the launcher. ts-lib: `pnpm install --frozen-lockfile`, `pnpm turbo run build test --filter <pkg>`, `npm pkg set repository.url=…`, `pnpm pack` (rewrites `catalog:`/`workspace:`), `npm publish <tgz> --provenance --access public`. Every publish is skipped when `npm view <name>@<version>` already exists, so a re-run is safe |

Human-only (goes to the generated repo's Blocked list via `docs/agents/project.md` seed text and to
hull's PROGRESS Blocked): first publish of each new npm package name, registering the npm trusted
publisher (repo, `release.yml`, environment `release`) for the launcher and all five platform
packages, creating the `release` environment with a tag rule. hoist automates these later (hoist
§9.4); when hoist M3 ships, a hull migration switches the trigger to hoist's release PR.

## 5. Versions (exact pins, verify at plan time)

No version below is a fact yet. The plan's first task fills each with `npm view <pkg> version` /
`cargo search <crate> --limit 1` (or `cargo info`) and the date, and checks `minimumReleaseAge`
(3 days; younger pins go to `minimumReleaseAgeExclude` per base spec §6.1).

| Kind | Name | Pin | Used by |
|---|---|---|---|
| npm | `publint` | `<verify>` | ts-lib (catalog) |
| npm | `@arethetypeswrong/cli` | `<verify>` (check it runs next to TypeScript 7; it bundles its own TS) | ts-lib (catalog) |
| npm CLI | `npm` in `release.yml` | `<verify>`: the first version with OIDC trusted publishing; Node 24's bundled npm if it qualifies | release |
| crate | `clap`, `clap_complete`, `clap_mangen` | `<verify>` (hoist pins clap 4.6.7) | rust-cli |
| crate | `thiserror`, `serde`, `serde_json` | `<verify>` (hoist: 2.0.21, 1.0.229, 1.0.154) | rust-cli |
| crate | `tracing`, `tracing-subscriber` | `<verify>` | rust-cli |
| crate | `assert_cmd`, `predicates`, `insta`, `tempfile` | `<verify>` (hoist: 2.2.2, 3.1.4, 1.49.0, 3.27.0; check `Command::cargo_bin` is not deprecated) | rust-cli |
| tool | Rust toolchain | `<verify>` (hoist pins 1.97) | rust-cli `rust-toolchain.toml` |
| tool | `cargo-deny` | `<verify>` (taiki-e install-action) | ci.yml, release.yml |
| action | `actions/attest-build-provenance`, `actions/upload-artifact`, `actions/download-artifact` | `<verify>` tags; Renovate pins digests | release.yml |

Renovate preset (`renovate/default.json`, hull-owned): group `clap` (`clap`, `clap_*`), group
`tracing`; a regex custom manager for `channel = "x.y.z"` in `rust-toolchain.toml` unless Renovate
handles that file natively (verify).

## 6. Testing (hull `tests/`, node:test)

Updated: `ai-layer.test.mjs` — per combo: rendered `AGENTS.md` + `CLAUDE.md` ≤ 80 lines together,
`CLAUDE.md` ≤ 20 lines and starts with `@AGENTS.md`, imports `docs/agents/project.md` and
`docs/agents/index.md`, `AGENTS.md` has no line starting with `@`, no `\n\n\n`; agents are
`Explore`/implementer/reviewer/ci-fixer, `Explore` model haiku with read-only tools; no `explorer`
anywhere in the rendered `.claude/` or instruction files; settings has the PreToolUse entry and
still the deny list. `rust-tool.test.mjs` and every piece test: per-instance `AGENTS.md` ≤ 20
lines, `CLAUDE.md` is exactly `@AGENTS.md\n` and classed seed. `ci-workflow.test.mjs`: index check
runs before Node setup and has no `if:` skip guard; `tool:` list includes `cargo-deny`.
`pieces-doc.test.mjs`: regenerated `docs/pieces.md`.

New:
- `guard-hook.test.mjs`: table-driven `decide()` cases for every rule row in §3.4, including
  `git -C . push -f`, `FOO=1 pnpm publish`, `bash -c 'npm publish'`, `git push origin cli-v1.2.0`,
  `git push --force-with-lease`, `cat .env.local`, `.env.example` allowed, owned edit → ask with
  a lock fixture, no lock → allow, malformed stdin → exit 0 allow; plus one spawn test of the CLI
  wrapper's JSON output shape.
- `agents-index.test.mjs`: fixture repo → exact expected output; deterministic across runs;
  `--check` exit 0/1 and message; over-budget fixture truncates docs only and stays ≤ 8192 bytes;
  rendered `index.md` for every combo ≤ 8192 bytes.
- `rust-cli.test.mjs`: every dependency pinned `=x.y.z`; no `openssl`/`native-tls` anywhere;
  `deny.toml` bans them; package name ends in `-crate`; build is debug with `--locked`; base files
  gain the rust-cli branches (root Cargo, toolchain pin, turbo globals, rust-affected) and the
  same-branches invariant holds.
- `npm-cli.test.mjs`: no `optionalDependencies`/`scripts.postinstall`/`preinstall` in the
  rendered package.json; `bin` key = `crate`; workspace devDependency on the crate; turbo `test`
  has no `^build`.
- `ts-lib.test.mjs`: `exports` has `types` first and `./package.json`; `files` = `["dist"]`;
  `build` runs publint and attw; `isolatedDeclarations`.
- `release.test.mjs`: `release-plan.mjs` `plan()` on fixtures (rust-cli + npm-cli pairing, ts-lib,
  version mismatch, unknown tag, ambiguous match); `release.yml` shape: tag trigger only, top-level
  `contents: read`, `id-token: write` only on publishing jobs, `environment: release` on `npm`,
  `--provenance` on every publish, no `secrets.NPM_TOKEN`/`NODE_AUTH_TOKEN`.

Dogfood (`scripts/combos.json`, base spec §10.1): new combos `cli` = `base, rust-cli:cli,
npm-cli:cli` and `lib` = `base, ts-lib:lib`, both on the PR path of hull CI (affected-combos
selects them by piece id). `dogfood.mjs` runs `node scripts/agents-index.mjs` after render (post
equivalent) and `--check` in the task list for every combo. The `cli` combo's CI tasks build the
crate, run its insta/assert_cmd tests, and run the launcher tests; hull CI's Rust setup condition
becomes "a selected combo contains rust-tool or rust-cli". Release jobs are not dogfooded
(registry and OIDC); they are covered by the shape and `plan()` tests, and by a first real release
of a keelstackhq tool.

## 7. Base spec sections that change (same commit as the implementation, per hull CLAUDE.md)

§1 goal 4 (AGENTS.md canonical; hooks enforce) · §4.2 ownership table (per-instance `AGENTS.md`
owned, `<target>/CLAUDE.md` seed) · §4.3 item 3 (per-instance notes) · §5 (npm-cli var `crate`) ·
§6 piece table (+ rust-cli, npm-cli, ts-lib) · §6.1 (Cargo/toolchain/turbo/rust-affected branches,
`scripts/agents-index.mjs`, `release.yml`, `release-plan.mjs`, `.gitignore`, catalog, post) ·
§6.6 (rust-tool: file split; "use rust-cli for a distributed CLI") · new §6.10 rust-cli, §6.11
npm-cli, §6.12 ts-lib · §6.9 rewritten (§3 here) · §7 new rows · §8.1 (index check, cargo-deny) ·
new §8.7 release.yml · §8.6 Renovate groups · §10.1 combos · §10.2 Rust setup condition · §12
tests · §13 new unverified items (§9 here). hull's own `CLAUDE.md` rule "Generated `CLAUDE.md` ≤ 80
lines" becomes "Generated `AGENTS.md` + `CLAUDE.md` ≤ 80 lines", and its layout lists the new pieces.

## 8. CI budget

- Docs-only PR: + < 1 s (index check with the runner's node, before setup). Stays ≤ 15 s.
- ts-lib PR: one more `vp pack` + publint + attw (~2–4 s, estimate). Stays ≤ 45 s.
- rust-cli PR: dev-profile compile of clap/serde/tracing. Cold (no rust-cache) is expected to
  exceed 45 s; warm rust-cache + turbo cache must stay ≤ 45 s. Measured with `ci-timing.mjs` on a
  canary render of the `cli` combo before the piece is called done; if over, the first lever is
  dropping `typecheck` to a no-op for Rust (clippy already type-checks), which needs a parity
  exception and therefore a spec change, not a silent edit.

## 9. Risks and facts to verify at plan time

1. A project agent named `Explore` overrides the built-in one. **Verified 2026-10-17** (Claude Code in this container): in a scratch render of `base`, with `.claude/agents/explore.md` edited to `model: sonnet` plus a marker line, `claude -p "Use the Explore subagent to find which file defines the 'ci-fixer' agent in .claude/agents. Quote the subagent's reply verbatim." --output-format stream-json --verbose` showed `subagent_type":"Explore"`, only `claude-sonnet-5-5` model entries (no haiku) and the marker in the reply; the unedited file (haiku) run showed `claude-haiku-5-5`. The project file wins over the built-in.
2. PreToolUse JSON output fields (`hookSpecificOutput.permissionDecision` = `deny`/`ask`,
   `permissionDecisionReason`) and that `ask` prompts even under `acceptEdits`; verify against
   code.claude.com/docs hooks.
3. `@AGENTS.md` inside a lazily loaded `<dir>/CLAUDE.md` resolves relative to that file; an
   `@import` of a missing file (index not yet generated) is ignored, not an error.
4. Guard false positives (`grep publish`, a path containing `.env` in a test fixture name):
   tokens are matched as commands/basenames, and every deny says how to proceed; a false positive
   costs one prompt, a false negative is still caught by settings deny for the common forms.
5. The owned-edit rule is off until splice writes locks; dev-renderer repos (example-app,
   keelstack) get it after their first `splice` adoption.
6. npm trusted publishing: minimum npm version, whether `npm publish <tarball> --provenance`
   works for a `pnpm pack` tarball, and whether a package must exist before a trusted publisher can
   be registered (if so, the first publish is a human step with a short-lived token).
7. Runner labels `ubuntu-24.04-arm`, `macos-latest` cross-building `x86_64-apple-darwin`.
8. `$TURBO_ROOT$` in `inputs` (verified only for `outputs`, base spec §6.6); `cargo deny
   --manifest-path` on a workspace member with `--config`; attw with TypeScript 7 in the
   workspace; `tsc` (TS 7) `checkJs` for the launcher; `vp pack` dts with `isolatedDeclarations`.
9. Hull is pre-v0.1.0 and no repo has a splice lock, so the `explorer.md` removal and the
   `CLAUDE.md` owned→seed reclass need no migration. If v0.1.0 ships first, add
   `template/migrations/<v>.toml` with `[[remove]] .claude/agents/explorer.md` and accept that
   reclassed per-instance `CLAUDE.md` files keep their old text (seed is never touched).
10. The fixed AI-layer cost grows by the index (≤ 8 KB) while `CLAUDE.md` shrinks; the
   ai-layer test asserts always-loaded bytes per combo (AGENTS + CLAUDE + project + index) against
   a ceiling (measured max 3,764 bytes in the `web` combo + 10 % = 4,150), so growth fails a test
   instead of being printed.

## 10. Choices left to the user

- **D11 release model**: tag-driven now and hoist later (recommended), or adopt changesets now.
- **D14 naming**: `@<scope>/<name>-crate` for the private Rust workspace package, or another suffix.
- **D5 owned edits**: `ask` (recommended) or `deny`.
