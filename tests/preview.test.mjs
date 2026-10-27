import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { renderCombo } from "./helpers.mjs";
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
  TURBO_ARGS,
  buildArtifact,
  checkArtifact,
  deploy,
  parseJsonc,
  previewConfig,
  report,
} from "../template/pieces/base/files/.github/scripts/preview.mjs";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/.github/scripts/preview.mjs", import.meta.url),
);
const PATH = ".github/workflows/preview.yml";

async function load(pieces) {
  const { dir, result } = await renderCombo(pieces);
  const raw = await readFile(join(dir, PATH), "utf8");
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

test("job env carries Cloudflare secrets, PR number and turbo scm range", () => {
  assert.equal(job.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}");
  assert.equal(job.env.CLOUDFLARE_ACCOUNT_ID, "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
  assert.equal(job.env.PR_NUMBER, "${{ github.event.pull_request.number }}");
  assert.match(job.env.TURBO_SCM_BASE, /pull_request\.base\.sha/);
  assert.match(job.env.TURBO_SCM_HEAD, /github\.sha/);
});

test("deploy step runs preview.mjs, skipped without the token", () => {
  const d = steps.find((s) => /preview\.mjs/.test(s.run ?? ""));
  assert.equal(d.run.trim(), "node .github/scripts/preview.mjs");
  assert.equal(d.shell, "bash");
  assert.match(d.if, /env\.CLOUDFLARE_API_TOKEN != ''/);
  assert.match(d.if, /outputs\.deploy == 'true'/);
});

test("preview.mjs is owned by base and runs only deploy:preview (never production deploy)", () => {
  const c = base.result.changes.find((x) => x.path === ".github/scripts/preview.mjs");
  assert.equal(c.class, "owned");
  assert.deepEqual(TURBO_ARGS, [
    "turbo",
    "run",
    "deploy:preview",
    "--affected",
    "--continue",
    "--log-prefix=task",
  ]);
});

// Shapes of real turbo 2.11 output with --log-prefix=task in GitHub Actions (checked 2026-10-22).
const WEB_OK = [
  "::group::@acme/web:deploy:preview",
  "@acme/web:deploy:preview: Version Preview Alias URL: \x1b[36mhttps://pr-3-web.acme.workers.dev\x1b[0m",
  "::endgroup::",
].join("\n");
const API_MISSING = [
  "\x1b[;31m@acme/api:deploy:preview\x1b[;0m",
  "@acme/api:deploy:preview: \x1b[31m✘ [ERROR]\x1b[0m You cannot upload a new version of a Worker that does not yet exist. Please run the `deploy` command first.",
  "@acme/api:deploy:preview: [ELIFECYCLE] Command failed with exit code 1.",
].join("\n");
const tail = (failed) =>
  ` Tasks:    1 successful, 2 total\nFailed:    ${failed}\n ERROR  run failed: command  exited (1)\n`;

test("report: success lists the preview URLs without ANSI codes", () => {
  const r = report(`${WEB_OK}\n Tasks:    1 successful, 1 total\n`, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.urls, ["https://pr-3-web.acme.workers.dev"]);
  assert.deepEqual(r.notCreated, []);
  assert.match(r.summary, /^## Preview deployments\n/);
  assert.match(r.summary, /https:\/\/pr-3-web\.acme\.workers\.dev/);
});

test("report: a Worker that was never deployed is skipped with a notice, not a failure", () => {
  const r = report(`${WEB_OK}\n${API_MISSING}\n${tail("@acme/api#deploy:preview")}`, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.notCreated, ["@acme/api"]);
  assert.deepEqual(r.urls, ["https://pr-3-web.acme.workers.dev"]);
  assert.match(r.summary, /does not exist yet/);
  assert.match(r.summary, /pnpm turbo run deploy --filter=@acme\/api/);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /^::notice title=Preview skipped::@acme\/api/);
});

test("report: any other failure still fails the job", () => {
  const build = report(`${API_MISSING}\n${tail("@acme/web#build, @acme/api#deploy:preview")}`, 1);
  assert.equal(build.ok, false);
  const auth = report(
    `@acme/web:deploy:preview: ✘ [ERROR] Authentication error [code: 10000]\n${tail("@acme/web#deploy:preview")}`,
    1,
  );
  assert.equal(auth.ok, false);
  assert.deepEqual(auth.notCreated, []);
  const both = report(
    `${API_MISSING}\n@acme/web:deploy:preview: ✘ [ERROR] boom\n${tail("@acme/api#deploy:preview, @acme/web#deploy:preview")}`,
    1,
  );
  assert.equal(both.ok, false);
});

test("report: a non-zero exit without a Failed line fails", () => {
  assert.equal(report(" ERROR  run failed: no lockfile\n", 1).ok, false);
  assert.equal(report(API_MISSING, 1).ok, false);
});

test("deployable pieces document the one-time first deploy", async () => {
  for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
    const name = piece.split(":")[1];
    const { dir } = await renderCombo(["base", piece]);
    const doc = await readFile(join(dir, `apps/${name}/AGENTS.md`), "utf8");
    assert.match(doc, /pnpm turbo run deploy --filter=@\w+\/\w+/, piece);
  }
});

test("install matches ci.yml rules", () => {
  assert.ok(steps.some((s) => s.uses?.startsWith("pnpm/action-setup@v4")));
  assert.ok(steps.some((s) => s.uses?.startsWith("actions/setup-node@v5")));
  assert.ok(steps.some((s) => s.run === "pnpm install --frozen-lockfile --prefer-offline"));
});

test("turbo passes deploy env through for deploy tasks", async () => {
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  for (const t of ["deploy:preview", "deploy"]) {
    assert.deepEqual(turbo.tasks[t].passThroughEnv, [
      "PR_NUMBER",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
  }
});

test("deploy tasks depend on build (a CI checkout has no dist/)", async () => {
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  for (const t of ["deploy:preview", "deploy"])
    assert.deepEqual(turbo.tasks[t].dependsOn, ["build"]);
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
  mkdirSync(join(dir, "apps/api"), { recursive: true });
  writeFileSync(join(dir, "apps/api/index.js"), "export default {}\n");
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
  const root = checkout();
  mkdirSync(join(root, "apps/api/dist"));
  writeFileSync(join(root, "apps/api/dist/index.js"), "x");
  writeFileSync(join(root, "apps/api/dist/wrangler.json"), "{}");
  const out = join(root, ".preview");
  buildArtifact({ root, out, pr: "7" });
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual(manifest, { pr: 7, apps: ["api"] });
  assert.deepEqual(checkArtifact(out), []);
  assert.equal(readFileSync(join(out, "apps/api/index.js"), "utf8"), "x");
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
  out: "You cannot upload a new version of a Worker that does not yet exist.",
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
  const keys = "compatibility_date,compatibility_flags,kv_namespaces,main,name";
  assert.equal(Object.keys(cfg).sort().join(), keys);
  assert.equal(cfg.name, "acme-api-preview");
  assert.match(cfg.main, /preview-art-.*apps\/api\/index\.js$/);
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
    { entry: "/a/i.js", assets: "/a" },
  );
  assert.deepEqual(both.assets, { directory: "/a", not_found_handling: "404-page" });
  assert.equal(both.main, "/a/i.js");
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
  assert.match(w.cfgs[2].assets.directory, /preview-art-.*apps\/api$/);
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
