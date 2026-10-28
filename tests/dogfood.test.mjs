import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { dogfood } from "../scripts/dogfood.mjs";
import { CI_TASKS, RUST_CI_STEPS } from "../scripts/lib/ci-tasks.mjs";
import { comboTemplate, comboVars } from "../scripts/lib/combos.mjs";

const EXTRA = "bash -c if [ -f scripts/ci-extra.sh ]; then bash scripts/ci-extra.sh; fi";

test("a render failure fails that combo without throwing", async () => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  const results = await dogfood({
    combos: ["base", "base"],
    root,
    template: join(root, "missing-template"),
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok === false));
});

test("every combo in scripts/combos/ renders", async (t) => {
  const { renderNew } = await import("../scripts/render.mjs");
  const { loadCombos } = await import("../scripts/lib/combos.mjs");
  const { vars, combos } = loadCombos();
  const root = await mkdtemp(join(tmpdir(), "hull-render-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const c of combos) {
    await renderNew({
      template: fileURLToPath(new URL(`../${comboTemplate(c)}`, import.meta.url)),
      out: join(root, c.name),
      pieces: c.pieces,
      vars: comboVars(c, vars),
    });
    await access(
      join(root, c.name, comboTemplate(c) === "template" ? "package.json" : "Cargo.toml"),
    );
  }
});

test("single-vite check runs for web and site, not base; failure fails the combo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    return 0;
  };
  const results = await dogfood({ combos: ["base", "web", "site"], root, run });
  assert.ok(results.every((r) => r.ok));
  const checked = (n) =>
    calls.some(
      (c) => c.args.some((a) => a.endsWith("check-single-vite.mjs")) && c.cwd === join(root, n),
    );
  assert.equal(checked("base"), false);
  assert.equal(checked("web"), true);
  assert.equal(checked("site"), true);

  const failing = async (cmd, args) =>
    args.some((a) => a.endsWith("check-single-vite.mjs")) ? 1 : 0;
  const r = await dogfood({ combos: ["web"], root, run: failing });
  assert.equal(r[0].ok, false);
});

test("base combo runs git init, install, index write, turbo, index check in order", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return 0;
  };
  await dogfood({ combos: ["base"], root, cacheDir: "/c", run, renderer: "dev" });
  assert.deepEqual(calls, [
    "git init -q",
    "pnpm install --no-frozen-lockfile --prefer-offline",
    "node scripts/agents-index.mjs",
    `pnpm turbo run ${CI_TASKS.join(" ")} --cache-dir=/c`,
    EXTRA,
    "node scripts/agents-index.mjs --check",
  ]);
});

test("splice renderer (default): splice new (git init + post hooks), then turbo, index check", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return 0;
  };
  await dogfood({ combos: ["site"], root, cacheDir: "/c", run, splice: ["splice"] });
  const src = `${join(root, "template-src")}//template`;
  assert.deepEqual(calls, [
    `splice new ${src} ${join(root, "site")} --ref HEAD --piece astro-site:site --piece rust-tool:tool --data scope=hullci --yes --json`,
    `pnpm turbo run ${CI_TASKS.join(" ")} --cache-dir=/c`,
    EXTRA,
    "node scripts/agents-index.mjs --check",
    `node ${fileURLToPath(new URL("../scripts/check-single-vite.mjs", import.meta.url))} ${join(root, "site")}`,
  ]);
});

test("splice renderer: a failing splice new fails the combo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = async (cmd) => (cmd === "splice" ? 3 : 0);
  const r = await dogfood({ combos: ["base"], root, run, splice: ["splice"] });
  assert.equal(r[0].ok, false);
});

test("unknown renderer is rejected", async () => {
  await assert.rejects(dogfood({ combos: ["base"], renderer: "nope" }), /renderer/);
});

test("with TURBO_API set (hoard) and no --cache-dir, turbo runs without --cache-dir", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return 0;
  };
  const before = process.env.TURBO_API;
  process.env.TURBO_API = "http://127.0.0.1:1";
  t.after(() =>
    before === undefined ? delete process.env.TURBO_API : (process.env.TURBO_API = before),
  );
  await dogfood({ combos: ["base"], root, run, splice: ["splice"] });
  assert.ok(calls.includes(`pnpm turbo run ${CI_TASKS.join(" ")}`), calls.join("\n"));
  assert.ok(!calls.some((c) => c.includes("--cache-dir")));
});

test("rust combo (template-rust): no pnpm or turbo; cargo steps, index write and check", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return 0;
  };
  const r = await dogfood({ combos: ["rust"], root, cacheDir: "/c", run, renderer: "dev" });
  assert.ok(r[0].ok);
  assert.deepEqual(calls, [
    "git init -q",
    "cargo generate-lockfile",
    "node scripts/agents-index.mjs",
    ...RUST_CI_STEPS,
    EXTRA,
    "node scripts/agents-index.mjs --check",
  ]);
});

test("rust combo with splice: renders template-rust without vars, then the cargo steps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return 0;
  };
  await dogfood({ combos: ["rust"], root, run, splice: ["splice"] });
  const src = `${join(root, "template-rust-src")}//template-rust`;
  assert.deepEqual(calls, [
    `splice new ${src} ${join(root, "rust")} --ref HEAD --piece rust-cli:cli --yes --json`,
    ...RUST_CI_STEPS,
    EXTRA,
    "node scripts/agents-index.mjs --check",
  ]);
});
