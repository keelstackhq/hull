import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ciCommand, comboSteps } from "../scripts/dogfood.mjs";
import { CI_PLAN, CI_TASKS } from "../scripts/lib/ci-tasks.mjs";

const base = fileURLToPath(new URL("../template/pieces/base/files/", import.meta.url));
const tasks = CI_TASKS.join(" ");

test("parity: generated ci.yml, base ci script and dogfood use CI_TASKS", async () => {
  const yml = await readFile(`${base}.github/workflows/ci.yml`, "utf8");
  const turbo = yml.match(/pnpm turbo run ([a-z: ]+?) --affected/);
  assert.equal(turbo?.[1], tasks);
  const query = yml.match(/query affected --tasks ([a-z: ]+?) >/);
  assert.equal(query?.[1], tasks);
  const plan = CI_PLAN.map((s) => s.github).join("");
  assert.ok(plan.includes(`pnpm turbo run ${tasks} --affected`));
  assert.ok(plan.includes(`query affected --tasks ${tasks} >`));

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

test("comboSteps runs cargo generate-lockfile for the rust-cli combo before turbo", () => {
  const steps = comboSteps("/c", ["base", "rust-cli:cli", "npm-cli:cli"], "/d").map(([c, a]) =>
    [c, ...a].join(" "),
  );
  const lock = steps.indexOf("cargo generate-lockfile");
  assert.ok(lock > steps.findIndex((s) => s.startsWith("pnpm install")));
  assert.ok(lock < steps.findIndex((s) => s.startsWith("pnpm turbo run")));
  assert.ok(!comboSteps("/c", ["base", "ts-lib:lib"], "/d").some(([c]) => c === "cargo"));
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

test("cargo-deny pin equal in template ci.yml, release.yml and the renovate regex", async () => {
  const preset = JSON.parse(await readFile(new URL("../renovate/default.json", import.meta.url)));
  const regex = new RegExp(
    preset.customManagers.find((m) => m.depNameTemplate === "cargo-deny").matchStrings[0],
    "g",
  );
  const pins = async (file) => {
    const yml = await readFile(`${base}.github/workflows/${file}`, "utf8");
    return [...yml.matchAll(regex)].map((m) => m.groups.currentValue);
  };
  const found = await pins("ci.yml");
  assert.deepEqual(found, ["0.20.2"]);
  assert.deepEqual(await pins("release.yml"), found);
  const hull = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.deepEqual(
    [...hull.matchAll(regex)].map((m) => m.groups.currentValue),
    found,
  );
  // the preset's file pattern covers both workflows
  const files = new RegExp(
    preset.customManagers
      .find((m) => m.depNameTemplate === "cargo-deny")
      .managerFilePatterns[0].slice(1, -1),
  );
  assert.deepEqual(
    [".github/workflows/ci.yml", ".github/workflows/release.yml"].map((f) => files.test(f)),
    [true, true],
  );
  // a fixture in the shape Renovate sees: the same text, one pin
  const fixture = "      tool: cargo-nextest@0.9.148,cargo-deny@0.20.2\n";
  assert.deepEqual(
    [...fixture.matchAll(regex)].map((m) => m.groups.currentValue),
    found,
  );
});

test("cargo-nextest pin equal in template ci.yml, hull ci.yml and the renovate regex", async () => {
  const preset = JSON.parse(await readFile(new URL("../renovate/default.json", import.meta.url)));
  const mgr = preset.customManagers.find((m) => m.depNameTemplate === "cargo-nextest");
  assert.equal(mgr?.datasourceTemplate, "crate");
  assert.deepEqual(mgr.managerFilePatterns, ["/^\\.github/workflows/.*\\.ya?ml$/"]);
  const regex = new RegExp(mgr.matchStrings[0], "g");
  const pins = (text) => [...text.matchAll(regex)].map((m) => m.groups.currentValue);
  const tmpl = await readFile(`${base}.github/workflows/ci.yml`, "utf8");
  const hull = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.deepEqual(pins(tmpl), ["0.9.148"]);
  assert.deepEqual(pins(hull), ["0.9.148"]);
  assert.deepEqual(pins("      tool: cargo-nextest@0.9.148,cargo-deny@0.20.2\n"), ["0.9.148"]);
});
