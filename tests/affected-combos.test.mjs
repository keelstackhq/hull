import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedCombos } from "../scripts/affected-combos.mjs";
import { loadCombos } from "../scripts/lib/combos.mjs";

const combos = [
  { name: "base", pieces: ["base"] },
  { name: "web", pieces: ["base", "preact-app:web"] },
];

test("piece change selects combos with that piece", () =>
  assert.deepEqual(affectedCombos(["template/pieces/preact-app/files/x"], combos), ["web"]));

test("base change selects all", () =>
  assert.deepEqual(affectedCombos(["template/pieces/base/files/a"], combos), ["base", "web"]));

test("rust-cli, npm-cli and ts-lib changes select the cli and lib combos", () => {
  const real = loadCombos().combos;
  assert.deepEqual(affectedCombos(["template/pieces/rust-cli/files/x"], real), ["cli"]);
  assert.deepEqual(affectedCombos(["template/pieces/npm-cli/files/x"], real), ["cli"]);
  assert.deepEqual(affectedCombos(["template/pieces/ts-lib/files/x"], real), ["lib"]);
  assert.deepEqual(
    affectedCombos(["template/pieces/base/files/.github/workflows/release.yml"], real),
    [
      "base",
      "cli",
      "docs",
      "lib",
      "site",
      "web",
      "web-circleci",
      "web-circleci-only",
      "web-secrets",
    ],
  );
});

test("renderer, manifest, workflow and root package changes select all", () => {
  for (const f of [
    "scripts/render.mjs",
    "scripts/lib/plan.mjs",
    "scripts/dogfood.mjs",
    "scripts/combos/web.json",
    "scripts/combos/_vars.json",
    "template/splice.toml",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/other.yml",
    "scripts/affected-combos.mjs",
    ".node-version",
  ]) {
    assert.deepEqual(affectedCombos([f], combos), ["base", "web"], f);
  }
});

test("docs and tests select none", () =>
  assert.deepEqual(affectedCombos(["docs/a.md", "tests/x.test.mjs", "README.md"], combos), []));

test("other template/ files select all", () =>
  assert.deepEqual(affectedCombos(["template/README.md"], combos), ["base", "web"]));

const cli = fileURLToPath(new URL("../scripts/affected-combos.mjs", import.meta.url));
const names = loadCombos()
  .combos.filter((c) => !c.scheduled)
  .map((c) => c.name);

test("CLI --all prints every non-scheduled combo", () => {
  const out = execFileSync("node", [cli, "--all"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), names);
});

test("CLI with an unknown base warns and prints every combo", () => {
  const r = spawnSync("node", [cli, "--base", "deadbeef-not-a-ref"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), names);
  assert.match(r.stderr, /warning/);
});

test("scheduled combos are never selected, even for base or all-changing files", () => {
  const withScheduled = [
    ...combos,
    { name: "heavy", pieces: ["base", "tauri-app"], scheduled: true },
  ];
  assert.deepEqual(affectedCombos(["template/pieces/tauri-app/files/x"], withScheduled), []);
  assert.deepEqual(affectedCombos(["template/pieces/base/files/x"], withScheduled), [
    "base",
    "web",
  ]);
  assert.deepEqual(affectedCombos(["scripts/render.mjs"], withScheduled), ["base", "web"]);
});

test("real combos: hono-worker selects web, astro-site selects site", () => {
  const real = loadCombos().combos;
  assert.deepEqual(affectedCombos(["template/pieces/hono-worker/files/x"], real), [
    "web",
    "web-circleci",
    "web-circleci-only",
    "web-secrets",
  ]);
  assert.deepEqual(affectedCombos(["template/pieces/astro-site/files/x"], real), ["site"]);
  assert.deepEqual(affectedCombos(["template/pieces/secrets/files/x"], real), ["web-secrets"]);
  assert.deepEqual(affectedCombos(["template/pieces/preact-app/files/x"], real), [
    "web",
    "web-circleci",
    "web-circleci-only",
    "web-secrets",
  ]);
  assert.deepEqual(affectedCombos(["template/pieces/ui-storybook/files/x"], real), ["web"]);
  assert.deepEqual(
    affectedCombos(["template/pieces/base/files/x"], real),
    real.filter((c) => !c.scheduled && !c.template).map((c) => c.name),
  );
  assert.deepEqual(
    affectedCombos(["scripts/check-single-vite.mjs"], real),
    real.filter((c) => !c.scheduled).map((c) => c.name),
  );
});

const mixed = [
  { name: "base", pieces: ["base"] },
  { name: "cli", pieces: ["base", "rust-cli:cli"] },
  { name: "rust", template: "template-rust", pieces: ["base", "rust-cli:cli"], vars: {} },
  { name: "rust-lib", template: "template-rust", pieces: ["base"], vars: {} },
];

test("template-rust pieces select only template-rust combos with that piece", () => {
  assert.deepEqual(affectedCombos(["template-rust/pieces/rust-cli/files/src/x.rs"], mixed), [
    "rust",
  ]);
  assert.deepEqual(affectedCombos(["template/pieces/rust-cli/files/src/x.rs"], mixed), ["cli"]);
});

test("template-rust base, manifest and other files select every template-rust combo only", () => {
  for (const f of [
    "template-rust/pieces/base/files/Cargo.toml.jinja",
    "template-rust/splice.toml",
    "template-rust/migrations/0.3.0.toml",
  ]) {
    assert.deepEqual(affectedCombos([f], mixed), ["rust", "rust-lib"], f);
  }
  assert.deepEqual(affectedCombos(["template/splice.toml"], mixed), ["base", "cli"]);
  assert.deepEqual(affectedCombos(["scripts/lib/ci-tasks.mjs"], mixed), [
    "base",
    "cli",
    "rust",
    "rust-lib",
  ]);
});

test("real combos: the template-rust circleci piece selects rust-circleci only", () => {
  const real = loadCombos().combos;
  assert.deepEqual(affectedCombos(["template-rust/pieces/circleci/files/x"], real), [
    "rust-circleci",
  ]);
  assert.deepEqual(affectedCombos(["template-rust/pieces/rust-cli/files/x"], real), [
    "rust",
    "rust-circleci",
  ]);
});
