# Progress

One short line per finished task: `YYYY-MM-DD · plan/task · commit`. Test counts and detail live in the commit and PR; timings go to Measurements.

## Done

- 2026-10-14 · 01/1 · `feat: scaffold hull and load template manifests`
- 2026-10-14 · 01/2 · `feat: check templates against the portable subset`
- 2026-10-14 · 01/3 · `feat: classify ownership and plan renders`
- 2026-10-14 · 01/4 · `feat: dev renderer writes new repos from the template`
- 2026-10-14 · 01/5 · `test: template invariants and base skeleton`
- 2026-10-14 · 01/6 · `feat(base): workspace, catalog, turbo and Vite+ config`
- 2026-10-14 · 01/7 · `feat(base): one-job CI with affected early exit and Renovate preset`
- 2026-10-14 · 01/8 · `feat(base): Claude Code layer — agents, skills, hooks, loop`
- 2026-10-14 · 01/9 · `ci: dogfood rendered combos in hull CI`
- 2026-10-14 · Milestone 1 reviewed · `fix: milestone 1 review findings`
- 2026-10-14 · 02/1 · `feat: check that a lockfile resolves a single vite`
- 2026-10-14 · 02/2 · `feat(preact-app): Preact app on Vite+ with cascivo`
- 2026-10-14 · 02/3 · `feat(ui-storybook): Preact UI package with Storybook 10.6`
- 2026-10-14 · 02/4 · `feat(astro-site): Astro 7 static site sharing Vite+ core`
- 2026-10-14 · 02/5 · `feat(hono-worker): Hono worker with JSON request logs and optional Sentry`
- 2026-10-14 · 02/6 · `feat(base): Cloudflare PR previews for deployable pieces`
- 2026-10-15 · 02/7 · `ci: dogfood web and site combos`
- 2026-10-15 · Milestone 2 reviewed · `fix: milestone 2 review findings`
- 2026-10-15 · 03/1 · `feat(rust-tool): Rust crates in a Cargo workspace, orchestrated by Turbo`
- 2026-10-15 · 03/2 · `feat(tauri-app): Tauri v2 shell with scheduled desktop builds`
- 2026-10-15 · 03/3 · `feat(docs): docspack piece with packs manifest and community recipes`
- 2026-10-15 · 03/4 · `feat: CI timing check against the budget`
- 2026-10-15 · 03/5 · `docs: pieces reference and product README`
- 2026-10-15 · Milestone 3 reviewed · `fix: milestone 3 review findings`
- 2026-10-15 · splice sync · `fix: align dev renderer with splice template rules; rename org to keelstackhq`
- 2026-10-15 · fix · `ci: make hull's workflow valid YAML`
- 2026-10-17 · 04/1 · `feat(base): PreToolUse guard denies publish, force/tag push, secret reads; asks before owned edits`
- 2026-10-17 · 04/2 · `feat(base): generated docs index for agents (scripts/agents-index.mjs)`
- 2026-10-17 · 04/3 · `ci: check the agents index in generated CI and dogfood`
- 2026-10-17 · 04/4 · `feat(base): AGENTS.md canonical, thin CLAUDE.md, Explore subagent on haiku`
- 2026-10-17 · 04/5 · `feat: per-instance AGENTS.md owned, CLAUDE.md seed for local notes`
- 2026-10-17 · 04/6 · `feat(ts-lib): ESM TypeScript library with publint and attw checks`
- 2026-10-17 · 04/7 · `feat(rust-cli): Rust CLI skeleton with JSON/exit contract, pinned toolchain and cargo-deny`
- 2026-10-17 · 04/8 · `feat(npm-cli): npm launcher and platform packages for a rust-cli binary`
- 2026-10-17 · 04/9 · `feat(base): tag-driven release workflow with npm trusted publishing and provenance`
- 2026-10-17 · 04/10 · `ci: dogfood cli and lib combos`
- 2026-10-17 · 04/11 · `docs: amend hull spec and CLAUDE.md for agent layer v2 and skeleton pieces`
- 2026-10-17 · 04/final review · `fix: final review — guard bypasses, Explore agent, pinned nextest`
- 2026-10-21 · 04/12 · https://github.com/keelstackhq/cli-canary (rendered from 7c7eadf; PRs #1-#3 closed, not merged)
- 2026-10-21 · splice-04/C2 dogfood · local splice 0.2.0, `gh:keelstackhq/hull//rigging` at 09d2a8d, `base` render
- 2026-10-18 · splice-04/C2 · `feat: rigging channel template; AGENTS.md becomes seed`
- 2026-10-21 · contract §9.15-26 · `feat(renderer): raw blocks, stray #} and ASCII tag whitespace per contract §9.19-24`
- 2026-10-22 · owner decisions (npm-cli) · `feat(npm-cli): tsc typecheck with @types/node, require rust-cli`
- 2026-10-22 · splice update bot · `ci: add the splice update bot`
- 2026-10-22 · migrations names · `fix: migrations/ holds only <semver>.toml files`
- 2026-10-22 · 03/7 · `ci: render combos with splice and test template updates`
- 2026-10-22 · 03/6 · `ci: use hoard as the Turborepo remote cache`
- 2026-10-22 · base agents → rigging · `feat(base)!: subagents move to the rigging channel`
- 2026-10-22 · 03/8 step 2 · `docs: changelog for v0.1.0`
- 2026-10-22 · v0.2.2 · `fix(base): PR previews skip a Worker that was never deployed`
- 2026-10-23 · 05/1-5 · `feat: template-rust, a pure Rust template without Turborepo`
- 2026-10-23 · 05/canary · https://github.com/keelstackhq/rust-canary (rendered from hull d25ab5e with `--piece rust-cli:cli`, plus rigging `--piece claude` and decisions `--piece import-project`; PR #1 merged, measurement PRs #2/#3 closed unmerged)
- 2026-10-23 · bosun hooks (option b) · `feat: guarded bosun hooks in hull's settings.json`

- 2026-10-26 · auto-release · `ci: tag and release hull from CHANGELOG.md on main`
- 2026-10-28 · docspack pin · `feat(docs): pin the keelstack docs pack to 0.1.1`
- 2026-10-27 · secrets-ci/HU-1a · `refactor: combos as fragments in scripts/combos/` (#28)
- 2026-10-27 · secrets-ci/HU-1b · `refactor: CI_PLAN and gen-ci generate ci.yml` (#29)
- 2026-10-28 · secrets-ci/HU-2 · `feat: circleci piece` (#44, #45)
- 2026-10-28 · secrets-ci/HU-3 · `feat: circleci-only piece and ci-ok mirror` (#46)
- 2026-10-28 · secrets-ci/HU-4 · `feat: secrets piece, two-phase previews, deploy.yml` (#38, #39, #40, #42)
- 2026-10-28 · secrets-ci/HU-4 guard · `feat: release refuses to tag while TODO(hoist-release) pins remain` (#36, #37)
- 2026-10-28 · secrets-ci/HU-7 · `feat(template-rust): circleci piece` and `circleci-only piece` (#48, #49)
- 2026-10-27 · secrets-ci/HU-8 · `docs: contract rule 9.27` (#26) and `docs: contract rule 9.28 (--data keys)` (#41, #43)
- 2026-10-28 · update bot · `feat: weekly splice update bot for template/ repos` (#50, #53, #54, #55, #56)
- 2026-10-28 · ci-extra · `feat: seeded scripts/ci-extra.sh hook, run last in CI` (#52)
- 2026-10-28 · fixes · #33 `package-manager-cache: false` in base `release.yml` job `npm`; #57 hono-worker leak tests use marker `zQsecretQz` (the old marker made `logging.test.ts` about 2% flaky); #5
- 2026-10-28 · secrets-ci/HU-9 (docs part) · `docs: secrets + CircleCI wrap-up (changelog, progress, CLAUDE.md)`
- 2026-10-28 · secrets-ci/HU-9 (release) · `release: v0.4.0 — pin hoist v0.3.0 secrets action`
- 2026-10-29 · start-checklist · `feat: project-start checklist and the ready check`
- 2026-10-29 · onboarding · `feat(ready): onboarding questions decide optional checklist items`
- 2026-10-29 · release · `release: v0.5.0 — start checklist, ready and onboarding`
- 2026-10-29 · bosun 0.3.0 · `fix: start checklist matches bosun 0.3.0`
- 2026-10-31 · docspack age · `chore: drop the docspack 0.1.1 release-age exclude`
- 2026-11-09 · release · `release: hull v0.8.0`
- 2026-11-09 · docs · `docs: update an existing repo to the latest hull`
- 2026-11-09 · deps · `chore(deps): react, react-dom 19.3.1`
- 2026-11-09 · deps · `chore(deps): storybook 10.6.6`
- 2026-11-09 · deps · `chore(deps): astro 7.4.7, @astrojs/preact 6.1.2`
- 2026-11-09 · deps · `chore(deps): hono 4.13.16, wrangler 4.158.0, workers-types 5.20261106.1, sentry 11.11.0`
- 2026-11-09 · deps · `chore(deps): turbo 2.11.10`
- 2026-11-09 · deps · `chore(deps): happy-dom 21.0.4`
- 2026-11-09 · deps · `chore(deps): preact 11.2.0`
- 2026-11-09 · deps · `chore(deps): @tauri-apps/cli, api 2.12.4`
- 2026-11-01 · first-user feedback B5 · `feat(ready): template-rust ships ready; release question`
- 2026-11-01 · release · `release: v0.5.2 — ready in template-rust`
- 2026-11-02 · adopt A · `feat(ready): --assess for existing repos`
- 2026-11-02 · adopt B · `docs: adopt.md for existing repos`
- 2026-11-02 · release · `release: v0.6.0 — existing repos`
- 2026-11-02 · ZX T1 · `feat(ready): fixed --assess --json schema (hull.assess/1)`
- 2026-11-06 · release · `release: hull v0.7.0`
- 2026-11-09 · deps · `chore(deps): vite-plus 1.5.0`
- 2026-11-12 · release · `docs: release v0.9.0`
- 2026-11-12 · deps · `chore(deps): vite-plus 1.5.1`
- 2026-11-14 · release · `docs: release v0.10.0`
- 2026-11-14 · audit-v0.10.0 · `fix(guard): …` one PR, 400-line cap waived by the owner · G1-G5, F1-F4, F5/F6, D1, S1/S2 of the v0.10.0 audit (see CHANGELOG v0.11.0). Table tests for every guard form, red first. Spec §6.9/§9 and `docs/start-checklist.md` updated in the same PR. Human: the release must update `docs/adopt.md`'s URL and sha256 for the new `ready.mjs` and host the new assess file; a repo with rigging's `claude` piece updates the channel first, then the template; set the server-side branch ruleset (the guard is a rail, not a sandbox).
- 2026-11-14 · improve-round-2 · `fix(guard): …` cd/patch/find-exec gaps closed, ready output trimmed, stale BUILD_PROMPT removed; tests first. Dogfood "Exec format error" is this container's pnpm shim on PATH, not hull (put /usr/bin first).
- 2026-11-14 · improve-round-3 · `fix(guard): …` chdir variants, glob cd, chain-made git diff patches; combos dogfooded with /usr/bin first on PATH; agent dry run notes in the PR.
- 2026-11-14 · release · `release: v0.11.0` · CHANGELOG dated (guard hardening rounds 1-3, PR-ready AGENTS.md, compact `ready`, agents in base; changelog.d and progress.d folded). adopt.md URL v0.11.0 with the real sha256 of ready.mjs. Human: host assess/v0.11.0.mjs on keelstack.dev (as v0.10.0); release.yml tags v0.11.0 after the owner approves the `release` environment.
- 2026-11-15 · release · `release: v0.12.0` · CHANGELOG dated (adopt notes, hoard 0.6.0, hoist 0.5.0, splice action 0.5.0 pins, hoard CircleCI `restore` param, optional janitor); spec version text fixed. `ready.mjs` unchanged (sha256 same as v0.11.0), adopt.md URL moved to v0.12.0 because a hull test pins the newest release. Human: host assess/v0.12.0.mjs on keelstack.dev; release.yml tags v0.12.0 after the owner approves the `release` environment; a later PR bumps the splice pins to v0.5.1.
- 2026-11-16 · hoard-restore · `fix(circleci): hoard skips its cache restore on main` · `restore: false` on main, default on PRs; TODO removed; test expands both branches; spec §6.4/§12.15
- 2026-11-16 · pnpm-placeholder · `fix(base): session-start finishes a pinned pnpm whose install.js was skipped` · loop over `$PNPM_HOME/.tools/pnpm/*` (XDG fallback), placeholder + XDG tests; reproduced ENOEXEC → ok here; spec §6
- 2026-11-16 · contract-29 · `docs: contract rule 29 kept keys (sync with splice)` · template-format.md sha256 d59eb700… = splice dfd749c; no renderer change (no lock)
- 2026-11-16 · hoard-0.6.1 · `chore: pin hoard 0.6.1` · Actions pin 4a6d185f… (tag commit), CircleCI version + linux-x64 musl sha256 c7702f33…; vendored hoard.yml unchanged (blob d61fec53…); gen-ci, golden fixture + workflow sha256 snapshot (pin line only)
- 2026-11-16 · release · `release: v0.12.1` · CHANGELOG dated (CircleCI hoard restore skip on main, session-start pnpm placeholder fix, contract rule 29 kept keys, hoard 0.6.1 pin). `ready.mjs` unchanged (sha256 same as v0.12.0), adopt.md URL moved to v0.12.1 (a hull test pins the newest release). Human: host assess/v0.12.1.mjs on keelstack.dev; release.yml tags v0.12.1 after the owner approves the `release` environment.
- 2026-11-17 · licenses · `feat: third-party licenses list in generated repos` · `scripts/licenses.mjs` (both templates) writes THIRD_PARTY_LICENSES.md + third-party-licenses.json (pnpm licenses / cargo metadata); CI step `licenses` = lockfile sha256 gate (~0.05 s, no install); dogfood base, cli, rust green via splice 0.4.0 (cli: 76 npm + 79 cargo, 0 UNKNOWN; generation 1.4 s)

## Measurements

<!-- Dogfood and CI timings: date, combo(s), cold/warm, seconds, machine or runner. -->

- 2026-10-23 · keelstackhq/rust-canary (template-rust, rust combo) on GitHub ubuntu-latest · cold PR #1 job `ci` 65 s (toolchain 9, clippy 15, tests 17, cache save 11); docs-only PR #2 7 s (early exit); crate PR #3 34 s warm (toolchain 11, rust-cache restore 6, install-action 2, clippy 2, deny 1, nextest 1, doc tests 1) · runs 39971885224, 39972430712, 39972437869

- 2026-10-23 · cli combo (base+rust-cli) turbo vs plain cargo, same CI tasks · cold 25.8 s vs 26.0 s; crate changed + warm target 1.35 s vs 2.2 s; unchanged 0.24 s (turbo hit) vs 1.35 s (cargo no-op); target/ 621 MB · cloud container, Rust 1.99.1. GitHub: Node setup 10 s (pnpm/action-setup 5, setup-node 4, install 1; hull run 39808906539)
- 2026-10-23 · dogfood rust (template-rust) · cold `target/` · 22.8 s with splice and with the dev renderer · cloud container

- 2026-10-14 · base · warm pnpm store, cold turbo cache · install 0.35 s, `turbo run lint format:check typecheck test build` 2.08 s (6 tasks) · cloud container, Node 24.21
- 2026-10-14 · dogfood base · cold turbo / warm turbo · 3.4 s / 0.9 s (render+install+5 CI tasks) · cloud container
- 2026-10-15 · dogfood base+web+site · cold turbo / warm turbo · base 10.3/0.8 s, web 21.2/2.0 s, site 10.8/1.7 s (render+install+CI tasks+single-vite) · cloud container, warm pnpm store
- 2026-10-15 · dogfood all PR combos after Milestone 3 fixes · cold turbo · base 1.8 s, web 11.6 s, site (incl. rust-tool) 7.9 s, docs 2.0 s · cloud container, warm pnpm store
- 2026-10-15 · site warm rerun · 2.3 s, 16/16 tasks cached incl. the crate · cloud container
- 2026-10-15 · hull CI on GitHub (run 38752514194, PR #1, first valid run) · cold caches, all 4 PR combos dogfooded (diff vs root commit) · job `ci` 86 s (14:33:53→14:35:19 UTC), `ci-ok` green · ubuntu-latest. Within the 120 s hull budget even cold; warm one-piece and docs-only runs not yet measured.
- 2026-10-15 · one repo with all 8 pieces · `turbo run lint format:check typecheck test build` 32/32 tasks in 18 s cold, no Tauri compile · cloud container
- 2026-10-17 · hand dogfood base+rust-cli:cli · `turbo run lint format:check typecheck test build` 11/11 tasks 22 s cold turbo (cargo registry warm, fresh `target/`), 1 s warm (11/11 cached); touching root `Cargo.lock` → test cache miss, also without globalDependencies · cloud container, Rust 1.99.1
- 2026-10-17 · dogfood base+web+site+docs+cli+lib, same `--cache-dir` · cold turbo / warm turbo · base 2.0/0.6 s, web 11.6/1.7 s, site 8.8/1.8 s, docs 1.9/1.0 s, cli 48.9/1.6 s, lib 4.7/0.8 s · cloud container, warm pnpm store, cargo-deny 0.20.2

## Blocked

- Next step 2026-11-12: bump astro 7.4.8, wrangler 4.159.0, hono 4.13.17, workers-types 5.20261109.1.

- First real release of a keelstackhq tool (needs a public npm scope + repo settings): verify `npm publish <pnpm-pack tgz> --provenance`, private-repo behaviour (npm generates no provenance for private repos; artifact attestations need a public repo or GitHub Enterprise Cloud), `ubuntu-24.04-arm`, `macos-latest` cross-building `x86_64-apple-darwin`, and that the `npm view <name>@<version> || npm publish` skip works with setup-node's placeholder `NODE_AUTH_TOKEN` (a 401 on the read would make a re-run try to republish). Before it, per repo: create the GitHub environment `release` with a tag rule `*-v*` and required reviewers (npm and github-release run in parallel, so the reviewers are the only gate before publishing); publish each new npm name once by hand; add an npm trusted publisher (repo, `release.yml`, environment `release`) to the launcher and all five platform packages, or the library, then release within 2 days.

- Publish `@docspack-community/*` (needs npm scope + owner): create the `@docspack-community` npm scope with an owner, then for each recipe in `community-packs/` (vite-plus; hono and cloudflare listed in `docs/packs.json` once their recipes exist) run the README's `pnpm dlx docspack@1.5.0 build --from <docs dir> --name @docspack-community/<tool> --pkg-version <ver>` and `npm publish` the output. Until then `pnpm docs:packs --online` reports them as unpublished.

- Desktop build verified only on GitHub: this container has no webkit2gtk-4.1. Action: run `.github/workflows/desktop.yml` via workflow_dispatch and confirm `pnpm turbo run build:desktop` produces a `.deb` for the `desktop` combo.

- Cloudflare preview smoke test (needs account), two-phase previews: in keelstackhq/example-app create the environment `preview` (Deployment branches: Selected → main), move `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` there and delete the repository secrets. Deploy `apps/api` and `apps/web` once (`pnpm turbo run deploy --filter=@keelstackhq/api --filter=@keelstackhq/web` after `wrangler login`; a never-deployed Worker cannot get versions). After `splice update`, open a PR and check that `preview.yml` uploads the artifact `preview-<pr>` and `preview-deploy.yml` (environment `preview`) deploys `<app>-preview` with alias `pr-<n>` (`wrangler versions upload --no-bundle --preview-alias`, assets, the `gh api … --jq '$ENV…'` PR-number fallback) and lists the `*.workers.dev` URLs in the job summary.

- Cloudflare account needed: verify that the empty `vars.SENTRY_DSN` in a generated `wrangler.jsonc` does not override a `wrangler secret put SENTRY_DSN` value on `wrangler deploy` (docs are silent). If it does, drop it from `vars` (spec §6.5 + plan 02 Global Constraints).

- template-rust release (spec §15), unverified until a repo releases: the hoist `release.yml` (workspace tags `{name}@{version}`, the 5-target build, `release-pending.mjs stage`). Action: in keelstackhq/rust-canary, follow `docs/agents/project.md` Blocked (drop `publish = false`, `[publish]` in `crates/cli/hoist.toml`, `hoist apply --area release`, `HOIST_RELEASE=enabled`), then merge hoist's release PR. The CI budget is measured (Measurements, 2026-10-23).

- hull auto-release (`release.yml`, spec §10.5) needs repo settings. Action: in keelstackhq/hull Settings → Environments, create or edit `release`: required reviewer = owner, and allow `main` in its deployment branches (a tag-only rule blocks the run, as in splice). The first automatic release is the next dated `## v<X.Y.Z>` heading; v0.3.0 was tagged by hand.

- Plan 03 Task 8 (release v0.1.0): needs human go-ahead. Action: merge this branch to `main` once CI is green there, then add `CHANGELOG.md` (an agent can draft it on request) and run `git tag v0.1.0 && git push origin v0.1.0` (agents are denied `git tag`).

- keelstackhq/hull: create environment `splice-bot` (Deployment branches: Selected → main) BEFORE the next splice.yml run, move SPLICE_BOT_TOKEN into it, delete the repo secret

- Release-tag ruleset in every consumer repo (spec §0 P2; keelstack, hull-canary-circleci and each later one). Action, on github.com: Settings → Rules → Rulesets → New tag ruleset `release-tags`, Active, bypass Repository admin only, include `*-v*`, rules: restrict creations, updates and deletions, block force pushes. Check with `bash scripts/owner/bootstrap-secrets.sh --check-rulesets OWNER/REPO...`.

- template-rust repo with that ruleset (for example rust-canary once it releases): create a release GitHub App (Contents write only; no Workflows permission needed) and install it, add it to the ruleset bypass list (mode "always"), set the repository variable `HOIST_RELEASE_APP_CLIENT_ID` and the secret `HOIST_RELEASE_APP_KEY` in environments `release-pr` and `release`, then run `bash scripts/owner/bootstrap-secrets.sh --check-rulesets --allow-app <app-id> OWNER/REPO`.

- template-rust consumers (rust-canary): create the environments `release-pr` and `splice-bot` (Deployment branches: Selected → main) and move `HOIST_RELEASE_TOKEN` and `SPLICE_BOT_TOKEN` into them, then delete the repository secrets, before the next `release.yml` / `splice.yml` run.

- Optional, hull's update bot with a GitHub App: create an App with Contents, Pull requests and Workflows write, install it on keelstackhq/hull, set the variable `SPLICE_APP_CLIENT_ID` and the secret `SPLICE_APP_KEY` in environment `splice-bot`. Or session mode: set the repository variable `SPLICE_BOT=off`. Nothing changes until one is set.

- `secrets` piece verification (needs hoist and a Cloudflare account): create environment `prod` (Selected → main) with `SOPS_AGE_KEY`; set org variable `SECRETS_READ_APP_ID` and org secret `SECRETS_READ_APP_KEY`; `hoist secrets grant` creates the environments (docs/agents/secrets.md); run `deploy.yml` once on `main`.

- CircleCI project settings for each CircleCI consumer, before its first pipeline (spec §0 P3; CAN-1 checks them on hull-canary-circleci). Action, on app.circleci.com → the project → Project settings → Advanced: enable "dynamic config using setup workflows"; "Build forked pull requests" on; "Pass secrets to builds from forked pull requests" OFF; "Prevent unregistered users from triggering builds" off (needed for the merge queue). Triggers: PRs, default-branch pushes and "Pushes to merge queues". Organization settings → Contexts: restrict `secrets-read` and `<repo>-prod` to the project.
- CircleCI canary (spec §12, CAN-1, for example hull-canary-circleci): verify `checkout: method: blobless`, `pipeline.git.base_revision` on GitHub App pipelines, the continuation API without orbs, `circleci config validate` online (`CIRCLECI_VALIDATE=1`), the `circleci-app[bot]` sender (record its numeric `sender.id`), the `ci/circleci: ci-ok` context and `pipeline.trigger_source` `scheduled_pipeline` / `api` (items 1, 3, 8, 16); measure the 75 s / 30 s Rust budgets.

- circleci-only repos with tauri-app (consumer step, also in the generated `AGENTS.md`): CircleCI Project Settings → Triggers → add a weekly scheduled trigger on branch `main` for the desktop builds.

- splice release that stops passing token variables to post hooks (cross-repo). Action: after it is out, repin `keelstackhq/splice/action` in `splice.yml` of hull, `template/` and `template-rust/` to that release's SHA.


## Status

Written 2026-10-15 when the build loop stopped. Plans 01 and 02 are fully checked. Plan 03 Tasks 1–5
are checked; Tasks 6–8 are Blocked (hoard and splice are unreleased; the release needs a human).
Milestones 1, 2 and 3 are reviewed (lines above). Updated 2026-10-17 after the milestone 4 final review: 580 tests pass, lint and format are clean.

**Milestone 4 (2026-10-17, plan 04 agent layer and skeletons, Tasks 1–12):** `AGENTS.md` canonical with a thin `CLAUDE.md`, project `Explore` on haiku, PreToolUse guard hook (asks on owned edits), generated docs index with a CI check, per-instance `AGENTS.md`, new pieces `ts-lib`, `rust-cli`, `npm-cli`, tag-driven `release.yml` with provenance, combos `cli` and `lib` dogfooded. Spec: `docs/superpowers/specs/2026-10-17-hull-agent-layer-and-skeletons-design.md` (approved; base spec amended). Final review 2026-10-17: with fixes, all fixed in one wave (Done line `04/final review`). Task 12 (cli CI timing on `keelstackhq/cli-canary`) is not done.

**Secrets + CircleCI (plan `2026-10-27-secrets-ci-hull.md`, updated 2026-10-28):** HU-1a, 1b, 2, 3, 4, 7 and 8 are done (Done lines above), with the update bot, `ci-extra` and `min_splice` 0.3.0 on top. HU-5 (secrets on CircleCI) and HU-6 (`template-secrets/`) are not started. HU-9 is done: CHANGELOG `v0.4.0 — 2026-10-28` pins hoist secrets v0.3.0 and splice 0.3.1; merging tags it after the owner approves the `release` environment.

**Open items after milestone 4**

- Release Blocked items: first real release of a keelstackhq tool. (Tagging after splice M2: done, splice 0.2.0 ships the class-change rules; v0.1.0 was tagged 2026-10-22.)
- ~~Human decisions: `@types/node` in the catalog; npm-cli `requires` = `["base", "rust-cli"]`~~ settled by the owner 2026-10-22 (YES to both) and implemented (Done line `owner decisions (npm-cli)`).

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
node scripts/render.mjs new --template template --out /tmp/x --piece preact-app:web --data scope=acme --json
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

- 2026-11-05 ci: PR workflows skip drafts (`ready_for_review` trigger, job `if`; `ci-ok` fails on drafts), draft-skip test, spec §8.1

**Blocked — needs you or an upstream repo** (full actions in the Blocked section above)

1. Run `desktop.yml` once via workflow_dispatch to verify the Tauri `.deb` build (no webkit2gtk here).
2. Cloudflare account: preview smoke test (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the `vars.SENTRY_DSN` vs `wrangler secret put` check.
3. ~~Contract: agree a `{% raw %}` addition with keelstackhq/splice~~ done 2026-10-21 (contract §4, §9.23; dev renderer implements it).
4. npm scope `@docspack-community` + owner to publish the community doc packs.
5. ~~hoard and splice releases~~: both out; plan 03 Tasks 6 and 7 done 2026-10-22. Open: Task 6 Step 4, compare `ci-timing` p50 before/after hoard (needs `gh`).
6. Release v0.1.0 (plan 03 Task 8): merge to `main`, changelog, `git tag v0.1.0 && git push origin v0.1.0`.

Environment note: this container shipped Node 22 / pnpm 10; the build used Node 24.21 (nvm) and pnpm 12.11.2.
A stray `/plan.bak` (a subagent backup written because `TMPDIR` is `/`) sits outside the repo; delete it if you like.
