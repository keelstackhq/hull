# hull Milestone 2 — Web pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pieces `preact-app` (with cascivo), `ui-storybook`, `astro-site` and `hono-worker` (JSON logging, observability, optional Sentry), the Cloudflare PR preview workflow, and hull CI rendering the `web` and `site` combos.

**Architecture:** Each piece is a directory under `template/pieces/` with `target = "<dir>/{{ name }}"` (or `packages/ui`), configs owned, `package.json` shared (json), `wrangler.jsonc` shared (text), source seed. Root-level effects (preview workflow, CLAUDE.md lines) are `{% if %}` blocks in `base` files. One Vite: every Vite consumer resolves to `@voidzero-dev/vite-plus-core` through the base override, enforced by `check-single-vite`.

**Tech Stack:** As milestone 1, plus generated-repo packages from spec §7: preact 10.29.8, @preact/preset-vite 2.10.6, @cascivo/react 1.9.0, @cascivo/themes 1.0.3, @preact/signals-react 3.12.0, react/react-dom 19.3.0 (dev-only), happy-dom 20.14.6 (added 2026-10-14 with user approval), storybook / @storybook/preact-vite / @storybook/addon-docs 10.6.2, astro 7.3.8, @astrojs/preact 6.0.6, hono 4.13.13, wrangler 4.151.0, @cloudflare/workers-types 5.20261014.1, @sentry/cloudflare 11.7.0.

**Spec:** `docs/superpowers/specs/2026-10-14-hull-design.md` (§4, §6.2–§6.5, §7.2, §8.2, §10)

## Global Constraints

- All milestone 1 Global Constraints apply.
- Package names `@{{ scope }}/{{ name }}`; scripts `lint`, `format:check`, `typecheck`, `test`, `build` as in spec §6.2–§6.5; never `vp run`.
- `typecheck` is `tsc --noEmit` (TypeScript 7.0.2).
- `wrangler.jsonc`: `compatibility_date: "2026-10-01"`, `observability.enabled: true`; hono-worker adds `compatibility_flags: ["nodejs_compat"]`, `vars.LOG_LEVEL = "info"`, `vars.SENTRY_DSN = ""`.
- Log line fields: `level`, `msg`, `requestId`, `method`, `path`, `status`, `durationMs`, optional `colo`, `country`. Never the query string, headers or body.
- Preview command: `wrangler versions upload --preview-alias pr-$PR_NUMBER`.
- Lockfile of every combo with a Vite piece: no `vite@` entry, exactly one `@voidzero-dev/vite-plus-core@` version.
- Storybook build, Playwright and visual tests never run on the PR path.

## Review Focus

1. **Astro or Storybook pulls in its own `vite`** (override not applied, e.g. a nested `vite` dep) → `check-single-vite` fails naming the offending lockfile key. Test in Task 1; enforced for every combo in Task 7.
2. **The worker throws** → exactly one `error` line with `requestId`, a `500` JSON body carrying the same `requestId`, and no second `request` line missing fields. Test in Task 5.
3. **A request URL carries secrets in the query string** (`/cb?token=abc`) → the log line's `path` is `/cb` and `abc` appears nowhere in the output. Test in Task 5.
4. **`SENTRY_DSN` is empty or unset** → no Sentry import side effects, requests still served. Test in Task 5.
5. **A fork PR has no Cloudflare secret** → the preview job's deploy step is skipped, the workflow is green. Test in Task 6 (structure: step `if` on the secret).

---

## File Structure

```
scripts/check-single-vite.mjs                      # checkSingleVite(lockText) + CLI <repoDir>
template/pieces/preact-app/{piece.toml,files/**}
template/pieces/ui-storybook/{piece.toml,files/**}
template/pieces/astro-site/{piece.toml,files/**}
template/pieces/hono-worker/{piece.toml,files/**}  # files/src/hull/{logging,sentry}.ts owned
template/pieces/base/files/.github/workflows/preview.yml
template/pieces/base/files/CLAUDE.md.jinja         # + one line per piece kind
scripts/combos.json                                # + web, site
tests/fixtures/lockfiles/{single,duplicate}.yaml
tests/single-vite.test.mjs preact-app.test.mjs ui-storybook.test.mjs astro-site.test.mjs hono-worker.test.mjs preview.test.mjs
```

---

### Task 1: One-Vite check

**Files:**
- Create: `scripts/check-single-vite.mjs`, `tests/fixtures/lockfiles/single.yaml`, `tests/fixtures/lockfiles/duplicate.yaml`
- Test: `tests/single-vite.test.mjs`

**Interfaces:**
- Produces: `checkSingleVite(lockText: string): { ok: boolean, coreVersions: string[], viteEntries: string[] }`; CLI `node scripts/check-single-vite.mjs <repoDir>` exits 1 with the offending keys.

- [x] **Step 1: Write failing tests:**

```js
test("single core, no vite → ok", () => assert.deepEqual(checkSingleVite(fx("single")), { ok: true, coreVersions: ["1.1.0"], viteEntries: [] }));
test("a real vite entry → not ok", () => { const r = checkSingleVite(fx("duplicate")); assert.equal(r.ok, false); assert.deepEqual(r.viteEntries, ["vite@8.3.3"]); });
test("two core versions → not ok", ...);
test("peer-suffixed keys count once", ...);  // "@voidzero-dev/vite-plus-core@1.1.0(@types/node@24.0.0)"
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Implement** by parsing `pnpm-lock.yaml` with `yaml` and reading the `packages:` keys (strip the `(...)` peer suffix). Fixtures: trimmed real lockfiles (generate `single.yaml` from a rendered base+preact-app install in Task 2 if easier, then trim).
- [x] **Step 4: Run `pnpm test` — expect PASS.**
- [x] **Step 5: Commit** — `feat: check that a lockfile resolves a single vite`

---

### Task 2: `preact-app` piece with cascivo

**Files:**
- Create: `template/pieces/preact-app/piece.toml`, `files/{package.json.jinja,vite.config.ts,tsconfig.json,wrangler.jsonc.jinja,index.html,src/main.tsx,src/app.tsx,src/app.test.tsx,CLAUDE.md}`
- Modify: `template/pieces/base/files/CLAUDE.md.jinja` (+ `{% if "preact-app" in pieces %}` line)
- Test: `tests/preact-app.test.mjs`

**Interfaces:**
- Consumes: `renderCombo`, `CI_TASKS`, `checkSingleVite`
- Produces: package `@{{ scope }}/{{ name }}` with `dist/` output; `deploy:preview` script (used by Task 6); `tauri-app` (plan 03) relies on scripts `dev` and `build` and on `vite` dev port 5173.

- [x] **Step 1: Verify cascivo.** Run `npm view @cascivo/react peerDependencies` and read the cascivo docs (`pnpm dlx docspack ask` with `@cascivo/docspack`, or the cascivo README) to confirm the Preact path (prebuilt `@cascivo/react` via `preact/compat`, or the `cascivo` CLI). Record the decision in spec §6.2 in this task's commit. If the packages cannot be installed (private or broken), keep a plain Preact app, put "cascivo package access" under Blocked, and continue.
- [x] **Step 2: Write failing tests:**

```js
test("piece manifest", ...);   // multiple, target "apps/{{ name }}", name default "web", requires ["base"]
test("renders at apps/<name> with classes", async () => {
  const { result } = await renderCombo(["base", "preact-app:admin"]);
  const cls = byPath(result);
  assert.equal(cls["apps/admin/package.json"], "shared"); assert.equal(cls["apps/admin/vite.config.ts"], "owned");
  assert.equal(cls["apps/admin/src/app.tsx"], "seed"); assert.equal(cls["apps/admin/wrangler.jsonc"], "shared");
});
test("package name and CI scripts", ...);       // "@acme/admin", every CI_TASKS script present, none uses "vp run"
test("wrangler.jsonc serves dist as an SPA with observability", ...);  // strip // comments, JSON.parse
test("root CLAUDE.md mentions apps when preact-app is present and stays ≤ 80 lines", ...);
```

- [x] **Step 3: Run `pnpm test` — expect FAIL.**
- [x] **Step 4: Write the piece** per spec §6.2. Seed app: one component using a cascivo component and theme, one Vitest test rendering it.
- [x] **Step 5: Run `pnpm test` — expect PASS. Dogfood by hand:** render `base preact-app:web`, `pnpm install --no-frozen-lockfile`, `pnpm turbo run lint format:check typecheck test build`, `node scripts/check-single-vite.mjs <dir>` — all pass.
- [x] **Step 6: Commit** — `feat(preact-app): Preact app on Vite+ with cascivo`

---

### Task 3: `ui-storybook` piece

**Files:**
- Create: `template/pieces/ui-storybook/piece.toml`, `files/{package.json.jinja,vite.config.ts,tsconfig.json,.storybook/main.ts,.storybook/preview.ts,src/index.ts,src/button.tsx,src/button.stories.tsx,src/button.test.tsx,CLAUDE.md}`
- Modify: `template/pieces/base/files/CLAUDE.md.jinja`
- Test: `tests/ui-storybook.test.mjs`

**Interfaces:**
- Produces: package `@{{ scope }}/ui` built with `vp pack` (`dist/`), task `storybook:build` (outputs `storybook-static/**`, defined in base `turbo.json`).

- [x] **Step 1: Write failing tests:** manifest (`multiple = false`, `target = "packages/ui"`); classes (`.storybook/main.ts` owned, `.storybook/preview.ts` seed, stories seed); `main.ts` names framework `@storybook/preact-vite`; scripts include `storybook:build` and `test` is `vp test` (no Storybook browser tests); `build` is `vp pack`.
- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the piece** per spec §6.3.
- [x] **Step 4: Run `pnpm test` — expect PASS. Dogfood by hand** with `base preact-app:web ui-storybook`: CI tasks pass, `check-single-vite` passes, and `pnpm --filter @hullci/ui storybook:build` succeeds once (off the PR path; proves the override works). Paste any `vite-plus` peer warning into PROGRESS.
- [x] **Step 5: Commit** — `feat(ui-storybook): Preact UI package with Storybook 10.6`

---

### Task 4: `astro-site` piece

**Files:**
- Create: `template/pieces/astro-site/piece.toml`, `files/{package.json.jinja,astro.config.mjs,tsconfig.json,wrangler.jsonc.jinja,src/pages/index.astro,src/components/hello.tsx,src/components/hello.test.tsx,CLAUDE.md}`
- Modify: `template/pieces/base/files/CLAUDE.md.jinja`
- Test: `tests/astro-site.test.mjs`

**Interfaces:**
- Produces: package `@{{ scope }}/{{ name }}` (`dist/` static output), `deploy:preview` script.

- [x] **Step 1: Write failing tests:** manifest (name default `site`); `build` is `astro build`, `typecheck` is `tsc --noEmit`, `format:check` excludes `.astro`; `astro.config.mjs` uses `@astrojs/preact` and `output: "static"`; the piece `CLAUDE.md` states that oxlint does not lint `.astro` templates and oxfmt `.astro` support is experimental.
- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the piece** per spec §6.4. Try `astro check` once with TypeScript 7.0.2; if it works, use it for `typecheck` and update spec §6.4; if not, keep `tsc --noEmit` and note the error in PROGRESS.
- [x] **Step 4: Run `pnpm test` — expect PASS. Dogfood by hand** `base astro-site:site`: CI tasks pass, `check-single-vite` passes (Astro's own `vite ^8.3.1` resolves to the core alias).
- [x] **Step 5: Commit** — `feat(astro-site): Astro 7 static site sharing Vite+ core`

---

### Task 5: `hono-worker` piece with logging

**Files:**
- Create: `template/pieces/hono-worker/piece.toml`, `files/{package.json.jinja,tsconfig.json,wrangler.jsonc.jinja,src/index.ts,src/index.test.ts,src/hull/logging.ts,src/hull/logging.test.ts,src/hull/sentry.ts,CLAUDE.md}`
- Modify: `template/pieces/base/files/CLAUDE.md.jinja`
- Test: `tests/hono-worker.test.mjs` (template-level); the behaviour tests are the generated `src/hull/logging.test.ts`, run by dogfood

**Interfaces:**
- Produces (in the generated package, spec §6.5):
  - `jsonLogger(): MiddlewareHandler`
  - `onErrorHandler(err: Error, c: Context): Response`
  - `withOptionalSentry<E extends { SENTRY_DSN?: string }>(app: Hono<{ Bindings: E }>): ExportedHandler<E>`

- [x] **Step 1: Write failing tests.** Template-level (`tests/hono-worker.test.mjs`): classes (`src/hull/*.ts` owned, `src/index.ts` seed, `wrangler.jsonc` shared text); wrangler config values from Global Constraints; scripts. Generated `src/hull/logging.test.ts` (Vitest, `app.request()`, spy on `console.log`):

```ts
it("logs one JSON line per request", async () => {
  await app.request("/hello");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: "info", msg: "request", method: "GET", path: "/hello", status: 200 });
  expect(typeof lines()[0].requestId).toBe("string"); expect(typeof lines()[0].durationMs).toBe("number");
});
it("drops the query string", async () => { await app.request("/cb?token=abc"); expect(raw()).not.toContain("abc"); expect(lines()[0].path).toBe("/cb"); });
it("warn for 404, error for 500", ...);
it("thrown error → one error line and 500 with the same requestId", async () => {
  const res = await app.request("/boom"); const body = await res.json();
  expect(res.status).toBe(500); expect(body).toEqual({ error: "internal", requestId: expect.any(String) });
  expect(lines().filter(l => l.level === "error")).toHaveLength(1);
  expect(lines().every(l => l.requestId === body.requestId)).toBe(true);
});
it("echoes x-request-id", ...);
it("withOptionalSentry returns the app unchanged when SENTRY_DSN is empty", ...);
```

- [x] **Step 2: Run `pnpm test` (template-level) — expect FAIL.**
- [x] **Step 3: Write the piece** per spec §6.5. `src/index.ts` seed: `requestId()`, `jsonLogger()`, `onError(onErrorHandler)`, a `/` route, `export default withOptionalSentry(app)`. Test app for the logging tests is built inside the test file (routes `/hello`, `/boom`). The OTel/Axiom lines in `wrangler.jsonc` are comments marked "verify against https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/".
- [x] **Step 4: Run `pnpm test` — expect PASS. Dogfood by hand** `base hono-worker:api`: CI tasks pass, including the generated logging tests; `pnpm --filter @hullci/api build` produces `dist/`.
- [x] **Step 5: Commit** — `feat(hono-worker): Hono worker with JSON request logs and optional Sentry`

---

### Task 6: Cloudflare PR preview workflow

**Files:**
- Create: `template/pieces/base/files/.github/workflows/preview.yml` (plain, owned; was `.jinja` — changed 2026-10-14 by user decision, contract cannot emit `${{`)
- Test: `tests/preview.test.mjs`

**Interfaces:**
- Consumes: `deploy:preview` scripts (Tasks 2, 4, 5)
- Produces: generated `.github/workflows/preview.yml` (spec §8.2)
- Deviation (user decision 2026-10-14): tests "absent for base only" and "elif branches are identical" become "base-only: every step after detection is guarded by the deploy output"; no same-branches chain.

- [x] **Step 1: Write failing tests:**

```js
test("base only: every step after detection is guarded by the deploy output", ...);
for (const p of ["preact-app", "astro-site", "hono-worker"]) test(`apps/*/wrangler.jsonc matches with ${p}`, ...);
test("runs deploy:preview --affected with PR_NUMBER and Cloudflare env, shell bash (pipefail)", ...);
test("turbo passes PR_NUMBER and Cloudflare env through to deploy:preview", ...);
test("deploy step is skipped without the secret", ...);   // step.if mentions CLOUDFLARE_API_TOKEN != ''
test("pull_request only, concurrency per PR, contents: read", ...);
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Write the workflow** per spec §8.2 as a plain owned file with a detection step (`apps/*/wrangler.jsonc`) guarding every later step. Put the secret into job `env` so the step `if` can test `env.CLOUDFLARE_API_TOKEN != ''`. Preview URLs: grep wrangler output for `*.workers.dev` URLs and append to `$GITHUB_STEP_SUMMARY`. `deploy:preview`/`deploy` in base `turbo.json` declare `passThroughEnv`.
- [x] **Step 4: Run `pnpm test` — expect PASS.** A real preview run needs a Cloudflare account and token: put "Cloudflare preview smoke test" under Blocked with the exact secrets needed.
- [x] **Step 5: Commit** — `feat(base): Cloudflare PR previews for deployable pieces`

---

### Task 7: Web combos in hull CI and the sequential-vs-matrix decision

**Files:**
- Modify: `scripts/combos.json` (+ `web`, `site` per spec §10.1; `site` = `base, astro-site:site` until plan 03 adds rust-tool), `scripts/dogfood.mjs` (run `check-single-vite` when a combo has preact-app, ui-storybook or astro-site)
- Test: `tests/affected-combos.test.mjs` (extend), `tests/parity.test.mjs` (extend)

**Interfaces:**
- Consumes: `dogfood`, `checkSingleVite`
- Produces: final combo names `base`, `web`, `site` used by plan 03.

- [x] **Step 1: Write failing tests:** `affectedCombos(["template/pieces/hono-worker/files/x"])` → `["web"]`; `astro-site` → `["site"]`; every combo in `combos.json` renders without error (fast: render only); dogfood calls the single-vite check for `web` and `site` but not `base` (inject a fake runner).
- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Implement.** Inject the command runner into `dogfood()` (`opts.run?: (cmd, args, cwd) => Promise<number>`) so tests do not spawn pnpm.
- [x] **Step 4: Measure:** `node scripts/dogfood.mjs --combo base --combo web --combo site` twice (cold, then warm with the same `--cache-dir`). Record both times per combo in PROGRESS. Keep sequential unless warm total > 180 s and a matrix would halve it (spec §10.2); if switching, update spec §10.2 in this commit.
- [x] **Step 5: Run `pnpm test && pnpm lint && pnpm format:check` — expect PASS.**
- [x] **Step 6: Commit** — `ci: dogfood web and site combos`

---

## Milestone 2 done when

All tasks checked (cascivo access and Cloudflare smoke test may be Blocked); dogfood passes for `base`, `web`, `site`; single-vite holds for `web` and `site`; superpowers:requesting-code-review recorded in `docs/PROGRESS.md`.
