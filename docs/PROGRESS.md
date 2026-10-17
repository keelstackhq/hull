# Progress

One line per finished task: `YYYY-MM-DD · plan/task · commit · test summary (+ timing if measured)`.

## Done

- 2026-10-14 · 01/1 · `feat: scaffold hull and load template manifests` · 9/9 tests, lint+fmt clean (Node 24.21, pnpm 12.11.2). `test` script is `node --test "tests/**/*.test.mjs"` (`node --test tests/` fails on Node 24). Deferred review notes: multiple-piece `name` var → Task 5 invariant; `[merge]` globs vs `shared` → Task 3.
- 2026-10-14 · 01/2 · `feat: check templates against the portable subset` · 58/58 tests, lint+fmt clean. Also rejects bare pieces/piece/template, unterminated tags, double else, keyword identifiers, chained filters. Note for Task 7: GitHub `${{ }}` in a `.jinja` workflow would be rejected — keep workflows non-`.jinja` or avoid `${{` in them.
- 2026-10-14 · 01/3 · `feat: classify ownership and plan renders` · 90/90 tests, lint+fmt clean. Multiple-piece instance names always set `name` and reject empty, `/`, `\`, `..`. `[merge]`-names-a-shared-file check moves to the Task 5 invariant (loader check was stricter than contract §3).
- 2026-10-14 · 01/4 · `feat: dev renderer writes new repos from the template` · 116/116 tests, lint+fmt clean; manual `render.mjs new --piece app --json` → ok, exit 0, root mode 755. Writes via a sibling staging dir renamed into place (no partial output); target/path strings subset-checked; unexpected errors exit 3.
- 2026-10-14 · 01/5 · `test: template invariants and base skeleton` · 135/135 tests, lint+fmt clean. Invariants probed on a broken copy (two classes, `or`, `{%-`, bad merge key, `{{` in path all fail). `assertSameBranches` throws on unmarked/unclosed/single-branch chains.
- 2026-10-14 · 01/6 · `feat(base): workspace, catalog, turbo and Vite+ config` · 146/146 tests, lint+fmt clean; dogfood base (scope hullci): install 0.35 s (warm store), turbo 6/6 tasks 2.08 s cold cache. `allowBuilds` replaces `onlyBuiltDependencies`; root config is a turbo globalDependency; root `//#format:check`.
- 2026-10-14 · 01/7 · `feat(base): one-job CI with affected early exit and Renovate preset` · 161/161 tests, lint+fmt clean; base re-rendered, 6/6 turbo tasks pass. `ci.yml` is a plain owned file (contract gap, see Blocked). actionlint not run then (no binary, no Docker daemon); run on 2026-10-15 with a downloaded binary, clean. Action tags checkout@v5, pnpm/action-setup@v4, setup-node@v5, cache@v4; Renovate custom manager tracks the `npx turbo@` pin.
- 2026-10-14 · 01/8 · `feat(base): Claude Code layer — agents, skills, hooks, loop` · 176/176 tests, lint+fmt clean; base rendered → 6/6 turbo tasks, rendered CLAUDE.md 42 lines and `vp fmt --check` clean. Settings/hooks/statusline shape checked against code.claude.com docs. Uses `pnpm run ci` (`pnpm ci` is pnpm's clean install). docs-conditional tests use a stub docs piece until plan 03.
- 2026-10-14 · 01/9 · `ci: dogfood rendered combos in hull CI` · 185/185 tests, lint+fmt clean; `node scripts/dogfood.mjs --combo base` → `base ok 3.4s` (cold turbo cache, warm pnpm store), `base ok 0.9s` warm. Unknown base selects all combos.
- 2026-10-14 · Milestone 1 reviewed · `fix: milestone 1 review findings` · 213/213 tests, lint+fmt clean, dogfood base ok. Fixed: undefined vars in if/elif/filters are template errors (contract §9.12); docs-only PRs early-exit (root package ignored unless a root trigger changed; docs formatting checked locally/on main only, spec §8.4); add-piece uses contract §9.14 CLI; root format:check covers all root files; repeated `--piece base` ignored; reserved var names rejected.
- 2026-10-14 · 02/1 · `feat: check that a lockfile resolves a single vite` · 223/223 tests, lint+fmt clean; CLI on rendered base → ok, single vite-plus-core@1.1.0. Reads packages+snapshots of all YAML docs, resolves `npm:` aliases.
- 2026-10-14 · 02/2 · `feat(preact-app): Preact app on Vite+ with cascivo` · 230/230 tests, lint+fmt clean; base+preact-app:web rendered → install 0.62 s (warm store), turbo 11/11 tasks 7.8 s cold cache, check-single-vite ok (vite-plus-core 1.1.0). cascivo via `@cascivo/react` + `preact/compat`; new deps @preact/signals-react, react/react-dom (dev), happy-dom approved by user. wrangler/miniflare/workerd in minimumReleaseAgeExclude (published 2026-10-12..14).
- 2026-10-14 · 02/3 · `feat(ui-storybook): Preact UI package with Storybook 10.6` · 237/237 tests, lint+fmt clean; base+preact-app:web+ui-storybook → turbo 16/16 tasks 12.3 s cold cache, check-single-vite ok, `storybook:build` ok in 7.3 s (off PR path). No vite-plus peer warning text; install reports only expected unmet `vite` peers (override). preact/cascivo are peers of @scope/ui.
- 2026-10-14 · 02/4 · `feat(astro-site): Astro 7 static site sharing Vite+ core` · 243/243 tests, lint+fmt clean; base+astro-site:site → turbo 11/11 tasks 7.5 s cold cache, check-single-vite ok (Astro's vite resolves to vite-plus-core 1.1.0). `astro check` (@astrojs/check 0.9.10) with TypeScript 7.0.2 fails: "astro check does not currently support TypeScript 7.0. To continue using astro check, install TypeScript 6 instead." → `typecheck` stays `tsc --noEmit`. No cascivo in astro-site.
- 2026-10-14 · 02/5 · `feat(hono-worker): Hono worker with JSON request logs and optional Sentry` · 251/251 tests, lint+fmt clean; base+hono-worker:api → turbo 11/11 tasks (16 generated api tests), build writes dist/. Security: request line never reads query/headers/body; error line logs err.name + stack frames only; HTTPException passes through; Sentry scrubbed (query, headers, cookies, body, breadcrumbs, exception messages); leak/401/scrub tests proven red. `@cloudflare/workers-types`, `@sentry/*` in minimumReleaseAgeExclude.
- 2026-10-14 · 02/6 · `feat(base): Cloudflare PR previews for deployable pieces` · 263/263 tests, lint+fmt clean; base+hono-worker:api → turbo 11/11; `turbo run deploy:preview --dry=json` resolves passThroughEnv PR_NUMBER/CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID. preview.yml is a plain owned file with a runtime detect step (user decision: contract cannot emit `${{`); deploy skipped without the secret; shell bash (pipefail).
- 2026-10-15 · 02/7 · `ci: dogfood web and site combos` · 267/267 tests, lint+fmt clean; dogfood base/web/site cold 10.3/21.2/10.8 s (orchestrator run; implementer run 2.2/13.4/8.4 s), warm 0.8/2.0/1.7 s; single-vite ok for web and site. Decision: stay sequential (warm total ≈ 5 s ≪ 180 s, spec §10.2).
- 2026-10-15 · Milestone 2 reviewed · `fix: milestone 2 review findings` · 274/274 tests, lint+fmt clean; dogfood base 2.2 s, web 11.4 s, site 4.9 s, single-vite ok. Fixed: deploy tasks dependsOn build (static previews were broken); preact-app depends on @scope/ui when present; release-age excludes are exact name@version only; Renovate groups react/cascivo/sentry/preact; `## Pieces` in CLAUDE.md; `vite` peer rule; `vp test run` everywhere; fmt.sortPackageJson false.
- 2026-10-15 · 03/1 · `feat(rust-tool): Rust crates in a Cargo workspace, orchestrated by Turbo` · 287/287 tests, lint+fmt clean; dogfood base 2.0 s, web 11.0 s, site (now with rust-tool:tool) 6.8 s cold → 2.3 s warm, 16/16 cached incl. crate tasks. Two instances (rust-tool:a/b) share one workspace, cached outputs restore both binaries. Rust CI steps behind runtime guard (plain ci.yml); root Cargo.toml members per piece (cargo rejects unmatched globs). cargo-nextest 0.9.148 installed locally.
- 2026-10-15 · 03/2 · `feat(tauri-app): Tauri v2 shell with scheduled desktop builds` · 300/300 tests, lint+fmt clean; dogfood desktop 6.7 s (JS tasks + cargo fmt, single-vite ok), site 6.9 s. desktop.yml.jinja needs no `${{` so it renders only with tauri-app; `desktop` combo is scheduled-only (never on the PR path). tauri 2.12.4 / tauri-build 2.7.3 pinned; bundle deb only. Tauri compile not run here (no webkit2gtk-4.1).
- 2026-10-15 · 03/3 · `feat(docs): docspack piece with packs manifest and community recipes` · 309/309 tests, lint+fmt clean; dogfood docs 1.8 s, base/web/site still ok. In the rendered docs repo: `pnpm docs:sync` exit 0 (repo-docs 18 chunks, repo-code 9 chunks); `docspack ask "turbo affected" --json` exit 4 (valid JSON, no hits); `pnpm docs:packs` exit 0, 4 packs missing with `pnpm add -D` hints. vite-plus recipe built locally (224 chunks, ~68.5k tokens), `docspack doctor` ok. docspack 1.5.0 CLI matches spec §6.8.
- 2026-10-15 · 03/4 · `feat: CI timing check against the budget` · 321/321 tests, lint+fmt clean; dogfood base ok. `scripts/ci-timing.mjs` (gh via execFile, nearest-rank p50/p90, cancelled/skipped jobs ignored, exit 1 over budget, 2 on usage/gh errors); hull CI writes its job duration to the step summary; generated README has "Measure CI time". Not run against GitHub (no repo).
- 2026-10-15 · 03/5 · `docs: pieces reference and product README` · 321/321 tests, lint+fmt clean. `docs/pieces.md` generated by `pnpm docs:pieces` (test fails when stale); README quick start verified by hand (render → `pnpm run ci` 16/16 green); spec §13 keeps only open items.
- 2026-10-15 · Milestone 3 reviewed · `fix: milestone 3 review findings` · 325/325 tests, lint+fmt clean; dogfood base 1.8 s, web 11.6 s, site 7.9 s, docs 2.0 s. All-8-pieces render: 32/32 CI tasks in 18 s, no Tauri compile, CLAUDE.md 55 lines. Fixed: root Cargo/toolchain changes now schedule crate tasks (verified with `--affected --dry`); rust-tool `add` uses `cargo update --workspace` (no lock bumps); generated CI writes its duration; renderer warns on instance-name clashes across pieces; ci-timing counts pull_request runs only; docs recipe uses a `gh:` ref; README corrected (desktop.yml, no license claim).
- 2026-10-15 · splice sync · `fix: align dev renderer with splice template rules; rename org to keelstackhq` · 385/385 tests, lint+fmt clean; dogfood base 2.2 s, web 12.3 s, site 7.6 s, docs 2.1 s. Agreed in the splice ⇄ hull proposals doc: post.when required, description/prompt defaults, identifier rule + reserved loop/self/range/namespace, no symlinks, safe path segments + case-insensitive collisions (also fixed a target path-escape via `..` in a rendered segment). `docs/template-format.md` unchanged until the joint contract PR.
- 2026-10-15 · fix · `ci: make hull's workflow valid YAML` · hull's ci.yml had an unquoted `: ` in the Job duration step (since 03/4), so GitHub rejected the file and no job ran on any push. Fixed; actionlint 1.7.7 (downloaded) passes on hull's and all generated workflows; new test YAML-parses hull's workflows (seen red on the broken file). 386/386 tests.
- 2026-10-17 · 04/1 · `feat(base): PreToolUse guard denies publish, force/tag push, secret reads; asks before owned edits` · 442/442 tests, lint+fmt clean; dogfood base ok (1.9 s); rendered `echo '{...git -C . push -f}' | node .claude/hooks/guard.mjs` prints the deny JSON. Owned-file edits ask (user decision). Hull `vite.config.ts` ignores `tests/fixtures/lock/**` for fmt (aligned TOML fixture).
- 2026-10-17 · 04/2 · `feat(base): generated docs index for agents (scripts/agents-index.mjs)` · 466/466 tests, lint+fmt clean; dogfood base, web, docs ok; rendered base+docs: `agents-index.mjs` writes index (starts with header, 1.3 KB), `--check` exit 0, rendered `pnpm format:check` clean (rendered formatter wraps the `.sort().join()` chain).
- 2026-10-17 · 04/3 · `ci: check the agents index in generated CI and dogfood` · 472/472 tests, lint+fmt clean; dogfood base, web, site, docs, desktop ok (site needed cargo-nextest 0.9.148 installed locally); generated ci.yml step `Agents index current?` after checkout, before `Anything affected?`, no `if`; dogfood writes the index before turbo and checks it after; agents-index warns once on stderr (exit 0) when commands+packages exceed 8192 bytes.
- 2026-10-17 · 04/4 · `feat(base): AGENTS.md canonical, thin CLAUDE.md, Explore subagent on haiku` · 478/478 tests, lint+fmt clean; dogfood base, web, site, docs, desktop ok; lines AGENTS/CLAUDE: base 38/11, web 44/11, site 43/11, docs 39/12; always-loaded bytes (AGENTS+CLAUDE+project+index): base 3205, web 3764, site 3611, docs 3478; CEILING = 4150 (max 3764 + 10 %). Spec §9 item 3 checked with `claude -p` 2026-10-17: missing index import is not an error, loads after `agents-index`, nested `@AGENTS.md` resolves relative to the file. Per-instance `AGENTS.md` files arrive in Task 5 (bullets point to them already).
- 2026-10-17 · 04/5 · `feat: per-instance AGENTS.md owned, CLAUDE.md seed for local notes` · 485/485 tests, lint+fmt clean; dogfood base, web, site, docs, desktop ok; six pieces ship `files/AGENTS.md[.jinja]` (owned, ≤ 20 lines; hono-worker trimmed 21 → 20) and `files/CLAUDE.md` = `@AGENTS.md` (seed); rust-tool AGENTS.md points a distributed CLI to `rust-cli`; `assertInstanceNotes` in tests/helpers.mjs; docs/pieces.md regenerated; spec §4.2, §4.3.3, §6.3-6.6 updated.
- 2026-10-17 · 04/6 · `feat(ts-lib): ESM TypeScript library with publint and attw checks` · tests/ts-lib.test.mjs 8/8, full suite green, lint+fmt clean; hand dogfood base+ts-lib:lib (install, agents-index, turbo lint/format:check/typecheck/test/build, index --check) ok; dogfood base ok; ts-lib adds ~2 s to build (vp pack 0.5 s, publint 0.2 s, attw 1.3 s); attw runs next to TS 7 (bundled 5.6.1-rc).

## Measurements

<!-- Dogfood and CI timings: date, combo(s), cold/warm, seconds, machine or runner. -->

- 2026-10-14 · base · warm pnpm store, cold turbo cache · install 0.35 s, `turbo run lint format:check typecheck test build` 2.08 s (6 tasks) · cloud container, Node 24.21
- 2026-10-14 · dogfood base · cold turbo / warm turbo · 3.4 s / 0.9 s (render+install+5 CI tasks) · cloud container
- 2026-10-15 · dogfood base+web+site · cold turbo / warm turbo · base 10.3/0.8 s, web 21.2/2.0 s, site 10.8/1.7 s (render+install+CI tasks+single-vite) · cloud container, warm pnpm store
- 2026-10-15 · dogfood all PR combos after Milestone 3 fixes · cold turbo · base 1.8 s, web 11.6 s, site (incl. rust-tool) 7.9 s, docs 2.0 s · cloud container, warm pnpm store
- 2026-10-15 · site warm rerun · 2.3 s, 16/16 tasks cached incl. the crate · cloud container
- 2026-10-15 · hull CI on GitHub (run 38752514194, PR #1, first valid run) · cold caches, all 4 PR combos dogfooded (diff vs root commit) · job `ci` 86 s (14:33:53→14:35:19 UTC), `ci-ok` green · ubuntu-latest. Within the 120 s hull budget even cold; warm one-piece and docs-only runs not yet measured.
- 2026-10-15 · one repo with all 8 pieces · `turbo run lint format:check typecheck test build` 32/32 tasks in 18 s cold, no Tauri compile · cloud container

## Blocked

- Joint contract PR (hull + keelstackhq/splice, same week): apply the org rename and the agreed template-author rules (splice spec §10 items 10–18, 22) to `docs/template-format.md` §9 in both repos, byte-identical. Pending splice's answers in the proposals doc: whether hoard is `keelstackhq/hoard`, and the `{% raw %}` proposal.

- Real CI timings (needs hull on GitHub + canary repo): push hull to `keelstackhq/hull` and run `node scripts/ci-timing.mjs --repo keelstackhq/hull --budget 120` after ~20 PR runs; create `keelstackhq/hull-canary` from the `web` combo (`node scripts/render.mjs new --template template --out hull-canary --piece base --piece preact-app:web --piece ui-storybook --piece hono-worker:api --data scope=<scope>`), open ~20 PRs, run `node scripts/ci-timing.mjs --repo keelstackhq/hull-canary --budget 45`.

- Publish `@docspack-community/*` (needs npm scope + owner): create the `@docspack-community` npm scope with an owner, then for each recipe in `community-packs/` (vite-plus; hono and cloudflare listed in `docs/packs.json` once their recipes exist) run the README's `pnpm dlx docspack@1.5.0 build --from <docs dir> --name @docspack-community/<tool> --pkg-version <ver>` and `npm publish` the output. Until then `pnpm docs:packs --online` reports them as unpublished.

- Desktop build verified only on GitHub: this container has no webkit2gtk-4.1. Action: once hull is on GitHub, run `.github/workflows/desktop.yml` via workflow_dispatch and confirm `pnpm turbo run build:desktop` produces a `.deb` for the `desktop` combo.

- Cloudflare preview smoke test (needs account): in a repo rendered from the `web` combo, add repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + Account Settings:Read) and `CLOUDFLARE_ACCOUNT_ID`, open a PR, and check that `preview.yml` uploads `pr-<n>` versions and lists the `*.workers.dev` URLs in the job summary.

- Cloudflare account needed: verify that the empty `vars.SENTRY_DSN` in a generated `wrangler.jsonc` does not override a `wrangler secret put SENTRY_DSN` value on `wrangler deploy` (docs are silent). If it does, drop it from `vars` (spec §6.5 + plan 02 Global Constraints).

- Contract gap (keelstackhq/splice + hull, same week): the subset cannot emit `${{ … }}` from a `.jinja` file. Action: agree a contract §4 addition (proposed `{% raw %}…{% endraw %}`) in both repos' `docs/template-format.md`. Until then `ci.yml` is a plain owned file; plan 02 Task 6 (`preview.yml`) and plan 03 (`desktop.yml`, Rust steps in `ci.yml`) must use runtime guards (`hashFiles(...)`) or wait for the addition.

- Time-gated (no human needed): drop each exact `name@version` entry from `minimumReleaseAgeExclude` in base `pnpm-workspace.yaml` (and the matching assertion in `tests/base.test.mjs`) once it is 3 days old: turbo/@turbo/* after 2026-10-16, storybook/@storybook/* and @sentry/* after 2026-10-15 ~18:30Z, wrangler/miniflare/@cloudflare/workers-types after 2026-10-17. Exact versions mean old renders never bypass the gate for newer versions.

- Plan 03 Task 6 (hoard remote cache): `keelstackhq/hoard@v1` is not released (repo not publicly reachable on 2026-10-15). Action (keelstackhq/hoard owners): publish `v1` with a README documenting the GitHub-cache backend and the env it sets (`TURBO_API`/`TURBO_TOKEN`/`TURBO_TEAM`); then rerun plan 03 Task 6.

- Plan 03 Task 7 (render with splice + update test): `@keelstackhq/splice` 0.1 is not on npm (E404 on 2026-10-15). Action (keelstackhq/splice owners): publish 0.1 with `splice new|add|update|check --json` per contract §9.14; then rerun plan 03 Task 7 with `SPLICE_BIN` set.

- Plan 03 Task 8 (release v0.1.0): needs human go-ahead. Action: merge this branch to `main` once CI is green there, then add `CHANGELOG.md` (an agent can draft it on request) and run `git tag v0.1.0 && git push origin v0.1.0` (agents are denied `git tag`).

## Status

Written 2026-10-15 when the build loop stopped. Plans 01 and 02 are fully checked. Plan 03 Tasks 1–5
are checked; Tasks 6–8 are Blocked (hoard and splice are unreleased; the release needs a human).
Milestones 1, 2 and 3 are reviewed (lines above). 325 tests pass, lint and format are clean.

**What works**

- Dev renderer `scripts/render.mjs new` renders `template/` per the contract (format 1, §9): strict
  manifest loading, template-subset check (undefined variables are errors), ownership classes,
  staged writes (no partial output), `--json` output, exit codes 0/2/3.
- Eight pieces: `base` (pnpm 12 workspace, exact catalog, turbo, Vite+, one-job CI with an affected
  early exit, Renovate preset, Claude Code layer), `preact-app` (cascivo via `preact/compat`),
  `ui-storybook`, `astro-site`, `hono-worker` (JSON request logs that never contain query strings,
  headers, bodies or error messages; scrubbed optional Sentry), `rust-tool`, `tauri-app` (compiled
  only by the scheduled `desktop.yml`), `docs` (docspack).
- One Vite per repo (`check-single-vite`), template invariants (one class per path, subset,
  same-branches chains), CI-task parity between the generated workflow, the `ci` script and dogfood.
- Hull's own CI: lint, format, tests, then dogfood of the combos a diff touches.

**How to try it**

```bash
export PATH=/path/to/node24/bin:$PATH          # Node 24, pnpm 12.11.2
pnpm install
pnpm test && pnpm lint && pnpm format:check
node scripts/render.mjs new --template template --out /tmp/x --piece base --piece preact-app:web --data scope=acme --json
cd /tmp/x && git init -q && pnpm install --no-frozen-lockfile && pnpm run ci
node scripts/dogfood.mjs --combo base --combo web --combo site --combo docs   # needs Rust + cargo-nextest for site
node scripts/affected-combos.mjs --base HEAD~1
node scripts/ci-timing.mjs --repo <owner/repo> --budget 45                    # needs gh and a repo on GitHub
```

**Measured vs budgets**

| What | Budget | Measured | Where |
|---|---|---|---|
| Generated repo job `ci`, typical PR | ≤ 45 s p50 | not measured (no GitHub repo); local turbo CI tasks 2–12 s cold, ≤ 2 s warm | Measurements |
| Generated repo, docs-only PR | ≤ 15 s | not measured; early exit verified in a scratch repo (CLAUDE.md-only commit → skip) | 01 review fix |
| Hull job `ci`, one piece changed, warm | ≤ 120 s | first GitHub run: 86 s cold with all 4 combos (2026-10-15); warm one-piece not yet measured | Measurements |
| Hull, docs-only PR | ≤ 20 s | not measured; docs/tests select no combo | 01/9 |

All timings are from this cloud container, not GitHub runners; they are not evidence for the GitHub budgets.

**Blocked — needs you or an upstream repo** (full actions in the Blocked section above)

1. Put hull on GitHub (`keelstackhq/hull`), let CI run, then measure: `node scripts/ci-timing.mjs --repo keelstackhq/hull --budget 120`; create `keelstackhq/hull-canary` from the `web` combo and run it with `--budget 45`.
2. Run `desktop.yml` once via workflow_dispatch to verify the Tauri `.deb` build (no webkit2gtk here).
3. Cloudflare account: preview smoke test (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the `vars.SENTRY_DSN` vs `wrangler secret put` check.
4. Contract: agree a `{% raw %}` (or equivalent) addition with keelstackhq/splice so piece-dependent workflows can be `.jinja`.
5. npm scope `@docspack-community` + owner to publish the community doc packs.
6. keelstackhq/hoard v1 release (plan 03 Task 6) and @keelstackhq/splice 0.1 release (plan 03 Task 7).
7. Release v0.1.0 (plan 03 Task 8): merge to `main`, changelog, `git tag v0.1.0 && git push origin v0.1.0`.
8. Time-gated, no human needed: drop exact-version `minimumReleaseAgeExclude` entries as they pass 3 days (turbo after 2026-10-16, storybook/sentry after 2026-10-15 ~18:30Z, wrangler/miniflare/workers-types after 2026-10-17).

Environment note: this container shipped Node 22 / pnpm 10; the build used Node 24.21 (nvm) and pnpm 12.11.2.
A stray `/plan.bak` (a subagent backup written because `TMPDIR` is `/`) sits outside the repo; delete it if you like.
