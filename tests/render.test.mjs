import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TemplateError } from "../scripts/lib/errors.mjs";
import { main, renderNew } from "../scripts/render.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/template", import.meta.url));

const tmp = () => mkdtemp(join(tmpdir(), "hull-render-"));
const read = (dir, p) => readFile(join(dir, p), "utf8");
const exists = (dir, p) =>
  stat(join(dir, p)).then(
    () => true,
    () => false,
  );

/** Copy the fixture and add files to a piece. */
async function variant(files, piece = "base") {
  const t = join(await tmp(), "template");
  await cp(FIXTURE, t, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const f = join(t, "pieces", piece, "files", rel);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, content);
  }
  return t;
}
const outDir = async () => join(await tmp(), "out");

async function runCli(argv) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => (chunks.push(String(c)), true);
  try {
    const code = await main(argv);
    return { code, stdout: chunks.join("") };
  } finally {
    process.stdout.write = orig;
  }
}

test("renders, copies, strips .jinja", async () => {
  const out = await outDir();
  const r = await renderNew({
    template: FIXTURE,
    out,
    pieces: ["app:admin"],
    vars: { scope: "acme" },
  });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(await read(out, "package.json")).name, "@acme/root");
  assert.ok(!(await exists(out, "package.json.jinja")));
  assert.ok(await exists(out, "apps/admin/src/main.ts"));
});

test("binary file copied byte for byte", async () => {
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x0d, 0x0a,
  ]);
  const t = await variant({ "logo.png": bytes });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: [], vars: {} });
  assert.deepEqual(await readFile(join(out, "logo.png")), bytes);
});

test("whitespace-only output is skipped and no empty dir is left", async () => {
  const t = await variant({ "empty/x.txt.jinja": '{% if "nope" in pieces %}x{% endif %}\n' });
  const out = await outDir();
  const r = await renderNew({ template: t, out, pieces: [], vars: {} });
  const c = r.changes.find((x) => x.path === "empty/x.txt");
  assert.equal(c.action, "skip");
  assert.ok(!(await exists(out, "empty")));
});

test("CRLF in a template becomes LF", async () => {
  const t = await variant({ "a.txt.jinja": "a\r\n{{ scope }}\r\n" });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: [], vars: {} });
  assert.equal(await read(out, "a.txt"), "a\nacme\n");
});

test("final newline kept exactly: with and without a trailing \\n", async () => {
  const t = await variant({
    "with.txt.jinja": "x{{ scope }}\n",
    "without.txt.jinja": "x{{ scope }}",
  });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: [], vars: {} });
  assert.equal(await read(out, "with.txt"), "xacme\n");
  assert.equal(await read(out, "without.txt"), "xacme");
});

test("autoescape off: '<&>' in a var renders verbatim", async () => {
  const t = await variant({ "e.txt.jinja": "{{ scope }}" });
  const t2 = join(await tmp(), "t");
  await cp(t, t2, { recursive: true });
  await writeFile(
    join(t2, "splice.toml"),
    (await readFile(join(t2, "splice.toml"), "utf8")).replace(
      /^scope = .*$/m,
      'scope = { prompt = "s", default = "acme" }',
    ),
  );
  const out = await outDir();
  await renderNew({ template: t2, out, pieces: [], vars: { scope: "<&>" } });
  assert.equal(await read(out, "e.txt"), "<&>");
});

test("pieces holds unique ids in add order with two instances", async () => {
  const t = await variant({ "p.txt.jinja": "{% for p in pieces %}{{ p }},{% endfor %}" }, "app");
  const out = await outDir();
  await renderNew({ template: t, out, pieces: ["app:a", "app:b"], vars: {} });
  assert.equal(await read(out, "apps/a/p.txt"), "base,app,");
  assert.equal(await read(out, "apps/b/p.txt"), "base,app,");
});

test("non-multiple piece has piece.name === piece.id", async () => {
  const t = await variant({ "n.txt.jinja": "{{ piece.id }}={{ piece.name }}" });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: [], vars: {} });
  assert.equal(await read(out, "n.txt"), "base=base");
});

test("undefined variable → TemplateError naming the file", async () => {
  const t = await variant({ "u.txt.jinja": "{{ nope }}" });
  const out = await outDir();
  await assert.rejects(
    renderNew({ template: t, out, pieces: [], vars: {} }),
    (e) => e instanceof TemplateError && e.message.includes("u.txt.jinja"),
  );
  assert.ok(!(await exists(out, ".")));
});

test("subset violation → TemplateError before anything is written", async () => {
  const t = await variant({ "s.txt.jinja": "{% set x = 1 %}" });
  const out = await outDir();
  await assert.rejects(
    renderNew({ template: t, out, pieces: [], vars: {} }),
    (e) => e instanceof TemplateError && e.message.includes("s.txt.jinja"),
  );
  assert.ok(!(await exists(out, ".")));
});

test("non-empty --out → exit 2, nothing written", async () => {
  const out = await tmp();
  await writeFile(join(out, "keep.txt"), "k");
  const { code } = await runCli(["new", "--template", FIXTURE, "--out", out, "--piece", "app"]);
  assert.equal(code, 2);
  assert.deepEqual(await readdir(out), ["keep.txt"]);
});

test("--json prints exactly one JSON object", async () => {
  const out = await outDir();
  const { code, stdout } = await runCli([
    "new",
    "--template",
    FIXTURE,
    "--out",
    out,
    "--piece",
    "app",
    "--json",
  ]);
  assert.equal(code, 0);
  const o = JSON.parse(stdout);
  assert.deepEqual(Object.keys(o).sort(), ["changes", "command", "messages", "ok"]);
  assert.ok(o.changes.every((c) => ["path", "action", "class"].every((k) => k in c)));
});

test("usage error with --json → exit 2 and ok:false", async () => {
  const out = await outDir();
  const { code, stdout } = await runCli([
    "new",
    "--template",
    FIXTURE,
    "--out",
    out,
    "--piece",
    "nope",
    "--json",
  ]);
  assert.equal(code, 2);
  const o = JSON.parse(stdout);
  assert.equal(o.ok, false);
  assert.ok(o.messages.length > 0);
});

test("for-loop and in-pieces render identically to the contract examples", async () => {
  const golden = await readFile(join(FIXTURE, "..", "golden", "pieces.txt"), "utf8");
  const t = await variant({
    "pieces.txt.jinja":
      '{% for p in pieces %}- {{ p }}\n{% endfor %}{% if "app" in pieces %}has app\n{% else %}no app\n{% endif %}',
  });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: ["app"], vars: {} });
  assert.equal(await read(out, "pieces.txt"), golden);
});

test("undefined var in a piece target → exit 3 naming piece.toml, no output", async () => {
  const t = await variant({});
  const f = join(t, "pieces/app/piece.toml");
  await writeFile(f, (await readFile(f, "utf8")).replace("{{ name }}", "{{ nope }}"));
  const out = await outDir();
  const { code } = await runCli(["new", "--template", t, "--out", out, "--piece", "app"]);
  assert.equal(code, 3);
  assert.ok(!(await exists(out, ".")));
  await assert.rejects(
    renderNew({ template: t, out, pieces: ["app"], vars: {} }),
    (e) => e instanceof TemplateError && e.message.includes("piece.toml"),
  );
});

test("undefined var in a path segment → exit 3 naming the path", async () => {
  const t = await variant({ "x-{{ nope }}.txt": "x" });
  const out = await outDir();
  const { code } = await runCli(["new", "--template", t, "--out", out]);
  assert.equal(code, 3);
  await assert.rejects(
    renderNew({ template: t, out, pieces: [], vars: {} }),
    (e) => e instanceof TemplateError && e.message.includes("x-{{ nope }}.txt"),
  );
});

test("subset violation in target or path → exit 3", async () => {
  const t = await variant({});
  const f = join(t, "pieces/app/piece.toml");
  await writeFile(f, (await readFile(f, "utf8")).replace("{{ name }}", "{{ name | title }}"));
  const out = await outDir();
  assert.equal((await runCli(["new", "--template", t, "--out", out, "--piece", "app"])).code, 3);
  const t2 = await variant({ "y-{{ scope | title }}.txt": "x" });
  assert.equal((await runCli(["new", "--template", t2, "--out", await outDir()])).code, 3);
});

test("unexpected (non-TemplateError) errors exit 3 with an internal error message", async () => {
  const { code, stdout } = await runCli([
    "new",
    "--template",
    FIXTURE,
    "--out",
    "bad\0out",
    "--json",
  ]);
  assert.equal(code, 3);
  assert.match(JSON.parse(stdout).messages[0], /^internal error:/);
});

test("file/dir prefix collision between pieces → TemplateError, nothing written", async () => {
  const t = await variant({ apps: "i am a file" });
  const out = await outDir();
  await assert.rejects(
    renderNew({ template: t, out, pieces: ["app"], vars: {} }),
    (e) => e instanceof TemplateError && e.message.includes("apps"),
  );
  assert.ok(!(await exists(out, ".")));
});

test("failed write leaves no --out and no staging dir", async () => {
  const t = await variant({ "w-{{ scope }}.txt": "x" });
  const f = join(t, "splice.toml");
  await writeFile(
    f,
    (await readFile(f, "utf8")).replace(
      /^scope = .*$/m,
      'scope = { prompt = "s", default = "acme" }',
    ),
  );
  const parent = await tmp();
  const out = join(parent, "out");
  // a NUL byte in a rendered path is only rejected by the filesystem call at write time
  await assert.rejects(renderNew({ template: t, out, pieces: [], vars: { scope: "a\0b" } }));
  assert.deepEqual(await readdir(parent), []);
});

test("existing empty --out is replaced in place", async () => {
  const out = await outDir();
  await mkdir(out, { recursive: true });
  const r = await renderNew({ template: await variant({}), out, pieces: [], vars: {} });
  assert.equal(r.ok, true);
  assert.ok(await exists(out, "README.md"));
});

test("BOM-only body is written (not whitespace-only)", async () => {
  const t = await variant({ "bom.txt.jinja": "﻿" });
  const out = await outDir();
  await renderNew({ template: t, out, pieces: [], vars: {} });
  assert.equal(await read(out, "bom.txt"), "﻿");
});

test("--out gets umask-based permissions, new and pre-existing", async () => {
  const want = 0o777 & ~process.umask();
  const out = await outDir();
  await renderNew({ template: FIXTURE, out, pieces: [], vars: {} });
  assert.equal((await stat(out)).mode & 0o777, want);
  const out2 = await outDir();
  await mkdir(out2, { recursive: true });
  await renderNew({ template: FIXTURE, out: out2, pieces: [], vars: {} });
  assert.equal((await stat(out2)).mode & 0o777, want);
});

test("failure removes parent dirs it created", async () => {
  const t = await variant({ "w-{{ scope }}.txt": "x" });
  const f = join(t, "splice.toml");
  await writeFile(
    f,
    (await readFile(f, "utf8")).replace(
      /^scope = .*$/m,
      'scope = { prompt = "s", default = "acme" }',
    ),
  );
  const parent = await tmp();
  const out = join(parent, "p", "q", "out");
  await assert.rejects(renderNew({ template: t, out, pieces: [], vars: { scope: "a\0b" } }));
  assert.deepEqual(await readdir(parent), []);
});

test("pre-existing empty --out survives a failed render", async () => {
  const t = await variant({ "u.txt.jinja": "{{ nope }}" });
  const out = await outDir();
  await mkdir(out, { recursive: true });
  await assert.rejects(renderNew({ template: t, out, pieces: [], vars: {} }));
  assert.ok(await exists(out, "."));
});

test("--json internal error message has no stack", async () => {
  const { stdout } = await runCli(["new", "--template", FIXTURE, "--out", "bad\0out", "--json"]);
  const m = JSON.parse(stdout).messages[0];
  assert.match(m, /^internal error: /);
  assert.ok(!m.includes("\n    at "));
});
