import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";
import { renderString } from "../scripts/lib/render-file.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  buildArtifact,
  checkArtifact,
  deploy,
  fenced,
  parseJsonc,
  previewConfig,
  runWrangler,
} from "../template/pieces/base/files/.github/scripts/preview.mjs";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/.github/scripts/preview.mjs", import.meta.url),
);
const PATH = ".github/workflows/preview.yml";
const DEPLOY = ".github/workflows/preview-deploy.yml";

async function load(pieces, path = PATH) {
  const { dir, result } = await renderCombo(pieces);
  const raw = await readFile(join(dir, path), "utf8");
  return { dir, result, raw, wf: YAML.parse(raw) };
}

const base = await load(["base"]);
const job = base.wf.jobs.preview;
const steps = job.steps;
const detectIdx = steps.findIndex((s) => /wrangler\.jsonc/.test(s.run ?? ""));
const detect = steps[detectIdx];

test("preview.yml is an owned plain file", () => {
  const c = base.result.changes.find((x) => x.path === PATH);
  assert.equal(c.class, "owned");
});

test("triggers, concurrency, permissions", () => {
  assert.deepEqual(Object.keys(base.wf.on), ["pull_request"]);
  assert.match(base.wf.concurrency.group, /pull_request\.number/);
  assert.equal(base.wf.concurrency["cancel-in-progress"], true);
  assert.deepEqual(base.wf.permissions, { contents: "read" });
});

test("preview.yml builds only: no secrets, no environment, no Cloudflare variable", () => {
  assert.doesNotMatch(base.raw, /secrets\./);
  assert.doesNotMatch(base.raw, /^\s*environment:/m);
  assert.doesNotMatch(base.raw, /CLOUDFLARE/);
  assert.equal(job.environment, undefined);
});

test("checkout has full history; detect step is right after it", () => {
  const co = steps[0];
  assert.match(co.uses, /^actions\/checkout@/);
  assert.equal(co.with["fetch-depth"], 0);
  assert.equal(co.with.filter, "blob:none");
  assert.equal(detectIdx, 1);
  assert.ok(detect.id);
  assert.match(detect.run, /deploy=(true|false)/);
});

test("every step after detect is guarded by the deploy output", () => {
  for (const s of steps.slice(detectIdx + 1)) {
    assert.match(String(s.if), new RegExp(`steps\\.${detect.id}\\.outputs\\.deploy == 'true'`));
  }
});

test("job env carries the PR number and the turbo scm range only", () => {
  assert.deepEqual(Object.keys(job.env).sort(), ["PR_NUMBER", "TURBO_SCM_BASE", "TURBO_SCM_HEAD"]);
  assert.equal(job.env.PR_NUMBER, "${{ github.event.pull_request.number }}");
  assert.match(job.env.TURBO_SCM_BASE, /pull_request\.base\.sha/);
  assert.match(job.env.TURBO_SCM_HEAD, /github\.sha/);
});

test("preview.yml builds, packs with preview.mjs build and uploads preview-<pr> for 3 days", () => {
  const i = (f) => steps.findIndex(f);
  const build = i((s) => s.run === "pnpm turbo run build --affected");
  const pack = i((s) => s.run === "node .github/scripts/preview.mjs build");
  const up = i((s) => s.uses?.startsWith("actions/upload-artifact@"));
  assert.ok(build > detectIdx && pack > build && up > pack);
  assert.equal(steps[up].with.name, "preview-${{ github.event.pull_request.number }}");
  assert.equal(steps[up].with.path, ".preview");
  assert.equal(steps[up].with["retention-days"], 3);
});

test("preview.mjs is owned by base; without a subcommand it prints usage and exits 2", () => {
  const c = base.result.changes.find((x) => x.path === ".github/scripts/preview.mjs");
  assert.equal(c.class, "owned");
  const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: preview\.mjs build \| deploy/);
});

// --- preview-deploy.yml: the half that holds secrets, run from the default branch

const SECRETS_SRC = readFileSync(
  join(REAL_TEMPLATE, "pieces/base/files", `${DEPLOY}.jinja`),
  "utf8",
);
const withSecrets = YAML.parse(renderString(SECRETS_SRC, { pieces: ["base", "secrets"] }));
const dep = await load(["base", "hono-worker:api"], DEPLOY);
const dj = dep.wf.jobs.deploy;
const stepsOf = (wf) => wf.jobs.deploy.steps;
const usesStep = (wf, re) => stepsOf(wf).find((s) => re.test(s.uses ?? ""));

test("preview-deploy.yml is owned and rendered without the .jinja suffix", () => {
  assert.equal(dep.result.changes.find((x) => x.path === DEPLOY)?.class, "owned");
  assert.ok(!dep.result.changes.some((x) => x.path.endsWith(".jinja")));
});

test("preview-deploy: workflow_run of preview, completed only; minimal permissions", () => {
  assert.deepEqual(dep.wf.on, { workflow_run: { workflows: ["preview"], types: ["completed"] } });
  assert.deepEqual(dep.wf.permissions, {
    contents: "read",
    actions: "read",
    "pull-requests": "read",
  });
});

test("preview-deploy: runs only after a successful same-repo pull_request build", () => {
  for (const part of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'pull_request'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
  ])
    assert.ok(dj.if.includes(part), part);
  assert.doesNotMatch(dj.if, / \|\| /);
  assert.equal(dj.environment, "preview");
});

test("preview-deploy: a gate job without environment or secrets decides whether anything deploys", async () => {
  const gate = dep.wf.jobs.gate;
  assert.equal(gate.environment, undefined);
  assert.doesNotMatch(JSON.stringify(gate), /secrets|CLOUDFLARE/);
  assert.ok(gate.if.includes("workflow_run.head_repository.full_name == github.repository"));
  assert.ok(gate.steps.some((s) => /apps\/\*\/wrangler\.jsonc/.test(s.run ?? "")));
  const co = gate.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
  assert.deepEqual(co.with, { "persist-credentials": false });
  assert.match(gate.outputs.deploy, /steps\.detect\.outputs\.deploy/);
  assert.equal(dj.needs, "gate");
  assert.match(dj.if, /needs\.gate\.outputs\.deploy == 'true'/);
  // A base-only repo has the same file: its deploy job is gated on the detect output too.
  const only = await load(["base"], DEPLOY);
  assert.equal(only.wf.jobs.deploy.needs, "gate");
  assert.match(only.wf.jobs.deploy.if, /needs\.gate\.outputs\.deploy == 'true'/);
});

test("preview-deploy: one deploy per head branch, newer cancels older", () => {
  assert.equal(
    dep.wf.concurrency.group,
    "preview-deploy-${{ github.event.workflow_run.head_repository.full_name }}-${{ github.event.workflow_run.head_branch }}",
  );
  assert.equal(dep.wf.concurrency["cancel-in-progress"], true);
});

for (const [label, wf] of [
  ["without secrets", dep.wf],
  ["with secrets", withSecrets],
]) {
  test(`preview-deploy (${label}): checks out the default branch only and installs from its lockfile`, () => {
    const s = stepsOf(wf);
    const co = s.find((x) => x.uses?.startsWith("actions/checkout@"));
    assert.deepEqual(Object.keys(co.with ?? {}), ["persist-credentials"]);
    assert.equal(co.with["persist-credentials"], false);
    assert.equal(s.filter((x) => /checkout/.test(x.uses ?? "")).length, 1);
    assert.ok(s.some((x) => x.run === "pnpm install --frozen-lockfile --prefer-offline"));
    assert.ok(s.indexOf(co) < s.findIndex((x) => x.run?.startsWith("pnpm install")));
  });

  test(`preview-deploy (${label}): downloads only preview-<pr> by run id into RUNNER_TEMP`, () => {
    const d = usesStep(wf, /^actions\/download-artifact@/).with;
    assert.equal(d.name, "preview-${{ steps.pr.outputs.number }}");
    assert.equal(d["run-id"], "${{ github.event.workflow_run.id }}");
    assert.equal(d.path, "${{ runner.temp }}/preview");
    assert.equal(d.pattern, undefined);
    assert.equal(d["github-token"], "${{ github.token }}");
  });

  test(`preview-deploy (${label}): the PR number is event or API data passed through env, never into run:`, () => {
    const pr = stepsOf(wf).find((x) => x.id === "pr");
    assert.equal(pr.env.EVENT_PRS, "${{ toJSON(github.event.workflow_run.pull_requests) }}");
    assert.match(pr.run, /select\(\.head\.sha == \$sha\)/);
    assert.doesNotMatch(pr.run, /pull_requests\[0\]/);
    assert.equal(pr.env.GH_TOKEN, "${{ github.token }}");
    assert.match(pr.run, /gh api "repos\/\$REPO\/commits\/\$HEAD_SHA\/pulls"/);
    assert.match(pr.run, /\*\[!0-9\]\*/);
    for (const s of stepsOf(wf)) assert.doesNotMatch(s.run ?? "", /\$\{\{/, s.name ?? s.run);
  });

  test(`preview-deploy (${label}): deploy comes after the download; nothing builds or runs PR code`, () => {
    const s = stepsOf(wf);
    const at = (f) => s.findIndex(f);
    const dl = at((x) => /download-artifact/.test(x.uses ?? ""));
    const dp = at((x) => /preview\.mjs deploy/.test(x.run ?? "") || x.with?.run);
    assert.ok(dl > 0 && dp > dl);
    assert.equal(dp, s.length - 1);
    assert.ok(!s.some((x) => /turbo|build|vp /.test(x.run ?? "")));
    assert.ok(!s.some((x) => x.with?.ref || x.with?.repository));
  });
}

test("preview-deploy without secrets: Cloudflare secrets from environment preview, PR number via env", () => {
  const d = stepsOf(dep.wf).at(-1);
  assert.equal(d.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}");
  assert.equal(d.env.CLOUDFLARE_ACCOUNT_ID, "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
  assert.equal(d.env.PR_NUMBER, "${{ steps.pr.outputs.number }}");
  assert.equal(d.env.PREVIEW_ARTIFACT, "${{ runner.temp }}/preview");
  assert.equal(d.run, "node .github/scripts/preview.mjs deploy");
  assert.doesNotMatch(dep.raw, /keelstackhq\/hoist/);
});

test("preview-deploy with secrets: hoist secrets action, SHA-pinned, env preview, explicit keys", () => {
  const d = stepsOf(withSecrets).at(-1);
  assert.match(d.uses, /^keelstackhq\/hoist\/secrets@0{40}$/);
  assert.equal(d.with.env, "preview");
  assert.equal(d.with.keys, "CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID");
  assert.equal(d.with.run, "node .github/scripts/preview.mjs deploy");
  assert.equal(d.with["app-id"], "${{ vars.SECRETS_READ_APP_ID }}");
  assert.equal(d.with["app-key"], "${{ secrets.SECRETS_READ_APP_KEY }}");
  assert.equal(d.with["age-key"], "${{ secrets.SOPS_AGE_KEY }}");
  // workflow_run: hoist's exec needs the triggering workflow's file, else it exits 2
  assert.equal(d.with["workflow-run-path"], ".github/workflows/preview.yml");
  assert.deepEqual(withSecrets.on.workflow_run.workflows, ["preview"]);
  assert.equal(d.env.PR_NUMBER, "${{ steps.pr.outputs.number }}");
  assert.equal(withSecrets.jobs.deploy.environment, "preview");
  assert.doesNotMatch(JSON.stringify(withSecrets), /secrets\.CLOUDFLARE/);
  const src = SECRETS_SRC.split("\n").find((l) => l.includes("hoist/secrets@"));
  assert.match(src, /@0{40} # TODO\(hoist-release\)$/);
});

test("deployable pieces document previews, not a one-time first deploy", async () => {
  for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
    const name = piece.split(":")[1];
    const { dir } = await renderCombo(["base", piece]);
    const doc = await readFile(join(dir, `apps/${name}/AGENTS.md`), "utf8");
    assert.ok(doc.includes(`\`${name}-preview\``) || /`<app>-preview`/.test(doc), piece);
    assert.match(doc, /alias `pr-<n>`/, piece);
    assert.match(doc, /never create `[^`]*-preview` by hand/i, piece);
    assert.match(doc, /secrets set on the -preview Worker are readable by every PR/i, piece);
    assert.match(doc, /env\.preview[^\n]*preview-only[^\n]*share/is, piece);
    assert.doesNotMatch(doc, /one-time|deploy it once|does not exist yet|deploy:preview/i, piece);
    const pkg = JSON.parse(await readFile(join(dir, `apps/${name}/package.json`), "utf8"));
    assert.equal(pkg.scripts["deploy:preview"], undefined, piece);
  }
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  assert.equal(turbo.tasks["deploy:preview"], undefined);
});

test("turbo passes deploy env through for the deploy task", async () => {
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  assert.deepEqual(turbo.tasks.deploy.passThroughEnv, [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ]);
  assert.deepEqual(turbo.tasks.deploy.dependsOn, ["build"]);
});

test("each deployable app's build writes the Worker bundle apart from the static assets", async () => {
  for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
    const name = piece.split(":")[1];
    const { dir } = await renderCombo(["base", piece]);
    const cfg = parseJsonc(await readFile(join(dir, `apps/${name}/wrangler.jsonc`), "utf8"));
    const pkg = JSON.parse(await readFile(join(dir, `apps/${name}/package.json`), "utf8"));
    if (cfg.main) {
      assert.equal(pkg.scripts.build, "wrangler deploy --dry-run --outdir dist", piece);
      assert.equal(cfg.assets, undefined, piece);
    } else {
      assert.equal(cfg.assets.directory, "./dist", piece);
      assert.ok(!/outdir/.test(pkg.scripts.build), piece);
    }
  }
});

// Expand `apps/*/wrangler.jsonc` against a rendered dir.
async function globWrangler(dir) {
  const out = [];
  for (const e of await readdir(join(dir, "apps")).catch(() => [])) {
    const f = `apps/${e}/wrangler.jsonc`;
    if (
      await access(join(dir, f)).then(
        () => true,
        () => false,
      )
    )
      out.push(f);
  }
  return out;
}

test("base only: detection glob matches nothing", async () => {
  assert.deepEqual(await globWrangler(base.dir), []);
});

for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
  test(`${piece}: present, and detection glob matches its wrangler.jsonc`, async () => {
    const { dir, result, wf } = await load(["base", piece]);
    assert.ok(result.changes.some((c) => c.path === PATH));
    const name = piece.split(":")[1];
    assert.match(wf.jobs.preview.steps[1].run, /apps\/\*\/wrangler\.jsonc/);
    assert.deepEqual(await globWrangler(dir), [`apps/${name}/wrangler.jsonc`]);
  });
}

// Fixture artifacts for `preview.mjs deploy`.
function artifact(extra = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "preview-art-"));
  mkdirSync(join(dir, "apps/api/worker"), { recursive: true });
  mkdirSync(join(dir, "apps/api/assets"));
  writeFileSync(join(dir, "apps/api/worker/index.js"), "export default {}\n");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ pr: 7, apps: ["api"] }));
  extra(dir);
  return dir;
}
function checkout(config = '{ "name": "acme-api", "main": "src/index.ts" }\n') {
  const dir = mkdtempSync(join(tmpdir(), "preview-root-"));
  mkdirSync(join(dir, "apps/api"), { recursive: true });
  writeFileSync(join(dir, "apps/api/wrangler.jsonc"), config);
  return dir;
}

test("buildArtifact packs built output and a manifest, dropping forbidden files", () => {
  const root = checkout(
    '{ "name": "w", "main": "src/index.ts", "assets": { "directory": "./public" } }',
  );
  mkdirSync(join(root, "apps/api/dist"));
  mkdirSync(join(root, "apps/api/public"));
  writeFileSync(join(root, "apps/api/dist/index.js"), "x");
  writeFileSync(join(root, "apps/api/dist/wrangler.json"), "{}");
  writeFileSync(join(root, "apps/api/public/app.js"), "client");
  const out = join(root, ".preview");
  buildArtifact({ root, out, pr: "7" });
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual(manifest, { pr: 7, apps: ["api"] });
  assert.deepEqual(checkArtifact(out), []);
  assert.equal(readFileSync(join(out, "apps/api/worker/index.js"), "utf8"), "x");
  assert.equal(readFileSync(join(out, "apps/api/assets/app.js"), "utf8"), "client");
});

const CONFIG = `{
  // "name": "commented"
  "name": "acme-api", // trailing note
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "https://api.acme.dev/*", "custom_domain": true }],
  "d1_databases": [{ "binding": "DB", "name": "prod-db", "database_id": "p" }],
  "kv_namespaces": [{ "binding": "KV", "id": "prod-kv" }],
  "env": {
    "preview": {
      "kv_namespaces": [{ "binding": "KV", "id": "preview-kv" }],
      "routes": ["https://evil/*"],
      "name": "x",
    },
  },
}\n`;

test("parseJsonc strips comments and trailing commas outside strings, top-level keys only", () => {
  const c = parseJsonc(
    '{ /* "name": "x" */ "url": "https://a.b/c//d", "name": "w", "b": [{"name": "inner",},], }',
  );
  assert.deepEqual(c, { url: "https://a.b/c//d", name: "w", b: [{ name: "inner" }] });
  assert.deepEqual(parseJsonc('{"a":"x,}",}'), { a: "x,}" });
});

// Stub wrangler: records argv and the generated config read at call time.
const OK = { code: 0, out: "https://pr-7.x.workers.dev\n" };
const MISSING = {
  code: 1,
  out: "\u2718 [ERROR] You cannot upload a new version of a Worker that does not yet exist.",
};
function stub(...results) {
  const calls = [];
  const cfgs = [];
  const run = async (args) => {
    calls.push(args);
    cfgs.push(JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8")));
    return results[calls.length - 1] ?? results.at(-1);
  };
  return { calls, cfgs, run };
}
const go = (w, o = {}) =>
  deploy({ artifact: artifact(), root: checkout(), pr: "7", run: w.run, ...o });

test("deploy: versions upload of a minimal config, never production bindings or routes", async () => {
  const w = stub(OK);
  const r = await go(w, { root: checkout(CONFIG) });
  const [call] = w.calls;
  const cfg = w.cfgs[0];
  assert.equal(r.ok, true);
  assert.equal(w.calls.length, 1);
  assert.match(
    call.join(" "),
    /^wrangler versions upload --config \S+ --no-bundle --preview-alias pr-7$/,
  );
  const keys =
    "base_dir,compatibility_date,compatibility_flags,find_additional_modules,kv_namespaces,main,name";
  assert.equal(Object.keys(cfg).sort().join(), keys);
  assert.equal(cfg.name, "acme-api-preview");
  assert.match(cfg.main, /preview-art-.*apps\/api\/worker\/index\.js$/);
  assert.deepEqual(cfg.kv_namespaces, [{ binding: "KV", id: "preview-kv" }]);
  assert.doesNotMatch(JSON.stringify(cfg), /prod|routes?"|custom_domain|evil/);
});

test("deploy: a relative artifact path still gives absolute paths inside the artifact", async () => {
  const dir = artifact();
  const w = stub(OK);
  await go(w, { artifact: relative(process.cwd(), dir), root: checkout(CONFIG) });
  assert.ok(isAbsolute(w.cfgs[0].main));
  assert.ok(w.cfgs[0].main.startsWith(realpathSync(dir) + sep));
});

test("previewConfig: assets for assets-only and for main+assets; no binding or run_worker_first", () => {
  const assets = { directory: "./dist", binding: "ASSETS", run_worker_first: true };
  const both = previewConfig(
    { name: "w", main: "src/i.ts", assets: { ...assets, not_found_handling: "404-page" } },
    { entry: "/a/w/i.js", assets: "/a/assets" },
  );
  assert.deepEqual(both.assets, { directory: "/a/assets", not_found_handling: "404-page" });
  assert.equal(both.main, "/a/w/i.js");
  assert.equal(both.find_additional_modules, true);
  assert.equal(both.base_dir, "/a/w");
  const only = previewConfig({ name: "w", assets }, { assets: "/a" });
  assert.deepEqual(only.assets, { directory: "/a" });
  assert.equal(only.main, undefined);
});

test("deploy: main+assets keeps the server bundle out of the assets directory; the stub has no bindings", async () => {
  const w = stub(MISSING, OK, OK);
  const kv = '"env": { "preview": { "kv_namespaces": [{ "binding": "K", "id": "k" }] } }';
  const cfg = `{ "name": "w", "main": "src/index.ts", "assets": { "directory": "./dist" }, ${kv} }`;
  await go(w, { root: checkout(cfg) });
  assert.equal(w.cfgs[1].kv_namespaces, undefined);
  assert.ok(w.cfgs[2].kv_namespaces);
  assert.ok(existsSync(w.cfgs[2].main));
  assert.ok(!existsSync(join(w.cfgs[2].assets.directory, "index.js")));
});

test("deploy: a missing Worker is created once from a stub entry, then the PR code is uploaded", async () => {
  const w = stub(MISSING, OK);
  const root = checkout('{ "name": "site", "assets": { "directory": "./dist" } }');
  const r = await go(w, { root });
  assert.equal(r.ok, true);
  assert.deepEqual(
    w.calls.map((c) => c.slice(0, 2).join(" ")),
    ["wrangler versions", "wrangler deploy", "wrangler versions"],
  );
  assert.equal(w.cfgs[1].name, "site-preview");
  assert.equal(w.cfgs[1].assets, undefined);
  assert.doesNotMatch(w.cfgs[1].main, /preview-art-/);
  assert.match(readFileSync(w.cfgs[1].main, "utf8"), /new Response/);
  assert.equal(w.cfgs[1].find_additional_modules, undefined);
  assert.equal(w.cfgs[1].base_dir, undefined);
  assert.match(w.cfgs[2].assets.directory, /preview-art-.*apps\/api\/assets$/);
  const bad = stub(MISSING, OK, { code: 1, out: "boom" });
  assert.equal((await go(bad)).ok, false);
  assert.equal(bad.calls.length, 3);
  assert.equal((await go(stub({ code: 1, out: "boom" }))).ok, false);
});

const forbidden = {
  "wrangler.json": (d) => writeFileSync(join(d, "apps/api/wrangler.json"), "{}"),
  "wrangler.jsonc": (d) => writeFileSync(join(d, "wrangler.jsonc"), "{}"),
  "package.json": (d) => writeFileSync(join(d, "apps/api/package.json"), "{}"),
  "pnpm-lock.yaml": (d) => writeFileSync(join(d, "pnpm-lock.yaml"), ""),
  "a .toml file": (d) => writeFileSync(join(d, "apps/api/x.toml"), ""),
  "_worker.js": (d) => writeFileSync(join(d, "apps/api/_worker.js"), ""),
  "a _worker.js* dir": (d) => mkdirSync(join(d, "apps/api/_worker.js.d")),
  ".assetsignore": (d) => writeFileSync(join(d, "apps/api/.assetsignore"), ""),
  "a symlink": (d) => symlinkSync("/etc/passwd", join(d, "apps/api/link")),
};
if (spawnSync("mkfifo", ["--version"]).status !== null) {
  forbidden["a FIFO"] = (d) => spawnSync("mkfifo", [join(d, "apps/api/pipe")]);
}

test("deploy: any forbidden file, symlink or special file is rejected before wrangler", async () => {
  const w = stub(OK);
  for (const [name, add] of Object.entries(forbidden)) {
    const dir = artifact(add);
    assert.equal(checkArtifact(dir).length, 1, name);
    assert.equal((await go(w, { artifact: dir })).ok, false, name);
  }
  assert.equal(w.calls.length, 0);
});

test("deploy: a manifest for another PR or with a path escape is rejected", async () => {
  const w = stub(OK);
  assert.equal((await go(w, { pr: "8" })).ok, false);
  const bad = artifact((d) =>
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ pr: 7, apps: ["../x"] })),
  );
  assert.equal((await go(w, { artifact: bad })).ok, false);
  const name = '{ "name": "a_b", "main": "src/index.ts" }';
  assert.equal((await go(w, { root: checkout(name) })).ok, false);
  assert.equal(w.calls.length, 0);
});

test("CLI: an unknown subcommand exits 2 with a usage line", () => {
  const r = spawnSync("node", [SCRIPT, "bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: preview\.mjs/);
});

test("deploy: hostile names and manifest values are rejected and never echoed raw", async () => {
  const w = stub(OK);
  const dir = artifact((d) => writeFileSync(join(d, "apps/api/a\n::set-output name=x::y"), ""));
  const r = await go(w, { artifact: dir });
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => !e.includes("\n")));
  const pr = artifact((d) =>
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ pr: "1\n::warning::x", apps: [] })),
  );
  const r2 = await go(w, { artifact: pr });
  assert.equal(r2.ok, false);
  assert.ok(!r2.errors.join("").includes("::warning::"));
  assert.equal(w.calls.length, 0);
});

test("fenced wraps wrangler output in stop-commands only on GitHub Actions", async () => {
  const out = [];
  assert.equal(
    await fenced(
      async () => 5,
      { GITHUB_ACTIONS: "true" },
      (t) => out.push(t),
    ),
    5,
  );
  const token = /^::stop-commands::([0-9a-f]{32})\n$/.exec(out[0])?.[1];
  assert.ok(token);
  assert.deepEqual(out.slice(1), [`\n::${token}::\n`]);
  const none = [];
  await fenced(
    async () => 1,
    {},
    (t) => none.push(t),
  );
  assert.deepEqual(none, []);
});

test("deploy: Worker names clashing with a <name>-preview Worker are refused", async () => {
  for (const other of [
    '{ "name": "acme-api-preview" }',
    '{ "name": "o", "env": { "x": { "name": "acme-api-preview" } } }',
  ]) {
    const root = checkout();
    mkdirSync(join(root, "apps/other"));
    writeFileSync(join(root, "apps/other/wrangler.jsonc"), other);
    const w = stub(OK);
    const r = await go(w, { root });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /acme-api-preview/);
    assert.equal(w.calls.length, 0);
  }
});

test("deploy: env.preview service and Durable Object references must be -preview Workers", async () => {
  const cfg = (pv) => `{ "name": "w", "main": "src/index.ts", "env": { "preview": ${pv} } }`;
  const bad = [
    '{ "services": [{ "binding": "S", "service": "prod-api" }] }',
    '{ "durable_objects": { "bindings": [{ "name": "D", "class_name": "C", "script_name": "prod" }] } }',
  ];
  for (const pv of bad) {
    const w = stub(OK);
    assert.equal((await go(w, { root: checkout(cfg(pv)) })).ok, false);
    assert.equal(w.calls.length, 0);
  }
  const good = '{ "services": [{ "binding": "S", "service": "api-preview" }] }';
  assert.equal((await go(stub(OK), { root: checkout(cfg(good)) })).ok, true);
});

test("deploy: server modules live under worker/ (base_dir), client JS stays in assets/", async () => {
  const dir = artifact((d) => {
    mkdirSync(join(d, "apps/api/worker/chunks"));
    writeFileSync(join(d, "apps/api/worker/chunks/a.mjs"), "x");
    writeFileSync(join(d, "apps/api/assets/app.js"), "client");
  });
  const cfg = '{ "name": "w", "main": "src/index.ts", "assets": { "directory": "./public" } }';
  const w = stub(OK);
  await go(w, { artifact: dir, root: checkout(cfg) });
  const { main, base_dir: base, assets } = w.cfgs[0];
  assert.equal(base, dirname(main));
  assert.ok(existsSync(join(base, "chunks/a.mjs")));
  assert.ok(existsSync(join(assets.directory, "app.js")));
  assert.ok(!existsSync(join(assets.directory, "chunks")));
});

test("deploy: a main inside assets.directory is refused", async () => {
  const w = stub(OK);
  const cfg = '{ "name": "w", "main": "dist/index.ts", "assets": { "directory": "./dist" } }';
  const r = await go(w, { root: checkout(cfg) });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /inside assets\.directory/);
  assert.equal(w.calls.length, 0);
});

test("deploy: a checkout without apps/ has no name clash and nothing to deploy", async () => {
  const root = mkdtempSync(join(tmpdir(), "preview-root-"));
  assert.equal((await go(stub(OK), { root })).ok, false);
});

test("runWrangler writes stdout and stderr to the same sink, in order", async () => {
  const chunks = [];
  const bin = ["node", "-e", "console.log('o1'); console.error('e1')", "--"];
  const r = await runWrangler(["x"], process.cwd(), { bin, write: (t) => chunks.push(t) });
  assert.equal(r.code, 0);
  assert.match(chunks.join(""), /o1[\s\S]*e1|e1[\s\S]*o1/);
  assert.ok(chunks.join("").includes("e1") && r.out.includes("e1"));
});

test("deploy: the missing-Worker error must be wrangler's error line, not any output", async () => {
  const w = stub({
    code: 1,
    out: "log: You cannot upload a new version of a Worker that does not yet exist",
  });
  assert.equal((await go(w)).ok, false);
  assert.equal(w.calls.length, 1);
});

const TOKENS = { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" };
const withEnv = (pv) => `{ "name": "w", "main": "src/index.ts", "env": { "preview": ${pv} } }`;

test("deploy: env.preview.services that is not an array fails that app with its own error", async () => {
  for (const pv of [
    '{ "services": { "binding": "S", "service": "x-preview" } }',
    '{ "services": "x" }',
  ]) {
    const w = stub(OK);
    const r = await go(w, { root: checkout(withEnv(pv)) });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /^api: .*services/);
    assert.equal(w.calls.length, 0);
  }
});

test("deploy: the implicit <name>-<env> Worker name of an env without a name also clashes", async () => {
  const clash = async (other) => {
    const root = checkout();
    mkdirSync(join(root, "apps/other"));
    writeFileSync(join(root, "apps/other/wrangler.jsonc"), other);
    const w = stub(OK);
    return { r: await go(w, { root }), calls: w.calls.length };
  };
  const bad = await clash('{ "name": "acme", "env": { "api-preview": { "vars": {} } } }');
  assert.equal(bad.r.ok, false);
  assert.match(bad.r.errors[0], /acme-api-preview/);
  assert.equal(bad.calls, 0);
  // An env that sets its own name is judged by that name only; env.preview is the binding source.
  const named = await clash('{ "name": "acme", "env": { "api-preview": { "name": "ok" } } }');
  assert.equal(named.r.ok, true);
  const own = await go(stub(OK), { root: checkout(withEnv('{ "vars": {} }')) });
  assert.equal(own.ok, true);
});

test("deploy: queue names in env.preview must end in -preview", async () => {
  const q = (x) => `{ "queues": ${x} }`;
  const bad = [
    q('{ "producers": [{ "binding": "Q", "queue": "jobs" }] }'),
    q('{ "consumers": [{ "queue": "jobs" }] }'),
    q('{ "consumers": [{ "queue": "jobs-preview", "dead_letter_queue": "dlq" }] }'),
    q('{ "producers": {} }'),
    q('{ "producers": [{ "binding": "Q" }] }'),
  ];
  for (const pv of bad) {
    const w = stub(OK);
    const r = await go(w, { root: checkout(withEnv(pv)) });
    assert.equal(r.ok, false, pv);
    assert.match(r.errors[0], /^api: .*queue/, pv);
    assert.equal(w.calls.length, 0, pv);
  }
  const good = q(
    '{ "producers": [{ "binding": "Q", "queue": "jobs-preview" }], "consumers": [{ "queue": "jobs-preview", "dead_letter_queue": "dlq-preview" }] }',
  );
  assert.equal((await go(stub(OK), { root: checkout(withEnv(good)) })).ok, true);
});

test("CLI: deploy reads the artifact directory from PREVIEW_ARTIFACT when no argument is given", () => {
  const dir = artifact((d) => writeFileSync(join(d, "apps/api/wrangler.json"), "{}"));
  const r = spawnSync("node", [SCRIPT, "deploy"], {
    cwd: checkout(),
    env: { ...process.env, PR_NUMBER: "7", PREVIEW_ARTIFACT: dir, ...TOKENS },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apps\/api\/wrangler\.json: forbidden name/);
});

test("CLI: deploy without Cloudflare credentials fails early, pointing at the preview environment", () => {
  for (const missing of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    const r = spawnSync("node", [SCRIPT, "deploy", artifact()], {
      cwd: checkout(),
      env: { ...process.env, PR_NUMBER: "7", ...TOKENS, [missing]: "" },
      encoding: "utf8",
    });
    assert.equal(r.status, 1, missing);
    assert.match(r.stderr, new RegExp(`${missing} is empty`), missing);
    assert.match(r.stderr, /secrets of the `preview` environment/, missing);
    assert.match(r.stderr, /Deployment branches/, missing);
  }
});

test("the generated README says where the Cloudflare secrets live", async () => {
  const text = await readFile(join(base.dir, "README.md"), "utf8");
  assert.match(text, /CLOUDFLARE_API_TOKEN/);
  assert.match(text, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(text, /secrets of the `preview` environment/);
  assert.match(text, /Deployment branches[^\n]*main/);
  assert.match(text, /never as repository secrets/i);
});

test("preview-deploy: setup-node has no pnpm cache and the package-manager cache is off", () => {
  for (const wf of [dep.wf, withSecrets]) {
    const node = usesStep(wf, /^actions\/setup-node@/);
    assert.equal(node.with.cache, undefined);
    assert.equal(node.with["package-manager-cache"], false);
  }
});
