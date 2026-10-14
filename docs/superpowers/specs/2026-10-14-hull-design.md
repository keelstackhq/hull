# hull — design

Date: 2026-10-14 · Status: approved for build · Org `keelstack`, repo `keelstack/hull`

hull is an opinionated, AI-native monorepo template. It owns structure, stack, tool versions and
config, never app logic. Consumers render it with `splice` (`keelstack/splice`, Rust) from
`gh:keelstack/hull//template`. Public product, private use first.

This document is the source of truth. The template layout follows the shared contract
`docs/template-format.md` (format 1) exactly; where the contract is silent, §4.3 says what hull does.

## 1. Goals and non-goals

Goals:
1. Bootstrap a repo by choosing pieces: `splice new gh:keelstack/hull//template my-repo`.
2. Keep generated repos current: owned files are replaced, shared files merged, seed files never touched.
3. CI in seconds: ≤ 45 s for a typical PR, ≤ 15 s for a docs-only PR, on GitHub's own runners.
4. AI-native for Claude Code first: lean CLAUDE.md, subagents with fixed models, skills, loops, hooks.
5. hull's own CI is fast and dogfoods the template by rendering piece combinations and running their checks.

Non-goals (v1): app logic, a hosted service, custom runners (documented only, §8.5), Playwright or
visual tests on the PR path, React (Preact only), Cloudflare Pages, our own remote cache (that is `hoard`).

## 2. Names, versions, distribution

- Template source: `gh:keelstack/hull//template`. A template version is a git tag `v<semver>` on hull.
- `template/splice.toml`: `format = 1`, `name = "hull"`, `min_splice = "0.1.0"`, `base = "base"`.
- First release `v0.1.0` after milestone 3. Breaking template changes bump the minor until 1.0 and
  ship a migration (`template/migrations/<semver>.toml`) when files move or disappear.
- License MIT.

## 3. hull repository layout

```
template/
  splice.toml
  pieces/<id>/piece.toml
  pieces/<id>/files/...
  migrations/                  # empty in v0.1 (.gitkeep)
scripts/
  render.mjs                   # dev renderer CLI (§9)
  lib/errors.mjs manifest.mjs subset.mjs ownership.mjs plan.mjs render-file.mjs ci-tasks.mjs
  combos.json                  # piece combinations hull CI renders (§10)
  dogfood.mjs                  # render combos and run their CI steps
  affected-combos.mjs          # which combos a diff touches
  check-single-vite.mjs        # lockfile has exactly one vite (§7.2)
  ci-timing.mjs                # job durations vs budget (§8.4)
  pieces-doc.mjs               # docs/pieces.md from piece.toml files
renovate/default.json          # the keelstack Renovate preset generated repos extend
community-packs/<tool>/        # recipes for community docspacks (§6.8)
tests/*.test.mjs               # node:test; fixtures under tests/fixtures/
.github/workflows/ci.yml       # hull's own CI (§10)
.github/workflows/desktop.yml  # scheduled + manual tauri-app build (§10.3)
docs/                          # this spec, plans, template-format.md, pieces.md, PROGRESS.md
CLAUDE.md  .claude/            # for building hull
```

hull's own toolchain: Node 24, pnpm 12.11.2, `node:test`, `vite-plus` for `vp lint` and `vp fmt`
on `scripts/` and `tests/`. Runtime deps of the dev renderer: `nunjucks` 3.2.4, `smol-toml` 1.9.1,
`picomatch` 4.0.7, `yaml` 2.9.1 (tests). Nothing else without asking.

## 4. Template contract conformance

### 4.1 Rules hull follows

- Every piece directory has `piece.toml` and `files/`; `id` equals the directory name.
- Only `.jinja` files are rendered; everything else (icons) is copied byte for byte.
- `.jinja` files use only the contract's subset (contract §4 and §9). Conditions test only
  `var` or `"id" in pieces` (§9.2); `{% if pieces %}` is rejected; dotted access is limited to
  `piece.id`, `piece.name`, `template.name`, `template.version` (§9.3); no whitespace control
  (`{%-`, `-%}`), no `set`, no comparisons, no `not`/`and`/`or`, no filters other than
  `lower`/`upper`. The dev renderer and the invariant tests both enforce this.
- Final newline kept exactly as in the source; no auto-escaping (§9.4). All vars are strings.
- `pieces` = unique ids in add order; a `multiple = false` piece has `name` = its `id` (§9.5).
- Every path under `files/` matches the ownership globs of at most one class, so "first match
  wins" never decides anything (invariant test). Files matching no glob are `owned` by contract;
  hull lists every class explicitly anyway, except owned files may rely on the default.
- `[merge]` keys only name shared files.
- No `{{ }}` in paths under `files/`; pieces with instances use `target = "<dir>/{{ name }}"`.

### 4.2 Ownership policy

| Class | What | Examples |
|---|---|---|
| `owned` | configs, workflows, AI layer, hull glue code | `vite.config.ts`, `tsconfig.json`, `.github/workflows/*`, `.claude/**`, `CLAUDE.md`, `renovate.json` |
| `shared` | files both sides edit | root and package `package.json` (json), `turbo.json` (json), `pnpm-workspace.yaml` (yaml), crate `Cargo.toml` (toml), `tauri.conf.json` (json), `wrangler.jsonc` (text: has comments), `docs/packs.json` (json) |
| `seed` | app source, user docs | `src/**`, `index.html`, `README.md`, `docs/agents/project.md`, stories, tests |

The AI layer is owned. Project-specific notes for agents go in the seed file
`docs/agents/project.md`, which `CLAUDE.md` imports. Personal settings go in
`.claude/settings.local.json` (gitignored).

### 4.3 Where the contract was silent

Contract §9.10–§9.14 have since settled items 1, 2, 5, 6 and 7 below in the way hull assumed: glob precedence, re-render on `add`, strict undefined variables, no file modes, no `or`, and the minimal CLI with `--data`. If this section and the contract differ, the contract wins.

Contract §9 settled glob matching, conditions, whitespace, the `pieces` list and exit codes.
The items below are the gaps as hull first found them.

1. **Root files that depend on other pieces.** A piece with `target` cannot write root files, so
   `base` writes every root file and uses `{% if "<id>" in pieces %}`. This requires that `add`
   re-renders `base` (and every piece) with the new `pieces` list. hull assumes it does.
2. **No boolean operators (contract §9.2 forbids them).** Where a file is needed for any of
   several pieces (preview workflow, root `Cargo.toml`), hull uses an `if/elif` chain marked
   `{# same-branches #}` whose branches are byte-identical; a test checks that they stay identical.
   Proposed future contract addition: `or`.
3. **Instance names are not in `pieces`.** Root files never list instances by name; they use globs
   (`apps/*`, `crates/*`) and turbo `--affected`. Per-instance agent notes live in
   `<target>/CLAUDE.md`, which Claude Code loads on demand when it works in that directory.
4. **Lines holding only a block tag.** Settled: final newline kept, no trim/lstrip (§9.4). Such
   lines therefore leave an empty line in both engines; dogfood runs `vp fmt --check` on generated
   files, so a stray blank line that matters is caught.
5. **Undefined variables.** The dev renderer throws on an undefined variable (typos are template
   errors, exit 3). hull's templates never rely on undefined-is-empty.
6. **File modes.** The contract does not carry the executable bit. Hook scripts are invoked as
   `bash <path>`, so they never need it.
7. **Non-interactive `new`.** The contract has no CLI. hull assumes
   `splice new <source> <dest> --piece <id>[:<name>]... --data <key>=<value>... --yes --json`
   and adapts in plan 03 when splice publishes its CLI.
8. **Literal `{{` in `.jinja` output.** GitHub Actions expressions (`${{ … }}`) collide with the
   subset, which has no `{% raw %}` and no string-literal output. Workflows without piece
   conditions are plain files (`ci.yml`). Piece-dependent workflows need a contract addition
   (proposed: `{% raw %}…{% endraw %}` in §4) or a runtime guard instead of a template condition.
   Raised with keelstack/splice (Blocked in `docs/PROGRESS.md`).

## 5. Template variables

`template/splice.toml`:

```toml
[vars]
scope = { prompt = "npm scope without @", default = "acme", pattern = "^[a-z0-9-]+$" }
```

Piece variables: `name` for every multiple piece (pattern `^[a-z][a-z0-9-]*$`), plus `frontend`
for `tauri-app` (§6.7). No other variables in v1; Cloudflare account, Sentry DSN and Axiom are
repo secrets or wrangler vars, not template vars.

## 6. Pieces

| id | multiple | target | requires | default name |
|---|---|---|---|---|
| `base` | no | — (root) | — | — |
| `preact-app` | yes | `apps/{{ name }}` | base | `web` |
| `ui-storybook` | no | `packages/ui` | base | — |
| `astro-site` | yes | `apps/{{ name }}` | base | `site` |
| `hono-worker` | yes | `apps/{{ name }}` | base | `api` |
| `rust-tool` | yes | `crates/{{ name }}` | base | `tool` |
| `tauri-app` | yes | `apps/{{ name }}` | base, preact-app | `desktop` |
| `docs` | no | — (root) | base | — |

Every JS package has the scripts the CI runs: `lint`, `format:check`, `typecheck`, `test`, `build`
(a missing script is skipped by turbo). Package names are `@{{ scope }}/{{ name }}`.

### 6.1 `base`

Root files (class in brackets):

- `package.json.jinja` [shared, json]: `"name": "{{ scope }}"`, `private`, `packageManager:
  "pnpm@12.11.2"`, scripts `ci` = `turbo run lint format:check typecheck test build --affected`,
  `check` = `turbo run lint format:check typecheck test`, `build`, `test`, `lint`, `format` (`vp fmt`),
  `format:check`, `typecheck`; devDependencies `turbo`, `vite-plus`, `typescript` (all `catalog:`),
  plus `docspack` when `"docs" in pieces`.
- `pnpm-workspace.yaml` [shared, yaml]: `packages: [apps/*, packages/*, crates/*]`; `catalog:`
  with every version in §7 (unused entries are harmless, so the file does not depend on pieces);
  `overrides: { vite: "npm:@voidzero-dev/vite-plus-core@<vite-plus version>" }`;
  `peerDependencyRules.allowedVersions: { "storybook>vite-plus": "1" }` (§7.2);
  `allowBuilds: { esbuild: true, workerd: true, sharp: true }` (pnpm 11 replaced
  `onlyBuiltDependencies`, which pnpm 12 silently ignores); `minimumReleaseAge: 4320` (minutes,
  strict when set); `minimumReleaseAgeExclude` lists catalog pins younger than 3 days at render
  time (turbo 2.11.8 today), each with a comment to drop it once the pin has aged. Checked against
  pnpm 12.11.2 on 2026-10-14.
- `turbo.json` [shared, json]: tasks `build` (`dependsOn: ["^build"]`, outputs `dist/**`), `lint`, `format:check`, `typecheck`
  (`dependsOn: ["^build"]`), `test` (`dependsOn: ["^build"]`), `dev` (`persistent`, no cache),
  `deploy:preview` and `deploy` (no cache), `storybook:build` (outputs `storybook-static/**`),
  `build:desktop` (no cache). No `vp run` cache anywhere (Turbo caches, §7.1).
- `tsconfig.base.json` [owned]: strict, `module: preserve`, `moduleResolution: bundler`,
  `jsx: react-jsx`, `jsxImportSource: preact`, `noEmit`, `verbatimModuleSyntax`, `isolatedModules`.
- `vite.config.ts` [owned]: root Vite+ config holding the shared `lint` and `fmt` options
  (oxlint categories `correctness` + `suspicious` as errors; ignore `dist`, `.astro`,
  `storybook-static`, `target`). Vite+ 1.1.0 does not apply nested configs for lint/fmt: `vp lint`
  and `vp fmt` read the root config even when run from a package, so package `vite.config.ts`
  files hold only `pack`/`test` options. Root `vite.config.ts` and `tsconfig.base.json` are turbo
  `globalDependencies`, and a root `//#format:check` task checks root files (checked 2026-10-14).
- `.node-version` [owned] `24`; `.gitignore` [owned] (node_modules, dist, .turbo, .astro,
  .wrangler, target, storybook-static, `.claude/settings.local.json`, `.docspack`);
  `.gitattributes` [owned] `* text=auto eol=lf`.
- `renovate.json` [owned]: `{"extends": ["github>keelstack/hull//renovate/default"]}` (§8.6).
- `.github/workflows/ci.yml` [owned] (§8.1), `preview.yml.jinja` [owned] (§8.2),
  `desktop.yml.jinja` [owned] (§8.3). The contract subset cannot emit GitHub's `${{ … }}` from a
  `.jinja` file (no `{% raw %}`, no string literals), so a workflow is a plain file unless it needs
  piece conditions; see §4.3 item 8.
- `Cargo.toml.jinja` [owned] root virtual workspace, rendered only for rust-tool or tauri-app:
  `resolver = "3"`, `members = ["crates/*", "apps/*/src-tauri"]`, `[workspace.lints]`,
  `[profile.release] lto = "thin"`. `rust-toolchain.toml.jinja` [owned], same condition, `stable`
  with `clippy`, `rustfmt`.
- `packages/shared/` [configs owned, `package.json` shared json, `src/**` seed]: a tiny library built with `vp pack`, so a
  base-only repo runs every CI task.
- `README.md.jinja` [seed], `docs/agents/project.md` [seed].
- AI layer, §6.9.

### 6.2 `preact-app`

`package.json.jinja` [shared, json] scripts: `dev` `vp dev`, `build` `vp build`, `lint` `vp lint`,
`format:check` `vp fmt --check`, `typecheck` `tsc --noEmit`, `test` `vp test`, `preview` `vp preview`,
`deploy:preview` `wrangler versions upload --preview-alias pr-$PR_NUMBER`, `deploy` `wrangler deploy`.
Dependencies: `preact`, cascivo (below); dev: `@preact/preset-vite`, `vite-plus`, `typescript`,
`wrangler`. `vite.config.ts` [owned] with `@preact/preset-vite`; `tsconfig.json` [owned] extends
`../../tsconfig.base.json`; `wrangler.jsonc` [shared, text]: static assets from `./dist`,
`not_found_handling: "single-page-application"`, `observability.enabled: true`;
`index.html`, `src/main.tsx`, `src/app.tsx`, `src/app.test.tsx` [seed]; `CLAUDE.md` [owned].

cascivo: the app uses the prebuilt components `@cascivo/react` 1.9.0 and `@cascivo/themes` 1.0.3
through `preact/compat` (the Preact preset aliases `react` to `preact/compat`). To verify in the
task with `npm view` and the cascivo docs (`@cascivo/docspack`): that these are the right packages
for Preact, and whether the `cascivo` CLI (copy-in components) should be the default instead.
`npm view` on 2026-10-14: `cascivo` 1.8.0 is the CLI (`init/add/list/update`); `@cascivo/core`
1.9.0 peers on `react >= 18`.

### 6.3 `ui-storybook`

`packages/ui`: a Preact component package on cascivo with Storybook 10.6
(`@storybook/preact-vite`). Scripts: `build` `vp pack`, `lint`, `format:check`, `typecheck`, `test`
`vp test` (unit tests only), `storybook` `storybook dev -p 6006`, `storybook:build` `storybook build`
(not on the PR path). `.storybook/main.ts` [owned], `.storybook/preview.ts` [seed],
`src/button.tsx`, `src/button.stories.tsx`, `src/button.test.tsx` [seed].

### 6.4 `astro-site`

Astro 7 static site with `@astrojs/preact`. Scripts: `dev` `astro dev`, `build` `astro build`,
`lint` `vp lint` (TS/TSX only — oxlint does not lint `.astro` templates), `format:check`
`vp fmt --check` (`.astro` excluded; oxfmt's `.astro` support is experimental and needs
`@astrojs/compiler-rs`, so it stays off in v1), `typecheck` `tsc --noEmit` (`astro check` needs the
TypeScript JS API, which TypeScript 7 does not ship; verify and document), `test` `vp test
--passWithNoTests`, `deploy:preview`, `deploy`. `astro.config.mjs` [owned], `tsconfig.json` [owned],
`wrangler.jsonc` [shared, text] (assets `./dist`), `src/pages/index.astro` [seed], `CLAUDE.md` [owned].
Astro runs through package scripts (`vp run` would add a second cache; not used).

### 6.5 `hono-worker`

Hono on Workers. `wrangler.jsonc` [shared, text]: `main: "src/index.ts"`,
`compatibility_date: "2026-10-01"`, `compatibility_flags: ["nodejs_compat"]`,
`observability: { enabled: true, head_sampling_rate: 1 }`, `vars: { LOG_LEVEL: "info",
SENTRY_DSN: "" }`, and commented lines showing OTel export destinations (Axiom), marked
"verify against Cloudflare docs". Scripts: `dev` `wrangler dev`, `build`
`wrangler deploy --dry-run --outdir dist`, `test` `vp test`, `typecheck` `tsc --noEmit`, `lint`,
`format:check`, `deploy:preview`, `deploy`.

Files: `src/index.ts` [seed] (the app; imports hull glue), `src/hull/logging.ts` [owned],
`src/hull/sentry.ts` [owned], `src/index.test.ts` [seed], `src/hull/logging.test.ts` [owned].

Logging contract (`src/hull/logging.ts`):
- `jsonLogger(): MiddlewareHandler` — use after Hono's `requestId()`. After `await next()` it
  writes exactly one `console.log(JSON.stringify(line))` per request, with
  `line = { level: "info"|"warn"|"error", msg: "request", requestId, method, path, status,
  durationMs, colo?, country? }`; `level` is `error` for status ≥ 500, `warn` for ≥ 400.
  No query string, no headers, no body (no secrets or PII in logs).
- `onErrorHandler(err, c)` — logs `{ level: "error", msg: err.message, requestId, stack }` once
  and returns `500` JSON `{ error: "internal", requestId }`.
- Workers Logs indexes these JSON fields. Optional: OTel export to Axiom (free 500 GB/month),
  configured in the Cloudflare dashboard plus `observability` in `wrangler.jsonc`.
- `src/hull/sentry.ts`: `withOptionalSentry(app)` wraps the app with `@sentry/cloudflare`
  `withSentry` only when `env.SENTRY_DSN` is non-empty; otherwise returns the app unchanged.

Pricing note: Workers Logs free tier becomes 0.5 GB/day from 2026-12-01; the README says how to
lower `head_sampling_rate`.

### 6.6 `rust-tool`

`crates/{{ name }}`: `Cargo.toml.jinja` [shared, toml] (`edition = "2024"`, `[lints] workspace = true`),
`src/main.rs` [seed] with one unit test, `package.json.jinja` [shared, json] whose scripts call
cargo for this crate only: `build` `cargo build --release -p {{ name }}`, `lint`
`cargo clippy -p {{ name }} --all-targets -- -D warnings`, `format:check` `cargo fmt -p {{ name }} --check`,
`test` `cargo nextest run -p {{ name }}`. `turbo.json` [owned] extends `//`: build outputs
`$TURBO_ROOT$/target/release/{{ name }}`, inputs `src/**`, `Cargo.toml`, `$TURBO_ROOT$/Cargo.lock`
(verify the `$TURBO_ROOT$` syntax). `[[post]]` `cargo generate-lockfile` on `new`/`add`.
`CLAUDE.md` [owned].

### 6.7 `tauri-app`

Tauri v2 desktop shell around an existing preact-app instance. Vars: `name` (default `desktop`),
`frontend` (default `web`, must be a preact-app instance; checked by the renderer only as a
pattern). `src-tauri/` is a member of the root Cargo workspace. `tauri.conf.json` [shared, json]:
`build.beforeDevCommand` `pnpm --filter @{{ scope }}/{{ frontend }} dev`, `beforeBuildCommand`
`pnpm --filter @{{ scope }}/{{ frontend }} build`, `devUrl` `http://localhost:5173`,
`frontendDist` `../../{{ frontend }}/dist`. `package.json.jinja` [shared, json]: `tauri` `tauri`,
`build:desktop` `tauri build`, `format:check` `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
(fmt needs no system libraries). No `lint`/`test`/`build` on the PR path: compiling Tauri needs
webkit2gtk, so the Rust build runs only in `desktop.yml`. `src-tauri/Cargo.toml` [shared, toml],
`src-tauri/build.rs` [owned], `src-tauri/src/{main,lib}.rs` [seed], `src-tauri/capabilities/default.json`
[seed], `src-tauri/icons/*` [owned, binary].

### 6.8 `docs` (docspack)

docspack 1.5.0 (verified with `--help` on 2026-10-14): `docspack sync` indexes installed
`@vendor/docspack` and `@docspack-community/<name>` packages; `docspack index --repo` indexes the
repo's own Markdown and code map; `docspack ask "<q>" --json` answers for agents (bounded to
3 chunks / 3000 tokens); `docspack search` is the human view. The brief's `docspack index` and
`search --json` map to these.

Files (root): `docs/packs.json` [shared, json], `docs/agents/docs.md` [owned], and conditional
blocks in base files (`docspack` devDependency, SessionStart sync, `docs-lookup` skill, a CLAUDE.md line).

`docs/packs.json`:

```json
{
  "version": 1,
  "packs": {
    "cascivo": { "package": "@cascivo/docspack", "source": "vendor" },
    "hono": { "package": "@docspack-community/hono", "source": "community", "build": "hono" },
    "cloudflare": { "package": "@docspack-community/cloudflare", "source": "community", "build": "cloudflare" },
    "vite-plus": { "package": "@docspack-community/vite-plus", "source": "community", "recipe": "community-packs/vite-plus" }
  }
}
```

`source` is `vendor` (published by the tool's authors) or `community`. A community entry names
either `build` (a curated source of `docspack build <source>`) or `recipe` (a folder in hull's
`community-packs/`). On 2026-10-14 no `@docspack-community/*` package is published; hull keeps the
recipes, and publishing them is a blocked task (needs the npm scope). `pnpm docs:packs` (script in
the docs piece) prints which listed packs are installed, missing, or unpublished; it never edits
files.

### 6.9 AI layer (owned, in `base`)

- `CLAUDE.md.jinja` ≤ 80 rendered lines for every combo: what the repo is, commands (`pnpm check`,
  `pnpm run ci`; `pnpm ci` is pnpm's built-in clean install), rules (test first, verify before claiming, small files), the subagent routing table,
  one line per present piece kind (`{% if "hono-worker" in pieces %}`), `@docs/agents/project.md`,
  and `@docs/agents/docs.md` when docs is present. Per-instance notes are `<target>/CLAUDE.md`
  (loaded on demand; §4.3.3). `AGENTS.md`: one line pointing to `CLAUDE.md`.
- `.claude/agents/*.md` (frontmatter `name`, `description`, `tools`, `model`):

| Agent | Model | Tools | Use |
|---|---|---|---|
| `explorer` | haiku | Read, Grep, Glob | "Use proactively" for search and reading; returns paths and ≤ 15-line summaries |
| `implementer` | sonnet | Read, Edit, Write, Bash, Grep, Glob | one task, test first, runs `verify` |
| `reviewer` | opus | Read, Grep, Glob, Bash | read-only review against task and CLAUDE.md; never edits |
| `ci-fixer` | sonnet | Read, Edit, Write, Bash, Grep, Glob | reads `gh run view --log-failed`, reproduces, fixes |

  Claude Code has no complexity-based routing; fixed models per agent are the convention, and
  `"model": "opusplan"` in settings is the main-session default (Opus plans, Sonnet executes).
- `.claude/skills/verify/SKILL.md`: run `pnpm turbo run lint format:check typecheck test --affected
  --output-logs=errors-only`, report ≤ 10 lines (pass/fail per task, first error per failure).
- `.claude/skills/add-piece/SKILL.md`: `pnpm dlx @keelstack/splice add <id>[:<name>] --json`,
  read the JSON `changes`, run `[[post]]`-equivalent install, then `verify`.
- `.claude/skills/docs-lookup/SKILL.md` (only with docs): `pnpm exec docspack ask "<q>" --json`
  before any web search; web search only on exit 3/4.
- `.claude/loop.md`: default `/loop` prompt — run `verify`; fix the first failure; repeat until
  green; then stop and summarise in ≤ 5 lines.
- `.claude/hooks/session-start.sh`: `pnpm install --prefer-offline` (quiet), then
  `pnpm exec docspack sync` and `docspack index --repo` if docspack is installed. Exits 0 on any
  failure (never blocks a session), prints one line.
- `.claude/hooks/stop-checks.sh` (opt-in): does nothing unless `HULL_STOP_CHECKS=1`; then runs
  `pnpm turbo run lint typecheck test --affected` and on failure exits 2 with the first error on
  stderr, which blocks stopping. Enable by setting the env var in `.claude/settings.local.json`.
  Exits 0 when the hook input has `stop_hook_active: true` (Claude is already continuing because
  of a stop hook), so it cannot loop.
- `.claude/statusline.sh` (opt-in via `statusLine` in settings.local.json): model, context %, cost,
  read from stdin `model.display_name`, `context_window.used_percentage` (may be null),
  `cost.total_cost_usd` with `jq`; prints a fixed fallback line when `jq` is missing.
- `.claude/settings.json`: `model: "opusplan"`; `permissions.allow` for pnpm, cargo, turbo, git
  read and commit commands, `gh run view`, `docspack`; `deny` force-push (`--force*`, `-f`, `+ref`
  anywhere after `git push`), `pnpm|npm|cargo publish` and reading `.env*` (deny rules match only
  commands starting with the literal program, so `git -C . push -f` is not caught; push is not
  allowed, so it still prompts); hook entries carry `timeout: 120` (seconds);
  `hooks.SessionStart` matcher `startup|resume` → `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"`;
  `hooks.Stop` → stop-checks; `extraKnownMarketplaces` + `enabledPlugins` for superpowers
  (`superpowers@superpowers-marketplace`, repo `obra/superpowers-marketplace`) and caveman
  (`caveman@akramsystems-plugins`, repo `akramsystems/caveman`). Shape checked against
  code.claude.com/docs (settings, hooks, statusline) on 2026-10-14: `enabledPlugins` keys are
  `<plugin>@<marketplace-key>`; repo-level `extraKnownMarketplaces` apply only after the user
  accepts the workspace trust dialog. The marketplace names inside those repos' manifests were not
  checked.

## 7. Versions (template pnpm catalog, exact pins)

Checked with `npm view` on 2026-10-14.

| Package | Pin | Note |
|---|---|---|
| `vite-plus` | 1.1.0 | 1.2.0 published 2026-10-14 09:21 UTC; Renovate bumps it after `minimumReleaseAge` |
| `@voidzero-dev/vite-plus-core` | 1.1.0 | via the `vite` override; always the same version as vite-plus |
| `turbo` | 2.11.8 | |
| `typescript` | 7.0.2 | native compiler, binary `tsc` |
| `preact` | 10.29.8 | 11.0.1 exists, but `@astrojs/preact` peers `^10.6.5` |
| `@preact/preset-vite` | 2.10.6 | |
| `astro` | 7.3.8 | depends on `vite ^8.3.1` |
| `@astrojs/preact` | 6.0.6 | |
| `storybook`, `@storybook/preact-vite`, `@storybook/addon-docs` | 10.6.2 | |
| `hono` | 4.13.13 | |
| `wrangler` | 4.151.0 | |
| `@cloudflare/workers-types` | 5.20261014.1 | |
| `@sentry/cloudflare` | 11.7.0 | |
| `@tauri-apps/cli` | 2.12.2 | `@tauri-apps/api` 2.12.3 |
| `@cascivo/react` / `@cascivo/themes` | 1.9.0 / 1.0.3 | to verify (§6.2) |
| `docspack` | 1.5.0 | |
| pnpm / Node | 12.11.2 / 24 | Node 24 is the active LTS |

### 7.1 Turbo and Vite+

Turbo orchestrates and caches (local + remote). Packages call `vp build/test/lint/fmt/pack`. The
`vp run` cache is never enabled; scripts never call `vp run`. When Vite+ ships remote caching, a
migration may switch; two caches on one task must never happen.

### 7.2 One Vite

The `vite` override makes Astro, Storybook and `@preact/preset-vite` resolve to
`@voidzero-dev/vite-plus-core`. `scripts/check-single-vite.mjs <repo>` reads `pnpm-lock.yaml` and
fails unless (a) no `vite@` package entry exists and (b) exactly one `@voidzero-dev/vite-plus-core@`
version exists. Storybook declares `vite-plus` `^0.1.15 || ^0.2.0` as an optional peer; the
`peerDependencyRules` entry accepts 1.x, and the README says Storybook + Vite+ 1.x is not tested
upstream.

## 8. CI of generated repos

### 8.1 `ci.yml` (one job + `ci-ok`)

- `on: pull_request`, `merge_group`, and `push` to the default branch (only so caches exist on the
  default branch; PR caches are not shared between PRs). No workflow-level `paths` filters.
- `concurrency: { group: ci-${{ github.event.pull_request.number || github.ref }},
  cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`; `permissions: contents: read`.
- Job `ci`, `ubuntu-latest`, `timeout-minutes: 15`, env `TURBO_SCM_BASE`/`TURBO_SCM_HEAD` from
  the PR base sha, `merge_group.base_sha`, or `github.event.before`:
  1. `actions/checkout` with `fetch-depth: 0`, `filter: blob:none`.
  2. Early exit: `npx -y turbo@2.11.8 query affected --tasks lint format:check typecheck test build --exit-code`
     (exit 0 = nothing affected → set `skip=true`; 1 = affected; 2 = error → run everything).
     All later steps have `if: steps.affected.outputs.skip != 'true'`.
  3. `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with
     `node-version-file: .node-version`, `cache: pnpm`.
  4. `pnpm install --frozen-lockfile --prefer-offline`.
  5. Turbo cache: `actions/cache` on `.turbo/cache`, key `turbo-${{ runner.os }}-${{ github.sha }}`,
     restore-keys `turbo-${{ runner.os }}-`. Replaced by `keelstack/hoard@v1` once released.
  6. Rust (rendered only with rust-tool): `.github/scripts/rust-affected.mjs` [owned] reads
     `turbo query affected --packages` JSON and sets `rust=true` when an affected package has a
     `Cargo.toml`; then `dtolnay/rust-toolchain@stable`,
     `Swatinem/rust-cache`, `taiki-e/install-action` (`cargo-nextest`), all `if: rust == 'true'`.
  7. `pnpm turbo run lint format:check typecheck test build --affected --output-logs=errors-only`.
- Job `ci-ok`: `needs: [ci]`, `if: always()`, fails unless `needs.ci.result == 'success'`. It is
  the only required check.
- Actions are pinned by tag in the template; Renovate pins digests (§8.6).
- Not on the PR path: Playwright, Storybook build and visual tests, Tauri builds.

### 8.2 `preview.yml`

Rendered only if hono-worker, astro-site or preact-app is present (§4.3.2). `on: pull_request`;
same checkout/install; step skipped when `secrets.CLOUDFLARE_API_TOKEN` is empty (forks); runs
`pnpm turbo run deploy:preview --affected` with `PR_NUMBER`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`; writes the preview URLs from wrangler's output to the job summary.
Caveats in the README: preview URLs are public unless Cloudflare Access protects them, and do not
work for Workers with Durable Objects.

### 8.3 `desktop.yml`

Rendered only with tauri-app. `workflow_dispatch` + weekly schedule; ubuntu with the Tauri apt
deps (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`); runs
`pnpm turbo run build:desktop`. Release with `tauri-apps/tauri-action` is documented, not wired.

### 8.4 Budget and measurement

Typical PR (1–2 packages, warm caches) ≤ 45 s for job `ci`; docs-only ≤ 15 s (early exit).
Measure with `scripts/ci-timing.mjs` (hull) or by hand:
`gh run list -w ci.yml -L 20 --json databaseId` then `gh run view <id> --json jobs` and
`completedAt − startedAt` of job `ci`. The script reports p50/p90 and exits 1 when p50 exceeds
the budget. A canary repo rendered from the `web` combo is the reference (blocked: needs repo).

### 8.5 Custom runners

Documented only: changing `runs-on` to Blacksmith/Namespace/Depot labels; sticky disks replace the
pnpm store cache. No template option in v1.

### 8.6 Renovate

`renovate/default.json` in hull (preset `github>keelstack/hull//renovate/default`, syntax to
verify): `config:recommended`, `helpers:pinGitHubActionDigests`, `rangeStrategy: pin`,
`minimumReleaseAge: "3 days"`, groups `vite-plus` (`vite-plus` + `@voidzero-dev/vite-plus-core`,
which must move together), `storybook`, `astro`, `tauri`, `cloudflare` (wrangler + workers-types),
`turbo`; automerge for minor/patch and digests with `platformAutomerge`; weekly
`lockFileMaintenance`. Open question: once `splice update` runs as a bot, template-managed catalog
entries move to `ignoreDeps` so Renovate and the template do not both bump them.

## 9. Dev renderer `scripts/render.mjs`

Exists until splice v0.1 renders hull; afterwards it stays as a conformance oracle in tests.

```
node scripts/render.mjs new --template <dir> --out <dir> --piece <id>[:<name>]... \
  --data <key>=<value>... [--data <piece-id>.<key>=<value>...] [--template-version <v>] [--json]
```

- Implements contract §1–§4 and §8 (JSON shape, exit codes), and writes files for `new` only:
  every planned file is created (`action: "create"`, its `class`). No lock file (only splice
  writes it), no `[[post]]`, no `update`/`check`/`add`, no merges, no migrations.
- `base` is always applied first and exactly once; `--piece base` is accepted and ignored.
- `--out` must not exist or be empty (exit 2).
- Exit 2: unknown piece, missing `requires`, a non-multiple piece twice, duplicate instance name,
  a var failing its `pattern`, unknown var. Exit 3: invalid `splice.toml`/`piece.toml`, unknown
  `format`, subset violation, undefined variable, two pieces writing the same path.
- Context: template vars, then the instance's piece vars; `pieces` (ids in application order,
  unique); `piece` `{id, name}` (name = `vars.name` or the id); `template`
  `{name, version}` (`--template-version`, default `0.0.0-dev`).
- Nunjucks: `autoescape: false`, `throwOnUndefined: true`, `trimBlocks: false`,
  `lstripBlocks: false` (contract §9.4); the source's final newline is kept; output `\n`;
  whitespace-only results are not written (`action: "skip"`).
- Every `.jinja` source is checked against contract §4 + §9 before rendering (exit 3 on a
  violation, with file, line and tag).
- `--json` prints exactly one object `{ok, command: "new", changes, messages}`; without it, one
  line per file. Library entry `renderNew(options) → Result` for tests and `dogfood.mjs`.

## 10. hull's own CI

### 10.1 Combos (`scripts/combos.json`)

| name | pieces |
|---|---|
| `base` | base |
| `web` | base, preact-app:web, ui-storybook, hono-worker:api |
| `site` | base, astro-site:site, rust-tool:tool (rust-tool from plan 03) |
| `docs` | base, docs (from plan 03) |
| `desktop` | base, preact-app:web, tauri-app:desktop — scheduled/manual only |

Template var `scope = "hullci"` for all.

### 10.2 `ci.yml` (hull)

One job + `ci-ok`, same triggers/concurrency/checkout rules as §8.1:
1. `pnpm install --frozen-lockfile --prefer-offline`; `vp lint`, `vp fmt --check`, `pnpm test`
   (`node --test "tests/**/*.test.mjs"`: renderer unit tests + template invariants). Always runs (seconds).
2. `node scripts/affected-combos.mjs --base $BASE` → list. Changes under
   `template/pieces/<id>/` select combos containing `<id>`; `base`, `template/splice.toml`,
   `scripts/render.mjs`, `scripts/lib/**`, `scripts/dogfood.mjs`, `scripts/combos.json`, root
   `package.json`/lockfile and the workflow select all; docs and tests select none.
3. `node scripts/dogfood.mjs --combo <each>`: render into `$RUNNER_TEMP/combos/<name>`, then in
   sequence per combo `pnpm install --no-frozen-lockfile --prefer-offline` (shared pnpm store),
   `pnpm turbo run lint format:check typecheck test build --cache-dir=$RUNNER_TEMP/turbo-cache`,
   and `check-single-vite` for combos with Vite pieces. Rust toolchain set up only when a
   selected combo contains rust-tool.
4. The turbo cache dir is cached with `actions/cache` (later hoard).

Sequential in one job is the default. Plan 02 measures it; a matrix is adopted only if the
measured sequential time exceeds 3 minutes warm and a matrix would cut it by more than half.
Budget for hull's own PR CI: ≤ 120 s warm when one piece changes, ≤ 20 s docs-only.

### 10.3 `desktop.yml` (hull)

`workflow_dispatch` + weekly: renders `desktop`, installs Tauri apt deps, runs the generated
`build:desktop`.

### 10.4 Parity

`scripts/lib/ci-tasks.mjs` exports `CI_TASKS = ["lint", "format:check", "typecheck", "test", "build"]`.
A test asserts the generated `ci.yml` turbo command, the base `package.json` `ci` script and
`dogfood.mjs` all use exactly this list.

## 11. Switching to splice and hoard (blocked)

- **splice v0.1** (blocked until released): hull CI renders with
  `pnpm dlx @keelstack/splice@0.1 new ./template <dir> ... --yes --json`; the dev renderer stays as
  an oracle: a test renders every combo with both and diffs the trees (excluding `.splice/`).
  Update test: render the `web` combo from the previous hull tag, commit, apply scripted user edits
  (edit a seed file, add a dependency to `apps/web/package.json`, edit an owned file), run
  `splice update` to the working tree's template: seed unchanged, the user's dependency kept, the
  owned edit reported by `check` and replaced only with `--force`, `splice check` exit 0 at the end.
- **hoard v1** (blocked until released): the `actions/cache` turbo step becomes
  `uses: keelstack/hoard@v1` in the generated `ci.yml` and in hull's CI.

## 12. Testing

- Unit tests for every `scripts/lib` module (node:test, fixtures in `tests/fixtures/template/`).
- Invariants over the real `template/`: manifests valid; every `files/` path classified by at most
  one class; `[merge]` keys are shared; every `.jinja` passes the subset check; no `{{` in
  `files/` paths; elif-chain branches identical; rendered `CLAUDE.md` ≤ 80 lines per combo;
  generated `ci.yml` structure (§8.1); settings and agent frontmatter shape.
- Dogfood: each combo installs, lints, formats, typechecks, tests and builds.
- Timing: `ci-timing.mjs` against §8.4 and §10.2 budgets.

## 13. Unverified / to check during the build

cascivo package choice for Preact (§6.2); Vite+ shared lint/fmt config mechanism; pnpm 12 setting
names; `$TURBO_ROOT$` in outputs; Renovate preset path syntax; Claude Code plugin settings shape and
statusline input fields; `astro check` with TypeScript 7; Cloudflare OTel destination syntax;
splice CLI flags (§4.3.7); whether `add` re-renders other pieces (§4.3.1).
