# hull Milestone 3 — Native pieces, docs, splice, hoard and the CI budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pieces `rust-tool`, `tauri-app` and `docs` (docspack); a CI timing check against the budget; product docs; then, once released upstream, hull CI rendering with `splice` (with an update test) and the remote cache from `hoard`.

**Architecture:** Rust crates live in a root virtual Cargo workspace rendered by `base` when a Rust piece is present; each crate has a thin `package.json` whose scripts call cargo for that crate only, so Turbo orchestrates and caches Rust like JS. Tauri compiles only in a scheduled workflow. The docs piece wires docspack into the AI layer. Tasks 6 and 7 are blocked on other keelstack repos and are written so they can land later without touching earlier work.

**Tech Stack:** As milestones 1–2, plus Rust stable (edition 2024), cargo-nextest, @tauri-apps/cli 2.12.2, @tauri-apps/api 2.12.3, docspack 1.5.0, `gh` CLI (timing script), later `@keelstack/splice` 0.1 and `keelstack/hoard@v1`.

**Spec:** `docs/superpowers/specs/2026-10-14-hull-design.md` (§6.1 Cargo files, §6.6–§6.8, §8.1 step 6, §8.3, §8.4, §10, §11)

## Global Constraints

- All milestone 1 and 2 Global Constraints apply.
- Rust scripts always pass `-p <crate>`; never `--workspace` (it would pull in `src-tauri`, which needs webkit2gtk).
- Root `Cargo.toml`: `resolver = "3"`, `members` per piece (`crates/*` with rust-tool, `apps/*/src-tauri` with tauri-app; cargo rejects unmatched globs — changed 2026-10-15); rendered only when rust-tool or tauri-app is present.
- Tauri builds run only in `desktop.yml` (scheduled + manual), never on the PR path.
- docspack commands: `docspack sync`, `docspack index --repo`, `docspack ask "<q>" --json`. Never auto-edit `package.json` from scripts.
- Budgets: generated repo job `ci` p50 ≤ 45 s (typical PR), ≤ 15 s docs-only; hull job `ci` ≤ 120 s warm, ≤ 20 s docs-only.
- splice invocation (contract §9.14): `pnpm dlx @keelstack/splice@0.1 new <source> <dest> --piece <id>[:<name>]... --data <k>=<v>... --yes --json`.

## Review Focus

1. **A rust-tool repo whose PR touches only TypeScript** → Rust toolchain steps are skipped (`rust != 'true'`) and the job stays within budget. Test in Task 1 (workflow structure + affected-step logic unit test).
2. **Two rust-tool instances** (`rust-tool:a rust-tool:b`) → one root `Cargo.toml`, both crates build and test independently, turbo outputs do not collide. Test in Task 1.
3. **`docs/packs.json` lists a package that is not installed** → `pnpm docs:packs` reports it as missing with the `pnpm add -D` command and exits 0; nothing is modified. Test in Task 3.
4. **The session-start hook runs in a repo where docspack is not installed** → it skips the docspack step, prints one line, exits 0. Test in Task 3.
5. **`gh` returns runs with a cancelled or skipped `ci` job** → the timing script ignores them instead of counting zero-length jobs. Test in Task 4.

---

## File Structure

```
template/pieces/base/files/{Cargo.toml.jinja,rust-toolchain.toml.jinja}
template/pieces/base/files/.github/workflows/{ci.yml (plain, +rust steps behind runtime guards),desktop.yml.jinja}
template/pieces/rust-tool/{piece.toml,files/{Cargo.toml.jinja,package.json.jinja,turbo.json.jinja,src/main.rs,CLAUDE.md}}
template/pieces/tauri-app/{piece.toml,files/{package.json.jinja,src-tauri/**,CLAUDE.md}}
template/pieces/docs/{piece.toml,files/{docs/packs.json,docs/agents/docs.md,scripts/docs-packs.mjs}}
community-packs/{README.md,vite-plus/}
.github/workflows/desktop.yml                         # hull: scheduled tauri combo build
scripts/ci-timing.mjs  scripts/pieces-doc.mjs  docs/pieces.md
tests/rust-tool.test.mjs tauri-app.test.mjs docs-piece.test.mjs ci-timing.test.mjs pieces-doc.test.mjs
tests/splice-parity.test.mjs  tests/splice-update.test.mjs   # Task 7 (blocked)
```

---

### Task 1: `rust-tool` piece and Rust in generated CI

**Files:**
- Create: `template/pieces/rust-tool/**`, `template/pieces/base/files/Cargo.toml.jinja`, `template/pieces/base/files/rust-toolchain.toml.jinja`
- Modify: `template/pieces/base/files/.github/workflows/ci.yml` (plain; Rust steps behind runtime guards, spec §8.1 step 6), `scripts/dogfood.mjs` (`cargo generate-lockfile` for rust combos), `template/pieces/base/files/CLAUDE.md.jinja`, `scripts/combos.json` (`site` += `rust-tool:tool`), `.github/workflows/ci.yml` (Rust toolchain when a selected combo has rust-tool)
- Test: `tests/rust-tool.test.mjs`, `tests/ci-workflow.test.mjs` (extend)

**Interfaces:**
- Consumes: `renderCombo`, `elifBranches`/`assertSameBranches`, `CI_TASKS`
- Produces: crate `{{ name }}` with npm package `@{{ scope }}/{{ name }}`; generated step output `rust` (`'true'|'false'`); `tauri-app` (Task 2) adds `"apps/*/src-tauri"` to the per-piece root `Cargo.toml` members.

- [x] **Step 1: Write failing tests:**

```js
test("root Cargo.toml only with a Rust piece; branches identical", ...);
test("crate classes", ...);   // Cargo.toml shared(toml), package.json shared(json), turbo.json owned, src/main.rs seed
test("scripts call cargo with -p and never --workspace", async () => {
  const s = pkg("crates/tool").scripts;
  assert.equal(s.build, "cargo build --release -p tool"); assert.equal(s.test, "cargo nextest run -p tool");
  assert.ok(!Object.values(s).some(v => v.includes("--workspace")));
});
test("turbo outputs point at target/release/<name>", ...);
test("two instances render two crates and one workspace", ...);
test("ci.yml has rust steps guarded by rust == 'true' only with rust-tool", ...);
test("rust decision: affected packages with Cargo.toml → true", ...); // unit test of the inline script: extract it to template file .github/scripts/rust-affected.mjs (owned) and test that
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the files** per spec §6.1 (Cargo files), §6.6 and §8.1 step 6. The rust decision runs `.github/scripts/rust-affected.mjs` (owned, rendered only with rust-tool): reads `turbo query affected --packages` JSON from stdin and prints `rust=true|false` to `$GITHUB_OUTPUT`. Verify `$TURBO_ROOT$` in outputs with a real `turbo run build` twice (second run must be `FULL TURBO`).
- [x] **Step 4: Run `pnpm test` — expect PASS. Dogfood** `node scripts/dogfood.mjs --combo site` (needs Rust + `cargo install cargo-nextest --locked` locally) — passes; the second run shows cache hits for the crate.
- [x] **Step 5: Commit** — `feat(rust-tool): Rust crates in a Cargo workspace, orchestrated by Turbo`

---

### Task 2: `tauri-app` piece and scheduled desktop builds

**Files:**
- Create: `template/pieces/tauri-app/**` (incl. `src-tauri/icons/*` generated once with `pnpm tauri icon` from a 1024 px PNG), `template/pieces/base/files/.github/workflows/desktop.yml.jinja`, `.github/workflows/desktop.yml` (hull)
- Modify: `template/pieces/base/files/CLAUDE.md.jinja`, `scripts/combos.json` (+ `desktop`, flagged `"scheduled": true` so `affected-combos` never selects it), `scripts/affected-combos.mjs`
- Test: `tests/tauri-app.test.mjs`, `tests/affected-combos.test.mjs` (extend)

**Interfaces:**
- Consumes: preact-app scripts `dev`/`build`, dev port 5173 (plan 02 Task 2); root `Cargo.toml` (Task 1)
- Produces: scripts `tauri`, `build:desktop`, `format:check`; combo `desktop`.

- [x] **Step 1: Write failing tests:** manifest (`requires = ["base", "preact-app"]`, vars `name` default `desktop`, `frontend` default `web`); `tauri.conf.json` build commands and `frontendDist` per spec §6.7 with `frontend=admin`; icons copied byte-identical (sha256 equal to the template file); no `lint`/`test`/`build` scripts; `desktop.yml` present only with tauri-app, triggers `workflow_dispatch` + `schedule`, installs the four apt packages; `affectedCombos([...all files])` never returns `desktop`.
- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the files** per spec §6.7 and §8.3; hull's `desktop.yml` renders `desktop`, installs apt deps + Rust, runs the generated `pnpm turbo run build:desktop`.
- [x] **Step 4: Run `pnpm test` — expect PASS.** If the machine has webkit2gtk, run `node scripts/dogfood.mjs --combo desktop` and then `pnpm turbo run build:desktop` in the rendered dir; otherwise record "desktop build verified only on GitHub" under Blocked (needs the repo to run `desktop.yml` once).
- [x] **Step 5: Commit** — `feat(tauri-app): Tauri v2 shell with scheduled desktop builds`

---

### Task 3: `docs` piece (docspack)

**Files:**
- Create: `template/pieces/docs/piece.toml`, `files/docs/packs.json`, `files/docs/agents/docs.md`, `files/scripts/docs-packs.mjs`, `community-packs/README.md`, `community-packs/vite-plus/` (recipe: `README.md` with the `docspack build --from <dir>` command and source URL)
- Modify (conditional blocks on `"docs" in pieces`): base `package.json.jinja` (`docspack` devDependency, `docs:packs` = `node scripts/docs-packs.mjs`, `docs:sync` = `docspack sync && docspack index --repo`), `CLAUDE.md.jinja` (`@docs/agents/docs.md`), `.claude/hooks/session-start.sh`, `.claude/skills/docs-lookup/SKILL.md.jinja`; `scripts/combos.json` (+ `docs`)
- Test: `tests/docs-piece.test.mjs`

**Interfaces:**
- Produces: `docs/packs.json` (spec §6.8 shape); in the generated repo, `docsPacksReport(packs, installed: Set<string>): { tool, package, state: "installed"|"missing"|"unpublished" }[]` exported from `scripts/docs-packs.mjs`.

- [x] **Step 1: Write failing tests:**

```js
test("packs.json shape", ...);  // version 1; every pack has package + source ∈ {vendor, community}; community has build xor recipe
test("docs piece adds docspack devDependency and scripts", ...);
test("docs-lookup skill and CLAUDE.md import appear only with docs", ...);
test("report states", async () => {
  const { docsPacksReport } = await import(join(dir, "scripts/docs-packs.mjs"));
  const r = docsPacksReport({ hono: { package: "@docspack-community/hono", source: "community", build: "hono" }, cascivo: { package: "@cascivo/docspack", source: "vendor" } }, new Set(["@cascivo/docspack"]));
  assert.deepEqual(r.map(x => [x.tool, x.state]), [["hono", "missing"], ["cascivo", "installed"]]);
});
test("docs-packs CLI exits 0 and modifies nothing", ...);       // hash the tree before/after
test("session-start skips docspack when not installed", ...);
test("every recipe folder named in packs.json exists in community-packs/", ...);
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the files** per spec §6.8. `unpublished` is decided only with `--online` (`npm view <pkg> version`); offline the script reports `missing`. Build the vite-plus recipe locally once with `pnpm dlx docspack@1.5.0 build --from <vite-plus docs checkout>` and `docspack doctor`; publishing `@docspack-community/*` goes under Blocked (needs the npm scope and an owner).
- [x] **Step 4: Run `pnpm test` — expect PASS. Dogfood** `--combo docs`; in the rendered dir `pnpm docs:sync` and `pnpm exec docspack ask "turbo affected" --json` return JSON (exit 0, 3 or 4 are all acceptable; paste which).
- [x] **Step 5: Commit** — `feat(docs): docspack piece with packs manifest and community recipes`

---

### Task 4: CI timing check against the budget

**Files:**
- Create: `scripts/ci-timing.mjs`, `tests/fixtures/gh/{runs.json,run-*.json}`
- Modify: `.github/workflows/ci.yml` (hull: append the job duration to `$GITHUB_STEP_SUMMARY`), `template/pieces/base/files/README.md.jinja` (a "Measure CI time" section with the `gh` commands from spec §8.4)
- Test: `tests/ci-timing.test.mjs`

**Interfaces:**
- Produces: `jobSeconds(runJson, jobName = "ci"): number | null` (null unless conclusion is `success`); `summarize(seconds: number[]): { n, p50, p90 }`; CLI `node scripts/ci-timing.mjs --repo <owner/repo> [--limit 20] [--budget 45] [--job ci]` exits 1 when p50 > budget.

- [ ] **Step 1: Write failing tests:**

```js
test("job seconds from startedAt/completedAt", () => assert.equal(jobSeconds(fx("run-ok")), 38));
test("cancelled and skipped jobs are null", () => { assert.equal(jobSeconds(fx("run-cancelled")), null); assert.equal(jobSeconds(fx("run-skipped")), null); });
test("p50/p90", () => assert.deepEqual(summarize([10, 20, 30, 40, 50]), { n: 5, p50: 30, p90: 50 }));
test("CLI exits 1 over budget", ...);   // inject a fake gh via opts.gh
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement** with `gh run list -R <repo> -w ci.yml -L <n> --json databaseId` and `gh run view <id> -R <repo> --json jobs`; `opts.gh` injectable for tests.
- [ ] **Step 4: Run `pnpm test` — expect PASS.** Real measurement needs hull on GitHub and a canary repo (`keelstack/hull-canary`, rendered from `web`): put both under Blocked with the commands to run (`node scripts/ci-timing.mjs --repo keelstack/hull --budget 120`, `--repo keelstack/hull-canary --budget 45`).
- [ ] **Step 5: Commit** — `feat: CI timing check against the budget`

---

### Task 5: Product docs

**Files:**
- Create: `scripts/pieces-doc.mjs`, `docs/pieces.md` (generated)
- Modify: `README.md` (the product README; it was `README.md.product` in the starter kit), spec §13 (remove items verified during the build)
- Test: `tests/pieces-doc.test.mjs`

**Interfaces:**
- Consumes: `loadTemplate`, `overlaps`
- Produces: `piecesDoc(t: Template): string` — one section per piece: id, description, multiple, target, requires, vars with defaults, files grouped by class.

- [ ] **Step 1: Write failing tests:** `piecesDoc` output contains every piece id as a `## ` heading and every var default; `docs/pieces.md` on disk equals `piecesDoc(await loadTemplate("template"))` (fails when someone forgets to regenerate).
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement**, generate `docs/pieces.md`, and update `README.md`: quick start with the real commands as they exist now (dev renderer until splice ships), piece table, CI budget, AI layer, logging, known limits (`.astro` lint/fmt, Storybook peer range, preview URL caveats, observability pricing from 2026-12-01), and a short "Custom runners" note (spec §8.5: change `runs-on`; sticky disks replace the pnpm store cache).
- [ ] **Step 4: Run `pnpm test && pnpm lint && pnpm format:check` — expect PASS.**
- [ ] **Step 5: Commit** — `docs: pieces reference and product README`

---

### Task 6: Remote cache with hoard — BLOCKED until `keelstack/hoard@v1` is released

**Files:**
- Modify: `template/pieces/base/files/.github/workflows/ci.yml` (plain), `.github/workflows/ci.yml`
- Test: `tests/ci-workflow.test.mjs` (extend)

**Interfaces:**
- Consumes: `keelstack/hoard@v1` (no inputs needed for the GitHub cache backend; it sets `TURBO_API`, `TURBO_TOKEN`, `TURBO_TEAM` for later steps — confirm from hoard's README at release).

- [ ] **Step 1: Write failing tests:** the generated workflow has a step `uses: keelstack/hoard@v1` before `turbo run`, no `actions/cache` step on `.turbo`, and the hoard step is guarded by `skip` like the rest.
- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Replace** the `actions/cache` turbo step in both workflows; hull's dogfood passes `--cache-dir` only when hoard is absent.
- [ ] **Step 4: Run `pnpm test` — expect PASS;** after merge, compare `ci-timing` p50 before/after and record both in PROGRESS.
- [ ] **Step 5: Commit** — `ci: use hoard as the Turborepo remote cache`

---

### Task 7: Render with splice and test updates — BLOCKED until `@keelstack/splice` 0.1 is released

**Files:**
- Modify: `scripts/dogfood.mjs` (`--renderer splice|dev`, default `splice`), `.github/workflows/ci.yml`, `template/pieces/base/files/.claude/skills/add-piece/SKILL.md` (real flags), spec §4.3.8 and §11
- Create: `tests/splice-parity.test.mjs`, `tests/splice-update.test.mjs`
- Test: both new files (skipped with a clear message when `SPLICE_BIN` is unset; CI sets it)

**Interfaces:**
- Consumes: splice CLI and `--json` output (contract §8); `renderNew` as the oracle.

- [ ] **Step 1: Align flags.** Read splice's README/`splice new --help`; update the assumed invocation everywhere (spec §4.3.8, this plan's Global Constraints, add-piece skill). Report any contract mismatch to the splice repo.
- [ ] **Step 2: Write failing tests:**

```js
test("splice and the dev renderer produce identical trees for every combo", ...); // ignore .splice/
test("splice --json matches the contract shape", ...);
test("update keeps seed, merges shared, guards owned", async () => {
  // 1. splice new from the previous tag (git worktree of v<prev>/template) → commit
  // 2. edit apps/web/src/app.tsx (seed), add "left-pad" to apps/web/package.json dependencies (shared), edit apps/web/vite.config.ts (owned)
  // 3. splice check → exit 1 naming apps/web/vite.config.ts
  // 4. splice update --force --json (to ./template)
  assert.equal(read("apps/web/src/app.tsx"), editedSeed);
  assert.ok(pkg("apps/web").dependencies["left-pad"]);
  assert.equal(read("apps/web/vite.config.ts"), renderedOwned);
  assert.equal(run("splice check").code, 0);
});
```

- [ ] **Step 3: Run with `SPLICE_BIN` set — expect FAIL** (dogfood still on the dev renderer).
- [ ] **Step 4: Switch** dogfood and hull CI to `pnpm dlx @keelstack/splice@0.1 new …`; keep the dev renderer for the parity test.
- [ ] **Step 5: Run `pnpm test` with `SPLICE_BIN` and `node scripts/dogfood.mjs --combo base --combo web --combo site --combo docs` — expect PASS.**
- [ ] **Step 6: Commit** — `ci: render combos with splice and test template updates`

---

### Task 8: Release v0.1.0 — needs a human go-ahead

- [ ] **Step 1:** All earlier tasks done or Blocked with an owner; `pnpm test`, lint, format and dogfood for all PR combos pass on `main`.
- [ ] **Step 2:** Add `CHANGELOG.md` (`## v0.1.0 — <date>`: pieces, CI budget, known limits). Commit — `docs: changelog for v0.1.0`.
- [ ] **Step 3:** The human creates and pushes the tag (`git tag v0.1.0 && git push origin v0.1.0`; `git tag` is denied for agents in `.claude/settings.json`). Until then, list it under Blocked with that command.

---

## Milestone 3 done when

Tasks 1–5 checked; Tasks 6–8 checked or Blocked with the exact human or upstream action; dogfood passes for `base`, `web`, `site`, `docs`; superpowers:requesting-code-review recorded in `docs/PROGRESS.md`.
