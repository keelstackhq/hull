# hull — design

Date: 2026-10-14 · Status: approved for build · amended by `2026-10-17-hull-agent-layer-and-skeletons-design.md` (agent layer v2, skeleton pieces) §14 (2026-10-18: `rigging/` channel, root `AGENTS.md` seed) and §15 (2026-10-23: `template-rust/`, pure Rust repos) · Org `keelstackhq`, repo `keelstackhq/hull`

hull is an opinionated, AI-native monorepo template. It owns structure, stack, tool versions and
config, never app logic. Consumers render it with `splice` (`keelstackhq/splice`, Rust) from
`gh:keelstackhq/hull//template`. Public product, private use first.

This document is the source of truth. The template layout follows the shared contract
`docs/template-format.md` (format 1) exactly; where the contract is silent, §4.3 says what hull does.

## 1. Goals and non-goals

Goals:
1. Bootstrap a repo by choosing pieces: `splice new gh:keelstackhq/hull//template my-repo`.
2. Keep generated repos current: owned files are replaced, shared files merged, seed files never touched.
3. CI in seconds: ≤ 45 s for a typical PR, ≤ 15 s for a docs-only PR, on GitHub's own runners.
4. AI-native for Claude Code first: canonical `AGENTS.md` (read by any agent) with a thin `CLAUDE.md` on top, subagents with fixed models, skills, loops, hooks; hooks enforce the hard rules.
5. hull's own CI is fast and dogfoods the template by rendering piece combinations and running their checks.

Non-goals (v1): app logic, a hosted service, custom runners (documented only, §8.5), Playwright or
visual tests on the PR path, React (Preact only), Cloudflare Pages, our own remote cache (that is `hoard`).

## 2. Names, versions, distribution

- Template source: `gh:keelstackhq/hull//template`. A template version is a git tag `v<semver>` on hull.
  Since v0.3.0 the tag is created by hull's `release.yml` (§10.5), never by hand.
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
rigging/                       # second template: the splice channel `rigging` (§14)
  splice.toml  pieces/{core,claude,skills}/
template-rust/                 # third template: pure Rust repos, no Node/pnpm/Turborepo (§15)
  splice.toml  pieces/{base,rust-cli}/
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
  `lower`/`upper`. `{% raw %}…{% endraw %}` is allowed (§9.23: exact tags without whitespace
  control, no nested raw, never in a path, template needs `min_splice` >= 0.2.0), a `#}` outside a
  comment or raw body is an error (§9.24), and whitespace inside tags is only space, tab, CR or LF
  (§9.19). The dev renderer and the invariant tests both enforce this.
- Final newline kept exactly as in the source; no auto-escaping (§9.4). All vars are strings.
- `pieces` = unique ids in add order; a `multiple = false` piece has `name` = its `id` (§9.5).
- Dev-renderer rules (agreed with splice, contract change pending): identifiers are ASCII `[a-z_][a-z0-9_]*` and
  never `loop/self/range/namespace` or the reserved words; no symlinks anywhere in a template; every
  rendered path segment is portable (no Windows-reserved names, `.git`, trailing dot/space, `/ \\ :`,
  control chars) and paths must not collide ignoring case; `[[post]].when` is required.
- Every path under `files/` matches the ownership globs of at most one class, so "first match
  wins" never decides anything (invariant test). Files matching no glob are `owned` by contract;
  hull lists every class explicitly anyway, except owned files may rely on the default.
- `[merge]` keys only name shared files.
- No `{{ }}` in paths under `files/`; pieces with instances use `target = "<dir>/{{ name }}"`.

### 4.2 Ownership policy

| Class | What | Examples |
|---|---|---|
| `owned` | configs, workflows, AI layer, hull glue code | `vite.config.ts`, `tsconfig.json`, `.github/workflows/*`, `.claude/**`, `CLAUDE.md`, `<target>/AGENTS.md`, `renovate.json` |
| `shared` | files both sides edit | root and package `package.json` (json), `turbo.json` (json), `pnpm-workspace.yaml` (yaml), crate `Cargo.toml` (toml), `tauri.conf.json` (json), `wrangler.jsonc` (text: has comments), `docs/packs.json` (json) |
| `seed` | app source, user docs | `src/**`, `index.html`, `README.md`, root `AGENTS.md` (§14), `docs/agents/project.md`, `<target>/CLAUDE.md`, stories, tests |

The AI layer is owned, except the root `AGENTS.md`, which is seed so that splice channels can
add sections to it (§14). Project-specific notes for agents go in the seed file
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
   `<target>/AGENTS.md` [owned], with a seed `<target>/CLAUDE.md` of `@AGENTS.md` that Claude Code loads
   on demand when it works in that directory; local notes go in the seed `CLAUDE.md` below the import.
4. **Lines holding only a block tag.** Settled: final newline kept, no trim/lstrip (§9.4). Such
   lines therefore leave an empty line in both engines; dogfood runs `vp fmt --check` on generated
   files, so a stray blank line that matters is caught.
5. **Undefined variables.** The dev renderer throws on an undefined variable (typos are template
   errors, exit 3). hull's templates never rely on undefined-is-empty.
6. **File modes.** The contract does not carry the executable bit. Hook scripts are invoked as
   `bash <path>`, so they never need it.
7. **Non-interactive `new`.** Contract §9.14:
   `splice new <source> <dest> --piece <id>[:<name>]... --data <key>=<value>... --yes --json`,
   confirmed against splice 0.2.0 (2026-10-22). `base` is implicit (listing it is exit 2), a local
   source must be a git repo (`<repo>//template`, `--ref` picks the commit), and `new` runs
   `git init` in `<dest>` and the `[[post]]` hooks unless `--no-post`.
8. **Literal `{{` in `.jinja` output.** GitHub Actions expressions (`${{ … }}`) collide with the
   subset, which has no string-literal output. The contract now has `{% raw %}…{% endraw %}` (§4,
   §9.23), so a piece-dependent workflow can be a `.jinja` file with `${% raw %}{{ … }}{% endraw %}`.
   It needs `min_splice = "0.2.0"` or later in `splice.toml`; hull's template uses no raw today and
   keeps `0.1.0`. Existing plain workflows (`ci.yml`, `preview.yml`) stay plain files.

## 5. Template variables

`template/splice.toml`:

```toml
[vars]
scope = { prompt = "npm scope without @", default = "acme", pattern = "^[a-z0-9-]+$" }
```

Piece variables: `name` for every multiple piece (pattern `^[a-z][a-z0-9-]*$`), plus `frontend`
for `tauri-app` (§6.7), `crate` for `npm-cli` (§6.11, the rust-cli instance it ships) and the optional
`repository` for `ts-lib` (§6.12). No other variables in v1; Cloudflare account, Sentry DSN and Axiom are
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
| `rust-cli` | yes | `crates/{{ name }}` | base | `cli` |
| `tauri-app` | yes | `apps/{{ name }}` | base, preact-app | `desktop` |
| `ts-lib` | yes | `packages/{{ name }}` | base | `lib` |
| `npm-cli` | yes | `packages/{{ name }}` | base, rust-cli | `cli` |
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
  Also script `agents:index` = `node scripts/agents-index.mjs`; root `format:check` and the
  `//#format:check` inputs cover `scripts` (the owned `scripts/agents-index.mjs`, and `docs-packs.mjs`
  with `docs`). `piece.toml` lists `scripts/agents-index.mjs` as owned and has a second `[[post]]`,
  `node scripts/agents-index.mjs`, `when = ["new", "add", "update"]`, after the install post.
- `pnpm-workspace.yaml` [shared, yaml]: `packages: [apps/*, packages/*, crates/*]`; `catalog:`
  with every version in §7 (unused entries are harmless, so the file does not depend on pieces);
  `overrides: { vite: "npm:@voidzero-dev/vite-plus-core@<vite-plus version>" }`;
  `peerDependencyRules.allowedVersions: { "storybook>vite-plus": "1" }` (§7.2);
  `allowBuilds: { esbuild: true, workerd: true, sharp: true }` (pnpm 11 replaced
  `onlyBuiltDependencies`, which pnpm 12 silently ignores); `minimumReleaseAge: 4320` (minutes,
  strict when set); `minimumReleaseAgeExclude` lists only exact `name@version` entries (pnpm 12
  supports them) for pins, and their resolved transitive packages, younger than 3 days at render
  time, so a rendered repo never bypasses the gate for later versions; each entry is dropped once
  it has aged. `peerDependencyRules.allowedVersions.vite: "1"` accepts the override's vite-plus-core
  for vitest/preset-vite/Storybook peers (`check-single-vite` still guards against a real second
  vite). Checked against pnpm 12.11.2 on 2026-10-14/15.
- `turbo.json.jinja` [shared, json]: `globalDependencies` = root `vite.config.ts`, `tsconfig.base.json`, plus
  `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` when rust-tool or rust-cli is present (otherwise turbo maps
  root Cargo changes only to `//` and `--affected` would skip the crates; the template keeps today's one-line layout without Rust and
  the multi-line block with it, via a marked `rust-cli`/`rust-tool` chain plus an unmarked chain whose `else` is the one-line form); tasks `build` (`dependsOn: ["^build"]`, outputs `dist/**`), `lint`, `format:check`, `typecheck`
  (`dependsOn: ["^build"]`), `test` (`dependsOn: ["^build"]`), `dev` (`persistent`, no cache),
  `deploy` (no cache, `dependsOn: ["build"]`, `passThroughEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]`), `storybook:build` (outputs `storybook-static/**`),
  `build:desktop` (no cache). No `vp run` cache anywhere (Turbo caches, §7.1).
- `tsconfig.base.json` [owned]: strict, `module: preserve`, `moduleResolution: bundler`,
  `jsx: react-jsx`, `jsxImportSource: preact`, `noEmit`, `verbatimModuleSyntax`, `isolatedModules`.
- `vite.config.ts` [owned]: root Vite+ config holding the shared `lint` and `fmt` options
  (oxlint categories `correctness` + `suspicious` as errors; ignore `dist`, `.astro`,
  `storybook-static`, `target`, `**/*.astro`; `fmt.sortPackageJson: false`, because a piece's
  `@<scope>/…` dependency would sort differently per scope). Vite+ 1.1.0 does not apply nested configs for lint/fmt: `vp lint`
  and `vp fmt` read the root config even when run from a package, so package `vite.config.ts`
  files hold only `pack`/`test` options. Root `vite.config.ts` and `tsconfig.base.json` are turbo
  `globalDependencies`, and a root `//#format:check` task checks root files (checked 2026-10-14).
- `.node-version` [owned] `24`; `.gitignore` [owned] (node_modules, dist, .turbo, .astro,
  .wrangler, target, storybook-static, `.claude/settings.local.json`, `.env*` with
  `!.env.example`, `.dev.vars`, `.docspack`);
  `.gitattributes` [owned] `* text=auto eol=lf`.
- `renovate.json` [owned]: `{"extends": ["github>keelstackhq/hull//renovate/default"]}` (§8.6).
- `.github/workflows/ci.yml` [owned] (§8.1), `preview.yml` [owned] with `.github/scripts/preview.mjs` [owned] (§8.2),
  `desktop.yml.jinja` [owned] (§8.3), `release.yml` [owned] with
  `.github/scripts/release-plan.mjs` [owned] (§8.7; plain files, rendered in every repo, idle
  without a rust-cli or ts-lib package). A `.jinja` workflow can emit GitHub's `${{ … }}` only with
  `{% raw %}` (needs `min_splice` 0.2.0); today every workflow is a plain file unless it needs
  piece conditions; see §4.3 item 8.
- `Cargo.toml.jinja` [owned] root virtual workspace, rendered only for rust-cli, rust-tool or tauri-app:
  `resolver = "3"`, `members` built per piece (`"crates/*"` only with rust-cli or rust-tool, via a nested marked chain;
  `"apps/*/src-tauri"` only with tauri-app; cargo errors on a glob that matches nothing), `[workspace.lints]`,
  `[profile.release] lto = "thin"`. `rust-toolchain.toml.jinja` [owned], same condition: `channel = "1.99.1"` with
  `clippy`, `rustfmt` when rust-cli is present (the crate's `rust-version` is the same number), otherwise `stable`
  (`clippy` + `rustfmt` with rust-tool, `rustfmt` for tauri-app alone).
  `.github/scripts/rust-affected.mjs.jinja` is a marked chain `rust-cli` / `rust-tool` with the body
  duplicated per branch (the subset has no `or`), so it renders for either piece.
- `packages/shared/` [configs owned, `package.json` shared json, `src/**` seed]: a tiny library built with `vp pack`, so a
  base-only repo runs every CI task.
- `README.md.jinja` [seed], `docs/agents/project.md.jinja` [seed]: with npm-cli or ts-lib (a
  marked `npm-cli`/`ts-lib` chain) it adds a `## Blocked` section with the human release steps of
  §8.7. A seed renders only on `new`, so the owned npm-cli and ts-lib `AGENTS.md` files carry the
  same steps for a later `splice add`.
- AI layer, §6.9.

### 6.2 `preact-app`

`package.json.jinja` [shared, json] scripts: `dev` `vp dev`, `build` `vp build`, `lint` `vp lint`,
`format:check` `vp fmt --check`, `typecheck` `tsc --noEmit`, `test` `vp test run`, `preview` `vp preview`,
`deploy` `wrangler deploy`.
Dependencies: `preact`, cascivo (below), and `@<scope>/ui` (`workspace:*`) when `ui-storybook` is
present, so turbo sees the ui → app edge; dev: `@preact/preset-vite`, `vite-plus`, `typescript`,
`wrangler`. `vite.config.ts` [owned] with `@preact/preset-vite`; `tsconfig.json` [owned] extends
`../../tsconfig.base.json`; `wrangler.jsonc` [shared, text]: static assets from `./dist`,
`not_found_handling: "single-page-application"`, `observability.enabled: true`;
`index.html`, `src/main.tsx`, `src/app.tsx`, `src/app.test.tsx` [seed]; `AGENTS.md` [owned] and `CLAUDE.md` [seed] (`@AGENTS.md`).

cascivo (decided 2026-10-14): the app uses the prebuilt components `@cascivo/react` 1.9.0 and
`@cascivo/themes` 1.0.3 through `preact/compat`, following cascivo's "Using cascivo with Preact"
guide (`docs/USING-WITH-PREACT.md`, linked from the `@cascivo/react` README; Vite CSR with
`@preact/preset-vite` is marked verified there). The `cascivo` CLI (copy-in components) is not the
default. `@cascivo/react` peers on `react`, `react-dom`, `@types/react` (all `>=18`) and
`@preact/signals-react >=3`: the piece depends on `@preact/signals-react` and has `react`/`react-dom`
as dev-only peers (aliased to `preact/compat` by the preset and by `tsconfig` `paths`; not bundled);
`@types/react` is listed in `peerDependencyRules.ignoreMissing`. `vite.config.ts` inlines
`@cascivo/*` for tests so the alias applies; the seed test renders with `happy-dom`. SSR/prerender
is unverified, and cascivo under `@astrojs/preact` compat is documented as broken, so astro-site
does not use cascivo. These four packages were added to the stack with the user's approval.

### 6.3 `ui-storybook`

`packages/ui`: a Preact component package on cascivo with Storybook 10.6
(`@storybook/preact-vite`). Scripts: `build` `vp pack`, `lint`, `format:check`, `typecheck`, `test`
`vp test run` (unit tests only), `storybook` `storybook dev -p 6006`, `storybook:build` `storybook build`
(not on the PR path). `preact` and `@cascivo/*` are `peerDependencies` (and dev copies), externalised
by `vp pack`, so consumers keep one preact. `vite.config.ts` uses `@preact/preset-vite` for the
`react` → `preact/compat` alias. `.storybook/main.ts` [owned], `.storybook/preview.ts` [seed],
`src/index.ts`, `src/button.tsx`, `src/button.stories.tsx`, `src/button.test.tsx` [seed].

### 6.4 `astro-site`

Astro 7 static site with `@astrojs/preact`. Scripts: `dev` `astro dev`, `build` `astro build`,
`lint` `vp lint` (TS/TSX only — oxlint does not lint `.astro` templates), `format:check`
`vp fmt --check` (`.astro` excluded; oxfmt's `.astro` support is experimental and needs
`@astrojs/compiler-rs`, so it stays off in v1), `typecheck` `tsc --noEmit` (`astro check` needs the
TypeScript JS API, which TypeScript 7 does not ship; verify and document), `test` `vp test run`
(the same in every piece), `deploy`. `astro.config.mjs` [owned], `tsconfig.json` [owned],
`wrangler.jsonc` [shared, text] (assets `./dist`), `src/pages/index.astro` [seed], `AGENTS.md` [owned] and `CLAUDE.md` [seed] (`@AGENTS.md`).
Astro runs through package scripts (`vp run` would add a second cache; not used).

### 6.5 `hono-worker`

Hono on Workers. `wrangler.jsonc` [shared, text]: `main: "src/index.ts"`,
`compatibility_date: "2026-10-01"`, `compatibility_flags: ["nodejs_compat"]`,
`observability: { enabled: true, head_sampling_rate: 1 }`, `vars: { LOG_LEVEL: "info",
SENTRY_DSN: "" }`, and commented lines showing OTel export destinations (Axiom), marked
"verify against Cloudflare docs". Scripts: `dev` `wrangler dev`, `build`
`wrangler deploy --dry-run --outdir dist`, `test` `vp test run`, `typecheck` `tsc --noEmit`, `lint`,
`format:check`, `deploy`.

Files: `src/index.ts` [seed] (the app; imports hull glue), `src/hull/logging.ts` [owned],
`src/hull/sentry.ts` [owned], `src/index.test.ts` [seed], `src/hull/logging.test.ts` [owned].

Logging contract (`src/hull/logging.ts`):
- `jsonLogger(): MiddlewareHandler` — use after Hono's `requestId()`. After `await next()` it
  writes exactly one `console.log(JSON.stringify(line))` per request, with
  `line = { level: "info"|"warn"|"error", msg: "request", requestId, method, path, status,
  durationMs, colo?, country? }`; `level` is `error` for status ≥ 500, `warn` for ≥ 400.
  No query string, no headers, no body (no secrets or PII in logs). `LOG_LEVEL` (from `env`,
  default `info`) drops lines below that level.
- `onErrorHandler(err, c)` — an `HTTPException` returns its own response (jsonLogger writes the
  normal warn line). Any other error logs once `{ level: "error", msg: err.name, requestId,
  method, path, status: 500, stack }` with the stack's first (message) line removed, because error
  messages can quote request data (e.g. `JSON.parse` quotes the body); jsonLogger skips its own
  line for that request. Returns `500` JSON `{ error: "internal", requestId }`.
- Workers Logs indexes these JSON fields. Optional: OTel export to Axiom (free 500 GB/month),
  configured in the Cloudflare dashboard plus `observability` in `wrangler.jsonc`.
- `src/hull/sentry.ts`: `withOptionalSentry(app)` returns an `ExportedHandler` that delegates to
  `app.fetch`; only when `env.SENTRY_DSN` is non-empty does it import `@sentry/cloudflare` (once per
  isolate) and wrap with `withSentry`, registering a reporter that `onErrorHandler` calls. A
  `beforeSend` scrubber removes query strings, headers, cookies, bodies, breadcrumbs and exception
  messages (type and stack frames are kept). Wrangler bundles the
  SDK (≈1.2 MB) but it is evaluated only when the DSN is set. Whether the empty `vars.SENTRY_DSN`
  is overridden by `wrangler secret put SENTRY_DSN` on deploy is unverified (needs an account).

Pricing note: Workers Logs free tier becomes 0.5 GB/day from 2026-12-01; the README says how to
lower `head_sampling_rate`.

### 6.6 `rust-tool`

`crates/{{ name }}`: `Cargo.toml.jinja` [shared, toml] (`edition = "2024"`, `[lints] workspace = true`),
`src/main.rs` [seed] with one unit test, `package.json.jinja` [shared, json] whose scripts call
cargo for this crate only: `build` `cargo build --release -p {{ name }}`, `lint`
`cargo clippy -p {{ name }} --all-targets -- -D warnings`, `format:check` `cargo fmt -p {{ name }} --check`,
`typecheck` `cargo check -p {{ name }} --all-targets` (CI_TASKS needs it), `test` `cargo nextest run -p {{ name }}`. `turbo.json` [owned] extends `//`: build outputs
`$TURBO_ROOT$/target/release/{{ name }}`, inputs `src/**`, `Cargo.toml`, `$TURBO_ROOT$/Cargo.lock`
(`$TURBO_ROOT$` verified with turbo 2.11.8 on 2026-10-15: a cached build restores the binary). `[[post]]`
`cargo generate-lockfile` on `new` and `cargo update --workspace` on `add` (adds the new member
without bumping locked crates); splice runs them in dogfood; with `--renderer dev` dogfood runs
`cargo generate-lockfile` itself, because the dev renderer does not run `[[post]]`.
`AGENTS.md` [owned] (≤ 20 lines; points a distributed CLI to `rust-cli`, §6.10) and `CLAUDE.md` [seed] (`@AGENTS.md`).

### 6.7 `tauri-app`

Tauri v2 desktop shell around an existing preact-app instance. `multiple = true` (only multiple
pieces can be named, contract §9.5), so vars are `name` (default `desktop`) and `tauri-app.frontend`
(default `web`, must be a preact-app instance; checked by the renderer only as a
pattern). `src-tauri/` is a member of the root Cargo workspace. `tauri.conf.json` [shared, json]:
`build.beforeDevCommand` `pnpm --filter @{{ scope }}/{{ frontend }} dev`, `beforeBuildCommand`
`pnpm --filter @{{ scope }}/{{ frontend }} build`, `devUrl` `http://localhost:5173`,
`frontendDist` `../../{{ frontend }}/dist`. `package.json.jinja` [shared, json]: `tauri` `tauri`,
`build:desktop` `tauri build`, `format:check` `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
(fmt needs no system libraries). No `lint`/`test`/`build` on the PR path: compiling Tauri needs
webkit2gtk, so the Rust build runs only in `desktop.yml`. `src-tauri/Cargo.toml` [shared, toml],
`src-tauri/build.rs` [owned], `src-tauri/src/{main,lib}.rs` [seed], `src-tauri/capabilities/default.json`
[seed], `src-tauri/icons/*` [owned, binary]. `src-tauri/Cargo.toml` pins `tauri = "2.12.4"` and
`tauri-build = "2.7.3"` (`cargo info`, 2026-10-15; `latest` is already 3.0.0-alpha) so the crates
match `@tauri-apps/cli` 2.12.2; Renovate's `tauri` group covers them. Bundle `targets: ["deb"]`
(AppImage downloads linuxdeploy at build time, which is flaky in scheduled CI). No workspace lints
(`unsafe_code = "forbid"` could break Tauri's macros) and no `[[post]]` (`tauri build` writes the
lockfile). `rust-toolchain.toml` lists only `rustfmt` when rust-tool is absent, so the PR-path
`cargo fmt` does not pull clippy.

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
    "keelstack": { "package": "@keelstackhq/docspack", "source": "vendor", "version": "0.1.1" },
    "cascivo": { "package": "@cascivo/docspack", "source": "vendor" },
    "hono": { "package": "@docspack-community/hono", "source": "community", "build": "hono" },
    "cloudflare": { "package": "@docspack-community/cloudflare", "source": "community", "build": "cloudflare" },
    "vite-plus": { "package": "@docspack-community/vite-plus", "source": "community", "recipe": "gh:keelstackhq/hull//community-packs/vite-plus" }
  }
}
```

`source` is `vendor` (published by the tool's authors) or `community`. A community entry names
either `build` (a curated source of `docspack build <source>`) or `recipe` (a folder in hull's
`community-packs/`). An optional `version` pins a pack to an exact semver (never a range); its hint
is then `pnpm add -D -E <package>@<version>`, and a non-exact version makes the entry invalid. The
pin only shapes the hint: `installed` is checked by name, so a Renovate bump past the pin is not
reported. `keelstack` is the keelstack.dev docs pack, pinned to 0.1.1 (`npm view` on 2026-10-28:
latest 0.1.1, published 2026-10-28T06:32Z, no dependencies). It is younger than 3 days, so
`pnpm-workspace.yaml` excludes `@keelstackhq/docspack@0.1.1` until 2026-10-31 (a consumer with
its own `minimumReleaseAgeExclude` gets a whole-array merge conflict on `splice update`). On
2026-10-14 no `@docspack-community/*` package is published; hull keeps the recipes, and
publishing them is a blocked task (needs the npm scope). `pnpm docs:packs` (script in the docs
piece) prints which listed packs are installed, missing, or unpublished; it never edits files.

### 6.9 AI layer (owned, in `base`)

The root `AGENTS.md` is seed since 2026-10-18 (§14); everything else listed here is owned.

- `AGENTS.md.jinja` (canonical, ≤ 60 rendered lines) and `CLAUDE.md.jinja` (thin, ≤ 20 lines),
  together ≤ 80 for every combo (`lineCount`, like `wc -l`). `AGENTS.md`: what the repo is,
  commands (`pnpm install`, `check`, `run ci`, `format`, `agents:index`; `pnpm ci` is pnpm's
  built-in clean install), rules (test first, verify before claiming, small files, catalog pins,
  never read `.env*`/`.dev.vars`, releases are tag pushes by a human, at most 2-3 parallel
  agents, a hook `ask` becomes a denial in `-p`/unattended runs), a `## Pieces` section
  (rendered only when a piece is present, via a `same-branches` chain) with one bullet per present
  piece kind pointing to `<dir>/AGENTS.md`, and `## Where to look` (plain pointers to
  `docs/agents/project.md`, `docs/agents/index.md`, `docs/agents/docs.md` with docs). It has no
  `@` import lines. `CLAUDE.md`: lines 1-3 are `@AGENTS.md`, `@docs/agents/project.md`,
  `@docs/agents/index.md`, line 4 `@docs/agents/docs.md` only with docs, then `## Claude Code`
  (subagent line, skills, hooks). Per-instance notes are `<target>/AGENTS.md` (loaded on demand;
  §4.3.3) with a seed `<target>/CLAUDE.md` of `@AGENTS.md`.
- `.claude/agents/*.md` (frontmatter `name`, `description`, `tools`, `model`). Since 0.2.0 they
  are not in `base`: rigging's `claude` piece ships them (§14); `migrations/0.2.0.toml` removes
  base's copies (0.2.1 also the pre-0.1.0 `explorer.md`), and the generated `CLAUDE.md` says to
  run `splice channel add gh:keelstackhq/hull//rigging --piece claude` if `.claude/agents/` lacks
  them:

| Agent | Model | Tools | Use |
|---|---|---|---|
| `Explore` | haiku | Read, Grep, Glob | "Use proactively" for search and reading; returns paths and ≤ 15-line summaries |
| `implementer` | sonnet | Read, Edit, Write, Bash, Grep, Glob | one task, test first, runs `verify` |
| `reviewer` | opus | Read, Grep, Glob, Bash | read-only review against task and AGENTS.md; never edits |
| `ci-fixer` | sonnet | Read, Edit, Write, Bash, Grep, Glob | reads `gh run view --log-failed`, reproduces, fixes |

  Claude Code has no complexity-based routing; fixed models per agent are the convention, and
  `"model": "opusplan"` in settings is the main-session default (Opus plans, Sonnet executes).
- `.claude/skills/verify/SKILL.md`: run `pnpm turbo run lint format:check typecheck test --affected
  --output-logs=errors-only`, report ≤ 10 lines (pass/fail per task, first error per failure).
- `.claude/skills/add-piece/SKILL.md`: `pnpm dlx @keelstackhq/splice add <id> [--name <name>] --data <k>=<v> --yes --json` (contract §9.14),
  read the JSON `changes`, run `[[post]]`-equivalent install, run `pnpm agents:index`, then `verify`.
- `.claude/skills/docs-lookup/SKILL.md` (only with docs): `pnpm exec docspack ask "<q>" --json`
  before any web search; web search only on exit 3/4.
- `docs/agents/index.md`: generated by `scripts/agents-index.mjs` (`pnpm agents:index`, `--check`
  for CI); never in the template. Commands, packages and docs rows in `text` fences, at most 8192
  bytes; agent-layer spec §3.5.
- `.claude/loop.md`: default `/loop` prompt — run `verify`; fix the first failure; repeat until
  green; then stop and summarise in ≤ 5 lines.
- `.claude/hooks/session-start.sh`: `pnpm install --prefer-offline` (quiet), then
  `pnpm exec docspack sync` and `docspack index --repo` if docspack is installed, then runs every
  `.claude/hooks/session-start.d/*.sh` (repo-local, not owned by the template; a failing one is
  reported and ignored), so a repo can add session-start work without editing owned files. Exits 0
  on any failure (never blocks a session), prints one status line plus whatever local hooks print.
- `.claude/hooks/guard.mjs` (PreToolUse, Node built-ins only): denies publish commands, force and
  tag pushes (also behind `git -C . push`), deleting `main`/`master` on the remote, reads of `.env*`/`.dev.vars` (not `.env.example`) and
  any write to `.splice/lock.toml`; asks the human before Edit/Write/MultiEdit/NotebookEdit on a
  file the lock lists as `owned`. A tokenizer, not a shell; any internal error allows the call.
  Rules and known gaps: agent-layer spec §3.4.
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
  allowed, so it still prompts); these deny rules are the second layer behind the guard hook
  below; hook entries carry `timeout: 120` (seconds, 10 for the guard);
  `hooks.PreToolUse` matcher `Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit` →
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"`;
  `hooks.SessionStart` matcher `startup|resume` → `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"`;
  `hooks.Stop` → stop-checks; bosun's two hooks (decision 2026-10-23, option b: bosun's channel
  cannot share this owned file, splice allows one owner per path): a second `PreToolUse` entry
  (bosun's matcher `Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__github__.*`) and a second
  `SessionStart` entry (no matcher, like bosun's) run `bosun hook pre-tool-use` /
  `bosun hook session-start` through `if [ -f "${CLAUDE_PROJECT_DIR:-.}/.bosun/bosun.toml" ] &&
  command -v bosun >/dev/null 2>&1; then exec bosun hook …; fi`: exit 0 and silent unless the repo
  uses bosun, and `exec` passes bosun's stdin and exit code (a block) through; timeout 120;
  `tests/bosun-hooks.test.mjs` runs the guard with and without bosun; `extraKnownMarketplaces` + `enabledPlugins` for superpowers
  (`superpowers@superpowers-marketplace`, repo `obra/superpowers-marketplace`) and caveman
  (`caveman@akramsystems-plugins`, repo `akramsystems/caveman`). Shape checked against
  code.claude.com/docs (settings, hooks, statusline) on 2026-10-14: `enabledPlugins` keys are
  `<plugin>@<marketplace-key>`; repo-level `extraKnownMarketplaces` apply only after the user
  accepts the workspace trust dialog. The marketplace names inside those repos' manifests were not
  checked.

### 6.10 `rust-cli`

`crates/<name>` (default `cli`): a production Rust CLI skeleton (agent-layer spec §4.1). The private workspace
package is `@<scope>/<name>-crate` (the published npm name belongs to `npm-cli`) with
`hull.release = "rust-cli"`; the binary and the crate are named `<name>`, version `0.0.0`.
`Cargo.toml.jinja` [shared, toml]: edition 2024, `rust-version = "1.99.1"` (equals the toolchain
pin), `[[bin]]`, `[lints] workspace = true`, every dependency pinned `=x.y.z` (§7). Scripts, all with
`-p <name>`, `--locked` where cargo reads the lockfile: `build` `cargo build -p <name> --locked` (a debug
build: release binaries are built only by the release workflow), `lint` `cargo clippy -p <name>
--all-targets --locked -- -D warnings && cargo deny --manifest-path Cargo.toml --config deny.toml check bans
licenses sources`, `format:check`, `typecheck` `cargo check -p <name> --all-targets --locked`, `test`
`cargo nextest run -p <name> --locked`. `turbo.json` [owned] extends `//`; every task's inputs name
`src/**`, `Cargo.toml` and the three root files with `$TURBO_ROOT$` (`Cargo.toml`, `Cargo.lock`,
`rust-toolchain.toml`), lint/typecheck/test/format also `tests/**`, lint also `deny.toml`; build outputs
`$TURBO_ROOT$/target/debug/<name>`. `deny.toml` [owned]: bans `openssl`, `openssl-sys`, `native-tls`;
license allow-list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unicode-3.0, Zlib),
`private.ignore` (the seed has no license), `unused-allowed-license = "allow"` (the list is policy, not a
usage report), crates.io only; `[advisories]` is configured but only `release.yml` checks it, so a new
advisory never fails an unrelated PR. No Rust file contains the instance name.

Sources are `seed`. The crate is binary-only: `src/main.rs` (parse, log init, dispatch, exit code),
`src/run.rs` (`pub fn run(cli: Cli) -> Result<Report, Error>`), `cli.rs` (clap derive; global `--json`,
`-C DIR`, `-v`, `-q`; `hello [--name N]`, `completions <shell>`, `man`), `exit.rs` (0 ok, 1 negative
result, 2 usage, 3 config/environment/runtime), `error.rs` (thiserror), `output.rs` (the only writer of
stdout: `--json` prints exactly one object and a newline, also for clap errors when `--json` is in argv),
`log.rs` (tracing to stderr; `RUST_LOG`, else `-q`/`-v`). A `src/lib.rs` is not possible in a seed,
because a plain file cannot name `my_cli` after an instance (agent-layer spec §4.1, amended).
`tests/common/mod.rs` [seed, plain] builds the command with `assert_cmd::cargo::cargo_bin_cmd!()` (the
package name is the binary name), `env_clear()` and only `PATH`, a temp `HOME`/`XDG_*` and `NO_COLOR=1`; no
test sets process env (`set_var` is unsafe in edition 2024 and the workspace forbids unsafe), a test
asserts on `get_envs()` of the built command instead. `tests/cli.rs` [seed] has inline insta snapshots
(`--help` after `String::replace(env!("CARGO_PKG_NAME"), "[BIN]")`, since insta's `filters` feature would
add `regex`; `hello --json`) and assertions for the JSON/exit/stderr contract, `RUST_LOG=trace`,
`completions`, `man`. `AGENTS.md` [owned] (≤ 20 lines) states the contract; `CLAUDE.md` [seed]
(`@AGENTS.md`). `[[post]]`: `cargo generate-lockfile` on `new`, `cargo update --workspace` on `add`.

Verification of the cargo-deny invocation and the `$TURBO_ROOT$` inputs is recorded in §13.

### 6.11 `npm-cli`

`packages/<name>` (default `cli`, var `crate` default `cli`, both `^[a-z][a-z0-9-]*$`): the npm side
of a `rust-cli` binary, package `@<scope>/<name>` with `hull.release = "npm-cli"`. `crate` names the
rust-cli instance it ships. `requires = ["base", "rust-cli"]` (owner decision 2026-10-22) refuses
npm-cli without any rust-cli; `crate` itself is checked as a pattern only, so the generated AGENTS.md,
README.md and the version-sync test say "needs a rust-cli instance named `<crate>`". `package.json` [shared] has
`bin: { "<crate>": "bin/launcher.js" }`, `files: ["bin"]`, provenance, a devDependency
`@<scope>/<crate>-crate: workspace:*` (so `--affected` runs this package's tests after a crate change),
and the scripts `lint`, `format:check`, `typecheck`, `test` only; it never carries `optionalDependencies`,
`repository`, `postinstall` or `preinstall` (written by `scripts/stage.mjs` at release time).
`turbo.json` [owned] sets `typecheck.dependsOn` and `test.dependsOn` to `[]`, so a launcher-only PR never
builds the crate. `bin/launcher.js` (plain JS, `// @ts-check`) resolves `<name>-<platform>-<arch>` with
`createRequire(import.meta.url)`, runs `bin/<crate>[.exe]` with inherited stdio, forwards the exit code,
re-raises the child's signal; `<BIN>_BINARY` (`bin.toUpperCase().replaceAll("-", "_")`, so `my-cli`
gives `MY_CLI_BINARY`) overrides the path; a missing platform package prints one stderr line with the
platform and the build-from-source command, exit 3 (`cargo install --locked --git <repository.url> <crate>` when the launcher's `package.json` has `repository.url`, which `stage.mjs` writes; else `cargo install --locked --path crates/<crate>`; never plain `cargo install <crate>`, since the crate has `publish = false` and the name belongs to an unrelated crates.io crate). `scripts/stage.mjs` exports `TARGETS` (the five platforms,
the single source for the release workflow) and `stage({ pkgDir, artifactsDir, outDir, repository })`;
it fails on a missing artifact or a launcher version that differs from `crates/<crate>/Cargo.toml`.
`test/*.test.js` [owned] read scope, name and bin from the package's own `package.json` at run time.
`typecheck` is `tsc --noEmit`: `tsconfig.json` [owned] sets `allowJs`, `checkJs` and `types: ["node"]`
over the five JavaScript files, with devDependencies `typescript` and `@types/node` from the catalog
(owner decision 2026-10-22; verified under TypeScript 7, §13).

### 6.12 `ts-lib`

`packages/<name>` (default `lib`): a publishable ESM TypeScript library, package `@<scope>/<name>`
with `hull.release = "ts-lib"` (read by the release workflow). `vite.config.ts` [owned] packs
`src/index.ts` as `format: ["esm"]` with `dts: true` into `dist/index.mjs` and `dist/index.d.mts`;
`exports` has `types` first plus `./package.json`; `files: ["dist"]`, `sideEffects: false`,
`publishConfig: { access: "public", provenance: true }`. `tsconfig.json` [owned] sets
`declaration` (TS5069 requires it) and `isolatedDeclarations`, and includes only `src`: TypeScript 7
rejects the default export of `vite.config.ts` under `isolatedDeclarations` (TS9037).
`build` is `vp pack && publint && attw --pack . --profile esm-only`; the checks run on the built
artifact (about 2 s extra locally: publint 0.2 s, attw 1.3 s). `src/index.ts`, `src/index.test.ts`,
`pack.entries.ts` (the entry list `vite.config.ts` imports, so the owned config never needs edits),
`README.md`, `CLAUDE.md` [seed]; `AGENTS.md` [owned]. Optional piece var `ts-lib.repository` (GitHub URL,
default empty) renders `repository` in `package.json`; npm provenance fails with E422 without it, so
`release.yml` sets it to the workflow's repository before `pnpm pack` (§8.7) and AGENTS.md says so;
the README still tells a user who publishes by other means to set it (the file is shared). The var pattern is `https://github.com/<owner>/<repo>` with `[A-Za-z0-9._-]` segments
(no quotes or backslashes, so no JSON injection); write the URL without `.git`. The catalog carries `publint` and
`@arethetypeswrong/cli` (unused entries are harmless).

## 7. Versions (template pnpm catalog, exact pins)

Checked with `npm view` on 2026-10-14.

| Package | Pin | Note |
|---|---|---|
| `vite-plus` | 1.1.0 | 1.2.0 published 2026-10-14 09:21 UTC; Renovate bumps it after `minimumReleaseAge` |
| `@voidzero-dev/vite-plus-core` | 1.1.0 | via the `vite` override; always the same version as vite-plus |
| `turbo` | 2.11.8 | |
| `typescript` | 7.0.2 | native compiler, binary `tsc` |
| `@types/node` | 24.19.2 | published 2026-10-09 (checked 2026-10-22); npm-cli `typecheck` (§6.11); Node 24 line |
| `preact` | 10.29.8 | 11.0.1 exists, but `@astrojs/preact` peers `^10.6.5` |
| `@preact/preset-vite` | 2.10.6 | |
| `astro` | 7.3.8 | depends on `vite ^8.3.1` |
| `@astrojs/preact` | 6.0.6 | |
| `storybook`, `@storybook/preact-vite`, `@storybook/addon-docs` | 10.6.2 | |
| `hono` | 4.13.13 | |
| `wrangler` | 4.151.0 | |
| `@cloudflare/workers-types` | 5.20261014.1 | |
| `@sentry/cloudflare` | 11.7.0 | |
| `@tauri-apps/cli` | 2.12.2 | `@tauri-apps/api` 2.12.3; crates `tauri` 2.12.4, `tauri-build` 2.7.3 (§6.7) |
| `@cascivo/react` / `@cascivo/themes` | 1.9.0 / 1.0.3 | published 2026-10-09; Preact path via `preact/compat` (§6.2) |
| `@preact/signals-react` | 3.12.0 | cascivo peer |
| `react`, `react-dom` | 19.3.0 | dev-only cascivo peers, aliased to `preact/compat`; published 2026-09-09 |
| `happy-dom` | 20.14.6 | DOM environment for component tests; published 2026-10-08 |
| `docspack` | 1.5.0 | |
| `publint` | 0.3.25 | ts-lib `build`; checked with `npm view` 2026-10-17 |
| `@arethetypeswrong/cli` | 0.18.5 | ts-lib `build`; bundles TypeScript 5.6.1-rc; checked with `npm view` 2026-10-17 |
| pnpm / Node | 12.11.2 / 24 | Node 24 is the active LTS |
| crates `clap` / `clap_complete` / `clap_mangen` | 4.6.7 / 4.6.11 / 0.3.3 | rust-cli `Cargo.toml` (not in the pnpm catalog); crates.io publish dates 2026-09-14 / 2026-09-15 / 2026-08-12 |
| crates `thiserror` / `serde` / `serde_json` | 2.0.21 / 1.0.229 / 1.0.154 | rust-cli; 2026-09-23 / 2026-07-18 / 2026-10-11 |
| crates `tracing` / `tracing-subscriber` | 0.1.44 / 0.3.23 | rust-cli; 2025-12-18 / 2026-03-13 |
| dev crates `assert_cmd` / `predicates` / `insta` / `tempfile` | 2.2.2 / 3.1.4 / 1.49.0 / 3.27.0 | rust-cli; `insta` with `json` only; 2026-05-11 / 2026-02-11 / 2026-10-03 / 2026-03-11 |
| Rust toolchain | 1.99.1 | rust-cli `rust-toolchain.toml` and `rust-version`; stable manifest dated 2026-10-15 |
| `cargo-deny` | 0.20.2 | `taiki-e/install-action` in `ci.yml` and `release.yml` (§8.7); Renovate tracks it with a regex manager; 2026-07-09 |
| npm CLI (release) | Node 24's bundled npm | `release.yml` `setup-node` `node-version: 24` (Node 24.22.0 ships npm 11.19.1); trusted publishing needs npm ≥ 11.5.1, Node ≥ 22.14.0 (docs.npmjs.com/trusted-publishers, 2026-10-17); no separate pin |
| Actions (release) | `actions/attest-build-provenance@v4`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `taiki-e/install-action@v2` | major tags (latest v4.2.2, v7.0.2, v8.0.2, v2.87.29 on 2026-10-17); Renovate pins digests; checkout/pnpm/setup-node as in `ci.yml` |

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
  2. Index check: a separate step with no `if`, using the runner's `node`:
     `node scripts/agents-index.mjs --check` fails when `docs/agents/index.md` is stale (docs-only
     cost < 1 s).
  3. Early exit, before Node/pnpm setup: the step downloads the `@turbo/linux-64` binary at
     `TURBO_VERSION` (= the catalog pin, tracked by the Renovate preset) from the npm registry with
     `curl` (~1 s; `npx` took ~5-7 s), then `turbo query affected --tasks lint format:check
     typecheck test build` writes JSON; `node .github/scripts/affected.mjs` [owned] reads it, drops tasks of the root
     package `//` unless `git diff BASE...HEAD` touches a root trigger (root package/workspace/lock/
     turbo/tsconfig/vite config, `.node-version`, `.npmrc`, anything under `.github/`), and sets
     `skip=true` when nothing remains. A turbo error, bad JSON or an unknown base → run everything.
     Root `format:check` covers every root-owned file, but docs-only changes (e.g. `CLAUDE.md`,
     `docs/**`) do not trigger it on PRs (§8.4).
     All later steps have `if: steps.affected.outputs.skip != 'true'`.
  4. `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with
     `node-version-file: .node-version`, `cache: pnpm`.
  5. `pnpm install --frozen-lockfile --prefer-offline`.
  6. Turbo cache: `uses: keelstackhq/hoard@v0` (since 2026-10-22, hoard 0.1.0): a Turborepo
     remote cache in the GitHub Actions cache; it exports `TURBO_API`/`TURBO_TOKEN`/`TURBO_TEAM`
     for the `turbo run` step. No `actions/cache` step.
  6. Rust (present in the plain `ci.yml`, guarded at runtime by
     `hashFiles('.github/scripts/rust-affected.mjs') != ''` (that script renders only with rust-tool),
     because a `.jinja` workflow cannot hold `${{` — §4.3 item 8): `.github/scripts/rust-affected.mjs` [owned] reads
     `turbo query affected --packages` JSON and sets `rust=true` when an affected package has a
     `Cargo.toml`; then a `rustup toolchain install` step (installs the channel and components pinned in `rust-toolchain.toml`; `dtolnay/rust-toolchain@stable` would download a second toolchain once stable moves past the pin),
     `Swatinem/rust-cache` (extra `key` = `hashFiles('rust-toolchain.toml')`), `taiki-e/install-action` (`tool: cargo-nextest@0.9.148,cargo-deny@0.20.2`, both tracked by Renovate regex managers; cargo-deny is installed for every Rust repo, a small cost), all `if: rust == 'true'`.
  7. `pnpm turbo run lint format:check typecheck test build --affected --output-logs=errors-only`.
  8. `Job duration` (`if: always()`, `continue-on-error`): writes the job time and the budget to the
     step summary, timed from a first `Start timer` step.
- Job `ci-ok`: `needs: [ci]`, `if: always()`, fails unless `needs.ci.result == 'success'`. It is
  the only required check.
- Actions are pinned by tag in the template; Renovate pins digests (§8.6).
- Not on the PR path: Playwright, Storybook build and visual tests, Tauri builds.

### 8.2 `preview.yml` and `preview-deploy.yml`

Two phases, so no job that runs PR code can read a secret (secrets spec 2026-10-27 §4.4).
`preview.yml` is a plain owned file for every repo. A first step checks for `apps/*/wrangler.jsonc`
and every later step is skipped when there is none (base-only repos pay a ~5 s no-op). `on:
pull_request`, `permissions: contents: read`, no `secrets.`, no `environment:`, no Cloudflare
variable: it builds the affected apps (`turbo run build --affected`; hono-worker writes the Worker
bundle to `dist` with `wrangler deploy --dry-run --outdir dist`, static apps write their assets to
`./dist`), runs `node .github/scripts/preview.mjs build` and uploads artifact `preview-<pr>`
(`apps/<dir>/worker/`, `apps/<dir>/assets/`, `manifest.json`; `retention-days: 3`).

`preview-deploy.yml.jinja` (owned, `min_splice` 0.2.0 for its raw blocks) runs on `workflow_run` of
`preview` (`completed`), only for a successful same-repo `pull_request` run, in environment
`preview`. A `gate` job (no environment, no secrets) first checks that `apps/*/wrangler.jsonc` exists, so base-only repos never reach the environment. `deploy` checks out the default branch only, installs from its lockfile, takes the PR number
from the event entry whose head sha matches (or the API by head sha), downloads `preview-<pr>` by run id and runs
`preview.mjs deploy`, which rejects forbidden names (`wrangler.json*`, `package.json`, `*.toml`,
lockfile, `_worker.js*`, symlinks), reads `wrangler.jsonc` from the default branch, writes a minimal
config with only `env.preview` bindings (service, Durable Object and queue references must be
`-preview`), and runs `wrangler versions upload --no-bundle --preview-alias pr-<n>` on the
`<name>-preview` Worker. A first preview creates that Worker once from an empty stub; a PR never
creates or deploys a production Worker. Credentials: `secrets.CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, stored only as secrets of environment `preview` (and of the prod deploy
environment once `deploy.yml` exists) with Deployment branches = Selected, `main`, never as
repository secrets (`preview.mjs deploy` fails early with this hint when they are empty); or, with the `secrets` piece, the hoist action
(`env: preview`). The deployable pieces' `AGENTS.md` states the rules (never create `<app>-preview`
by hand; its secrets are readable by every PR; `env.preview` ids are preview-only resources).
Without the `secrets` piece a deploy-on-`main` workflow is rejected (production deploys stay a repo
choice); with it, `deploy.yml` deploys `main` to prod behind the `prod` environment (hoist action,
`CLOUDFLARE_*` only as environment secrets). `wrangler preview` is rejected (open beta in 4.151.0).
Caveats in the README: preview URLs are public unless Cloudflare Access protects them, and do not
work for Workers with Durable Objects.

### 8.3 `desktop.yml`

Rendered only with tauri-app. `workflow_dispatch` + weekly schedule; ubuntu with the Tauri apt
deps (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`); runs
`pnpm turbo run build:desktop`. Release with `tauri-apps/tauri-action` is documented, not wired.

### 8.4 Budget and measurement

Typical PR (1–2 packages, warm caches) ≤ 45 s for job `ci`; docs-only ≤ 15 s (early exit).
Trade-off for the docs-only budget: formatting of root docs is checked by local
`pnpm format:check`, the stop hook and full runs on pushes to the default branch, not on PRs.
Measure with `scripts/ci-timing.mjs` (hull) or by hand:
`gh run list -w ci.yml -L 20 --json databaseId` then `gh run view <id> --json jobs` and
`completedAt − startedAt` of job `ci`. The script reports p50/p90 and exits 1 when p50 exceeds
the budget. Canary repos rendered from hull are the reference: `keelstackhq/example-app` (`web` combo; p50 29 s,
p90 51 s, docs-only 7 s) and `keelstackhq/cli-canary` (`cli` combo, 2026-10-21: npm-cli-only PR 26 s,
docs-only 9 s, crate PR 42 s warm; cold `main` 98 s) and `keelstackhq/rust-canary` (`rust` combo of
`template-rust`, 2026-10-23: docs-only 7 s, crate PR 34 s warm, cold PR 65 s).

### 8.5 Custom runners

Documented only: changing `runs-on` to Blacksmith/Namespace/Depot labels; sticky disks replace the
pnpm store cache. No template option in v1.

### 8.6 Renovate

`renovate/default.json` in hull (preset `github>keelstackhq/hull//renovate/default`, syntax to
verify): `config:recommended`, `helpers:pinGitHubActionDigests`, `rangeStrategy: pin`,
`minimumReleaseAge: "3 days"`, groups `vite-plus` (`vite-plus` + `@voidzero-dev/vite-plus-core`,
which must move together), `storybook`, `astro`, `tauri`, `cloudflare` (wrangler + workers-types),
`turbo`, `react` (react + react-dom), `cascivo` (`@cascivo/*`), `sentry` (`@sentry/*`), `preact`
(preact + `@preact/*`), `clap` (`clap`, `clap_*`), `tracing` (`tracing`, `tracing-*`); a regex custom manager
tracks `cargo-deny@x.y.z` in `.github/workflows/*.yml` (datasource `crate`); the native `rust-toolchain`
manager bumps `rust-toolchain.toml`, so the toolchain needs no regex; automerge for minor/patch and digests with `platformAutomerge`; weekly
`lockFileMaintenance`. Open question: once `splice update` runs as a bot, template-managed catalog
entries move to `ignoreDeps` so Renovate and the template do not both bump them.

### 8.7 `release.yml` (tag-driven)

Plain owned file in every repo. A human pushes `<instance>-v<semver>`; trigger
`on.push.tags: ["*-v[0-9]*"]`, top-level `permissions: contents: read`, `concurrency:
release-${{ github.ref }}` without cancel, every checkout `fetch-depth: 0`. No npm token exists
anywhere (no `NPM_TOKEN`, `NODE_AUTH_TOKEN` or npm secret); `id-token: write` only on the two
publishing jobs.

- `plan`: `.github/scripts/release-plan.mjs` (Node built-ins only; `plan(tag, fs)` exported for
  hull's tests) reads `GITHUB_REF_NAME` and writes `kind`, `dir`, `package`, `bin`, `version`, `npm_dirs` to
  `$GITHUB_OUTPUT`, or exits 1 with the reason (pairing rule and errors: new spec §4.4). For
  rust-cli it installs the pinned toolchain and `cargo-deny@0.20.2` and runs
  `cargo deny --manifest-path <dir>/Cargo.toml --config <dir>/deny.toml check advisories` (global
  options before the subcommand; advisories run only here, never on PRs).
- `binaries` (rust-cli): matrix over npm-cli's `TARGETS` (`linux-x64`/`linux-arm64` musl on
  `ubuntu-latest`/`ubuntu-24.04-arm`, both darwin targets on `macos-latest`, `win32-x64` on
  `windows-latest`); `cargo build --release --locked -p <package> --target <t>`; uploads
  `<t>/<bin>[.exe]` (the layout `stage.mjs --artifacts` reads) and `<bin>-<t>.tar.gz` (`.zip` on
  Windows); the `linux-x64` leg adds `completions/<bin>.{bash,zsh,fish,powershell}` and `<bin>.1`.
- `github-release` (rust-cli; `environment: release`; `contents: write`, `id-token: write`, `attestations: write`):
  `SHA256SUMS`, `actions/attest-build-provenance` on the archives, `gh release create <tag>
  --verify-tag` (`--prerelease` when the version has a `-` suffix; `gh release upload --clobber`
  when the release exists, so a re-run is safe).
- `npm` (rust-cli with npm-cli companions, or ts-lib; `environment: release`, `contents: read`,
  `id-token: write`): `setup-node` with `node-version: 24` and `registry-url` (the placeholder
  token it exports is not a secret; npm exchanges the OIDC token). npm-cli: `stage.mjs` per
  companion (it writes `repository` from `GITHUB_REPOSITORY`), platform packages first, launcher
  last. ts-lib: `pnpm install --frozen-lockfile`, `pnpm turbo run build test --filter <name>`,
  `npm pkg set repository.type=git repository.url=git+https://github.com/$GITHUB_REPOSITORY.git`,
  `pnpm pack` (rewrites `catalog:`/`workspace:`). Every publish is
  `npm publish <dir|tgz> --provenance --access public --tag <dist-tag>` (`next` for a version with a
  `-` prerelease suffix, else `latest`; npm refuses or would mark a prerelease `latest` otherwise),
  skipped when `npm view <name>@<version>` already answers.

`github-release` and `npm` both need only `plan` and `binaries`, so they run in parallel: npm can
publish while the GitHub release fails (and the reverse). A re-run of the failed job is safe
(`gh release upload --clobber`, the `npm view` skip); required
reviewers on the `release` environment (a human step, hull PROGRESS Blocked) gate both.

Human steps (in the generated `docs/agents/project.md` Blocked section and the owned npm-cli /
ts-lib `AGENTS.md`): the `release` environment with a tag rule; the first publish of each new npm
name by hand; an npm trusted publisher (repo, `release.yml`, environment `release`) on each
package (launcher and five platform packages, or the library), which must see its first publish
within 2 days. Unverified until the first real release (hull PROGRESS Blocked): `npm publish` of a
`pnpm pack` tarball with `--provenance`, private repos (npm makes no provenance for them;
attestations need a public repo or GitHub Enterprise Cloud), `ubuntu-24.04-arm`, and
`macos-latest` building `x86_64-apple-darwin`.

## 9. Dev renderer `scripts/render.mjs`

Exists until splice v0.1 renders hull; afterwards it stays as a conformance oracle in tests.

```
node scripts/render.mjs new --template <dir> --out <dir> --piece <id>[:<name>]... \
  --data <key>=<value>... [--template-version <v>] [--json]
```

- Implements contract §1–§4 and §8 (JSON shape, exit codes), and writes files for `new` only:
  every planned file is created (`action: "create"`, its `class`). No lock file (only splice
  writes it), no `[[post]]`, no `update`/`check`/`add`, no merges, no migrations.
- `base` is always applied first and exactly once. The CLI refuses `--piece base` (exit 2, splice
  0.2.0's messages); `renderNew` (dogfood, tests) accepts it in a piece list and ignores it.
- `--out` must not exist or be empty (exit 2).
- `--data` keys follow contract rule 9.28: bare var names (template vars and the vars of the
  selected pieces; a piece var applies to every selected instance that declares it).
- Exit 2: unknown piece, missing `requires`, a non-multiple piece twice, duplicate instance name
  (also two un-named instances of one piece given the same `--data name`), a var failing its
  `pattern`, unknown var, a dotted `<piece>.<var>` key. Exit 3: invalid `splice.toml`/`piece.toml`,
  unknown `format`, a piece var named like a template var, subset violation, undefined variable,
  two pieces writing the same path.
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
- A path that changes ownership class between template versions (for example `<target>/CLAUDE.md`,
  owned before the agent-layer amendment, seed now) is handled by splice, not by hull: splice spec
  §10 item 12 (owned to seed keeps the file and drops it from the lock; seed to owned creates it if
  absent, else conflicts). Hull ships no migration for it before v0.1.0, because no lock exists yet.

## 10. hull's own CI

### 10.1 Combos (`scripts/combos.json`)

| name | pieces |
|---|---|
| `base` | base |
| `web` | base, preact-app:web, ui-storybook, hono-worker:api |
| `site` | base, astro-site:site, rust-tool:tool (rust-tool from plan 03) |
| `docs` | base, docs (from plan 03) |
| `cli` | base, rust-cli:cli, npm-cli:cli |
| `lib` | base, ts-lib:lib |
| `desktop` | base, preact-app:web, tauri-app:desktop — scheduled/manual only |

Template var `scope = "hullci"` for all.

### 10.2 `ci.yml` (hull)

One job + `ci-ok`, same triggers/concurrency/checkout rules as §8.1:
1. `pnpm install --frozen-lockfile --prefer-offline`; `vp lint`, `vp fmt --check`, `pnpm test`
   (`node --test "tests/**/*.test.mjs"`: renderer unit tests + template invariants). Always runs (seconds).
2. `node scripts/affected-combos.mjs --base $BASE` → list. Changes under
   `template/pieces/<id>/` select combos containing `<id>`; `base`, `template/splice.toml`,
   `scripts/render.mjs`, `scripts/lib/**`, `scripts/dogfood.mjs`, `scripts/combos.json`, root
   `package.json`/lockfile, the workflow and any other path under `template/` select all; docs and
   tests select none. An unknown or missing base (first push, force-push) selects all.
3. `node scripts/dogfood.mjs --combo <each>`: commit a snapshot of `template/` (working tree) to a
   scratch git repo, `splice new <snapshot>//template $RUNNER_TEMP/combos/<name> --ref HEAD ...`
   (runs `git init` and the `[[post]]` hooks: `pnpm install`, `cargo generate-lockfile`, the agents
   index), then `pnpm turbo run lint format:check typecheck test build --cache-dir=$RUNNER_TEMP/turbo-cache`,
   `node scripts/agents-index.mjs --check`, and `check-single-vite` for combos with Vite pieces.
   `--renderer dev` uses the dev renderer and runs the hooks' commands itself. CI installs
   `@keelstackhq/splice@0.2.0` (`SPLICE_VERSION` in `scripts/lib/splice.mjs`) and sets `SPLICE_BIN`
   before Test. Rust toolchain set up only when a
   selected combo contains rust-tool or rust-cli; that step also adds `Swatinem/rust-cache@v2` (workspace `combos/cli -> target`)
   and installs `cargo-nextest@0.9.148` and `cargo-deny@0.20.2`, which the cli combo's generated `ci` task list uses.
4. The turbo cache is `keelstackhq/hoard@v0` (remote cache, before dogfood); dogfood passes
   `--cache-dir` only when `TURBO_API` is unset (local runs). The pnpm store cache is keyed
   on hull's lockfile while combos install with `--no-frozen-lockfile`, so a stale store only costs
   download time, never correctness.

Sequential in one job is the default. Plan 02 measures it; a matrix is adopted only if the
measured sequential time exceeds 3 minutes warm and a matrix would cut it by more than half.
Measured 2026-10-15 (cloud container, warm pnpm store): base+web+site cold 24–42 s, warm 4.5–6.8 s,
so hull CI stays sequential. `scripts/check-single-vite.mjs` changes also select all combos.
Local dogfood (2026-10-17, cloud container, shared `--cache-dir`): cold base 2.0 s, web 11.6, site 8.8, docs 1.9, cli 48.9 (Rust build), lib 4.7; warm 0.6 / 1.7 / 1.8 / 1.0 / 1.6 / 0.8. The GitHub `ci` time of the six combos is read after the first push.
Budget for hull's own PR CI: ≤ 120 s warm when one piece changes, ≤ 20 s docs-only.

### 10.3 `desktop.yml` (hull)

`workflow_dispatch` + weekly: renders `desktop`, installs Tauri apt deps, runs the generated
`build:desktop`.

### 10.4 Parity

`scripts/lib/ci-tasks.mjs` exports `CI_TASKS = ["lint", "format:check", "typecheck", "test", "build"]`.
A test asserts the generated `ci.yml` turbo command, the base `package.json` `ci` script and
`dogfood.mjs` all use exactly this list.

### 10.5 `release.yml` (hull, 2026-10-26)

Modelled on splice's `release.yml`. Source of truth: the first `## v<X.Y.Z> — <rest>` heading of
`CHANGELOG.md`; `<rest>` is `YYYY-MM-DD` (release it) or `unreleased` (release nothing); any other
heading fails the run. `scripts/release-tag.mjs` decides (`changelogRelease`, `releaseTag`,
`previousTag`; tests in `tests/release-tag.test.mjs`).
- Triggers `push` to `main` + `workflow_dispatch`; `permissions: {}`; run-level concurrency
  `release-run-<run_id>`, no cancel, so pushes never cancel each other's runs (the job-level group
  below still lets GitHub drop an older *pending* release job of the same tag for a newer one).
- `plan` (`github.repository == 'keelstackhq/hull'` and ref `main`, `contents: read`): `git
  ls-remote --tags`; releases when `v<version>` is missing, or (a re-run, attempt > 1) already tags
  this commit. On a first attempt an existing tag (e.g. one pushed by hand) releases nothing.
- `release` (`environment: release`, `contents: write`, concurrency `release-tag-<tag>` without
  cancel): creates the annotated tag `v<version>` on `github.sha` with `GITHUB_TOKEN` (which starts
  no other workflow, so the release happens in the same run; if another push's run tagged another
  commit first, this run skips publishing), then `gh release create <tag> --verify-tag --notes-file <changelog section>
  --generate-notes --notes-start-tag <previous v<semver> tag>`; an existing release is left alone
  (one release per tag). Owner settings: the `release` environment with required reviewers and
  `main` in its deployment branches.

## 11. Switching to splice and hoard (done 2026-10-22)

- **splice 0.2.0** (done 2026-10-22): hull CI renders with splice (§8.1 step 3); the dev renderer
  stays as an oracle: `tests/splice-parity.test.mjs` renders every combo with both (splice with
  `--no-post`, the dev renderer with splice's `template.version`) and diffs the trees (excluding
  `.splice/` and `.git/`), and checks the §8 JSON shape. `tests/splice-update.test.mjs`: render the
  `web` combo from the previous hull tag, commit, apply scripted user edits (edit a seed file, add
  a dependency to `apps/web/package.json`, edit an owned file), `splice check` exit 1 naming the
  owned file, `splice update` to the working tree's template refused without `--force`: seed
  unchanged, the user's dependency kept, the owned file replaced, `splice check` exit 0 at the end.
  Both skip with a message when `SPLICE_BIN` is unset.
- **hoard 0.1.0** (done 2026-10-22; the Action's moving tag is `v0`, not `v1`): the
  `actions/cache` turbo step became `uses: keelstackhq/hoard@v0` in the generated `ci.yml` and in
  hull's CI.

## 12. Testing

- Unit tests for every `scripts/lib` module (node:test, fixtures in `tests/fixtures/template/`).
- Invariants over the real `template/`: manifests valid; every `files/` path classified by at most
  one class; `[merge]` keys are shared; every `.jinja` passes the subset check; no `{{` in
  `files/` paths; elif-chain branches identical; rendered `AGENTS.md` + `CLAUDE.md` ≤ 80 lines per combo;
  generated `ci.yml` structure (§8.1, including the agents-index check and `cargo-deny`); settings
  and agent frontmatter shape (`Explore` on haiku, read-only; no `explorer`); per-instance
  `AGENTS.md` ≤ 20 lines with `CLAUDE.md` exactly `@AGENTS.md` (seed); `docs/agents/index.md`
  ≤ 8192 bytes per combo.
- Module tests for the hull-tested template scripts: `guard.mjs` (`decide()` table, one spawn
  test), `agents-index.mjs` (exact output, determinism, `--check`, budget) and `release-plan.mjs`
  (`plan()` on fixtures); `release.yml` shape (tag trigger, `contents: read`, `id-token: write`
  only on publishing jobs, `--provenance`, no npm token).
- Skeleton pieces: `rust-cli` (exact `=x.y.z` pins, no OpenSSL, `deny.toml`, debug `--locked`
  build), `npm-cli` (no `optionalDependencies` or install scripts, `bin` = crate), `ts-lib`
  (`exports` shape, publint and attw in `build`).
- Dogfood: each combo installs, lints, formats, typechecks, tests and builds.
- Timing: `ci-timing.mjs` against §8.4 and §10.2 budgets.

## 13. Unverified / to check during the build

Verified 2026-10-17 (rust-cli, agent-layer spec §9 item 8; Rust 1.99.1, cargo-deny 0.20.2, cargo-nextest 0.9.148, turbo 2.11.8): (a) `cargo deny --manifest-path Cargo.toml --config deny.toml check bans licenses sources` works from `crates/cli` and exits 0 (`--manifest-path` and `--config` are global options and must precede `check`: the order `check --config …` from the plan draft fails with "unexpected argument '--config'"); with an added `native-tls` dependency it exits 2 with `banned` for `native-tls`, `openssl` and `openssl-sys`. (b) Touching the root `Cargo.lock` makes `turbo run test --filter=<crate>` miss the cache, also with `globalDependencies` reduced to the two JS files, so the `$TURBO_ROOT$` inputs work on their own. (c) A second `turbo run lint format:check typecheck test build` is 11/11 cached (1 s).

Verified 2026-10-17 (npm-cli, agent-layer spec §9 item 8; TypeScript 7.0.2): `tsc --noEmit` with `allowJs` and `checkJs` type-checks the launcher, `stage.mjs` and the tests, but only with `@types/node` installed (without it TS2688 on `types: ["node"]`, and no `node:*` module types); 2026-10-22 the catalog pins `@types/node` 24.19.2 and `typecheck` is `tsc --noEmit` (it was `node --check` until then).

Verified 2026-10-17 (ts-lib, agent-layer spec §9 item 8): `attw --pack . --profile esm-only` runs next to TypeScript 7.0.2 (it uses its bundled 5.6.1-rc) and passes; `vp pack` emits `index.d.mts` with `isolatedDeclarations`.

Verified 2026-10-17 (agent-layer spec §9 items 1 and 3; a project `Explore` agent overrides the built-in one; Claude Code in this container): an `@docs/agents/index.md` import of a missing file loads without error; after `node scripts/agents-index.mjs` it loads; `@AGENTS.md` in a nested `CLAUDE.md` resolves relative to that file (`apps/web/AGENTS.md` content was loaded from `apps/web`).

Still open: whether a PreToolUse `ask` still prompts under `acceptEdits` (agent-layer spec §9
item 2; needs an interactive session, `claude -p` cannot show the prompt); Renovate preset path syntax; Cloudflare OTel destination syntax; splice CLI flags
(§4.3.7); whether `add` re-renders other pieces (§4.3.1); whether Renovate's pnpm manager bumps the
`overrides.vite` `npm:@voidzero-dev/vite-plus-core@x` alias together with `vite-plus` (needs a live
Renovate run); whether the empty `vars.SENTRY_DSN` is overridden by `wrangler secret put` on deploy
(needs an account); the Tauri desktop build (needs webkit2gtk, runs in `desktop.yml`).

Verified during the build (removed from this list): Vite+ shared lint/fmt config mechanism; pnpm 12
setting names; `$TURBO_ROOT$` in outputs; Claude Code settings and statusline shape; cascivo for
Preact (`@cascivo/react` via `preact/compat`); `astro check` does not work with TypeScript 7
(astro-site uses `tsc --noEmit`); `preview.yml`/`desktop.yml` use runtime guards, not `{% raw %}`.

## 14. `rigging` channel (2026-10-18)

Signed off by the hull owner on 2026-10-18 (splice task C2): hull ships a second template,
`rigging/`, applied with `splice channel add gh:keelstackhq/hull//rigging` (splice channels spec
§6-§7, splice 0.2.0), and the root `AGENTS.md` of `base` moves from owned to seed. Both stay
inside contract format 1; `docs/template-format.md` is unchanged (D-003).

**Layout.** `rigging/splice.toml`: `format = 1`, `name = "rigging"`, `base = "meta"`,
`min_splice = "0.2.0"` (older splices refuse it). splice always renders a template's base, so the
base is `meta`, an empty piece (only `id`, `description`, `multiple`; no files, sections, vars or
post) and every real piece below is optional; `claude` and `skills` require `meta`, not `core`.

| Piece | Content | Class |
|---|---|---|
| `core` | `[sections] "AGENTS.md" = "sections/rules.md.jinja"`: harness-neutral working rules (test first, verify with real output, one task per change, no secrets or `.env*` reads, releases by a human, ≤ 2-3 parallel agents); one bullet naming the subagents only with `"claude" in pieces`; ≤ 12 lines, no `@` imports, no files of its own | section |
| `claude` | `.claude/agents/{explore,implementer,reviewer,ci-fixer}.md`, the §6.9 agents with the same names, models and tools, made stack-neutral ("the fast checks `AGENTS.md` or `CLAUDE.md` lists" instead of `pnpm turbo`); **no** `CLAUDE.md` section: hull owns `CLAUDE.md`, which imports `@AGENTS.md` | owned |
| `skills` | `multiple = true`, `target = ".{{ dir }}/skills"`, var `dir` pattern `^(claude\|agents)$` (no default); `files/<skill>/SKILL.md` with `name` + `description` frontmatter; first skill `handoff` (write next steps and blockers to the progress notes, start fresh rather than compact) | owned |

**Who adds which piece.** `core` is for repos not rendered from hull (splice, hoard, hoist,
berth, …). A hull repo already carries these rules in its own `AGENTS.md` (§6.9), so it adds only
`claude` and/or `skills` from rigging, never `core`: `--piece claude` and/or
`--piece skills:claude --data dir=claude`; a non-hull repo adds `--piece core` as well.
The generated `AGENTS.md` does not mention rigging: the cli combo is at 4,103 of 4,150
always-loaded bytes.

**Budget.** hull's AI-layer budget (`AGENTS.md` ≤ 60 lines, `CLAUDE.md` ≤ 20, ≤ 4,150
always-loaded bytes, §6.9 and `tests/ai-layer.test.mjs`) covers what hull renders. Content an
adopter adds through a channel is outside it. Measured 2026-10-18: the `core` section with its
markers and the blank line before it adds 11 lines / 562 bytes, or 13 lines / 733 bytes with
`claude`.

One skill source serves two harnesses: `splice channel add … --piece skills:claude --data
dir=claude`, then `splice add skills --channel rigging --name agents --data dir=agents`.
Skill names must not collide with hull's own skills (`verify`, `add-piece`, `docs-lookup`), or a
hull repo gets a claim conflict (splice channels spec §5).

**Harness directories** (checked 2026-10-18): Claude Code loads project subagents from
`.claude/agents/*.md` (frontmatter `name`, `description` required; `tools`, `model` optional) and
skills from `.claude/skills/<name>/SKILL.md` (code.claude.com/docs/en/sub-agents, /skills; no
mention of `.agents/skills`). Codex loads skills from `.agents/skills/<name>/SKILL.md` in every
directory from the cwd up to the repo root, with `name` and `description` frontmatter
(developers.openai.com/codex/skills, now learn.chatgpt.com/docs/build-skills), and reads
`AGENTS.md`. A channel release fixes these for every repo if they move.

**`AGENTS.md` → seed.** A channel may only add a section to a host that no lock lists in
`[files]`, so the root `AGENTS.md` cannot stay owned. Consequence: like every seed it renders only
on `new`; `splice add` no longer refreshes its `## Pieces` bullets (the generated
`docs/agents/index.md` still lists every package), and later hull changes to the root `AGENTS.md`
no longer reach existing repos: the file is frozen at `new`. The class change itself is safe for
existing repos: splice main spec §10 item 12 (owned → seed keeps the file and drops it from the
lock). Per-instance `<target>/AGENTS.md` and root
`CLAUDE.md` stay owned.

**Validation.** hull's dev renderer never renders channels: `loadTemplate` rejects `[sections]`
as an unknown key, which `tests/rigging.test.mjs` asserts. That test checks the manifest shape,
the subset on every `.jinja` including fragments, ownership classes, no symlinks, portable paths,
agent and skill frontmatter, and the fragment's rendered output with and without `claude`.
`tests/conformance.test.mjs` renders splice's subset corpus (`tests/fixtures/conformance/`, a
byte-for-byte copy of splice `tests/fixtures/subset/`, including the `section-fragment` case) with
hull's Nunjucks setup. Dogfooding `rigging/` with splice waits for splice 0.2.0.

**hull 0.2.0 (2026-10-22).** `base` no longer ships the four `.claude/agents` files;
`migrations/0.2.0.toml` `[[remove]]`s them (deleted when unedited, else kept and reported; before
this, a hull repo that added `--piece claude` got a claim conflict on them), and the README and
generated `CLAUDE.md` say: run `splice update`, then
`splice channel add gh:keelstackhq/hull//rigging --piece claude`. Not a post or step: those run
before the main lock is written. Class changes made before v0.1.0 (`<target>/CLAUDE.md` owned →
seed) need no migration: splice 0.2.0 applies the class-change rules (splice spec §10 item 12).

**hull 0.2.1 (2026-10-22).** `explorer.md` (base, 2026-10-14 to 10-17, renamed `explore.md`)
survives in repos rendered before v0.1.0 and adopted with `splice new --force`: no lock tracks it,
so a `[[remove]]` only reports it. `migrations/0.2.1.toml` has a `[[step]]` that deletes it when
its git blob is the one hull shipped (`ad17ec0f`) and reports an edited copy. The generated
`CLAUDE.md` names the rigging command only "if `.claude/agents/` lacks them": it is owned, so its
reader already ran `splice update`, and the subset cannot test whether a channel was added.

## 15. Pure Rust repos: `template-rust/` (2026-10-23)

The owner wants to start a pure Rust project from hull. `template/` is always a pnpm + Turborepo
monorepo; its `rust-cli`/`rust-tool` crates live in `crates/*` inside it. Decision: a third
template in this repo, `template-rust/`, rendered with
`splice new gh:keelstackhq/hull//template-rust`. No Turborepo, no Node or pnpm in the repo.
Contract format 1 stays as it is (D-003, D-005).

**Turborepo: no.** Evidence from 2026-10-23:

| Measurement | Turborepo (`cli` combo: base + rust-cli) | Plain cargo, same crate |
|---|---|---|
| Cold, no `target/`, all CI tasks (local) | 25.8 s | 26.0 s |
| Crate source changed, warm `target/` (local) | 1.35 s (cache miss) | 2.2 s |
| Nothing changed (local) | 0.24 s (full hit) | 1.35 s (cargo no-op) |
| Node setup on a GitHub runner (hull run 39808906539) | pnpm/action-setup 5 s + setup-node 4 s + install 1 s | 0 s |

- A turbo hit saves about 1 s over a warm cargo no-op. A PR that changes a crate changes that
  crate's inputs, so it always misses the cache. Hits help only re-runs of the same tree
  (merge_group, then the push to `main`).
- Turbo caches task outputs, never `target/`. So the restore of `target/` (rust-cache; 621 MB
  locally for the `cli` crate) is needed either way. The cache work for Rust belongs to rust-cache
  or sccache (hoard's Rust research), not to a Turborepo remote cache.
- Node costs about 10 s on every non-docs PR, about 22 % of the 45 s budget. The `cli-canary`
  crate PR already takes 42 s warm (§8.4).
- The agent layer needs no Node toolchain. It needs only files (`AGENTS.md`, `CLAUDE.md`,
  `.claude/`), the rigging and decisions channels (splice), and two small Node scripts
  (`agents-index.mjs`, `docs-only.mjs`) that use the runner's preinstalled `node` and Node
  built-ins only, like the index check in §8.1.
- Lost: the `--affected` task graph and the hoard Turborepo cache. A docs-only exit and cargo's
  own fingerprints take their place. Per-crate selection (`-p` from `cargo metadata` and the diff)
  stays an option if a large workspace needs it.

**Contract fit.** Contract §2 applies the template's `base` to every `splice new`, exactly once.
So a `rust-base` piece in `template/` cannot remove `package.json`, `pnpm-workspace.yaml` or
`turbo.json`. Contract §1 already lets a template live in a subdirectory, and `rigging/` (§14) is
precedent for a second template in this repo. `template-rust/splice.toml`: `format = 1`,
`name = "hull-rust"`, `base = "base"`, `min_splice = "0.2.0"` (the update bot and channels need
it), no template `[vars]`. hull's `v<semver>` tags version all three templates.

**Shape** (`template-rust/pieces/`):

- `base` (root): `Cargo.toml.jinja` [shared, toml]: a virtual workspace, `resolver = "3"`,
  `members = ["crates/*"]`, `[workspace.package]` (`edition = "2024"`,
  `rust-version = "1.99.1"`), `[workspace.lints]` (`unsafe_code = "forbid"`, clippy `all` warn),
  `[profile.release] lto = "thin"`. Cargo errors on a virtual workspace without members, so `base`
  ships the seed crate `crates/common` (`publish = false`, a lib with one unit test and one doc
  test), like `packages/shared` in §6.1. `members` has no `"apps/*"`: cargo rejects a member glob
  that matches no crate (`cargo metadata` and `generate-lockfile` exit 101 with no `apps/` crate,
  checked with cargo 1.99.1 on 2026-10-28), so a comment above it tells consumers to add such globs
  once a crate exists; the toml merge keeps that edit, but it conflicts if the template later
  changes the array (arrays are whole values, contract §5). Owned files: `rust-toolchain.toml` (`1.99.1`, `clippy`,
  `rustfmt`, profile minimal), `rustfmt.toml` (`style_edition = "2024"`), `deny.toml` (the §6.10
  policy for the whole workspace), `.config/nextest.toml` (profile `ci`: no fail-fast),
  `.gitignore`, `.gitattributes`, `renovate.json` (the same preset, §8.6), the workflows below,
  and the AI layer below. Seed files: `README.md`, `AGENTS.md`, `docs/agents/project.md`,
  `hoist.toml`.
- `rust-cli` (`crates/{{ name }}`): the §6.10 crate without `package.json` or `turbo.json`.
  `deny.toml` moves to the root. `src/**` and `tests/**` are byte-identical to `template/`'s
  rust-cli (a test enforces this). `hoist.toml` [seed] holds the commented
  `[publish] github_release` for the five §8.7 targets.
- No `npm-cli` launcher yet (berth and bosun ship one with hoist), and no `rust-lib` piece yet:
  `common` is the library seed. Both are follow-ups.

**CI of generated repos** (`ci.yml`, owned, plain; §8.1 rules: one job `ci` + `ci-ok`,
`pull_request` + `merge_group` + push to the default branch, no path filters, `fetch-depth: 0`,
`filter: blob:none`):

1. `node scripts/agents-index.mjs --check` (runner's node).
2. Docs-only early exit: `node .github/scripts/docs-only.mjs` sets `skip=true` only when the
   `BASE...HEAD` diff is not empty and every path is root `*.md`, `docs/**`, `.claude/**` or
   `LICENSE*`. Files under `crates/` are never docs, because `include_str!`/`#[doc]` can read them.
   An unknown base or a git error runs everything. All later steps check `skip`.
3. `rustup toolchain install` (reads `rust-toolchain.toml`), `Swatinem/rust-cache@v2` (key
   `hashFiles('rust-toolchain.toml')`), `taiki-e/install-action`
   (`cargo-nextest@0.9.148,cargo-deny@0.20.2`).
4. The Rust CI steps, in order. `RUST_CI_STEPS` in `scripts/lib/ci-tasks.mjs` keeps the workflow,
   `AGENTS.md` and dogfood in sync:
   `cargo fmt --all --check`; `cargo clippy --workspace --all-targets --locked -- -D warnings`;
   `cargo deny --locked check bans licenses sources`;
   `cargo nextest run --workspace --locked --profile ci`; `cargo test --workspace --doc --locked`
   (nextest does not run doc tests).
5. `Job duration` against the budget (45 s typical PR, 15 s docs-only).

**Release** (`release.yml`, owned; the berth/bosun flow through hoist 0.2.0 from npm): on push
to `main` + `workflow_dispatch`; `detect` runs `.github/scripts/release-pending.mjs` (Node
built-ins, exported for hull's tests): a crate is a package when it has a `version` and
`publish` is not `false`. Its tag is `[release] tag_format` from the root `hoist.toml`, or
`{name}@{version}` in a workspace. It is pending when that tag is missing or on HEAD. The gate is
`vars.HOIST_RELEASE == 'enabled'`, so nothing releases until a person turns it on. `build` is
the bosun target matrix (`cargo build --release --locked --target <t>`; each binary is copied to
`dist/<bin>-<t>`). `publish` (environment `release`, `contents: write`, `id-token: write`) runs
`hoist release publish --assets dist`. `prepare` runs `hoist release prepare`. Node is set up
only in the release jobs that run hoist. The update bot `splice.yml` (owned) is the one splice's
README gives. Token order for the bot and for `prepare`: a GitHub App token
(`actions/create-github-app-token`, SHA-pinned, scoped to the repo; `vars.SPLICE_APP_CLIENT_ID` /
`vars.HOIST_RELEASE_APP_CLIENT_ID` hold the App's Client ID, the key is an environment secret), else
the PAT secret, else `github.token`, whose PRs get no CI. `vars.SPLICE_BOT == 'off'` skips the bot
job (session mode: an agent session runs `splice update --all` and opens the PR). 
`publish` takes the same optional App (Contents write only) for `GH_TOKEN`, else `github.token`,
because hoist pushes the release tags and a `*-v*` tag ruleset rejects `github.token`. The token
exists in a step where `cargo publish` runs crates' build scripts, hence contents-only, and the App
belongs only on the tag ruleset's bypass list.
The generated README names the two channel adds after `splice new`:
`rigging --piece claude` and `decisions//channel --track main --piece import-project` (D-004;
its section lands in the seed `docs/agents/project.md`, which `CLAUDE.md` imports). Checked
with splice 0.2.0 on the rendered `rust` combo on 2026-10-23: both add cleanly, `splice check`
passes, `agents-index` needs one re-run. The template leaves `governance/`, `.bosun/` and
bosun's workflow names (`risk.yml`, `verdict.yml`, `main-open.yml`, `main-health.yml`) free for
a bosun channel. Unverified until the first real release (PROGRESS Blocked): the workspace tags and
the build matrix.

**AI layer.** Same rules and budgets as §6.9 (`AGENTS.md` ≤ 60 lines, `CLAUDE.md` ≤ 20), with
cargo commands in place of pnpm. `.claude/hooks/guard.mjs` and `.claude/statusline.sh` are
byte-identical to `template/`'s copies (a test enforces this). `settings.json` allows cargo and
denies `cargo publish`, and carries the same guarded bosun hooks as §6.9. `session-start.sh` runs `rustup show` and `cargo fetch --locked`,
quietly. `stop-checks.sh` and the `verify` skill run the Rust CI steps. `scripts/agents-index.mjs`
lists the workspace crates from each `crates/*/Cargo.toml`.

**hull tooling.** A combo in `scripts/combos.json` may set `"template": "template-rust"` and its
own `"vars"`. dogfood renders it from that template and runs `RUST_CI_STEPS` in place of turbo.
`affected-combos` maps `template-rust/**` to its combos. The new combo is `rust`: base +
`rust-cli:cli`.
