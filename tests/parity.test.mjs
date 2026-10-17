import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ciCommand, comboSteps } from "../scripts/dogfood.mjs";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";

const base = fileURLToPath(new URL("../template/pieces/base/files/", import.meta.url));
const tasks = CI_TASKS.join(" ");

test("parity: generated ci.yml, base ci script and dogfood use CI_TASKS", async () => {
  const yml = await readFile(`${base}.github/workflows/ci.yml`, "utf8");
  const turbo = yml.match(/pnpm turbo run ([a-z: ]+?) --affected/);
  assert.equal(turbo?.[1], tasks);
  const query = yml.match(/query affected --tasks ([a-z: ]+?) >/);
  assert.equal(query?.[1], tasks);

  const pkg = await readFile(`${base}package.json.jinja`, "utf8");
  const ci = pkg.match(/"ci": "turbo run ([a-z: ]+?) --affected"/);
  assert.equal(ci?.[1], tasks);

  assert.deepEqual(ciCommand(), ["pnpm", "turbo", "run", ...CI_TASKS]);
  const [cmd, ...args] = [...ciCommand(), "--cache-dir=/c"];
  assert.ok(comboSteps("/c").some(([c, a]) => c === cmd && a.join(" ") === args.join(" ")));
});

test("comboSteps adds the single-vite step only for Vite pieces", () => {
  const steps = comboSteps("/c", ["base", "preact-app:web"], "/d");
  const [cmd, ...args] = ciCommand();
  assert.ok(steps.some(([c, a]) => c === cmd && a.slice(0, -1).join(" ") === args.join(" ")));
  assert.ok(
    steps.some(([c, a]) => c === "node" && a[0].endsWith("check-single-vite.mjs") && a[1] === "/d"),
  );
  const base = comboSteps("/c", ["base"], "/d");
  assert.ok(!base.some(([, a]) => a.some((x) => x.endsWith("check-single-vite.mjs"))));
});

test("comboSteps runs the rust-tool post hook (cargo generate-lockfile) before turbo", () => {
  const steps = comboSteps("/c", ["base", "rust-tool:tool"], "/d").map(([c, a]) =>
    [c, ...a].join(" "),
  );
  const lock = steps.indexOf("cargo generate-lockfile");
  assert.ok(lock > steps.findIndex((s) => s.startsWith("pnpm install")));
  assert.ok(lock < steps.findIndex((s) => s.startsWith("pnpm turbo run")));
  assert.ok(!comboSteps("/c", ["base"], "/d").some(([c]) => c === "cargo"));
});

test("dogfood and generated ci.yml both run `node scripts/agents-index.mjs --check`", async () => {
  const ci = await readFile(`${base}.github/workflows/ci.yml`, "utf8");
  assert.match(ci, /^\s+run: node scripts\/agents-index\.mjs --check$/m);
  const cmds = comboSteps("/c", ["base"], "/d").map(([c, a]) => [c, ...a].join(" "));
  assert.ok(cmds.includes("node scripts/agents-index.mjs --check"));
});

test("comboSteps writes the index before turbo and checks it after", () => {
  const cmds = comboSteps("/c", ["base", "preact-app:web"], "/d").map(([c, a]) =>
    [c, ...a].join(" "),
  );
  const write = cmds.indexOf("node scripts/agents-index.mjs");
  const turbo = cmds.findIndex((s) => s.startsWith("pnpm turbo run"));
  const check = cmds.indexOf("node scripts/agents-index.mjs --check");
  const vite = cmds.findIndex((s) => s.includes("check-single-vite.mjs"));
  assert.ok(write > cmds.findIndex((s) => s.startsWith("pnpm install")));
  assert.ok(write < turbo && turbo < check && check < vite);
});
