import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { CI_PLAN, RUST_CI_PLAN } from "../scripts/lib/ci-tasks.mjs";
import { rustComboSteps, comboSteps } from "../scripts/dogfood.mjs";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/scripts/licenses.mjs", import.meta.url),
);
const RUST_SCRIPT = fileURLToPath(
  new URL("../template-rust/pieces/base/files/scripts/licenses.mjs", import.meta.url),
);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { platformBuilds } = await import(SCRIPT);
const INPUTS = (lock) => [lock, "scripts/licenses.mjs"];
const FIX = "run `node scripts/licenses.mjs`";

const put = async (root, rel, text) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};
const lic = (cwd, ...a) => spawnSync("node", [SCRIPT, ...a], { cwd, encoding: "utf8" });
const crate = (name, version, extra = "") =>
  `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n${extra}`;

// Cargo workspace with path deps outside it (no network): app -> a (MIT) -> c -> d (license-file);
// app -dev-> b (none)
async function cargoFixture() {
  const d = await mkdtemp(join(tmpdir(), "lic-"));
  const ws = join(d, "ws");
  await put(
    d,
    "a/Cargo.toml",
    crate(
      "a",
      "1.0.0",
      'license = "MIT"\nrepository = "https://a.example"\n[dependencies]\nc = { path = "../c" }\n',
    ),
  );
  await put(d, "b/Cargo.toml", crate("b", "0.1.0"));
  await put(
    d,
    "c/Cargo.toml",
    crate("c", "0.2.0", 'license = "Apache-2.0 OR MIT"\n[dependencies]\nd = { path = "../d" }\n'),
  );
  await put(d, "d/Cargo.toml", crate("d", "0.3.0", 'license-file = "LICENSE.txt"\n'));
  await put(d, "d/LICENSE.txt", "custom\n");
  for (const c of ["a", "b", "c", "d", "ws/crates/app"]) await put(d, `${c}/src/lib.rs`, "");
  await put(ws, "Cargo.toml", '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n');
  await put(
    ws,
    "crates/app/Cargo.toml",
    crate(
      "app",
      "0.0.0",
      '[dependencies]\na = { path = "../../../a" }\n[dev-dependencies]\nb = { path = "../../../b" }\n',
    ),
  );
  const r = spawnSync("cargo", ["generate-lockfile", "--offline"], { cwd: ws, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return ws;
}

test("cargo: every non-member package, sorted, with direct/dev and UNKNOWN reported", async () => {
  const ws = await cargoFixture();
  const r = lic(ws);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stderr,
    /warning: 1 dependencies declare no license \(listed as UNKNOWN\): b@0\.1\.0/,
  );
  const j = JSON.parse(await readFile(join(ws, "third-party-licenses.json"), "utf8"));
  assert.deepEqual(Object.keys(j.inputs), INPUTS("Cargo.lock"));
  assert.deepEqual(j.packages, [
    {
      ecosystem: "cargo",
      name: "a",
      version: "1.0.0",
      license: "MIT",
      source: "https://a.example",
      direct: true,
      dev: false,
    },
    {
      ecosystem: "cargo",
      name: "b",
      version: "0.1.0",
      license: "UNKNOWN",
      source: "",
      direct: true,
      dev: true,
    },
    {
      ecosystem: "cargo",
      name: "c",
      version: "0.2.0",
      license: "Apache-2.0 OR MIT",
      source: "",
      direct: false,
      dev: false,
    },
    {
      ecosystem: "cargo",
      name: "d",
      version: "0.3.0",
      license: "LicenseRef-file:LICENSE.txt",
      source: "",
      direct: false,
      dev: false,
    },
  ]);
  const md = await readFile(join(ws, "THIRD_PARTY_LICENSES.md"), "utf8");
  assert.match(md, /^# Third-party licenses\n/);
  assert.match(md, /\| cargo \| c \| 0\.2\.0 \| Apache-2\.0 OR MIT \| no \| no \|  \|\n/);
  assert.match(md, /\| UNKNOWN \| 1 \|/);
  assert.doesNotMatch(md + JSON.stringify(j), /20\d\d-\d\d-\d\d/, "no timestamps");
  // deterministic: a second run writes the same bytes
  const before = md + JSON.stringify(j);
  lic(ws);
  const after =
    (await readFile(join(ws, "THIRD_PARTY_LICENSES.md"), "utf8")) +
    JSON.stringify(JSON.parse(await readFile(join(ws, "third-party-licenses.json"), "utf8")));
  assert.equal(after, before);
});

test("--check passes when current, fails naming the command when a lockfile changed or a file is missing", async () => {
  const ws = await cargoFixture();
  assert.equal(lic(ws, "--check").status, 1, "missing list is stale");
  lic(ws);
  assert.equal(lic(ws, "--check").status, 0);
  await appendFile(join(ws, "Cargo.lock"), "\n");
  const r = lic(ws, "--check");
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes(FIX), r.stdout);
  lic(ws);
  await rm(join(ws, "THIRD_PARTY_LICENSES.md"));
  assert.equal(lic(ws, "--check").status, 1);
});

test("--check fails when the script changed since the list was written", async () => {
  const ws = await cargoFixture();
  await put(ws, "scripts/licenses.mjs", readFileSync(SCRIPT, "utf8"));
  const run = (...a) =>
    spawnSync("node", ["scripts/licenses.mjs", ...a], { cwd: ws, encoding: "utf8" });
  assert.equal(run().status, 0);
  assert.equal(run("--check").status, 0);
  await appendFile(join(ws, "scripts/licenses.mjs"), "// changed\n");
  const r = run("--check");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /the script changed/);
});

test("fails, writing nothing, when every license is UNKNOWN (a broken read)", async () => {
  const d = await mkdtemp(join(tmpdir(), "lic-"));
  for (const c of ["x", "y"]) {
    await put(d, `${c}/Cargo.toml`, crate(c, "1.0.0"));
    await put(d, `${c}/src/lib.rs`, "");
  }
  await put(d, "ws/Cargo.toml", '[workspace]\nmembers = ["app"]\nresolver = "2"\n');
  await put(d, "ws/app/src/lib.rs", "");
  await put(
    d,
    "ws/app/Cargo.toml",
    crate("app", "0.0.0", '[dependencies]\nx = { path = "../../x" }\ny = { path = "../../y" }\n'),
  );
  const ws = join(d, "ws");
  spawnSync("cargo", ["generate-lockfile", "--offline"], { cwd: ws });
  const r = lic(ws);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /every cargo license is UNKNOWN/);
  assert.ok(r.stderr.includes(FIX));
  assert.equal(lic(ws, "--check").status, 1, "nothing written");
});

test("npm: fails, writing nothing, when node_modules is missing", async () => {
  const d = await mkdtemp(join(tmpdir(), "lic-"));
  await put(d, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const r = lic(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /node_modules is missing: run pnpm install/);
  assert.equal(lic(d, "--check").status, 1, "nothing written");
});

test("platformBuilds: cpu/os/libc lockfile packages mapped to their optionalDependencies parent", () => {
  // pnpm 12 writes the packageManager env (pnpm's own builds) as a first YAML doc: not project deps
  const env = [
    "---",
    "packages:",
    "",
    "  '@pnpm/exe.linux-x64@12.11.2':",
    "    os: [linux]",
    "",
    "snapshots:",
    "",
    "  pnpm@12.11.2:",
    "    optionalDependencies:",
    "      '@pnpm/exe.linux-x64': 12.11.2",
    "",
    "---",
  ];
  const lock = [
    ...env,
    "lockfileVersion: '9.0'",
    "",
    "packages:",
    "",
    "  '@t/linux-64@2.0.0':",
    "    resolution: {integrity: sha512-x}",
    "    cpu: [x64]",
    "    os: [linux]",
    "",
    "  fsevents@2.3.3:",
    "    resolution: {integrity: sha512-y}",
    "    os: [darwin]",
    "",
    "  only-darwin@1.0.0:",
    "    resolution: {integrity: sha512-w}",
    "    os: [darwin]",
    "",
    "  t@2.0.0:",
    "    resolution: {integrity: sha512-z}",
    "",
    "snapshots:",
    "",
    "  t@2.0.0(peer@1.0.0):",
    "    dependencies:",
    "      fsevents-not-optional: 1.0.0",
    "    optionalDependencies:",
    "      '@t/linux-64': 2.0.0",
    "      fsevents: 2.3.3",
    "",
    "  '@t/linux-64@2.0.0':",
    "    optional: true",
    "",
  ].join("\r\n");
  assert.deepEqual(
    [...platformBuilds(lock)],
    [
      ["@t/linux-64@2.0.0", "t"],
      ["fsevents@2.3.3", "t"],
    ],
  );
});

test("--check passes with no lockfile and no list", async () => {
  const d = await mkdtemp(join(tmpdir(), "lic-"));
  assert.equal(lic(d, "--check").status, 0);
});

test("npm: prod and dev deps from pnpm, direct flagged", async () => {
  const d = await mkdtemp(join(tmpdir(), "lic-"));
  await put(
    d,
    "a/package.json",
    JSON.stringify({ name: "a", version: "1.0.0", license: "MIT", homepage: "https://a.example" }),
  );
  await put(d, "b/package.json", JSON.stringify({ name: "b", version: "2.0.0" }));
  const ws = join(d, "ws");
  await put(
    ws,
    "package.json",
    JSON.stringify({
      name: "ws",
      private: true,
      dependencies: { a: "file:../a" },
      devDependencies: { b: "file:../b" },
    }),
  );
  const i = spawnSync("pnpm", ["install", "--offline"], { cwd: ws, encoding: "utf8" });
  assert.equal(i.status, 0, i.stderr + i.stdout);
  assert.equal(lic(ws).status, 0);
  const j = JSON.parse(await readFile(join(ws, "third-party-licenses.json"), "utf8"));
  assert.deepEqual(Object.keys(j.inputs), INPUTS("pnpm-lock.yaml"));
  assert.deepEqual(
    j.packages.map((p) => [p.ecosystem, p.name, p.license, p.direct, p.dev]),
    [
      ["npm", "a", "MIT", true, false],
      ["npm", "b", "UNKNOWN", true, true],
    ],
  );
  assert.equal(lic(ws, "--check").status, 0);
});

test("template-rust ships the same script (sync-shared)", () => {
  assert.equal(readFileSync(RUST_SCRIPT, "utf8"), readFileSync(SCRIPT, "utf8"));
});

test("both templates own the script and write the list on new", async () => {
  for (const [dir, when] of [
    ["template", ["new"]],
    ["template-rust", ["new", "update"]],
  ]) {
    const base = (await loadTemplate(join(ROOT, dir))).pieces.get("base");
    assert.ok(base.files.owned.includes("scripts/licenses.mjs"), dir);
    assert.ok(
      base.post.some((p) => p.run === "node scripts/licenses.mjs" && `${p.when}` === `${when}`),
      dir,
    );
  }
  // rust pieces change Cargo.lock after base's post may have run; chained in the same post
  // because splice ran an identical command (base's) only once (dogfood cli, 2026-11-17)
  const runs = (dir, id) =>
    loadTemplate(join(ROOT, dir)).then((t) => t.pieces.get(id).post.map((p) => p.run));
  for (const id of ["rust-tool", "rust-cli"])
    assert.deepEqual(await runs("template", id), [
      "cargo generate-lockfile && { node scripts/licenses.mjs || true; }",
      "cargo update --workspace && { node scripts/licenses.mjs || true; }",
    ]);
  assert.deepEqual(await runs("template-rust", "rust-cli"), [
    "cargo update --workspace && node scripts/licenses.mjs",
  ]);
});

test("CI runs the check right after the agents index, in both plans and dogfood", () => {
  for (const plan of [CI_PLAN, RUST_CI_PLAN]) {
    const ids = plan.map((s) => s.id);
    assert.equal(ids[ids.indexOf("agents-index") + 1], "licenses");
    const step = plan.find((s) => s.id === "licenses");
    for (const body of [step.github, step.circleci])
      assert.ok(body.includes("node scripts/licenses.mjs --check"), body);
    assert.ok(!step.github.includes("if:"), "runs on docs-only PRs too (no install needed)");
  }
  const has = (steps, a) => steps.some(([c, args]) => c === "node" && args.join(" ") === a);
  for (const steps of [rustComboSteps("dev"), comboSteps(null, [], ".", "dev")]) {
    assert.ok(has(steps, "scripts/licenses.mjs"));
    assert.ok(has(steps, "scripts/licenses.mjs --check"));
  }
});

test("agent docs name the command; the verify skills run the check", () => {
  for (const dir of ["template", "template-rust"]) {
    const f = (rel) => readFileSync(join(ROOT, dir, "pieces/base/files", rel), "utf8");
    assert.match(f("AGENTS.md.jinja"), /node scripts\/licenses\.mjs/, dir);
    assert.match(f(".claude/skills/verify/SKILL.md"), /node scripts\/licenses\.mjs --check/, dir);
  }
});
