import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/scripts/ready.mjs", import.meta.url),
);
const { CLASH, DETECT, assess, classOf, runChecks } = await import(SCRIPT);
const TEMPLATE = (t) => fileURLToPath(new URL(`../${t}`, import.meta.url));

const repo = async (files) => {
  const d = await mkdtemp(join(tmpdir(), "assess-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), text);
  }
  return d;
};
const pkg = (deps) => JSON.stringify({ name: "x", dependencies: deps });

for (const t of ["template", "template-rust"]) {
  test(`CLASH.${t} classifies every file the base renders, and each pattern is used`, async () => {
    const out = join(await mkdtemp(join(tmpdir(), "assess-render-")), "out");
    const { changes } = await renderNew({ template: TEMPLATE(t), out, pieces: [], vars: {} });
    for (const c of changes) assert.equal(classOf(t, c.path), c.class, `${t} ${c.path}`);
    for (const [cls, patterns] of Object.entries(CLASH[t])) {
      for (const p of patterns.split(" ")) {
        const hit = changes.some((c) => classOf(t, c.path) === cls && match(p, c.path));
        assert.ok(hit, `${t} ${cls} pattern ${p} matches no rendered file`);
      }
    }
  });
}
const match = (p, path) => (p.endsWith("/**") ? path.startsWith(p.slice(0, -2)) : p === path);

test("DETECT rules have unique ids, a signal text and a template or piece", () => {
  assert.equal(new Set(DETECT.map((r) => r.id)).size, DETECT.length);
  for (const r of DETECT)
    assert.ok(r.signal.length > 10 && (r.template || r.piece || r.info), r.id);
});

test("a pnpm repo: template/, pieces with reasons, moves for off-layout code, clashes by class", async () => {
  const root = await repo({
    "package.json": pkg({}),
    "pnpm-workspace.yaml": "packages: []\n",
    "apps/web/package.json": pkg({ preact: "10.0.0", vite: "7.0.0" }),
    "services/api/package.json": pkg({ hono: "4.0.0" }),
    "services/api/wrangler.jsonc": "{}\n",
    "crates/tool/Cargo.toml": '[package]\nname = "tool"\n',
    "crates/tool/src/lib.rs": "",
    ".github/workflows/ci.yml": "on: push\n",
    "README.md": "# x\n",
  });
  const a = assess(root);
  assert.equal(a.template, "template");
  const by = Object.fromEntries(a.pieces.map((p) => [p.piece, p]));
  assert.equal(by["preact-app"].from, "apps/web");
  assert.equal(by["preact-app"].to, "apps/web");
  assert.equal(by["hono-worker"].from, "services/api");
  assert.equal(by["hono-worker"].to, "apps/api", "off-layout code moves");
  assert.equal(by["rust-tool"].to, "crates/tool");
  for (const p of a.pieces) assert.ok(p.reason.length > 5, p.piece);
  assert.deepEqual(a.clashes.owned, [".github/workflows/ci.yml"]);
  assert.deepEqual(a.clashes.shared, ["package.json", "pnpm-workspace.yaml"]);
  assert.deepEqual(a.clashes.seed, ["README.md"]);
  assert.equal(
    a.next,
    "on a branch: splice adopt gh:keelstackhq/hull//template --piece preact-app:web " +
      "--piece hono-worker:api --piece rust-tool:tool --dry-run --json; review, then run it " +
      "without --dry-run (hull docs/adopt.md)",
  );
});

test("a Cargo-only repo with a binary: template-rust, rust-cli", async () => {
  const root = await repo({
    "Cargo.toml": '[package]\nname = "tool"\n',
    "src/main.rs": "fn main() {}\n",
  });
  const a = assess(root);
  assert.equal(a.template, "template-rust");
  assert.deepEqual(
    a.pieces.map((p) => [p.piece, p.from, p.to]),
    [["rust-cli", ".", "crates/tool"]],
  );
  assert.ok(a.signals.some((s) => s.id === "cargo-only"));
});

test("tauri (replacing its preact hit), astro and [[bin]] signals", async () => {
  const root = await repo({
    "package.json": pkg({}),
    "apps/desk/package.json": pkg({ "@tauri-apps/api": "2.0.0", preact: "10.0.0" }),
    "apps/desk/src-tauri/Cargo.toml": '[package]\nname = "desk"\n',
    "site/package.json": pkg({ astro: "7.0.0" }),
    "cli/Cargo.toml": '[package]\nname = "cli"\n\n[[bin]]\nname = "cli"\npath = "x.rs"\n',
  });
  const pieces = assess(root)
    .pieces.map((p) => `${p.piece}:${p.from}`)
    .sort();
  assert.deepEqual(pieces, ["astro-site:site", "rust-cli:cli", "tauri-app:apps/desk"]);
});

test("no package.json or Cargo.toml: no template, channels only", async () => {
  const a = assess(await repo({ "README.md": "# docs\n" }));
  assert.equal(a.template, null);
  assert.match(a.next, /channels only/);
});

test("--assess --json works with ready.mjs copied alone and writes nothing", async () => {
  const root = await repo({ "package.json": pkg({ astro: "7.0.0" }), "CLAUDE.md": "x\n" });
  const tool = await mkdtemp(join(tmpdir(), "assess-tool-"));
  copyFileSync(SCRIPT, join(tool, "ready.mjs"));
  const before = readdirSync(root).sort();
  const r = spawnSync(process.execPath, [join(tool, "ready.mjs"), "--assess", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.equal(a.template, "template");
  assert.deepEqual(a.clashes.owned, ["CLAUDE.md"]);
  assert.deepEqual(readdirSync(root).sort(), before);
  const text = spawnSync(process.execPath, [join(tool, "ready.mjs"), "--assess"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(text.stdout, /^template: template$/m);
  assert.match(text.stdout, /^clash owned +CLAUDE\.md/m);
});

test("ready without a lock: render is ask 'not adopted', pointing at splice adopt", async () => {
  const root = await repo({ "package.json": pkg({}) });
  const r = runChecks({ root, run: () => ({ ok: false, out: "", err: "" }), node: "24.0.0" }).find(
    (x) => x.id === "render",
  );
  assert.equal(r.status, "ask");
  assert.match(r.note, /not adopted/);
  assert.match(r.fix, /splice adopt/);
});

test("a workspace root package.json is not an app; names come from package.json", async () => {
  const root = await repo({
    "package.json": JSON.stringify({
      name: "@acme/root",
      workspaces: ["web"],
      dependencies: { preact: "10" },
    }),
    "web/package.json": JSON.stringify({ name: "@acme/web", dependencies: { preact: "10" } }),
  });
  const pieces = assess(root).pieces.map((p) => [p.piece, p.from, p.to]);
  assert.deepEqual(pieces, [["preact-app", "web", "apps/web"]]);
  const single = await repo({
    "package.json": JSON.stringify({ name: "@acme/shop", dependencies: { astro: "7" } }),
  });
  assert.deepEqual(
    assess(single).pieces.map((p) => [p.piece, p.to]),
    [["astro-site", "apps/shop"]],
  );
});

test("tauri replaces the preact hit for the same dir; pnpm-workspace.yaml alone is evidence", async () => {
  const root = await repo({
    "pnpm-workspace.yaml": "packages: []\n",
    "desk/package.json": pkg({ "@tauri-apps/api": "2", preact: "10" }),
  });
  const a = assess(root);
  assert.equal(a.template, "template");
  assert.deepEqual(
    a.pieces.map((p) => p.piece),
    ["tauri-app"],
  );
  assert.ok(a.signals.find((s) => s.id === "pnpm").evidence.includes("pnpm-workspace.yaml"));
});

test("hono: any wrangler config counts, not only the first wrangler.* entry", async () => {
  const root = await repo({
    "package.json": pkg({}),
    "api/package.json": pkg({ hono: "4" }),
    "api/wrangler.aaa.bak": "",
    "api/wrangler.jsonc": "{}\n",
  });
  assert.deepEqual(
    assess(root).pieces.map((p) => p.piece),
    ["hono-worker"],
  );
});

test("a piece target that already exists (and is not the source) is a clash", async () => {
  const root = await repo({
    "package.json": pkg({}),
    "site/package.json": pkg({ astro: "7" }),
    "apps/site/README.md": "old\n",
  });
  assert.deepEqual(assess(root).clashes.targets, ["apps/site"]);
});

test("files under .github/ or .claude/ that the template does not write are no clash", async () => {
  const root = await repo({
    "package.json": pkg({}),
    ".github/ISSUE_TEMPLATE/bug.md": "x\n",
    ".github/workflows/ci.yml": "on: push\n",
    ".claude/agents/mine.md": "x\n",
  });
  assert.deepEqual(assess(root).clashes.owned, [".github/workflows/ci.yml"]);
});
