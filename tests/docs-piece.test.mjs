import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

const NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const packsOf = async (dir) => JSON.parse(await read(dir, "docs/packs.json"));

async function treeHash(dir) {
  const h = createHash("sha256");
  const walk = async (d) => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else h.update(p).update(await readFile(p));
    }
  };
  await walk(dir);
  return h.digest("hex");
}

test("packs.json shape", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const doc = await packsOf(dir);
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc).sort(), ["packs", "version"]);
  for (const [tool, p] of Object.entries(doc.packs)) {
    assert.match(p.package, NAME_RE, tool);
    const allowed = ["package", "source", "build", "recipe"];
    assert.deepEqual(
      Object.keys(p).filter((k) => !allowed.includes(k)),
      [],
      `${tool}: unknown keys`,
    );
    for (const k of ["build", "recipe"]) if (k in p) assert.equal(typeof p[k], "string", tool);
    assert.ok(["vendor", "community"].includes(p.source), tool);
    if (p.source === "community") {
      assert.equal(Boolean(p.build) !== Boolean(p.recipe), true, `${tool}: build xor recipe`);
    }
  }
});

test("docs piece classes", async () => {
  const { result } = await renderCombo(["base", "docs"]);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls["docs/packs.json"], "shared");
  assert.equal(cls["docs/agents/docs.md"], "owned");
  assert.equal(cls["scripts/docs-packs.mjs"], "owned");
});

test("docs piece adds docspack devDependency and scripts", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const pkg = JSON.parse(await read(dir, "package.json"));
  assert.equal(pkg.devDependencies.docspack, "catalog:");
  assert.equal(pkg.scripts["docs:packs"], "node scripts/docs-packs.mjs");
  assert.equal(pkg.scripts["docs:sync"], "docspack sync && docspack index --repo");
  const base = JSON.parse(await read((await renderCombo(["base"])).dir, "package.json"));
  assert.equal(base.devDependencies.docspack, undefined);
  assert.equal(base.scripts["docs:sync"], undefined);
});

test("docs-lookup skill and CLAUDE.md import appear only with docs", async () => {
  const withDocs = (await renderCombo(["base", "docs"])).dir;
  const without = (await renderCombo(["base"])).dir;
  assert.ok(existsSync(join(withDocs, ".claude/skills/docs-lookup/SKILL.md")));
  assert.ok(!existsSync(join(without, ".claude/skills/docs-lookup/SKILL.md")));
  assert.match(await read(withDocs, "CLAUDE.md"), /^@docs\/agents\/docs\.md$/m);
  assert.ok(!/docs\/agents\/docs\.md/.test(await read(without, "CLAUDE.md")));
  assert.match(await read(withDocs, "docs/agents/docs.md"), /docspack ask/);
});

test("report states", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const { docsPacksReport } = await import(pathToFileURL(join(dir, "scripts/docs-packs.mjs")));
  const r = docsPacksReport(
    {
      hono: { package: "@docspack-community/hono", source: "community", build: "hono" },
      cascivo: { package: "@cascivo/docspack", source: "vendor" },
    },
    new Set(["@cascivo/docspack"]),
  );
  assert.deepEqual(
    r.map((x) => [x.tool, x.state]),
    [
      ["hono", "missing"],
      ["cascivo", "installed"],
    ],
  );
  const u = docsPacksReport(
    { hono: { package: "@docspack-community/hono", source: "community", build: "hono" } },
    new Set(),
    { unpublished: new Set(["@docspack-community/hono"]) },
  );
  assert.equal(u[0].state, "unpublished");
});

test("docs-packs CLI reports missing with the pnpm add -D command, exits 0, modifies nothing", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const before = await treeHash(dir);
  const r = spawnSync("node", [join(dir, "scripts/docs-packs.mjs")], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /missing/);
  assert.match(r.stdout, /pnpm add -D @cascivo\/docspack/);
  assert.equal(await treeHash(dir), before);
});

test("session-start skips docspack when not installed", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const bin = await mkdtemp(join(tmpdir(), "hull-stub-"));
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
  await chmod(join(bin, "pnpm"), 0o755);
  const r = spawnSync("/bin/bash", [join(dir, ".claude/hooks/session-start.sh")], {
    cwd: dir,
    env: { PATH: `${bin}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /docspack not installed/);
});

test("every recipe folder named in packs.json exists in community-packs/", async () => {
  const doc = JSON.parse(
    await readFile(join(REAL_TEMPLATE, "pieces/docs/files/docs/packs.json"), "utf8"),
  );
  const root = join(REAL_TEMPLATE, "..", "community-packs");
  for (const [tool, p] of Object.entries(doc.packs)) {
    if (p.recipe) {
      const prefix = "gh:keelstackhq/hull//community-packs/";
      assert.ok(p.recipe.startsWith(prefix), `${tool}: ${p.recipe}`);
      const folder = p.recipe.slice("gh:keelstackhq/hull//".length);
      assert.ok(existsSync(join(REAL_TEMPLATE, "..", folder, "README.md")), tool);
    }
  }
  assert.ok(existsSync(join(root, "README.md")));
});

test("lookupPublished: 404 unpublished, other failures unknown, success published", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const { lookupPublished, docsPacksReport } = await import(
    pathToFileURL(join(dir, "scripts/docs-packs.mjs"))
  );
  const name = "@docspack-community/hono";
  const fake = (r) => () => r;
  assert.equal(
    lookupPublished(name, fake({ status: 1, stderr: "npm error code E404" })),
    "unpublished",
  );
  assert.equal(
    lookupPublished(name, fake({ error: new Error("ETIMEDOUT"), status: null })),
    "unknown",
  );
  assert.equal(lookupPublished(name, fake({ status: 1, stderr: "npm error network" })), "unknown");
  assert.equal(lookupPublished(name, fake({ status: 0, stdout: "1.0.0\n" })), "published");
  let called = false;
  assert.equal(
    lookupPublished("Foo; rm -rf", () => ((called = true), { status: 0, stdout: "1" })),
    "invalid",
  );
  assert.equal(called, false, "invalid names never reach npm");
  let args;
  lookupPublished(name, (_c, a) => ((args = a), { status: 0, stdout: "1" }));
  assert.deepEqual(args, ["view", "--", name, "version"]);
  const r = docsPacksReport({ x: { package: "Evil Name", source: "vendor" } }, new Set());
  assert.equal(r[0].state, "invalid");
});
