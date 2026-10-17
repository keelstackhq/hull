import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

test("hull's own workflows are valid YAML with jobs", async () => {
  const files = (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const doc = YAML.parseDocument(await readFile(DIR + f, "utf8"));
    assert.deepEqual(doc.errors.map(String), [], f);
    assert.ok(doc.toJS().jobs, `${f} has jobs`);
  }
});

const hullCi = async () => YAML.parse(await readFile(DIR + "ci.yml", "utf8")).jobs.ci.steps;
const combosJson = () => readFile(new URL("../scripts/combos.json", import.meta.url), "utf8");

test("hull ci.yml Rust condition matches rust-tool and rust-cli combos only", async () => {
  const step = (await hullCi()).find((s) => s.id === "rust");
  const script = step.run.match(/node -e '([^']+)'/)[1];
  const exit = async (list) =>
    spawnSync("node", ["-e", script, JSON.stringify(list), await combosJson()]).status;
  assert.equal(await exit(["cli"]), 0);
  assert.equal(await exit(["site"]), 0);
  assert.equal(await exit(["web"]), 1);
  assert.equal(await exit(["lib"]), 1);
});

test("hull ci.yml installs nextest and cargo-deny@0.20.2, with rust-cache for the cli combo", async () => {
  const steps = await hullCi();
  const install = steps.find((s) => s.uses?.startsWith("taiki-e/install-action"));
  assert.equal(install.with.tool, "cargo-nextest,cargo-deny@0.20.2");
  const cache = steps.find((s) => s.uses === "Swatinem/rust-cache@v2");
  assert.equal(cache.if, "steps.rust.outputs.needed == 'true'");
  assert.equal(cache.with.workspaces, "${{ runner.temp }}/combos/cli -> target");
});
