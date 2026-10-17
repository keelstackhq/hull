# hull Milestone 4 — Agent layer v2 and skeleton pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated repos get a canonical `AGENTS.md`, a thin `CLAUDE.md`, a haiku `Explore`, a PreToolUse guard hook and a CI-checked docs index; three new pieces `rust-cli`, `npm-cli`, `ts-lib` ship a tested CLI/library skeleton with a tag-driven `release.yml`; hull CI dogfoods new combos `cli` and `lib`.

**Architecture:** All agent-layer changes live in `base` (owned, plain files where possible). The guard (`.claude/hooks/guard.mjs`), the index (`scripts/agents-index.mjs`) and the release planner (`.github/scripts/release-plan.mjs`) are zero-dependency Node modules that export one pure function hull tests import straight from `template/pieces/base/files/`; each has a thin CLI wrapper. New pieces follow the `rust-tool`/`preact-app` pattern: `target` with `{{ name }}`, shared `package.json`/`Cargo.toml`, owned configs, seed sources; root effects are `{# same-branches #}` chains in `base`. Workflows needing `${{ }}` stay plain files with runtime guards (`release.yml`, like `preview.yml`).

**Tech Stack:** As milestones 1–3 (hull itself adds no dependency). New pins for generated repos, re-checked on 2026-10-17 (`npm view <pkg> version time`; crates.io API `/api/v1/crates/<c>/<v>` for publish dates), none younger than 3 days, so no new `minimumReleaseAgeExclude` entries:
- npm (catalog): `publint` 0.3.25 (2026-10-01), `@arethetypeswrong/cli` 0.18.5 (2026-07-09; bundles its own `typescript` 5.6.1-rc via `@arethetypeswrong/core`, so it does not use the workspace TS 7).
- npm CLI for publishing: the npm bundled with Node 24 — Node 24.22.0 (2026-10-14) ships npm 11.19.1; trusted publishing needs npm ≥ 11.5.1 and Node ≥ 22.14.0 (docs.npmjs.com/trusted-publishers, read 2026-10-17). No separate `npm` pin (latest npm is 12.2.0, not needed).
- crates (`=x.y.z`, crates.io publish date): `clap` 4.6.7 (2026-09-14; features `derive`, `env`), `clap_complete` 4.6.11 (2026-09-15), `clap_mangen` 0.3.3 (2026-08-12), `thiserror` 2.0.21 (2026-09-23), `serde` 1.0.229 (2026-07-18; `derive`), `serde_json` 1.0.154 (2026-10-11), `tracing` 0.1.44 (2025-12-18), `tracing-subscriber` 0.3.23 (2026-03-13; `env-filter`, `fmt`); dev: `assert_cmd` 2.2.2 (2026-05-11), `predicates` 3.1.4 (2026-02-11), `insta` 1.49.0 (2026-10-03; `json` only), `tempfile` 3.27.0 (2026-03-11). Highest MSRV among them 1.85.
- Rust toolchain: `1.99.1` (stable channel manifest dated 2026-10-15; 1.99.0 2026-10-01). Equal to current `stable`, so hull CI's `dtolnay/rust-toolchain@stable` needs no second download today.
- Tools: `cargo-deny` 0.20.2 (2026-07-09; MSRV 1.88; via `taiki-e/install-action` `tool: cargo-deny@0.20.2`), `cargo-nextest` 0.9.148 (2026-10-08; local installs only; CI keeps taiki-e's latest as today).
- Actions (major tags, Renovate pins digests): `actions/attest-build-provenance@v4` (latest v4.2.2), `actions/upload-artifact@v7` (v7.0.2), `actions/download-artifact@v8` (v8.0.2), `taiki-e/install-action@v2` (v2.87.29), `Swatinem/rust-cache@v2` (already in the template's `ci.yml`); checkout/setup-node/pnpm/rust-toolchain as in `ci.yml`.
- Verified facts (2026-10-17):
  - A project subagent named `Explore` overrides the built-in and keeps its own `model` (code.claude.com/docs/en/sub-agents).
  - PreToolUse `hookSpecificOutput.permissionDecision` `"deny"|"ask"` with `permissionDecisionReason` (shown to Claude for deny, to the user for ask; ask also forces a prompt in auto mode; in `-p` runs ask becomes a denial); `tool_input` is the tool's own arguments (code.claude.com/docs/en/hooks).
  - `NotebookEdit` input key is `notebook_path` (required), not `file_path` (Claude Code's NotebookEdit tool schema, read from a live session 2026-10-17). Grep input has `path` and `glob`.
  - `@path` imports resolve relative to the file that contains them (code.claude.com/docs/en/memory). Not documented: whether an `@import` of a missing file is silently ignored → checked by hand in Task 4.
  - `insta` 1.49.0 has a `filters` feature (crates.io feature list; `Settings::add_filter` is `#[cfg(feature = "filters")]` in `src/settings.rs`, and it pulls in `regex`). We do not enable it; the generated test replaces the binary name with `String::replace` before the inline snapshot.
  - `assert_cmd` 2.2.2: `Command::cargo_bin` not deprecated; `cargo_bin_cmd!()` macro (`src/macros.rs`) and `Command::get_envs()` (`src/cmd.rs`) exist; removed variables appear as `(key, None)`.
  - Renovate has a native `rust-toolchain` manager (`/(^|/)rust-toolchain(\.toml)?$/`), so no regex manager for the toolchain.

**Spec:** `docs/superpowers/specs/2026-10-17-hull-agent-layer-and-skeletons-design.md` (all sections), amending `docs/superpowers/specs/2026-10-14-hull-design.md` (sections listed in its §7). Each task amends the new spec where its pre-flight fix deviates from it, in its own commit (named in its last step).

**User decisions (2026-10-17, binding):** D5 owned edits → guard returns `ask`; D11 tag-driven `release.yml`, no changesets, until hoist release ships; D14 private crate package `@<scope>/<name>-crate`; the subagent/skill files move to a `hull//rigging` splice channel later (not in this plan) — keep them in `base` now without making that move harder.

**Pre-flight (2026-10-17):** `.superpowers/sdd/2026-10-17-hull-04-agent-layer-skeletons/preflight.md`, 31 findings; every proposed fix and ruling accepted and written into the tasks below (finding ids in brackets, e.g. [a6]).

## Global Constraints

- All milestone 1–3 Global Constraints and hull `CLAUDE.md` rules apply (subset only, one class per path, no `{{` in paths, exact pins, never `vp run`, `[[post]].when` required).
- Instruction budget per rendered combo: root `AGENTS.md` ≤ 60 lines, root `CLAUDE.md` ≤ 20 lines, together ≤ 80; per-instance `<target>/AGENTS.md` ≤ 20 lines; `<target>/CLAUDE.md` is exactly `@AGENTS.md\n` and class `seed`. No `\n\n\n` in either root file; `AGENTS.md` has no line starting with `@`.
- **Line count** [b-T4]: one helper `export const lineCount = (text) => text.split("\n").length - 1` in `tests/helpers.mjs` (a file ending in `\n` counts its lines like `wc -l`). Every line cap in this plan uses it (Task 4 adds it).
- Docs index: `docs/agents/index.md` ≤ 8192 bytes, deterministic (sorted, no dates, `\n`), first line `generated by scripts/agents-index.mjs; do not edit`; never shipped in the template, never in any ownership class.
- Exit codes of the rust-cli skeleton: 0 ok · 1 negative result · 2 usage (clap) · 3 config/environment/runtime error. JSON: `{"version":1,"command","ok","exit_code","messages":[],…}`, errors add `"error":{"kind","message"}`, exactly one object + `\n` on stdout, also for clap errors when `--json` is in argv. Logs only on stderr.
- Release: tag `<instance>-v<semver>`, trigger `tags: ["*-v[0-9]*"]`, top-level `permissions: contents: read`; `id-token: write` only on publishing jobs; no `NPM_TOKEN`, `NODE_AUTH_TOKEN` or npm secret anywhere; every `npm publish` has `--provenance --access public` and is skipped when `npm view <name>@<version>` exists. Platforms: `linux-x64`, `linux-arm64` (musl), `darwin-x64`, `darwin-arm64`, `win32-x64`.
- No `optionalDependencies`, `postinstall`, `preinstall` or `repository` committed in any npm-cli package (D13).
- Rust crate deps pinned `=x.y.z`; no `openssl`, `openssl-sys`, `native-tls` in any crate dependency table or Rust source (only `deny.toml` names them, to ban them); PR-path `build` is a debug build with `--locked`. Generated Rust code is safe Rust: the workspace has `unsafe_code = "forbid"` and edition 2024 makes `std::env::set_var` unsafe, so no test sets process env.
- Rigging-ready: the agent layer is `.claude/**` + root `AGENTS.md`/`CLAUDE.md`. New `.claude/**` files are plain (no `.jinja`), import only Node built-ins, and read nothing from `template/` or `piece.toml`. No **new** reference to `.claude/**` outside `.claude/`, `AGENTS.md`, `CLAUDE.md` [c1]; the existing path globs (`.claude` in root `format:check`, `.claude/**` in `//#format:check` inputs, asserted in `ci-workflow.test.mjs`) stay, and the reverse direction (the `verify` skill calling `scripts/agents-index.mjs`) is fine. Hull tests that read `.claude/**` contents stay in `tests/ai-layer.test.mjs` and `tests/guard-hook.test.mjs`.
- Hull is pre-v0.1.0 and no repo has a splice lock: no `template/migrations/` entry for removing `explorer.md` or reclassing `CLAUDE.md` (spec §9 item 9). If v0.1.0 is tagged before this plan lands, stop and add the migration first.
- Every task that changes a `piece.toml` runs `pnpm docs:pieces` in its Step 4 (`pieces-doc.test.mjs` fails otherwise) and commits `docs/pieces.md` [a7]; it updates the base-spec sections named in its last step in the same commit. Every task appends one Done line to `docs/PROGRESS.md` (`2026-10-xx · 04/N · <commit message> · <tests> …`) in its commit.
- Dogfood: per commit, the combos named in the task's Step 4; **before any push, every combo `node scripts/affected-combos.mjs` selects for the branch diff** [c7, b-T1].
- Test bodies [c9]: every test bullet below is a real assertion on a value (`equal`, `deepEqual`, `match` with the expected text). The reviewer rejects tests that assert only existence, `ok(true)`, a bare `t.diagnostic`, or a count without its expected value.
- Task order: T4 lands before T5 [a2]. Between those two commits the root `AGENTS.md` bullets point to `<dir>/AGENTS.md` files that T5 creates; accepted (one branch, no release in between).
- Local toolchain for dogfood: Node 24 + pnpm 12.11.2 (see PROGRESS environment note); Rust tasks also need `rustup toolchain install 1.99.1 --component clippy rustfmt` and `cargo install --locked cargo-nextest@0.9.148 cargo-deny@0.20.2`.

## Review Focus

1. **Wrapped or prefixed dangerous commands** (`git -C . push -f`, `FOO=1 pnpm publish`, `bash -c 'npm publish'`, `npx npm publish`, `git push origin cli-v1.2.0`) → denied with a reason; harmless look-alikes (`grep -r publish docs`, `git push origin main`, `cat .env.example`, `echo .envrc-notes`) → allowed. Test table in Task 1.
2. **The guard itself fails** (empty or malformed stdin, unknown `tool_name`, unreadable lock) → exit 0, nothing on stdout, one stderr line; the session continues. Test in Task 1.
3. **`vp fmt` rewrites the generated index** (markdown tables, escaping) so `--check` passes but `format:check` fails, or the reverse → rows live inside fenced ` ```text ` blocks; dogfood runs `format:check` after the index is written. Test in Task 2 (fixture is fenced) and Task 3 (dogfood order).
4. **A release tag that is ambiguous or half-published**: tag naming only an npm-cli package, tag version ≠ `Cargo.toml`/`package.json` version, launcher version ≠ crate version, two primaries for one instance name, or a re-run after the platform packages were already published → `plan()` exits 1 before any publish; re-run skips existing versions. Tests in Task 9.
5. **A repo with every piece** (`base` + all 11 pieces incl. `docs`) → `AGENTS.md` + `CLAUDE.md` still ≤ 80 lines and the index ≤ 8192 bytes. Test in Task 8 (the last piece task) as an "all pieces" render.
6. **A same-branches chain missing a piece** (a later piece task forgets a branch in `AGENTS.md.jinja`) → the coverage test from Task 4 fails [a10].

---

## File Structure

```
template/pieces/base/files/
  .claude/hooks/guard.mjs                 # decide(input, ctx) + stdin CLI (Task 1)
  .claude/settings.json                   # + hooks.PreToolUse (Task 1)
  .claude/agents/explore.md               # replaces explorer.md; frontmatter name: Explore (Task 4)
  .claude/skills/{verify,add-piece}/SKILL.md
  .gitignore                              # + .env*, !.env.example, .dev.vars (Task 1)
  scripts/agents-index.mjs                # buildIndex(root) + CLI (Task 2)
  AGENTS.md.jinja                         # canonical, replaces AGENTS.md (Task 4)
  CLAUDE.md.jinja                         # thin (Task 4)
  docs/agents/project.md.jinja            # was project.md; release Blocked section (Task 9)
  package.json.jinja                      # agents:index script, format:check + scripts (Task 2)
  turbo.json.jinja                        # //#format:check inputs + scripts/** (Task 2); rust-cli globals (Task 7)
  Cargo.toml.jinja rust-toolchain.toml.jinja .github/scripts/rust-affected.mjs.jinja   # rust-cli branches (Task 7)
  .github/workflows/ci.yml                # index check step (Task 3); cargo-deny (Task 7)
  .github/workflows/release.yml           # Task 9
  .github/scripts/release-plan.mjs        # plan(tag, fs) + CLI (Task 9)
  pnpm-workspace.yaml                     # catalog publint, @arethetypeswrong/cli (Task 6)
template/pieces/{preact-app,ui-storybook,astro-site,hono-worker,rust-tool,tauri-app}/files/{AGENTS.md,CLAUDE.md}   # Task 5
template/pieces/ts-lib/**   template/pieces/rust-cli/**   template/pieces/npm-cli/**   # Tasks 6, 7, 8
renovate/default.json                     # clap/tracing groups, cargo-deny pin manager (Task 7)
scripts/dogfood.mjs scripts/combos.json .github/workflows/ci.yml (hull)                 # Tasks 3, 10
tests/guard-hook.test.mjs agents-index.test.mjs ts-lib.test.mjs rust-cli.test.mjs npm-cli.test.mjs release.test.mjs
tests/fixtures/agents-index/small/**  tests/fixtures/release/**  tests/fixtures/lock/owned.toml
tests/helpers.mjs                         # lineCount (Task 4), assertInstanceNotes (Task 5)
tests/{ai-layer,ci-workflow,parity,dogfood,affected-combos,hull-workflows,rust-tool,preact-app,ui-storybook,astro-site,hono-worker,tauri-app,base}.test.mjs   # extended
docs/superpowers/specs/2026-10-14-hull-design.md  docs/superpowers/specs/2026-10-17-hull-agent-layer-and-skeletons-design.md
docs/pieces.md  docs/PROGRESS.md  CLAUDE.md  README.md
```

---

### Task 1: PreToolUse guard hook

**Files:**
- Create: `template/pieces/base/files/.claude/hooks/guard.mjs`, `tests/fixtures/lock/owned.toml`
- Modify: `template/pieces/base/files/.claude/settings.json`, `template/pieces/base/files/.gitignore`
- Test: `tests/guard-hook.test.mjs`, `tests/ai-layer.test.mjs` (settings test)

**Interfaces:**
- Produces: `export function decide(input: { tool_name: string, tool_input: Record<string, unknown> }, ctx: { lockText?: string, projectDir: string }): null | { decision: "deny" | "ask", reason: string }`; `export function ownedPaths(lockText: string): Set<string>` (regex over `[files]` lines in the contract §6 shape `"<path>"<spaces>= { class = "owned", … }`, any run of spaces before `=`); `export function commands(cmd: string): string[][]` (simple commands as token lists after stripping prefixes); `export function targetPath(toolInput): string | undefined` = `file_path ?? notebook_path ?? path` [b-T1]. CLI: reads stdin JSON, reads `$CLAUDE_PROJECT_DIR/.splice/lock.toml` if present, prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":…,"permissionDecisionReason":…}}` or nothing; always exit 0.

- [ ] **Step 1: Write failing tests** (`tests/guard-hook.test.mjs`, import `decide` from `../template/pieces/base/files/.claude/hooks/guard.mjs`). Fixture `tests/fixtures/lock/owned.toml` copies the contract §6 example shape exactly:

```toml
[files]
"apps/web/vite.config.ts" = { class = "owned", sha256 = "0000" }
"apps/web/package.json"   = { class = "shared", sha256 = "0000" }
"README.md"               = { class = "seed", sha256 = "0000" }
"apps/web/notes.ipynb"    = { class = "owned", sha256 = "0000" }
```

```js
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const ctx = { projectDir: "/r" };
const DENY = [
  "npm publish", "pnpm publish --access public", "yarn publish", "bun publish", "npm unpublish x",
  "npm dist-tag add x@1 latest", "cargo publish", "changeset publish", "gh release create v1",
  "gh release upload v1 a.tgz", "FOO=1 pnpm publish", "env A=b npm publish", "sudo npm publish",
  "npx npm publish", "pnpm exec changeset publish", "bash -c 'npm publish'", "ls && npm publish",
  "git push -f", "git push --force origin main", "git push --force-with-lease", "git push --force-if-includes",
  "git push origin +main", "git -C . push -f", "git -c a=b push --force", "git --git-dir=.git push -f",
  "git push --tags", "git push --follow-tags", "git push origin cli-v1.2.0", "git push origin refs/tags/x",
  "cat .env", "cat apps/api/.env.local", "grep KEY .dev.vars", "echo x > .splice/lock.toml",
  "sed -i s/a/b/ .splice/lock.toml",
];
const ALLOW = ["grep -r publish docs", "git push origin main", "git push", "cat .env.example",
  "cat .env.sample", "cat .env.template", "echo .envrc-notes", "pnpm run ci", "cargo test"];
for (const c of DENY) test(`deny: ${c}`, () => assert.equal(decide(bash(c), ctx)?.decision, "deny"));
for (const c of ALLOW) test(`allow: ${c}`, () => assert.equal(decide(bash(c), ctx), null));
const tool = (tool_name, tool_input) => ({ tool_name, tool_input });
test("secret files: Read file_path, Grep path and glob, Glob pattern deny; .env.example allowed", () => {
  assert.equal(decide(tool("Read", { file_path: "/r/.env" }), ctx).decision, "deny");
  assert.equal(decide(tool("Grep", { pattern: "KEY", path: "/r/apps/api/.dev.vars" }), ctx).decision, "deny");
  assert.equal(decide(tool("Grep", { pattern: "KEY", glob: ".env*" }), ctx).decision, "deny");
  assert.equal(decide(tool("Glob", { pattern: "**/.env.local" }), ctx).decision, "deny");
  assert.equal(decide(tool("Read", { file_path: "/r/.env.example" }), ctx), null);
});
test("Edit/Write/MultiEdit/NotebookEdit on .splice/lock.toml deny with 'only splice writes the lock'", ...);
test("owned edit asks; seed edit and no lock allow", () => {
  const lockText = readFileSync("tests/fixtures/lock/owned.toml", "utf8");
  const edit = (p) => tool("Edit", { file_path: p });
  const c = { lockText, projectDir: "/r" };
  assert.deepEqual([...ownedPaths(lockText)].sort(), ["apps/web/notes.ipynb", "apps/web/vite.config.ts"]);
  assert.equal(decide(edit("/r/apps/web/vite.config.ts"), c).decision, "ask");
  assert.match(decide(edit("/r/apps/web/vite.config.ts"), c).reason, /splice update/);
  assert.equal(decide(edit("/r/apps/web/src/app.tsx"), c), null);
  assert.equal(decide(edit("/r/README.md"), c), null);
  assert.equal(decide(edit("/r/apps/web/vite.config.ts"), { projectDir: "/r" }), null);
});
test("NotebookEdit reads notebook_path: owned notebook asks", () => {
  const c = { lockText: readFileSync("tests/fixtures/lock/owned.toml", "utf8"), projectDir: "/r" };
  const nb = tool("NotebookEdit", { notebook_path: "/r/apps/web/notes.ipynb", new_source: "x" });
  assert.equal(decide(nb, c).decision, "ask");
});
test("every deny reason says what to do instead", ...); // publish reason matches /release\.yml/, force push /without --force/, secrets /\.env\.example/
test("CLI: deny prints hookSpecificOutput JSON and exits 0", ...);   // spawnSync node guard.mjs; parse stdout; deepEqual on hookEventName + permissionDecision
test("CLI: malformed stdin, empty stdin, unknown tool → exit 0, empty stdout, exactly 1 stderr line", ...);
test("guard imports only node: built-ins", ...);                     // every import specifier matches /^node:/
```
In `ai-layer.test.mjs` extend the settings test: `s.hooks.PreToolUse[0].matcher === "Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit"`, command `node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"`, `timeout === 10`; the existing `permissions.deny` entries remain. Rendered `.gitignore` lines include `.env*`, `!.env.example`, `.dev.vars`.

- [ ] **Step 2: Run `pnpm test` — expect FAIL** (guard.mjs missing).
- [ ] **Step 3: Implement** per spec §3.4. Tokenizer, not a shell: split on `;`, `&&`, `||`, `|`, newlines; strip leading `VAR=x`, `env`, `sudo`, `command`, `time`, `pnpm exec`, `npx`; recurse once into `bash|sh -c '<s>'`; skip git global options `-C <d>`, `-c k=v`, `--git-dir=…`, `--work-tree=…` before the subcommand. Secret basenames: `.env`, `.env.*`, `.dev.vars` minus `.env.example|.sample|.template`; checked on `targetPath(tool_input)`, Grep `glob`, Glob `pattern`, and Bash tokens. Owned rule normalises `targetPath` relative to `projectDir`. Header comment lists the known gaps (`eval`, scripts that publish, editing owned files through Bash). Wrap the CLI in `try/catch` → allow + one stderr line. Add the settings entry and `.gitignore` lines.
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check` — expect PASS.** Dogfood: `node scripts/dogfood.mjs --combo base` → ok; in the rendered dir `echo '{"tool_name":"Bash","tool_input":{"command":"git -C . push -f"}}' | node .claude/hooks/guard.mjs` prints the deny JSON. (The diff touches `base`, so all PR combos run before push; see Global Constraints.)
- [ ] **Step 5: Update base spec** §6.9 (guard bullet, settings `PreToolUse`, settings deny kept as second layer) and §6.1 (`.gitignore`); amend new spec §3.4 (`targetPath` = `file_path ?? notebook_path ?? path`; Grep `glob` in the secret check); PROGRESS line.
- [ ] **Step 6: Commit** — `feat(base): PreToolUse guard denies publish, force/tag push, secret reads; asks before owned edits`

---

### Task 2: Generated docs index

**Files:**
- Create: `template/pieces/base/files/scripts/agents-index.mjs`, `tests/fixtures/agents-index/small/**` (root `package.json`, `pnpm-workspace.yaml`, `apps/web/package.json`, `apps/web/AGENTS.md` (`# Web app`), `docs/agents/project.md` (`# Project notes`), `docs/guide/x.md` (`# Guide`)), `tests/fixtures/agents-index/small.expected.md`
- Modify: `template/pieces/base/files/package.json.jinja` (`"agents:index": "node scripts/agents-index.mjs"`; root `format:check` list gains `scripts`), `turbo.json.jinja` (`//#format:check` inputs gain `scripts/**`), `template/pieces/base/piece.toml` (`owned` + `scripts/agents-index.mjs`, kept although `owned` is the default class, as spec §3.1 lists it; `[[post]] run = "node scripts/agents-index.mjs"`, `when = ["new", "add", "update"]`, after the install post), `docs/pieces.md`
- Test: `tests/agents-index.test.mjs`, `tests/base.test.mjs`

**Interfaces:**
- Produces: `export const BUDGET = 8192`; `export function buildIndex(root: string): string`; CLI `node scripts/agents-index.mjs [--check]` — writes `docs/agents/index.md`; `--check` exits 1 with `docs/agents/index.md is stale: run \`pnpm agents:index\`` when different or missing, 0 otherwise.

- [ ] **Step 1: Write failing tests.** Fixture rule [b-T2]: skipped directories (`node_modules`, `dist`, `target`, `.turbo`, `.astro`, `.docspack`) are git-ignored in hull, so they are never committed; the skip test copies `small/` into a temp dir (`cp(…, { recursive: true })`) and creates them there. Fixture files are oxfmt-clean (`vp fmt --check tests` formats them) [R-T2].

```js
const tmpCopy = async (name) => { const d = await mkdtemp(join(tmpdir(), "idx-")); await cp(fx(name), d, { recursive: true }); return d; };
test("small fixture → exact expected output", () => assert.equal(buildIndex(fx("small")), read("small.expected.md")));
test("deterministic: two runs equal, no date, only \\n", () => {
  const a = buildIndex(fx("small"));
  assert.equal(buildIndex(fx("small")), a);
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}|\r/);
});
test("skips node_modules, dist, target, .turbo, .astro, .docspack and docs/agents/index.md", async () => {
  const d = await tmpCopy("small");
  for (const s of ["node_modules/x", "dist", "target", ".turbo", ".astro", ".docspack"]) {
    await mkdir(join(d, s), { recursive: true }); await writeFile(join(d, s, "README.md"), "# Skip me\n");
  }
  await writeFile(join(d, "docs/agents/index.md"), "# Old index\n");
  assert.equal(buildIndex(d), read("small.expected.md"));
});
test("title = first '# ' heading else file name", ...);            // temp file without heading → row `|docs/n.md|n.md`
test("docspack in root devDependencies adds the 'pnpm exec docspack ask' line", ...); // match the exact line
test("over budget: only docs/ rows dropped, deepest first; packages and commands kept", async () => {
  // temp copy + 300 files docs/a/b/c/d<i>.md and 50 files docs/e<i>.md, + 40 packages apps/p<i>
  // assert: Buffer.byteLength ≤ 8192; every package row present; '|ci|' row present;
  // all docs/a/b/c rows dropped before any docs/e row; last docs line matches /^… (\d+) more under docs\/ \(ls docs\)$/
  // and N equals the number of dropped rows; apps/*/AGENTS.md rows never dropped
});
test("--check: exit 0 when current, 1 with the fix message when stale or missing", ...); // spawnSync; stderr equals the message
test("rendered index for base, web, site, docs combos ≤ 8192 bytes and starts with the header line", ...);
test("base post runs agents-index after install, when new/add/update", ...);       // tests/base.test.mjs, deepEqual on the post entry and its index
```
Expected output `small.expected.md` [b-T2]:
````
generated by scripts/agents-index.mjs; do not edit

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
|apps/web/AGENTS.md|Web app
|docs/agents/project.md|Project notes
|docs/guide/x.md|Guide
```
````

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement** per spec §3.5 with Node built-ins only. Workspace globs: read `pnpm-workspace.yaml` `packages:` lines of the form `  - <dir>/*` (one level); a directory counts when it has `package.json`. Fences keep `vp fmt` from rewriting rows. Budget rule [c6]: only rows whose path starts with `docs/` are droppable, deepest path first (ties: reverse sort order); package rows (`<dir>/AGENTS.md`, `<dir>/README.md`) and commands are never dropped.
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check` — expect PASS.** By hand: render `base docs`, `git init -q && pnpm install --no-frozen-lockfile && node scripts/agents-index.mjs && pnpm format:check` → index exists and format check is clean; this also covers the docs piece's `scripts/docs-packs.mjs`, which `format:check` now checks [R-T2].
- [ ] **Step 5: Update base spec** §6.1 (script, post, `agents:index`, format:check covers `scripts`) and §6.9 (index); amend new spec §3.5 [c2, c6]: rows inside ` ```text ` fences with `## Commands`; "only `docs/` rows are dropped, deepest path first". PROGRESS line.
- [ ] **Step 6: Commit** — `feat(base): generated docs index for agents (scripts/agents-index.mjs)`

---

### Task 3: Index check in generated CI, dogfood and `verify`

**Files:**
- Modify: `template/pieces/base/files/.github/workflows/ci.yml` (new step `Agents index current?` after checkout, before `Anything affected?`: `run: node scripts/agents-index.mjs --check`, no `if:`), `template/pieces/base/files/.claude/skills/verify/SKILL.md` (run `node scripts/agents-index.mjs --check` first; one sentence: "`pnpm run ci` does not run this check (it is not a turbo task); CI does" [a4]), `scripts/dogfood.mjs` (`comboSteps`)
- Test: `tests/ci-workflow.test.mjs`, `tests/parity.test.mjs`, `tests/dogfood.test.mjs`, `tests/ai-layer.test.mjs`

**Interfaces:**
- Consumes: `agents-index.mjs` CLI (Task 2)
- Produces: `comboSteps(cacheDir, pieces, dir)` order: `git init` → `pnpm install` → cargo post (if any) → `node scripts/agents-index.mjs` → turbo CI tasks → `node scripts/agents-index.mjs --check` → `check-single-vite` (if Vite pieces).

- [ ] **Step 1: Write failing tests:** `ci-workflow`: "index check step index < setup-node step index < affected step index; the check has no `if`" (indices by step `name`/`uses`, asserted with `equal` on the ordered list). `parity`: "dogfood and generated ci.yml both run `node scripts/agents-index.mjs --check`"; "comboSteps writes the index before turbo and checks it after" — find each step by its command text (as the existing cargo test does) and assert `indexWrite < turbo < indexCheck` [b-T3]. `dogfood`: inject `run`, `deepEqual` the recorded command list for `base`. `ai-layer`: verify skill text matches `/agents-index\.mjs --check/` and `/pnpm run ci` does not run this check/`.
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement.** `CI_TASKS` and the turbo task list stay unchanged.
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check`; dogfood `node scripts/dogfood.mjs --combo base --combo web --combo site --combo docs`** — all ok (the format check now covers the written index).
- [ ] **Step 5: Update base spec** §8.1 (index check, docs-only cost < 1 s) and §10.2 item 3 (dogfood steps); amend new spec §3.6 wording [b-T3]: "a separate step after checkout and before the early-exit step, no `if`, using the runner's `node`". PROGRESS line.
- [ ] **Step 6: Commit** — `ci: check the agents index in generated CI and dogfood`

---

### Task 4: Canonical `AGENTS.md`, thin `CLAUDE.md`, `Explore` on haiku

**Files:**
- Create: `template/pieces/base/files/AGENTS.md.jinja`, `.claude/agents/explore.md`
- Delete: `template/pieces/base/files/AGENTS.md`, `.claude/agents/explorer.md`
- Modify: `CLAUDE.md.jinja`, `.claude/agents/{implementer,reviewer,ci-fixer}.md` (say `Explore`), `.claude/skills/add-piece/SKILL.md` (run `pnpm agents:index` after `add`), `.claude/loop.md` if it names `explorer`; `tests/helpers.mjs` (`lineCount`)
- Test: `tests/ai-layer.test.mjs`, and the six piece tests that assert the root bullet and the 80-line cap [a1]: `tests/preact-app.test.mjs` (test at line 98), `tests/ui-storybook.test.mjs` (81), `tests/astro-site.test.mjs` (75), `tests/tauri-app.test.mjs` (144), `tests/rust-tool.test.mjs` (181), `tests/hono-worker.test.mjs` (92)

**Interfaces:**
- Produces: the `## Pieces` same-branches chains (heading chain and trailing-blank chain) and the per-piece bullet `if`s now live in `AGENTS.md.jinja` (piece tasks 6–8 add branches there); bullets point to `<dir>/AGENTS.md`; `lineCount` in `tests/helpers.mjs`.

- [ ] **Step 1: Write failing tests** (replace the old CLAUDE/AGENTS tests; `COMBOS` = every non-scheduled entry of `scripts/combos.json` plus `["base","docs"]`):

```js
const AGENTS_LIST = [["Explore", "explore.md"], ["implementer", "implementer.md"], ["reviewer", "reviewer.md"], ["ci-fixer", "ci-fixer.md"]];
// helper reads `.claude/agents/${file}` and asserts frontmatter `name: ${name}` (case-sensitive) [b-T4]
test("per combo: AGENTS.md ≤ 60, CLAUDE.md ≤ 20, together ≤ 80 (lineCount), no \\n\\n\\n", ...);
test("CLAUDE.md lines 1-3 are @AGENTS.md, @docs/agents/project.md, @docs/agents/index.md; @docs/agents/docs.md is line 4 only with docs", ...);
test("AGENTS.md has no line starting with @ and points to docs/agents/project.md, docs/agents/index.md", ...);
test("AGENTS.md commands block lists pnpm install, check, run ci, format, agents:index", ...);
test("AGENTS.md rules: never read .env*/.dev.vars; releases are tag pushes by a human; 2–3 parallel agents; ask becomes deny in -p runs", ...);
test("Explore: name Explore, model haiku, tools Read, Grep, Glob, 'use proactively'", ...);
test("no 'explorer' anywhere in rendered .claude/, AGENTS.md, CLAUDE.md", ...);
test("piece bullets under ## Pieces in AGENTS.md, none without pieces", ...);   // moved from CLAUDE.md test
test("every piece id except base and docs has a branch in both Pieces chains and one bullet", () => {
  // ids = readdirSync("template/pieces") minus base, docs; src = AGENTS.md.jinja; chains = elifBranches-style scan
  // for each id: assert.match(src, new RegExp(`"${id}" in pieces`)) in heading chain, trailing chain and bullet if [a10]
});
test("always-loaded bytes per combo (AGENTS+CLAUDE+project+index) ≤ CEILING", ...); // CEILING = measured max + 10%, constant in the test [b-T4]
```
In the six piece tests: read root `AGENTS.md` (not `CLAUDE.md`) for the bullet, assert the `<dir>/AGENTS.md` pointer, and replace `text.split("\n").length <= 80` with `lineCount(agents) + lineCount(claude) <= 80`. Their instance-note assertions (e.g. `apps/web/CLAUDE.md` mentions `@acme/ui`) stay unchanged here and move in Task 5.

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the files** per spec §3.2–§3.3. `CLAUDE.md.jinja` keeps the docs import on the index line so no empty line appears without docs: `@docs/agents/index.md{% if "docs" in pieces %}\n@docs/agents/docs.md{% endif %}`; skills line `` `verify`, `add-piece`{% if "docs" in pieces %}, `docs-lookup`{% endif %} ``. Keep `.claude/**` files plain. `AGENTS.md` says in one line that a hook `ask` becomes a denial in `-p`/unattended runs (Risks).
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check`; dogfood all PR combos** — ok (rendered markdown passes `vp fmt --check`). **By hand, spec §9 item 3** [a5]: in a rendered `base` repo without `docs/agents/index.md`, `claude -p "list the files your instructions imported" --output-format json` (or `/memory` interactively) → no error for the missing import; after `node scripts/agents-index.mjs` it loads. Also confirm `@AGENTS.md` in `apps/web/CLAUDE.md` resolves to `apps/web/AGENTS.md` (documented: imports resolve relative to the containing file, code.claude.com/docs/en/memory, 2026-10-17). If the missing import errors, keep the index committed by the `[[post]]` and record the gap.
- [ ] **Step 5: Update base spec** §1 goal 4, rewrite §6.9 (AGENTS canonical, CLAUDE thin, agent table with `Explore`), §13 (spec §9 item 3 result with date); amend new spec §3.2 snippet [c3] (docs import on the index line) and §9 item 10 (bytes asserted against a ceiling, not printed). PROGRESS line with lines/bytes per combo and the CEILING value.
- [ ] **Step 6: Commit** — `feat(base): AGENTS.md canonical, thin CLAUDE.md, Explore subagent on haiku`

---

### Task 5: Per-instance `AGENTS.md` (owned) + `CLAUDE.md` (seed)

**Files:**
- Modify: for each of `preact-app`, `ui-storybook`, `astro-site`, `hono-worker`, `rust-tool`, `tauri-app`: move `files/CLAUDE.md[.jinja]` content to `files/AGENTS.md[.jinja]` (same `.jinja`-ness as today: `preact-app` and `tauri-app` are `.jinja`, the others plain); new `files/CLAUDE.md` = `@AGENTS.md\n` (plain); `piece.toml`: remove `CLAUDE.md` from `owned`, add it to `seed`, add `AGENTS.md` to `owned` (one class per path). hono-worker's notes are 21 lines today (`wc -l`): trim to ≤ 20 [a11]. `rust-tool` AGENTS.md gains "for a distributed CLI use `rust-cli`" within 20 lines. `docs/pieces.md` regenerated.
- Test: the six piece tests, `tests/helpers.mjs`, `tests/ai-layer.test.mjs`

**Interfaces:**
- Produces: `assertInstanceNotes(pieces, target)` and the convention new pieces (Tasks 6–8) copy.

- [ ] **Step 1: Write failing tests:** in `tests/helpers.mjs` — `export async function assertInstanceNotes(pieces, target, vars = {})`: renders, asserts `lineCount(<target>/AGENTS.md) <= 20` and class `owned`; `<target>/CLAUDE.md` `===` `"@AGENTS.md\n"` and class `seed`. Call it from each of the six piece tests. Move the content and class assertions from `CLAUDE.md` to `AGENTS.md`: `preact-app.test.mjs:78,82` (`@acme/ui`), `astro-site.test.mjs:70` (oxlint/oxfmt note), `tauri-app.test.mjs:149`, `hono-worker.test.mjs:108`; class lines `ui-storybook.test.mjs:32`, `astro-site.test.mjs:28`, `rust-tool.test.mjs:60`, `hono-worker.test.mjs:27` now expect `AGENTS.md` owned and `CLAUDE.md` seed. `rust-tool`: AGENTS.md matches `/rust-cli/`.
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Move the files and edit the manifests.**
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check`; dogfood all PR combos** — ok.
- [ ] **Step 5: Update base spec** §4.2 table, §4.3 item 3, §6.6 (file split, rust-cli pointer); PROGRESS line.
- [ ] **Step 6: Commit** — `feat: per-instance AGENTS.md owned, CLAUDE.md seed for local notes`

---

### Task 6: `ts-lib` piece

**Files:**
- Create: `template/pieces/ts-lib/piece.toml`, `files/{package.json.jinja,vite.config.ts,tsconfig.json,src/index.ts,src/index.test.ts,README.md,AGENTS.md,CLAUDE.md}`
- Modify: `template/pieces/base/files/pnpm-workspace.yaml` (catalog `publint: 0.3.25`, `"@arethetypeswrong/cli": 0.18.5`), `AGENTS.md.jinja` (both Pieces chains + bullet), `.claude/skills/add-piece/SKILL.md` (piece list), `docs/pieces.md`
- Test: `tests/ts-lib.test.mjs`, `tests/base.test.mjs` (catalog pins)

**Interfaces:**
- Produces: package `@{{ scope }}/{{ name }}` with `"hull": { "release": "ts-lib" }` (read by Task 9); `build` = `vp pack && publint && attw --pack . --profile esm-only`.

- [ ] **Step 1: Write failing tests:** manifest (`multiple`, target `packages/{{ name }}`, default `lib`, requires `["base"]`); classes (package.json shared json, vite.config.ts/tsconfig.json/AGENTS.md owned, src/README/CLAUDE.md seed); package.json: `exports["."]` keys `deepEqual` `["types","default"]` with values `./dist/index.d.mts` and `./dist/index.mjs`, `exports["./package.json"] === "./package.json"`, `files` deep-equals `["dist"]`, `sideEffects === false`, `publishConfig` deep-equals `{access:"public",provenance:true}`, `hull.release === "ts-lib"`, scripts keys include every `CI_TASKS` entry, `build` contains `publint` and `attw --pack . --profile esm-only`, no `vp run`, devDependencies `publint`/`@arethetypeswrong/cli`/`vite-plus`/`typescript` are `catalog:`; `tsconfig.json` `compilerOptions.isolatedDeclarations === true`; `vite.config.ts` matches `format: ["esm"]` and `dts: true`; `assertInstanceNotes(["base","ts-lib:lib"], "packages/lib")`; catalog pins equal `0.3.25` / `0.18.5`. The Task 4 coverage test now passes for `ts-lib`.
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the piece** per spec §4.3. Output names follow `packages/shared` [N-T6] (`type: module`, `format: ["esm"]` → `index.mjs`/`index.d.mts`, already shipped and green).
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check`; dogfood by hand:** render `base ts-lib:lib --data scope=hullci`, `git init -q && pnpm install --no-frozen-lockfile && node scripts/agents-index.mjs && pnpm turbo run lint format:check typecheck test build && node scripts/agents-index.mjs --check` → all pass. `ls packages/lib/dist` shows `index.mjs` and `index.d.mts` (confirmation only). Still to verify here (spec §9 item 8): `attw --pack` runs next to TS 7 (uses its bundled 5.6.1-rc) and `vp pack` dts with `isolatedDeclarations`. Record the extra build seconds in PROGRESS.
- [ ] **Step 5: Update base spec** §6 table, new §6.12, §6.1 catalog, §7 rows (publint, attw with dates), §13 (attw/TS 7 result); PROGRESS line.
- [ ] **Step 6: Commit** — `feat(ts-lib): ESM TypeScript library with publint and attw checks`

---

### Task 7: `rust-cli` piece and its base branches

**Files:**
- Create: `template/pieces/rust-cli/piece.toml`, `files/{Cargo.toml.jinja,package.json.jinja,turbo.json.jinja,deny.toml,src/main.rs,src/run.rs,src/cli.rs,src/exit.rs,src/error.rs,src/output.rs,src/log.rs,tests/common/mod.rs,tests/cli.rs,AGENTS.md,CLAUDE.md}`
- Modify (base): `Cargo.toml.jinja` (outer marked chain gains an identical `rust-cli` branch first; inside each outer branch the `"crates/*"` member line becomes a nested marked chain `{# same-branches #}{% if "rust-cli" in pieces %}  "crates/*",\n{% elif "rust-tool" in pieces %}  "crates/*",\n{% endif %}`), `rust-toolchain.toml.jinja` (unmarked chain gains a `rust-cli` branch first: `channel = "1.99.1"`, components clippy + rustfmt), `turbo.json.jinja` (globalDependencies, see Step 3), `.github/scripts/rust-affected.mjs.jinja` (whole-file `if` becomes a marked chain rust-cli/rust-tool with the body duplicated per branch; accepted [R-T7]), `.github/workflows/ci.yml` (`tool: cargo-nextest,cargo-deny@0.20.2`; also installed for rust-tool-only repos, small cost [N-T7]), `AGENTS.md.jinja`, add-piece skill list; `renovate/default.json` (groups `clap` = `clap`, `clap_*`; `tracing` = `tracing`, `tracing-*`; regex custom manager for `cargo-deny@x.y.z` in `.github/workflows/*.yml`, datasource `crate`); `docs/pieces.md`
- Test: `tests/rust-cli.test.mjs`, `tests/rust-tool.test.mjs`, `tests/ci-workflow.test.mjs`, `tests/parity.test.mjs`

**Interfaces:**
- Produces: private package `@{{ scope }}/{{ name }}-crate` with `hull.release = "rust-cli"`, binary `{{ name }}`, crate version `0.0.0` in `Cargo.toml` (read by Tasks 8–9); seed CLI subcommands `hello [--name N]` → data `{ "greeting": "hello, N" }`, `completions <shell>`, `man`; parity test "cargo-deny pin is one version" (extended in Tasks 9, 10).
- Deviations from spec §4.1 [c4] (amend the §4.1 table in this commit; record in base §6.10): binary-only crate — `src/run.rs` holds `pub fn run(cli: Cli) -> Result<Report, Error>` instead of `src/lib.rs`, because a plain seed `main.rs` cannot name an instance-dependent lib crate (`my-cli` → `my_cli`); `tests/common/mod.rs` is plain (not `.jinja`) and uses `assert_cmd::cargo::cargo_bin_cmd!()`; `--help` snapshots replace `env!("CARGO_PKG_NAME")` with `[BIN]` via `String::replace` before `insta::assert_snapshot!` (no insta `filters` feature, which would add `regex`) [b-T7], so no Rust file contains the instance name.

- [ ] **Step 1: Write failing hull tests** (`tests/rust-cli.test.mjs`):

```js
test("piece manifest", ...);  // multiple, target crates/{{ name }}, default cli; posts deepEqual [generate-lockfile/new, update --workspace/add]
test("classes", ...);         // Cargo.toml/package.json shared (toml/json), turbo.json/deny.toml/AGENTS.md owned, src/**, tests/**, CLAUDE.md seed
test("every dependency pinned =x.y.z with the plan's versions", ...);   // smol-toml; deepEqual on {name: version} maps
test("no openssl/openssl-sys/native-tls in Cargo.toml dependency tables, src/** or tests/**; deny.toml bans all three", () => {
  // absence: keys of [dependencies]/[dev-dependencies]/[build-dependencies]; text of every rendered src/**, tests/** file
  // presence: deny.toml bans.deny crate names deepEqual ["openssl","openssl-sys","native-tls"] [b-T7]
});
test("deny.toml: licenses allow-list, private crates ignored, crates.io-only sources", ...); // deepEqual on parsed values
test("package name ends in -crate; build is cargo build -p <name> --locked (debug); scripts use -p and --locked", ...);
test("lint runs clippy -D warnings then cargo deny … check … bans licenses sources", ...);
test("turbo inputs include tests/**, deny.toml, $TURBO_ROOT$/Cargo.lock, $TURBO_ROOT$/rust-toolchain.toml; build outputs target/debug/<name>", ...);
test("no Rust source contains {{, {% or {#", ...);
test("base with rust-cli: root Cargo.toml members crates/*, toolchain 1.99.1 + clippy + rustfmt, rust-affected rendered", ...);
test("turbo.json globalDependencies for none / rust-cli / rust-tool / both", () => {
  // none: deepEqual ["vite.config.ts","tsconfig.base.json"] and the raw text equals today's single line
  // rust-cli, rust-tool, both: deepEqual [..., "Cargo.toml","Cargo.lock","rust-toolchain.toml"], raw text equals today's multi-line block [a6]
});
test("rust-tool without rust-cli renders Cargo.toml, rust-toolchain.toml, rust-affected.mjs byte-identical to before", ...); // golden strings
test("same-branches invariant holds for every touched base file", ...);
test("generated ci.yml installs cargo-nextest and cargo-deny@0.20.2", ...);   // ci-workflow
test("renovate preset groups clap and tracing and tracks the cargo-deny pin", ...);
test("cargo-deny pin is one version across template ci.yml and the renovate regex fixture", ...); // parity.test.mjs [a9]
```
Generated tests (`files/tests/cli.rs`, run by dogfood): `--help` inline snapshot (after `.replace(env!("CARGO_PKG_NAME"), "[BIN]")`); `hello --json` inline snapshot of the object; `--json` stdout parses as exactly one object; `--json --bogus` → exit 2 and one JSON object with `error.kind == "usage"`; `--help` → exit 0; `hello` without `--json` writes nothing to stderr; `completions bash` and `man` stdout non-empty; `RUST_LOG=trace hello --json` (set on the child via `.env()`) → stdout still exactly one object, trace lines on stderr only; **env isolation without `set_var`** [b-T7]: `common::cli()` calls `env_clear()` then sets only `PATH`, `HOME`/`XDG_*` (tempdir), `NO_COLOR=1`; the test asserts on the built command: `cli().get_envs()` (assert_cmd 2.2.2 `Command::get_envs`) contains no `GITHUB_TOKEN`/`GH_TOKEN` key with a value and contains `("NO_COLOR", Some("1"))`. The parent process env is never modified.

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the piece** per spec §4.1 and D9/D10/D15, and the base branches. `deny.toml` (cargo-deny 0.20 format): `[bans] deny = [{ crate = "openssl" }, { crate = "openssl-sys" }, { crate = "native-tls" }]`; `[licenses] allow = ["MIT","Apache-2.0","BSD-2-Clause","BSD-3-Clause","ISC","Unicode-3.0","Zlib"]`, `private = { ignore = true }` (the seed crate has no license field); `[sources] unknown-registry = "deny"`, `unknown-git = "deny"`; `[advisories]` configured (checked only in `release.yml`). `turbo.json.jinja` globalDependencies [a6] — `assertSameBranches` compares every branch including `else`, and the rendered output must keep today's two layouts byte-for-byte (both pass `format:check` in dogfood today; a single shared multi-line suffix would change the no-Rust layout), so use two constructs (this replaces the pre-flight's single Cargo-suffix chain, which cannot produce both layouts):
  ```
  {# same-branches #}{% if "rust-cli" in pieces %}<today's multi-line block>{% elif "rust-tool" in pieces %}<same block>{% endif %}{% if "rust-cli" in pieces %}{% elif "rust-tool" in pieces %}{% else %}
    "globalDependencies": ["vite.config.ts", "tsconfig.base.json"],{% endif %}
  ```
  The second chain is unmarked (empty branches + `else`), inside the subset (no `not`). The render test pins all four outputs.
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check`; dogfood by hand:** render `base rust-cli:cli`, `git init -q && pnpm install --no-frozen-lockfile && cargo generate-lockfile && node scripts/agents-index.mjs && pnpm turbo run lint format:check typecheck test build && node scripts/agents-index.mjs --check` → pass; `node scripts/dogfood.mjs --combo base` and every combo with `rust-tool` → ok. Verify spec §9 item 8 and record results in base §13: (a) `cargo deny --manifest-path Cargo.toml check --config deny.toml bans licenses sources` works from `crates/cli`; (b) `$TURBO_ROOT$` in `inputs`: touch root `Cargo.lock` → `pnpm turbo run test --filter=@hullci/cli-crate` misses cache; (c) a second run is fully cached. Record cold/warm seconds in PROGRESS Measurements.
- [ ] **Step 5: Update base spec** §6 table, new §6.10, §6.1 (Cargo/toolchain/turbo/rust-affected branches), §6.6 pointer, §7 rows (crates with dates, toolchain, cargo-deny), §8.1 (cargo-deny), §8.6 (Renovate groups, native rust-toolchain manager); amend new spec §4.1 table (`run.rs`, plain `tests/common/mod.rs`, `String::replace` snapshot, env assertion via `get_envs`) and the §4.1 base-changes paragraph (turbo two-construct form). PROGRESS line.
- [ ] **Step 6: Commit** — `feat(rust-cli): Rust CLI skeleton with JSON/exit contract, pinned toolchain and cargo-deny`

---

### Task 8: `npm-cli` piece

**Files:**
- Create: `template/pieces/npm-cli/piece.toml` (vars `name` default `cli`, `crate` default `cli`, both `^[a-z][a-z0-9-]*$`; `requires = ["base"]` as the spec says), `files/{package.json.jinja,turbo.json,tsconfig.json,vite.config.ts,bin/launcher.js,scripts/stage.mjs,test/launcher.test.js,test/stage.test.js,test/version-sync.test.js,README.md,AGENTS.md,CLAUDE.md}`
- Modify: `AGENTS.md.jinja`, add-piece skill list, `docs/pieces.md`
- Test: `tests/npm-cli.test.mjs`, `tests/ai-layer.test.mjs` (all-pieces budget)

**Interfaces:**
- Consumes: rust-cli crate `crates/<crate>/Cargo.toml` version and package `@<scope>/<crate>-crate` (Task 7)
- Produces: `bin: { "<crate>": "bin/launcher.js" }`, `hull.release = "npm-cli"`; `scripts/stage.mjs` CLI `node scripts/stage.mjs --artifacts <dir> [--out dist-npm]` (artifacts named `<target>/<bin>[.exe]`), exported `stage({ pkgDir, artifactsDir, outDir, repository }): string[]` (written package dirs); platform map `{ "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl", "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin", "win32-x64": "x86_64-pc-windows-msvc" }` exported as `TARGETS` (used by Task 9; the single source of the platform list [a15]); env override `<BIN>_BINARY` where `<BIN>` = `bin.toUpperCase().replaceAll("-", "_")` (`my-cli` → `MY_CLI_BINARY`) [N-T8].

- [ ] **Step 1: Write failing hull tests:** manifest; classes (`package.json` shared json; `bin/**`, `scripts/**`, `test/**`, configs, `AGENTS.md` owned; `README.md`, `CLAUDE.md` seed); rendered package.json has no `optionalDependencies`, `repository`, `scripts.postinstall`, `scripts.preinstall`; `Object.keys(scripts)` deep-equals `["lint","format:check","typecheck","test"]` [R-T8]; `bin` key equals the `crate` var (render `["base", "rust-cli:mytool", "npm-cli:mynpm"]` with vars `{ scope: "acme", "npm-cli.crate": "mytool" }`, the var-key form of `tauri-app.test.mjs`); devDependency `"@acme/mytool-crate": "workspace:*"`; `files` = `["bin"]`; `publishConfig.provenance === true`; turbo.json `tasks.test.dependsOn` and `tasks.typecheck.dependsOn` both deep-equal `[]` [a13] (a launcher-only PR never builds the crate); `AGENTS.md` and `README.md` both match `/needs a rust-cli instance named `<crate>`/` (rendered with the crate name) [a13]; launcher has `// @ts-check`, no `.jinja`, no `https:`/`fetch(`/`postinstall`; `assertInstanceNotes`. **All-pieces budget** (Review Focus 5): render `base` + every piece (preact-app:web, ui-storybook, astro-site:site, hono-worker:api, rust-tool:tool, tauri-app:desktop, docs, ts-lib:lib, rust-cli:cli, npm-cli:npm with `{ "npm-cli.crate": "cli" }`) → `lineCount(AGENTS.md) + lineCount(CLAUDE.md) <= 80`, `Buffer.byteLength(buildIndex(dir)) <= 8192`.
  Generated tests (vitest, run by dogfood) read scope, name and bin from the package's own `package.json` at run time, never a literal `@hullci/…` [R-T8]: `launcher.test.js` — fake `@<scope>/<name>-<platform>-<arch>` in a temp `node_modules` with a tiny executable Node script: exit code 7 forwarded, stdout/stderr inherited, `<BIN>_BINARY` env override used (name computed by the rule above, passed via `spawnSync` `env`), unsupported platform → exit 3 and one stderr line naming the platform and `cargo install`; `stage.test.js` — five platform packages + launcher, names `@<scope>/<name>-linux-x64` …, `os`/`cpu` set, exact-version `optionalDependencies` on the launcher, no `scripts`, `repository.url` from `GITHUB_REPOSITORY`, missing artifact or launcher version ≠ crate version → throws; `version-sync.test.js` — package.json version equals `../../crates/<crate>/Cargo.toml` version, message names both files and, when the Cargo.toml is missing, says "needs a rust-cli instance named `<crate>`".
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the piece** per spec §4.2 (launcher resolves `createRequire(import.meta.url).resolve(pkg + "/package.json")`, `spawnSync` with `stdio: "inherit"`, re-raises the child's signal).
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check`; dogfood by hand** `base rust-cli:cli npm-cli:cli`: all CI tasks pass including generated launcher/stage/version-sync tests and `tsc --noEmit` with `checkJs` under TS 7 (spec §9 item 8; if `checkJs` fails on TS 7, record the error and switch `typecheck` to `node --check bin/launcher.js scripts/stage.mjs`, noting it in the spec). `turbo run test --filter=@hullci/cli --affected` after a crate-only change includes the npm-cli package; `turbo run typecheck --filter=@hullci/cli --dry=json` lists no crate task.
- [ ] **Step 5: Update base spec** §5 (var `crate`), §6 table, new §6.11; amend new spec §4 intro [c5]: "Every task the CI runs exists as a package script, except npm-cli `build` (nothing to build; staging runs in `release.yml`)" and §4.2 (`typecheck.dependsOn = []`, `<BIN>_BINARY` rule). PROGRESS line, plus a Blocked/decision line for the user: "npm-cli `requires = ["base"]` → raise to `["base","rust-cli"]`? (follow-up decision; today the AGENTS/README sentence and version-sync message explain it)".
- [ ] **Step 6: Commit** — `feat(npm-cli): npm launcher and platform packages for a rust-cli binary`

---

### Task 9: Tag-driven release workflow

**Files:**
- Create: `template/pieces/base/files/.github/workflows/release.yml`, `.github/scripts/release-plan.mjs`, `tests/fixtures/release/{cli-pair,cli-renamed,lib,mismatch,two-primaries,other-bin,npm-only}/**` (JSON/TOML kept oxfmt-clean)
- Rename: `template/pieces/base/files/docs/agents/project.md` → `project.md.jinja` (still seed): adds a `## Blocked` section via a `{# same-branches #}` chain on `npm-cli` / `ts-lib` listing the human steps (first publish of each new npm name; npm trusted publisher for repo + `release.yml` + environment `release` on the launcher and all five platform packages / the library — the configuration must see its first publish within 2 days; create the `release` environment with a tag rule)
- Modify: `template/pieces/base/piece.toml` (owned + `release.yml`, `release-plan.mjs`); the same human steps, compressed, in `template/pieces/npm-cli/files/AGENTS.md` and `template/pieces/ts-lib/files/AGENTS.md` (owned, so a later `splice add` still shows them; each stays ≤ 20 lines) [R-T9]; `docs/pieces.md`
- Test: `tests/release.test.mjs`, `tests/parity.test.mjs` (cargo-deny pin), `tests/npm-cli.test.mjs`, `tests/ts-lib.test.mjs`

**Interfaces:**
- Consumes: `hull.release` fields (Tasks 6–8), `TARGETS` and `stage.mjs` CLI (Task 8)
- Produces: `export const TAG_RE = /^(.+)-v(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/` (instance names may contain hyphens) [a14]; `export function plan(tag: string, fs: { read(rel: string): string | null, list(rel: string): string[] }): { kind: "rust-cli" | "ts-lib", dir: string, package: string, bin: string, version: string, npm_dirs: string[] }` (`package` = Cargo package name for `cargo build -p`, fix round 1), throws `Error` with the reason; CLI reads `GITHUB_REF_NAME`, prints `kind=…`, `dir=…`, `package=…`, `bin=…`, `version=…`, `npm_dirs=<json>` lines, exit 1 on error.
- Pairing rule [a14] (amend new spec §4.4): candidates are `crates/<instance>` and `packages/<instance>` with a `hull.release` field. The **primary** is the one `rust-cli` or `ts-lib` candidate. For a `rust-cli` primary, its companions are **all** `npm-cli` packages under `packages/*` (any dir name) whose `bin` key equals the crate's binary name. Errors: two primaries → "ambiguous: <dir>, <dir>"; an `npm-cli` candidate whose `bin` is not the primary's → "ambiguous"; only an `npm-cli` candidate → "push <crate>-v<version>"; no candidate or tag not matching `TAG_RE` → "unknown tag".

- [ ] **Step 1: Write failing tests:**

```js
test("cli-v1.2.0 with crates/cli + packages/cli (bin cli) → rust-cli, npm_dirs [packages/cli]", ...);   // fixture cli-pair
test("renamed companion packages/npm (bin cli) is paired → npm_dirs [packages/npm]", ...);               // fixture cli-renamed
test("lib-v0.3.0 → ts-lib at packages/lib, npm_dirs [packages/lib]", ...);
test("my-tool-v1.0.0-rc.1 → instance my-tool, version 1.0.0-rc.1", ...);                                // TAG_RE
test("tag version ≠ Cargo.toml / package.json version → throws naming both", ...);
test("unknown tag shape (v1.2.0, cli-1.2, cli-vx) → throws 'unknown tag'", ...);
test("tag naming only an npm-cli package → throws 'push <crate>-v<version>'", ...);                      // fixture npm-only
test("two primaries for one instance (crates/x rust-cli + packages/x ts-lib) → throws 'ambiguous'", ...);// two-primaries
test("npm-cli candidate with another bin → throws 'ambiguous'", ...);                                    // other-bin
test("release.yml: on.push.tags deep-equals ['*-v[0-9]*'] only; top-level permissions {contents: read}", ...);
test("jobs plan/binaries/github-release/npm; id-token: write only on github-release and npm", ...);
test("npm job: environment release; every npm publish has --provenance --access public and a 'npm view' skip", ...);
test("no NPM_TOKEN, NODE_AUTH_TOKEN or secrets.* npm token anywhere", ...);
test("binaries matrix targets deep-equal Object.values(TARGETS); runners ubuntu-latest, ubuntu-24.04-arm, macos-latest (both darwin), windows-latest", ...);
test("plan job runs cargo deny check advisories only for rust-cli", ...);
test("rendered base tree contains .github/workflows/release.yml, the file the guard's publish reason names", ...); // [a3]
test("project.md renders the Blocked section only with npm-cli or ts-lib; branches identical", ...);
test("npm-cli and ts-lib AGENTS.md name the trusted-publisher and first-publish steps, ≤ 20 lines", ...);
test("cargo-deny pin equal in template ci.yml, release.yml and the renovate regex", ...);                 // parity, extended [a9]
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement** per spec §4.4 with the pairing rule above (concurrency `release-${{ github.ref }}`, no cancel; `setup-node` `node-version: 24` so npm ≥ 11.5.1; `registry-url` injects a placeholder `NODE_AUTH_TOKEN` at run time only — the textual test stays green [N-T9]; ts-lib path: `pnpm install --frozen-lockfile`, `pnpm turbo run build test --filter <pkg>`, `npm pkg set repository.url=…`, `pnpm pack`, `npm publish <tgz> --provenance --access public`).
- [ ] **Step 4: Run `pnpm docs:pieces && pnpm test && pnpm lint && pnpm format:check`; `actionlint` on the rendered `release.yml`** (as for hull's ci.yml in PROGRESS) → clean; dogfood all PR combos. Real release runs need a registry: put under PROGRESS Blocked "first real release of a keelstackhq tool: verify `npm publish <pnpm-pack tgz> --provenance`, private-repo behaviour (npm generates no provenance for private repos; artifact attestations need a public repo or GitHub Enterprise Cloud), `ubuntu-24.04-arm`, `macos-latest` cross-building `x86_64-apple-darwin`".
- [ ] **Step 5: Update base spec** new §8.7, §6.1 (`release.yml`, `release-plan.mjs`, project.md Blocked; a seed, so it appears only on `new`, which is why the owned `AGENTS.md` files carry the steps too), §7 rows (actions, npm via Node 24); amend new spec §4.4 (pairing rule, `TAG_RE`). PROGRESS line + Blocked entries.
- [ ] **Step 6: Commit** — `feat(base): tag-driven release workflow with npm trusted publishing and provenance`

---

### Task 10: Dogfood combos `cli` and `lib` in hull CI

**Files:**
- Modify: `scripts/combos.json` (+ `{ "name": "cli", "pieces": ["base", "rust-cli:cli", "npm-cli:cli"] }`, `{ "name": "lib", "pieces": ["base", "ts-lib:lib"] }`), `scripts/dogfood.mjs` (`cargo generate-lockfile` post also for rust-cli), `.github/workflows/ci.yml` (hull: the `node -e` Rust condition matches `rust-tool` or `rust-cli`; `tool: cargo-nextest,cargo-deny@0.20.2`; new step `Swatinem/rust-cache@v2` with `if: steps.rust.outputs.needed == 'true'` and `workspaces: ${{ runner.temp }}/combos/cli -> target` [a16])
- Test: `tests/affected-combos.test.mjs`, `tests/dogfood.test.mjs`, `tests/parity.test.mjs`, `tests/hull-workflows.test.mjs`

**Interfaces:**
- Consumes: pieces from Tasks 6–8, `comboSteps` (Task 3)
- Produces: combo names `cli`, `lib`.

- [ ] **Step 1: Write failing tests:** `affectedCombos(["template/pieces/rust-cli/files/x"])` deep-equals `["cli"]`; `npm-cli` → `["cli"]`; `ts-lib` → `["lib"]`; `base/files/.github/workflows/release.yml` → all combo names; "every combo renders" picks up the new ones; `comboSteps` for `cli` includes `cargo generate-lockfile` before turbo (parity case next to the existing `rust-tool` case [a8]); hull ci.yml: run the Rust condition's `node -e` script with combos `["cli"]`, `["tool"]` (rust-tool) → exit 0, `["web"]` → exit 1 [b-T10]; tool list contains `cargo-deny@0.20.2`; a `Swatinem/rust-cache@v2` step guarded by `steps.rust.outputs.needed`; cargo-deny parity test extended to hull `ci.yml` [a9].
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check`; `node scripts/dogfood.mjs --combo base --combo web --combo site --combo docs --combo cli --combo lib`** twice with the same `--cache-dir` (cold, warm) → all ok; record per-combo seconds in PROGRESS Measurements. After push, read the hull `ci` job time of the PR (cold, then warm on a re-run) against the documented 120 s warm budget; if warm exceeds it, record the new expected hull budget in base spec §10.2.
- [ ] **Step 5: Update base spec** §10.1 (combos), §10.2 (Rust setup condition, rust-cache, cargo-deny, budget note); PROGRESS line.
- [ ] **Step 6: Commit** — `ci: dogfood cli and lib combos`

---

### Task 11: Spec, hull CLAUDE.md, README and status

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-hull-design.md` (§12 tests, §13 unverified/verified items from Tasks 4–9, header line "amended by 2026-10-17 agent-layer spec"), `docs/superpowers/specs/2026-10-17-hull-agent-layer-and-skeletons-design.md` (Status: approved, implemented by plan 04; §10 choices filled with the user decisions; check that the amendments from Tasks 1–9 are present), `CLAUDE.md` (hull), `README.md` (hull) [a17], `docs/PROGRESS.md` (Status section)

- [ ] **Step 1: Coverage check:** walk new-spec §7's list; for each item `grep -n` the base spec and confirm the change landed (Tasks 1–10). Any gap → fix here.
- [ ] **Step 2: Hull `CLAUDE.md`:** rule "Generated `CLAUDE.md` ≤ 80 lines. Per-instance notes go in `<target>/CLAUDE.md`." → "Generated `AGENTS.md` + `CLAUDE.md` ≤ 80 lines (AGENTS ≤ 60, CLAUDE ≤ 20). Per-instance notes: `<target>/AGENTS.md` owned, `<target>/CLAUDE.md` seed."; fold `rust-cli, npm-cli, ts-lib` into the existing Layout pieces line, and mention the module-tested files (`guard.mjs`, `agents-index.mjs`, `release-plan.mjs`) on the existing `tests/` Layout line instead of a new line [N-T11]. `wc -l CLAUDE.md` within ±3 of 100 (today's count).
- [ ] **Step 3: Hull `README.md`** [a17]: pieces table gains rows `rust-cli`, `npm-cli`, `ts-lib`; "Built for Claude Code" says `AGENTS.md` canonical + thin `CLAUDE.md`, `Explore` haiku (not `explorer`), the guard hook and the docs index; quick start adds "after rendering, run `node scripts/agents-index.mjs`" (the dev renderer runs no `[[post]]`) [a5].
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check`** — PASS (docs-only; `node scripts/affected-combos.mjs` selects none).
- [ ] **Step 5: PROGRESS:** Done line; Status section gains milestone 4 summary and the open items (cli CI timing until Task 12 lands, release Blocked items, npm-cli `requires` decision).
- [ ] **Step 6: Commit** — `docs: amend hull spec and CLAUDE.md for agent layer v2 and skeleton pieces`

---

### Task 12: Measure the `cli` combo's CI time (spec §8)

Rule R-12 (binding ruling 2026-10-17): the canary is the dedicated repo **`keelstackhq/cli-canary`**, never `keelstackhq/example-app` (the `web` canary: "holds no product code", and `ci-timing.mjs` reads every `pull_request` run of a repo, so Rust runs would mix into its history).

**Files:**
- Modify: `docs/PROGRESS.md` (Measurements; Blocked if no canary), `docs/superpowers/specs/2026-10-14-hull-design.md` §8.4 (result line)

- [ ] **Step 1: Local numbers:** from Task 10 (cold/warm dogfood `cli`) — already recorded; note that they are container timings, not runner evidence.
- [ ] **Step 2: Precondition.** Call `add_repo` (owner `keelstackhq`, repo `cli-canary`, access `push`) once; do not pre-check with `gh`/`git ls-remote`. **If it is refused or the repo does not exist:** add exactly one line under PROGRESS Blocked — "Task 12 cli canary: create an empty private repo `keelstackhq/cli-canary` (no README), then attach it to the agent session with push access (`add_repo` keelstackhq/cli-canary, access push); Task 12 then runs from Step 3." — commit it as Step 6 and **stop** (skip Steps 3–5).
- [ ] **Step 3: Set up the canary** (once attached): render `node scripts/render.mjs new --template template --out <dir> --piece base --piece rust-cli:cli --piece npm-cli:cli --data scope=keelstackhq --json`; then, because the dev renderer runs no posts and CI uses `--frozen-lockfile`/`--locked` [b-T12]: `git init -q && pnpm install --no-frozen-lockfile && cargo generate-lockfile && node scripts/agents-index.mjs && pnpm run ci && node scripts/agents-index.mjs --check` → green locally. Write `docs/agents/project.md` in the example-app layout (Source = hull commit + render command, Budget, Steps, Progress, Blocked). Commit the rendered tree (with `pnpm-lock.yaml`, `Cargo.lock`, the index) once, push `main`; record the cold `main` run separately. Warm-up: re-run the `main` workflow once (no-op) so rust-cache and turbo cache exist for PRs (PR caches read from the default branch).
- [ ] **Step 4: Measure** three PRs, each a one-line comment change, each merged never (close after green so canary `main` stays equal to the rendered tree): (1) `crates/cli/src/cli.rs` (crate + companion npm-cli affected, the worst case), (2) `packages/cli/bin/launcher.js` (npm-cli only), (3) docs-only. Then `node scripts/ci-timing.mjs --repo keelstackhq/cli-canary --budget 45 --limit 20` → record n / p50 / p90 (n = 3 `pull_request` runs, so p50 is the middle PR) and each PR's warm `ci` job seconds by type. Budgets: 45 s applies to PR (2), 15 s to PR (3); PR (1) is reported as the worst case.
- [ ] **Step 5: Decide:** PR (2) ≤ 45 s and PR (3) ≤ 15 s → done. Over budget → change nothing silently (spec §8): write the numbers and the first lever (Rust `typecheck` as a no-op, which needs a parity exception and a spec change) under PROGRESS Blocked as a decision for the user.
- [ ] **Step 6: Commit** — `docs: record cli combo CI timing against the 45 s budget` (or, after Step 2 stopped, the same message with only the Blocked line).

---

## Milestone 4 done when

Tasks 1–11 checked; Task 12 measured or Blocked with the exact human action; dogfood passes for `base`, `web`, `site`, `docs`, `cli`, `lib`; superpowers:requesting-code-review on the branch recorded in `docs/PROGRESS.md`.

## Risks (from spec §9, after the 2026-10-17 checks)

- Hook `ask` under `-p`/headless becomes a denial: owned-file edits by unattended agents (e.g. `/loop`, CI fixers) stop at that point — intended; `AGENTS.md` says it (Task 4).
- The owned-edit rule stays off until splice writes `.splice/lock.toml` (dev-renderer repos example-app, keelstack have none).
- A missing `@docs/agents/index.md` import before the first index run: behaviour not documented; checked by hand in Task 4 (spec §9 item 3).
- Private repos: npm provenance is not generated and artifact attestations need a public repo or Enterprise Cloud; keelstackhq repos are private today, so the first real release may fail on `--provenance`/attest. Verified only at first real release (Blocked).
- npm trusted publishing needs the package to exist first (human first publish) and a new trusted-publisher config expires after 2 days without a publish.
- npm-cli with `requires = ["base"]` can be added without its rust-cli instance; `pnpm install` then fails on the `workspace:*` crate dependency. Mitigated by AGENTS/README text and the version-sync message; `requires` change is a user decision (Task 8).
- rust-cli cold CI exceeds 45 s by design; only warm is budgeted (Task 12). Hull CI compiles the `cli` combo on every `base` change; rust-cache (Task 10) keeps warm runs near today's budget.
- `rust-toolchain.toml` pinned to 1.99.1 while hull CI installs `stable`: once stable moves past 1.99.1, rustup downloads the pin in each `cli` dogfood run (~10–20 s) until Renovate bumps the template; watch hull CI time.
