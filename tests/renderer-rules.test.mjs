import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TemplateError, UsageError } from "../scripts/lib/errors.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { checkSubset } from "../scripts/lib/subset.mjs";
import { renderNew } from "../scripts/render.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/template", import.meta.url));

async function copy() {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-rules-")), "template");
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}
async function addFiles(files, piece = "base") {
  const t = await copy();
  for (const [rel, content] of Object.entries(files)) {
    const f = join(t, "pieces", piece, "files", rel);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, content);
  }
  return t;
}
async function render(t, pieces = ["base"]) {
  const out = join(await mkdtemp(join(tmpdir(), "hull-rules-out-")), "out");
  const result = await renderNew({ template: t, out, pieces, vars: {} });
  return { ...result, out };
}
const rejects = (cls, re, p) =>
  assert.rejects(p, (e) => {
    assert.ok(e instanceof cls, `expected ${cls.name}, got ${e?.name}: ${e?.message}`);
    assert.match(e.message, re);
    return true;
  });

// --- manifest defaults and required fields
test("[[post]] without when → TemplateError", async () => {
  const t = await copy();
  const pt = join(t, "pieces/base/piece.toml");
  await writeFile(pt, `${await readFile(pt, "utf8")}\n[[post]]\nrun = "true"\n`);
  await rejects(TemplateError, /when/, loadTemplate(t));
});
test("piece description is optional, defaults to empty", async () => {
  const t = await copy();
  const pt = join(t, "pieces/base/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace(/^description = .*\n/m, ""));
  assert.equal((await loadTemplate(t)).pieces.get("base").description, "");
});
test("var prompt is optional, defaults to the var name", async () => {
  const t = await copy();
  const st = join(t, "splice.toml");
  await writeFile(st, `${await readFile(st, "utf8")}\n[vars.thing]\ndefault = "y"\n`);
  assert.equal((await loadTemplate(t)).vars.thing.prompt, "thing");
});

// --- identifiers
for (const name of ["Scope", "a-b", "loop", "self", "range", "namespace", "é"]) {
  test(`invalid var name ${JSON.stringify(name)} → TemplateError`, async () => {
    const t = await copy();
    const st = join(t, "splice.toml");
    await writeFile(st, `${await readFile(st, "utf8")}\n[vars."${name}"]\ndefault = "y"\n`);
    await rejects(TemplateError, /var/, loadTemplate(t));
  });
}
for (const src of [
  "{{ Scope }}",
  "{{ loop }}",
  "{% if self %}x{% endif %}",
  "{% for range in pieces %}{% endfor %}",
  "{% for Item in pieces %}{% endfor %}",
  "{% for namespace in pieces %}{% endfor %}",
  "{{ é }}",
]) {
  test(`subset rejects ${src}`, () => assert.ok(checkSubset(src, "f").length > 0));
}
test("subset accepts lowercase identifiers", () =>
  assert.deepEqual(checkSubset("{{ scope_1 }}{% for p in pieces %}{{ p }}{% endfor %}", "f"), []));

// --- symlinks
async function symlinkCase(label, mk) {
  test(`symlink: ${label} → TemplateError`, async () => {
    const t = await copy();
    await mk(t);
    await rejects(TemplateError, /symlink/i, render(t));
  });
}
await symlinkCase("file under files/", (t) =>
  symlink("README.md", join(t, "pieces/base/files/link.md")),
);
await symlinkCase("directory under files/", (t) =>
  symlink("src", join(t, "pieces/base/files/srclink")),
);
await symlinkCase("files/ itself", async (t) => {
  await cp(join(t, "pieces/app/files"), join(t, "pieces/app/real"), { recursive: true });
  await rm(join(t, "pieces/app/files"), { recursive: true });
  await symlink("real", join(t, "pieces/app/files"));
});
await symlinkCase("splice.toml", async (t) => {
  await cp(join(t, "splice.toml"), join(t, "real.toml"));
  await rm(join(t, "splice.toml"));
  await symlink("real.toml", join(t, "splice.toml"));
});
await symlinkCase("piece.toml", async (t) => {
  const p = join(t, "pieces/base");
  await cp(join(p, "piece.toml"), join(p, "real.toml"));
  await rm(join(p, "piece.toml"));
  await symlink("real.toml", join(p, "piece.toml"));
});
await symlinkCase("pieces/<id>", async (t) => {
  await symlink("base", join(t, "pieces/other"));
});
await symlinkCase("pieces/", async (t) => {
  await rename(join(t, "pieces"), join(t, "pieces2"));
  await symlink("pieces2", join(t, "pieces"));
});
await symlinkCase("migrations/", async (t) => {
  await rm(join(t, "migrations"), { recursive: true });
  await mkdir(join(t, "real-migrations"));
  await symlink("real-migrations", join(t, "migrations"));
});
await symlinkCase("migration file", async (t) => {
  await writeFile(join(t, "real.txt"), "x");
  await symlink("../real.txt", join(t, "migrations/001.toml"));
});

// --- path segments
const BAD_NAMES = [
  ["CON", /reserved/i],
  ["con.txt", /reserved/i],
  ["Nul", /reserved/i],
  ["COM1", /reserved/i],
  ["lpt9.log", /reserved/i],
  ["trail.", /end/i],
  ["trail ", /end/i],
  [".git", /\.git/],
  [".GIT", /\.git/],
  ["a:b", /character/i],
  ["a\x01b", /character/i],
];
for (const [name, re] of BAD_NAMES) {
  test(`literal file name ${JSON.stringify(name)} → TemplateError`, async () => {
    await rejects(TemplateError, re, render(await addFiles({ [name]: "x" })));
  });
}
test("literal directory named .git → TemplateError", async () => {
  await rejects(TemplateError, /\.git/, render(await addFiles({ ".git/config": "x" })));
});
test("rendered path segment from a var is checked", async () => {
  const t = await copy();
  const st = join(t, "splice.toml");
  await writeFile(
    st,
    (await readFile(st, "utf8")).replace(/^scope = .*$/m, 'scope = { default = "acme" }'),
  );
  const pt = join(t, "pieces/app/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace('"apps/{{ name }}"', '"{{ scope }}"'));
  const out = join(await mkdtemp(join(tmpdir(), "hull-rules-out-")), "out");
  await rejects(
    TemplateError,
    /reserved/i,
    renderNew({ template: t, out, pieces: ["app"], vars: { scope: "con" } }),
  );
});
test("case-insensitive collision of two files → TemplateError", async () => {
  await rejects(TemplateError, /case/i, render(await addFiles({ "Foo.txt": "a", "foo.txt": "b" })));
});
test("case-insensitive collision of file and directory prefix → TemplateError", async () => {
  await rejects(TemplateError, /case/i, render(await addFiles({ A: "a", "a/b.txt": "b" })));
});
test("case-insensitive collision across pieces → TemplateError", async () => {
  const t = await addFiles({ "Apps/x/src/main.ts": "a" });
  await rejects(TemplateError, /case/i, render(t, ["app:x"]));
});
test("piece id with a reserved name → TemplateError", async () => {
  const t = await copy();
  await cp(join(t, "pieces/app"), join(t, "pieces/con"), { recursive: true });
  const pt = join(t, "pieces/con/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace('id = "app"', 'id = "con"'));
  await rejects(TemplateError, /reserved/i, loadTemplate(t));
});
for (const bad of ["con", "NUL.x", "a:b", "x.", "x ", ".git", ".", "a\x01"]) {
  test(`instance name ${JSON.stringify(bad)} → UsageError`, async () => {
    const t = await copy();
    const pt = join(t, "pieces/app/piece.toml");
    await writeFile(pt, (await readFile(pt, "utf8")).replace(/^name = .*\n/m, ""));
    await rejects(UsageError, /instance name/, render(t, [`app:${bad}`]));
  });
}

// --- empty non-.jinja files are written
test("empty non-.jinja file is written", async () => {
  const out = await render(await addFiles({ "empty.txt": "" }));
  assert.ok(out.changes.some((c) => c.path === "empty.txt" && c.action === "create"));
  assert.equal(await readFile(join(out.out, "empty.txt"), "utf8").catch(() => null), "");
});

// --- review fixes
for (const x of ["..", ".", ""]) {
  test(`target + rendered segment ${JSON.stringify(x)} → TemplateError, nothing written`, async () => {
    const t = await copy();
    const pt = join(t, "pieces/app/piece.toml");
    await writeFile(
      pt,
      (await readFile(pt, "utf8")).replace('"apps/{{ name }}"', '"web/{{ scope }}"'),
    );
    const st = join(t, "splice.toml");
    await writeFile(st, (await readFile(st, "utf8")).replace(/, pattern = "[^"]*"/, ""));
    const out = join(await mkdtemp(join(tmpdir(), "hull-rules-out-")), "out");
    await rejects(
      TemplateError,
      /segment|empty/,
      renderNew({ template: t, out, pieces: ["app"], vars: { scope: x } }),
    );
    await assert.rejects(readFile(join(out, "f"), "utf8"));
  });
}
test("instance name 'a..b' is allowed", async () => {
  const t = await copy();
  const pt = join(t, "pieces/app/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace(/^name = .*\n/m, ""));
  assert.ok((await render(t, ["app:a..b"])).ok);
});
test("template-supplied bad instance name default → TemplateError", async () => {
  const t = await copy();
  const pt = join(t, "pieces/app/piece.toml");
  await writeFile(
    pt,
    (await readFile(pt, "utf8")).replace(/^name = .*$/m, 'name = { default = "con" }'),
  );
  await rejects(TemplateError, /instance name/, render(t, ["app"]));
});
test("subset: piece ids in conditions follow the segment rule", () => {
  assert.deepEqual(checkSubset('{% if "my.piece" in pieces %}x{% endif %}', "f"), []);
  assert.ok(checkSubset('{% if "con" in pieces %}x{% endif %}', "f").length > 0);
  assert.ok(checkSubset('{% if "a/b" in pieces %}x{% endif %}', "f").length > 0);
});

// --- raw blocks need min_splice >= 0.2.0 (contract §9.23)
const withMinSplice = async (v, files) => {
  const t = await addFiles(files);
  const st = join(t, "splice.toml");
  await writeFile(
    st,
    (await readFile(st, "utf8")).replace(/^min_splice = .*$/m, `min_splice = "${v}"`),
  );
  return t;
};
test("raw with min_splice 0.1.0 → TemplateError", async () => {
  const t = await withMinSplice("0.1.0", { "r.txt.jinja": "a {% raw %}{{ x }}{% endraw %}\n" });
  await rejects(TemplateError, /min_splice.*0\.2\.0/, render(t));
});
test("raw in an unselected piece still needs min_splice 0.2.0", async () => {
  const t = await withMinSplice("0.1.9", {});
  const dir = join(t, "pieces/base/files");
  await writeFile(join(dir, "r.txt.jinja"), "{% raw %}x{% endraw %}\n");
  await rejects(TemplateError, /min_splice/, render(t));
});
test("raw with min_splice 0.2.0 renders verbatim", async () => {
  const t = await withMinSplice("0.2.0", { "r.txt.jinja": "a ${% raw %}{{ x }}{% endraw %}\n" });
  const { out } = await render(t);
  assert.equal(await readFile(join(out, "r.txt"), "utf8"), "a ${{ x }}\n");
});
test("raw with min_splice 1.0.0 is fine", async () => {
  const t = await withMinSplice("1.0.0", { "r.txt.jinja": "{% raw %}x{% endraw %}\n" });
  await render(t);
});
test("min_splice 0.10.0 compares numerically", async () => {
  const t = await withMinSplice("0.10.0", { "r.txt.jinja": "{% raw %}x{% endraw %}\n" });
  await render(t);
});
test("raw in a file path → TemplateError", async () => {
  const t = await withMinSplice("0.2.0", { "a{% raw %}b{% endraw %}.txt": "x\n" });
  await rejects(TemplateError, /raw.*path/, render(t));
});
test("min_splice 0.2.0-rc.1 is below 0.2.0 (semver prerelease)", async () => {
  const t = await withMinSplice("0.2.0-rc.1", { "r.txt.jinja": "{% raw %}x{% endraw %}\n" });
  await rejects(TemplateError, /min_splice/, render(t));
});
test("min_splice 0.3.0-rc.1 is above 0.2.0", async () => {
  const t = await withMinSplice("0.3.0-rc.1", { "r.txt.jinja": "{% raw %}x{% endraw %}\n" });
  await render(t);
});

// --- migrations/ holds only <semver>.toml files (splice 0.2.0 rejects anything else)
const migrationCase = (name, content, ok) =>
  test(`migrations/${name} → ${ok ? "loads" : "TemplateError"}`, async () => {
    const t = await copy();
    await writeFile(join(t, "migrations", name), content);
    if (ok) await loadTemplate(t);
    else await rejects(TemplateError, /migration/, loadTemplate(t));
  });
migrationCase(".gitkeep", "", false);
migrationCase("v1.2.0.toml", "", false);
migrationCase("1.2.toml", "", false);
migrationCase("01.2.0.toml", "", false);
migrationCase("1.2.0.yaml", "", false);
migrationCase("1.2.0.toml", "[[remove]\n", false);
migrationCase("1.2.0.toml", '[[remove]]\npath = "old.txt"\n', true);
migrationCase("1.2.0-rc.1.toml", "", true);
test("a directory inside migrations/ → TemplateError", async () => {
  const t = await copy();
  await mkdir(join(t, "migrations", "1.2.0.toml"));
  await rejects(TemplateError, /migration/, loadTemplate(t));
});
