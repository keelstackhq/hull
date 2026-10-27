import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));

test("isMain is true for the entry script, also when it is run through a symlink", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "hull-is-main-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const real = join(tmp, "real");
  await cp(join(SCRIPTS, "lib/is-main.mjs"), join(real, "lib/is-main.mjs"));
  await writeFile(
    join(real, "probe.mjs"),
    'import { isMain } from "./lib/is-main.mjs";\nconsole.log(isMain(import.meta.url) ? "main" : "imported");\n',
  );
  await writeFile(join(real, "importer.mjs"), 'import "./probe.mjs";\n');
  await symlink(real, join(tmp, "link"), "dir");
  const run = (file) => spawnSync(process.execPath, [file], { encoding: "utf8" });
  assert.equal(run(join(real, "probe.mjs")).stdout, "main\n");
  assert.equal(run(join(tmp, "link/probe.mjs")).stdout, "main\n");
  assert.equal(run(join(tmp, "link/importer.mjs")).stdout, "imported\n");
  const keep = spawnSync(
    process.execPath,
    ["--preserve-symlinks-main", join(tmp, "link/probe.mjs")],
    {
      encoding: "utf8",
    },
  );
  assert.equal(keep.stdout, "main\n");
});

test("every hull script decides whether it is the entry script with isMain", async () => {
  const files = (await readdir(SCRIPTS, { recursive: true })).filter(
    (f) => f.endsWith(".mjs") && f !== join("lib", "is-main.mjs"),
  );
  const raw = [];
  for (const f of files)
    if (/process\.argv\[1\]/.test(await readFile(join(SCRIPTS, f), "utf8"))) raw.push(f);
  assert.deepEqual(raw, []);
});
