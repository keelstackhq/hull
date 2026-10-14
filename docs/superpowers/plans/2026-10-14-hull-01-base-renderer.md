# hull Milestone 1 — Dev renderer, invariants and the `base` piece — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node dev renderer that renders hull's template exactly as the shared contract says, tests that keep the template inside the contract, a complete `base` piece (workspace, catalog, turbo, Vite+, Renovate, CI, AI layer), and hull's own CI that renders `base` and runs its checks.

**Architecture:** `scripts/render.mjs` is a thin CLI over small modules in `scripts/lib/` (manifest loading, subset check, ownership, planning, file rendering). Tests use `node:test` against a fixture template and against the real `template/`. `scripts/dogfood.mjs` renders combos from `scripts/combos.json` into a temp dir and runs the generated repo's own CI command.

**Tech Stack:** Node 24, pnpm 12.11.2, `node:test`, nunjucks 3.2.4, smol-toml 1.9.1, picomatch 4.0.7, yaml 2.9.1, vite-plus 1.1.0 (hull's own lint/fmt). Generated repos: turbo 2.11.8, typescript 7.0.2, vite-plus 1.1.0.

**Spec:** `docs/superpowers/specs/2026-10-14-hull-design.md` (+ `docs/template-format.md`)

## Global Constraints

- Template layout and rendering follow `docs/template-format.md` format 1 exactly; hull-side choices for gaps are spec §4.3.
- Allowed template syntax: `{{ var }}`, `{{ var | lower }}`, `{{ var | upper }}`, `{% if var %}…{% elif … %}…{% else %}…{% endif %}`, `{% if "piece-id" in pieces %}`, `{% for p in pieces %}…{% endfor %}`, `{# … #}`. Nothing else (contract §4 + §9).
- Contract §9 is binding: conditions only `var` or `"id" in pieces`; no `not`/`and`/`or`/comparisons; `{% if pieces %}` rejected; dotted access only `piece.id|name`, `template.name|version`; no `{%-`/`-%}`; globs match the rendered path relative to `files/` without `.jinja`, before `target`, `*` within a segment, `**` across; `pieces` = unique ids in add order; a non-multiple piece's `name` = its `id`.
- Nunjucks options: `autoescape: false`, `throwOnUndefined: true`, `trimBlocks: false`, `lstripBlocks: false`. Final newline kept exactly as in the source. Output uses `\n`. Whitespace-only output is not written.
- Exit codes: 0 ok, 2 usage error, 3 template error. `--json` prints exactly one object `{ok, command, changes:[{path, action, class}], messages}`.
- `splice.toml`: `format = 1`, `name = "hull"`, `min_splice = "0.1.0"`, `base = "base"`, var `scope` default `acme`, pattern `^[a-z0-9-]+$`.
- CI task list everywhere: `["lint", "format:check", "typecheck", "test", "build"]` (from `scripts/lib/ci-tasks.mjs`).
- Generated `CLAUDE.md` ≤ 80 lines; hull's own `CLAUDE.md` ≤ 120 lines.
- Exact version pins in the catalog (spec §7); `vite` override → `npm:@voidzero-dev/vite-plus-core@1.1.0`.
- Never enable the `vp run` cache; scripts never call `vp run`.
- No new dependency beyond the Tech Stack without asking.

## Review Focus

1. **A `.jinja` file uses syntax outside the subset** (`{% set %}`, `{%-`, `| default`, `==`, `or`) → the subset check names file, line and tag; the invariant test fails. Test in Task 2.
2. **A file matches globs of two ownership classes** (e.g. `src/**` seed and `src/config.ts` owned) → invariant test fails with the path and both classes. Test in Task 3 (unit) and Task 5 (real template).
3. **A rendered file contains only whitespace** (whole body inside a false `{% if %}`) → not written, reported as `skip`; the directory is not created either. Test in Task 4.
4. **The output directory already has files** → exit 2, nothing written. Test in Task 4.
5. **A rendered `ci.yml` or `settings.json` is syntactically valid but structurally wrong** (paths filter added, `fetch-depth` removed, matcher typo) → structure tests fail. Tests in Tasks 7 and 8.

---

## File Structure

```
package.json  pnpm-lock.yaml  .node-version  .gitignore  vite.config.ts   # hull's own tooling
scripts/render.mjs                 # CLI: parse args → renderNew → print
scripts/lib/errors.mjs             # UsageError (exit 2), TemplateError (exit 3)
scripts/lib/manifest.mjs           # loadTemplate, validation of splice.toml / piece.toml
scripts/lib/subset.mjs             # checkSubset
scripts/lib/ownership.mjs          # outputPath, classify, mergeStrategy, overlaps
scripts/lib/plan.mjs               # resolveRequest, buildPlan
scripts/lib/render-file.mjs        # createEnv, renderString
scripts/lib/ci-tasks.mjs           # CI_TASKS
scripts/combos.json  scripts/dogfood.mjs  scripts/affected-combos.mjs
template/splice.toml  template/migrations/.gitkeep  template/pieces/base/{piece.toml,files/**}
renovate/default.json
tests/fixtures/template/           # tiny template used by unit tests
tests/manifest.test.mjs subset.test.mjs ownership.test.mjs plan.test.mjs render.test.mjs
tests/template.test.mjs            # invariants over the real template/
tests/base.test.mjs ci-workflow.test.mjs ai-layer.test.mjs affected-combos.test.mjs parity.test.mjs
.github/workflows/ci.yml           # hull's own CI
```

Shared test helper: `tests/helpers.mjs` exports `renderCombo(pieces: string[], vars?: Record<string,string>) → Promise<{dir: string, result: Result}>` (renders the real template into a fresh `fs.mkdtemp` dir). Created in Task 4, used from Task 5 on.

---

### Task 1: hull scaffold, errors and manifest loading

**Files:**
- Create: `package.json`, `.node-version` (`24`), `.gitignore`, `vite.config.ts`, `scripts/lib/errors.mjs`, `scripts/lib/manifest.mjs`, `tests/fixtures/template/**`
- Test: `tests/manifest.test.mjs`

**Interfaces:**
- Produces:
  - `class UsageError extends Error { exitCode = 2 }`, `class TemplateError extends Error { exitCode = 3 }`
  - `loadTemplate(dir: string): Promise<Template>`
  - `Template = { dir, name, format, minSplice, base, vars: Record<string, VarSpec>, pieces: Map<string, Piece> }`
  - `VarSpec = { prompt: string, default?: string, pattern?: string }`
  - `Piece = { id, dir, filesDir, description, multiple: boolean, requires: string[], target?: string, vars: Record<string, VarSpec>, files: { owned: string[], shared: string[], seed: string[] }, merge: Record<string, "json"|"yaml"|"toml"|"text">, post: { run: string, when: string[] }[] }`

- [x] **Step 1: Scaffold.** `package.json`: `"private": true`, `"type": "module"`, `packageManager: "pnpm@12.11.2"`, scripts `test` = `node --test "tests/**/*.test.mjs"`, `lint` = `vp lint scripts tests`, `format:check` = `vp fmt --check scripts tests`, `render` = `node scripts/render.mjs`. Deps per Tech Stack. Fixture template: `splice.toml` + pieces `base` (files `package.json.jinja`, `README.md`) and `app` (`multiple = true`, `target = "apps/{{ name }}"`, files `src/main.ts`, `config.json`).
- [x] **Step 2: Write failing tests** in `tests/manifest.test.mjs`:

```js
test("loads the fixture template", async () => {
  const t = await loadTemplate(FIXTURE);
  assert.equal(t.format, 1); assert.equal(t.base, "base");
  assert.deepEqual([...t.pieces.keys()].sort(), ["app", "base"]);
  assert.equal(t.pieces.get("app").multiple, true);
  assert.deepEqual(t.pieces.get("base").files, { owned: [], shared: ["package.json"], seed: ["README.md"] });
});
test("rejects unknown format", () => rejectsWith(TemplateError, /format 2/, mutate("splice.toml", s => s.replace("format = 1", "format = 2"))));
test("rejects piece id that differs from its directory", ...);       // /id "x" .* directory "app"/
test("rejects requires naming a missing piece", ...);                 // /requires "nope"/
test("rejects an unknown key in piece.toml", ...);                    // /unknown key "mutiple"/
test("rejects a merge strategy outside json|yaml|toml|text", ...);
test("rejects an invalid var pattern regex", ...);
test("rejects base naming a missing piece", ...);
```

`mutate(file, fn)` copies the fixture to a temp dir and edits one file; `rejectsWith` is `assert.rejects` with class + message regex.
- [x] **Step 3: Run `pnpm test` — expect FAIL (`loadTemplate` missing).**
- [x] **Step 4: Implement `loadTemplate`** with `smol-toml`. Validation is strict: unknown keys are errors; defaults `multiple = false`, `requires = []`, empty `files`/`merge`/`post`; `post.when` ⊆ `new|add|update`.
- [x] **Step 5: Run `pnpm test && pnpm lint && pnpm format:check` — expect PASS.**
- [x] **Step 6: Commit** — `feat: scaffold hull and load template manifests`

---

### Task 2: Template subset checker

**Files:**
- Create: `scripts/lib/subset.mjs`
- Test: `tests/subset.test.mjs`

**Interfaces:**
- Produces: `checkSubset(source: string, file: string): Violation[]`, `Violation = { file, line: number, tag: string, reason: string }`

- [x] **Step 1: Write failing tests:**

```js
const ok = ['{{ scope }}', '{{ piece.name | upper }}', '{{ name | lower }}', '{% if scope %}a{% elif x %}b{% else %}c{% endif %}',
  '{% if "hono-worker" in pieces %}x{% endif %}', '{% for p in pieces %}{{ p }}{% endfor %}', '{# note #}'];
for (const s of ok) test(`allows ${s}`, () => assert.deepEqual(checkSubset(s, "f"), []));
const bad = [['{% set x = 1 %}', /set/], ['{%- if a %}{% endif %}', /whitespace control/], ['{{ a | default("x") }}', /filter "default"/],
  ['{% if a == "b" %}{% endif %}', /expression/], ['{% if a or b %}{% endif %}', /expression/], ['{% include "x" %}', /include/],
  ['{% macro m() %}{% endmacro %}', /macro/], ['{{ a ~ b }}', /expression/], ['{% for k in vars %}{% endfor %}', /only "pieces"/],
  ['{% if not a %}{% endif %}', /expression/], ['{% if a and b %}{% endif %}', /expression/], ['{% if a %}{% elif b or c %}{% endif %}', /expression/],
  ['{% if pieces %}{% endif %}', /pieces/], ['{% if a -%}{% endif %}', /whitespace control/], ['{{- a }}', /whitespace control/],
  ['{{ vars.scope }}', /dotted/], ['{% if "x" not in pieces %}{% endif %}', /expression/]];
for (const [s, re] of bad) test(`rejects ${s}`, () => assert.match(checkSubset(s, "f")[0].reason, re));
test("reports the line number", () => assert.equal(checkSubset("a\nb\n{% set x %}", "f")[0].line, 3));
test("flags unbalanced if/endif", () => assert.match(checkSubset("{% if a %}", "f")[0].reason, /unclosed/));
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Implement `checkSubset`**: scan `{{…}}`, `{%…%}`, `{#…#}` with one regex; validate each tag against these grammars and keep a block stack:
  - output: `^\s*IDENT(\.IDENT)*(\s*\|\s*(lower|upper))?\s*$`
  - `if`/`elif`: `IDENT` (not `pieces`), an allowed dotted name, or `"<id>" in pieces`; reject `not`, `and`, `or` and any operator (contract §9.2)
  - dotted names allowed only: `piece.id`, `piece.name`, `template.name`, `template.version` (§9.3)
  - any `-` right after `{%`/`{{` or before `%}`/`}}` → whitespace-control violation (§9.4)
  - `for`: `IDENT in pieces`
  - `else`, `endif`, `endfor`
  - `IDENT` = `[A-Za-z_][A-Za-z0-9_]*`
- [x] **Step 4: Run `pnpm test` — expect PASS.**
- [x] **Step 5: Commit** — `feat: check templates against the portable subset`

---

### Task 3: Ownership and render planning

**Files:**
- Create: `scripts/lib/ownership.mjs`, `scripts/lib/plan.mjs`
- Test: `tests/ownership.test.mjs`, `tests/plan.test.mjs`

**Interfaces:**
- Consumes: `Template`, `Piece`, `UsageError`, `TemplateError` (Task 1)
- Produces:
  - `outputPath(relUnderFiles: string): string` — strips a trailing `.jinja`
  - `classify(path: string, files: Piece["files"]): "owned"|"shared"|"seed"` — checks owned, shared, seed in that order; no match → `owned`
  - `overlaps(path: string, files): string[]` — every class whose globs match (for invariants)
  - `mergeStrategy(path: string, merge): "json"|"yaml"|"toml"|"text"` — default `text`
  - `resolveRequest(t: Template, req: { pieces: string[], vars: Record<string,string> }): Instance[]`, `Instance = { piece: Piece, name: string, vars: Record<string,string> }`
  - `buildPlan(t: Template, instances: Instance[], opts: { templateVersion: string }): Promise<PlannedFile[]>`, `PlannedFile = { src: string, path: string, class, render: boolean, context: object }`

- [x] **Step 1: Write failing tests:**

```js
test("outputPath strips .jinja", () => assert.equal(outputPath("a/package.json.jinja"), "a/package.json"));
test("classify order and default", () => {
  const f = { owned: ["vite.config.ts"], shared: ["package.json"], seed: ["src/**"] };
  assert.equal(classify("src/a/b.ts", f), "seed"); assert.equal(classify("package.json", f), "shared");
  assert.equal(classify("other.txt", f), "owned");
});
test("* stays in one segment, ** crosses (contract §9.1)", () => {
  assert.equal(classify("src/a.ts", { owned: [], shared: [], seed: ["src/*"] }), "seed");
  assert.equal(classify("src/a/b.ts", { owned: [], shared: [], seed: ["src/*"] }), "owned");
  assert.equal(classify("src/a/b.ts", { owned: [], shared: [], seed: ["src/**"] }), "seed");
});
test("globs match the path without .jinja", () => assert.equal(classify(outputPath("package.json.jinja"), { owned: [], shared: ["package.json"], seed: [] }), "shared"));
test("overlaps lists both classes", () => assert.deepEqual(overlaps("src/x.ts", { owned: ["src/x.ts"], shared: [], seed: ["src/**"] }), ["owned", "seed"]));
test("base first, deduped, defaults applied", () => {
  const i = resolveRequest(t, { pieces: ["app", "base"], vars: {} });
  assert.deepEqual(i.map(x => [x.piece.id, x.name]), [["base", "base"], ["app", "web"]]);
});
test("id:name sets the name var", ...);                         // "app:admin" → name "admin", vars.name "admin"
test("piece var via <id>.<key>", ...);
test("unknown piece → UsageError", ...);  test("non-multiple twice → UsageError", ...);
test("duplicate instance name → UsageError", ...);  test("var failing pattern → UsageError /scope/", ...);
test("unknown var → UsageError", ...);  test("missing requires → UsageError", ...);
test("plan applies target and context", async () => {
  const p = await buildPlan(t, resolveRequest(t, { pieces: ["app:admin"], vars: { scope: "x" } }), { templateVersion: "0.0.0-dev" });
  const f = p.find(f => f.path === "apps/admin/src/main.ts");
  assert.equal(f.class, "seed");
  assert.deepEqual(f.context.pieces, ["base", "app"]);
  assert.deepEqual(f.context.piece, { id: "app", name: "admin" });
  assert.deepEqual(f.context.template, { name: "fixture", version: "0.0.0-dev" });
});
test("two instances writing the same path → TemplateError", ...);
```

- [x] **Step 2: Run `pnpm test` — expect FAIL.**
- [x] **Step 3: Implement** with `picomatch` (`dot: true`). `target` is rendered with the instance context through `renderString` from Task 4 — define `renderString` in `scripts/lib/render-file.mjs` now (Task 4 adds its tests). Instance `name` = `vars.name` or the piece id; non-multiple pieces have no `name` var.
- [x] **Step 4: Run `pnpm test` — expect PASS.**
- [x] **Step 5: Commit** — `feat: classify ownership and plan renders`

---

### Task 4: File rendering and the `render.mjs` CLI

**Files:**
- Create: `scripts/lib/render-file.mjs` (complete), `scripts/render.mjs`, `tests/helpers.mjs`
- Test: `tests/render.test.mjs`

**Interfaces:**
- Consumes: `loadTemplate`, `checkSubset`, `resolveRequest`, `buildPlan`
- Produces:
  - `createEnv(): nunjucks.Environment` (options from Global Constraints)
  - `renderString(source: string, context: object): string` — `\r\n` → `\n`
  - `renderNew(opts: { template: string, out: string, pieces: string[], vars: Record<string,string>, templateVersion?: string }): Promise<Result>`, `Result = { ok: boolean, command: "new", changes: { path, action: "create"|"skip", class }[], messages: string[] }`
  - CLI per spec §9; `main(argv): Promise<number>` (exit code) exported for tests
  - `tests/helpers.mjs` `renderCombo` (see File Structure)

- [ ] **Step 1: Write failing tests:**

```js
test("renders, copies, strips .jinja", async () => {
  const r = await renderNew({ template: FIXTURE, out, pieces: ["app:admin"], vars: { scope: "acme" } });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(read(out, "package.json")).name, "@acme/root");
  assert.ok(!exists(out, "package.json.jinja"));
  assert.ok(exists(out, "apps/admin/src/main.ts"));
});
test("binary file copied byte for byte", ...);                        // fixture has a small .png
test("whitespace-only output is skipped and no empty dir is left", ...); // change.action === "skip"
test("CRLF in a template becomes LF", ...);
test("final newline kept exactly: with and without a trailing \\n", ...);   // contract §9.4
test("autoescape off: '<&>' in a var renders verbatim", ...);
test("pieces holds unique ids in add order with two instances", ...);       // ["base","app"] for app:a app:b (§9.5)
test("non-multiple piece has piece.name === piece.id", ...);
test("undefined variable → TemplateError naming the file", ...);
test("subset violation → TemplateError before anything is written", ...);
test("non-empty --out → exit 2, nothing written", ...);
test("--json prints exactly one JSON object", async () => {
  const { code, stdout } = await runCli(["new", "--template", FIXTURE, "--out", out, "--piece", "app", "--json"]);
  assert.equal(code, 0); const o = JSON.parse(stdout);
  assert.deepEqual(Object.keys(o).sort(), ["changes", "command", "messages", "ok"]);
  assert.ok(o.changes.every(c => ["path", "action", "class"].every(k => k in c)));
});
test("usage error with --json → exit 2 and ok:false", ...);
test("for-loop and in-pieces render identically to the contract examples", ...); // golden file in fixtures
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement.** Order: load → subset-check every `.jinja` of the requested pieces → resolve → plan → render all in memory → only then write (no partial output on error). Args via `node:util` `parseArgs` (`--piece`/`--data` multiple).
- [ ] **Step 4: Run `pnpm test`, then by hand:** `node scripts/render.mjs new --template tests/fixtures/template --out /tmp/hull-x --piece app --json` — expect `"ok":true`.
- [ ] **Step 5: Commit** — `feat: dev renderer writes new repos from the template`

---

### Task 5: Real template skeleton and invariant tests

**Files:**
- Create: `template/splice.toml`, `template/migrations/.gitkeep`, `template/pieces/base/piece.toml`, `template/pieces/base/files/README.md.jinja`
- Test: `tests/template.test.mjs`

**Interfaces:**
- Consumes: `loadTemplate`, `checkSubset`, `overlaps`, `outputPath`
- Produces: invariant suite that every later task's template change must pass; `tests/invariants.mjs` exports `elifBranches(source: string): string[]` (branch bodies of a chain marked `{# same-branches #}`) and `assertSameBranches(path: string): void` (used by plan 02 Task 6 and plan 03 Task 1)

- [ ] **Step 1: Write failing tests** (they iterate over every piece found in `template/pieces/`):

```js
test("template loads", async () => { const t = await loadTemplate("template"); assert.equal(t.name, "hull"); assert.equal(t.minSplice, "0.1.0"); });
test("every files/ path is in at most one class", ...);      // message lists path + classes
test("every [merge] key names a shared file", ...);
test("every .jinja passes the subset (contract §4 + §9)", ...);   // fails on not/and/or/{%-/if pieces
test("no .jinja tag contains not/and/or/-%}", ...);   // second, regex-only check over raw tags (contract §9.2, §9.4)
test("no {{ in paths under files/", ...);
test("every multiple piece has target containing {{ name }} and a name var with the name pattern", ...);
test("every elif chain marked {# same-branches #} has identical branches", ...);
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL (no `template/`).**
- [ ] **Step 3: Create the skeleton** per spec §2 and §5 (`base` piece: `id = "base"`, description, `[files] seed = ["README.md"]`). Write `tests/invariants.mjs` with `elifBranches`.
- [ ] **Step 4: Run `pnpm test` — expect PASS.**
- [ ] **Step 5: Commit** — `test: template invariants and base skeleton`

---

### Task 6: `base` workspace core

**Files:**
- Create under `template/pieces/base/files/`: `package.json.jinja`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vite.config.ts`, `.node-version`, `.gitignore`, `.gitattributes`, `packages/shared/{package.json.jinja,tsconfig.json,vite.config.ts,src/index.ts,src/index.test.ts}`, `docs/agents/project.md`
- Create: `scripts/lib/ci-tasks.mjs`
- Modify: `template/pieces/base/piece.toml` (`[files]`, `[merge]`, `[[post]] run = "pnpm install --no-frozen-lockfile"`, `when = ["new"]`)
- Test: `tests/base.test.mjs`

**Interfaces:**
- Produces: `CI_TASKS: readonly string[]` = `["lint", "format:check", "typecheck", "test", "build"]`; the root package scripts `ci` and `check` (spec §6.1); `@{{ scope }}/shared` package.

- [ ] **Step 1: Write failing tests:**

```js
test("base renders the expected classes", async () => {
  const { result } = await renderCombo(["base"]);
  const cls = Object.fromEntries(result.changes.map(c => [c.path, c.class]));
  assert.equal(cls["package.json"], "shared"); assert.equal(cls["pnpm-workspace.yaml"], "shared");
  assert.equal(cls["turbo.json"], "shared"); assert.equal(cls["vite.config.ts"], "owned");
  assert.equal(cls["packages/shared/src/index.ts"], "seed"); assert.equal(cls["README.md"], "seed");
});
test("catalog pins exact versions from the spec", async () => {
  const ws = YAML.parse(read(dir, "pnpm-workspace.yaml"));
  assert.equal(ws.catalog["vite-plus"], "1.1.0"); assert.equal(ws.catalog.turbo, "2.11.8");
  assert.equal(ws.catalog.typescript, "7.0.2"); assert.equal(ws.overrides.vite, "npm:@voidzero-dev/vite-plus-core@1.1.0");
  for (const v of Object.values(ws.catalog)) assert.match(v, /^\d+\.\d+\.\d+$/);
});
test("ci script uses CI_TASKS with --affected", ...);   // pkg.scripts.ci === `turbo run ${CI_TASKS.join(" ")} --affected`
test("turbo.json defines every CI task and no vp run", ...);
test("package.json name is the scope", ...);            // vars { scope: "zeta" } → "zeta"
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the files** per spec §6.1 and §7 (full catalog table now, even for later pieces). Check pnpm 12 names for `onlyBuiltDependencies`, `minimumReleaseAge`, `peerDependencyRules` and Vite+'s shared lint/fmt config (docs or `vp lint --help`); record what you found in the commit body.
- [ ] **Step 4: Run `pnpm test` — expect PASS. Then dogfood by hand:**

```bash
node scripts/render.mjs new --template template --out /tmp/hull-base --piece base --data scope=hullci
cd /tmp/hull-base && git init -q && pnpm install --no-frozen-lockfile && pnpm turbo run lint format:check typecheck test build
```

Expected: install succeeds; every task passes for `@hullci/shared`.
- [ ] **Step 5: Commit** — `feat(base): workspace, catalog, turbo and Vite+ config`

---

### Task 7: Generated CI workflow and Renovate

**Files:**
- Create: `template/pieces/base/files/.github/workflows/ci.yml.jinja`, `template/pieces/base/files/renovate.json`, `renovate/default.json`
- Test: `tests/ci-workflow.test.mjs`

**Interfaces:**
- Consumes: `CI_TASKS`, `renderCombo`
- Produces: the generated `ci.yml` (spec §8.1) — plan 02 adds nothing to it; plan 03 adds Rust steps and hoard.

- [ ] **Step 1: Write failing tests** on the rendered, YAML-parsed workflow:

```js
test("triggers and no path filters", () => {
  assert.deepEqual(Object.keys(wf.on).sort(), ["merge_group", "pull_request", "push"]);
  assert.ok(!JSON.stringify(wf.on).includes("paths"));
});
test("concurrency cancels PR runs only", () => assert.match(wf.concurrency["cancel-in-progress"], /pull_request/));
test("exactly jobs ci and ci-ok; ci-ok needs ci and runs always", ...);
test("checkout has full blobless history", () => { const s = step("actions/checkout"); assert.equal(s.with["fetch-depth"], 0); assert.equal(s.with.filter, "blob:none"); });
test("early exit uses turbo query affected --exit-code with CI_TASKS", ...);
test("every step after the affected check is guarded by skip", ...);
test("install is frozen and prefer-offline; setup-node caches pnpm", ...);
test("turbo run uses CI_TASKS and --affected", ...);
test("no rust steps without rust-tool", ...);
test("renovate.json extends the hull preset", ...);
test("renovate preset groups vite-plus with vite-plus-core", ...);  // same packageRule
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the workflow** per spec §8.1 and the preset per §8.6. The affected step: run turbo; map exit 0 → `skip=true`, 1 → `skip=false`, 2 → `skip=false` plus a warning annotation. If `actionlint` is available (`pnpm dlx` is not; use `docker run rhysd/actionlint` only if Docker exists), run it on the rendered file; otherwise note it in PROGRESS.
- [ ] **Step 4: Run `pnpm test` — expect PASS.**
- [ ] **Step 5: Commit** — `feat(base): one-job CI with affected early exit and Renovate preset`

---

### Task 8: AI layer for generated repos

**Files:**
- Create under `template/pieces/base/files/`: `CLAUDE.md.jinja`, `AGENTS.md`, `.claude/settings.json`, `.claude/loop.md`, `.claude/agents/{explorer,implementer,reviewer,ci-fixer}.md`, `.claude/skills/{verify,add-piece}/SKILL.md`, `.claude/skills/docs-lookup/SKILL.md.jinja` (whole body inside `{% if "docs" in pieces %}`), `.claude/hooks/{session-start,stop-checks}.sh`, `.claude/statusline.sh`
- Test: `tests/ai-layer.test.mjs`

**Interfaces:**
- Consumes: `renderCombo`
- Produces: owned AI files (spec §6.9). Later pieces add `<target>/CLAUDE.md` and one `{% if %}` line each to `CLAUDE.md.jinja`.

- [ ] **Step 1: Write failing tests:**

```js
test("CLAUDE.md ≤ 80 lines and imports project notes", ...);       // includes "@docs/agents/project.md"
test("AGENTS.md points to CLAUDE.md", ...);
test("agents have name/description/tools/model with the routing table", () => {
  assert.deepEqual(models(), { explorer: "haiku", implementer: "sonnet", reviewer: "opus", "ci-fixer": "sonnet" });
  assert.match(fm("explorer").description, /use proactively/i);
  assert.ok(!/Edit|Write/.test(fm("reviewer").tools) && !/Edit|Write|Bash/.test(fm("explorer").tools));
});
test("settings.json is valid and wires hooks", () => {
  const s = JSON.parse(read(dir, ".claude/settings.json"));
  assert.equal(s.model, "opusplan");
  assert.equal(s.hooks.SessionStart[0].matcher, "startup|resume");
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /bash .*session-start\.sh/);
  assert.ok(s.enabledPlugins["superpowers@superpowers-marketplace"]);
  assert.ok(s.permissions.deny.some(d => d.includes("push --force")));
});
test("docs-lookup skill absent without docs piece", ...);
test("hook scripts pass bash -n", ...);
test("stop-checks exits 0 when HULL_STOP_CHECKS is unset", ...);   // spawnSync bash, env without the var
test("session-start exits 0 even when pnpm is missing", ...);      // PATH without pnpm
test("skills have name and description frontmatter", ...);
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Write the files** per spec §6.9. Check the plugin settings shape and statusline stdin fields against https://code.claude.com/docs/en/settings and `/statusline` docs; if they differ from the spec, follow the docs and update spec §6.9 in this commit.
- [ ] **Step 4: Run `pnpm test` — expect PASS.**
- [ ] **Step 5: Commit** — `feat(base): Claude Code layer — agents, skills, hooks, loop`

---

### Task 9: Dogfood runner and hull's own CI

**Files:**
- Create: `scripts/combos.json`, `scripts/dogfood.mjs`, `scripts/affected-combos.mjs`, `.github/workflows/ci.yml`
- Test: `tests/affected-combos.test.mjs`, `tests/parity.test.mjs`

**Interfaces:**
- Consumes: `renderNew`, `CI_TASKS`
- Produces:
  - `combos.json` = `{ "vars": { "scope": "hullci" }, "combos": [{ "name": "base", "pieces": ["base"] }] }` (plans 02/03 append)
  - `affectedCombos(changed: string[], combos: Combo[]): string[]`; CLI `node scripts/affected-combos.mjs --base <ref>` prints JSON array
  - `dogfood(opts: { combos: string[], root?: string, cacheDir?: string }): Promise<{ name, ok, seconds }[]>`; CLI `node scripts/dogfood.mjs --combo <name>...` exits 1 if any combo fails
  - `ciCommand(): string[]` exported from `dogfood.mjs` = `["pnpm", "turbo", "run", ...CI_TASKS]`

- [ ] **Step 1: Write failing tests:**

```js
const combos = [{ name: "base", pieces: ["base"] }, { name: "web", pieces: ["base", "preact-app:web"] }];
test("piece change selects combos with that piece", () => assert.deepEqual(affectedCombos(["template/pieces/preact-app/files/x"], combos), ["web"]));
test("base change selects all", ...);  test("renderer change selects all", ...);
test("docs and tests select none", () => assert.deepEqual(affectedCombos(["docs/a.md", "tests/x.test.mjs", "README.md"], combos), []));
test("parity: generated ci.yml, base ci script and dogfood use CI_TASKS", ...);
```

- [ ] **Step 2: Run `pnpm test` — expect FAIL.**
- [ ] **Step 3: Implement** per spec §10.2. `dogfood.mjs` renders into `<root>/<name>` (default `os.tmpdir()/hull-dogfood`), runs `git init -q`, `pnpm install --no-frozen-lockfile --prefer-offline`, then `ciCommand()` with `--cache-dir=<cacheDir>`, streaming output with a `[combo]` prefix and printing seconds per combo. Workflow: one job + `ci-ok` (spec §10.2), steps: checkout (depth 0, blobless), pnpm + setup-node (cache pnpm), install, lint, format:check, test, affected-combos → dogfood (skipped when the list is empty), `actions/cache` on `$RUNNER_TEMP/turbo-cache`.
- [ ] **Step 4: Run `pnpm test`, then `node scripts/dogfood.mjs --combo base`** — expect `base ok <n>s` and exit 0. Paste the timing into PROGRESS.
- [ ] **Step 5: Commit** — `ci: dogfood rendered combos in hull CI`

---

## Milestone 1 done when

All tasks checked; `pnpm test`, `pnpm lint`, `pnpm format:check` pass; `node scripts/dogfood.mjs --combo base` passes; superpowers:requesting-code-review on the milestone recorded in `docs/PROGRESS.md`. Pushing and watching hull's CI on GitHub needs the repo (Blocked until it exists).
