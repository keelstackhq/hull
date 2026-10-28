import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { cliPin, structuralProblems } from "../scripts/circleci-check.mjs";
import { CI_PLAN, CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { renderCombo } from "./helpers.mjs";

const PIECE = fileURLToPath(new URL("../template/pieces/circleci/", import.meta.url));
const FILES = join(PIECE, "files/.circleci");
const read = (p) => readFile(join(FILES, p), "utf8");
const tasks = CI_TASKS.join(" ");
const web = await renderCombo(["base", "circleci", "preact-app:web", "hono-worker:api"]);
const ciOk = await read("src/jobs/ci-ok.yml");
const classOf = (path) => web.result.changes.find((c) => c.path === path)?.class;

test("piece requires base and owns exactly the S§6.3 paths (no glob, none in another piece)", async () => {
  const toml = (await import("smol-toml")).parse(await readFile(join(PIECE, "piece.toml"), "utf8"));
  assert.deepEqual(toml.requires, ["base"]);
  const owned = toml.files.owned;
  assert.ok(owned.every((p) => !p.includes("*")));
  assert.deepEqual(owned.toSorted(), [
    ".circleci/config.yml",
    ".circleci/scripts/scm-base.sh",
    ".circleci/src/@config.yml",
    ".circleci/src/commands/hoard.yml",
    ".circleci/src/executors/node.yml",
    ".circleci/src/jobs/ci-ok.yml",
    ".circleci/src/workflows/ci.yml",
  ]);
  for (const p of owned) assert.equal(classOf(p), "owned", p);
  const pieces = fileURLToPath(new URL("../template/pieces/", import.meta.url));
  for (const other of (await readdir(pieces)).filter((d) => d !== "circleci")) {
    const t = await readFile(join(pieces, other, "piece.toml"), "utf8");
    assert.ok(!t.includes(".circleci/"), `${other} claims .circleci paths`);
  }
});

test("rendered web-circleci has a setup config and an unchanged GitHub ci.yml (both mode)", async () => {
  const config = YAML.parse(await readFile(join(web.dir, ".circleci/config.yml"), "utf8"));
  assert.equal(config.setup, true);
  const plain = await renderCombo(["base", "preact-app:web", "hono-worker:api"]);
  const gh = ".github/workflows/ci.yml";
  assert.equal(
    await readFile(join(web.dir, gh), "utf8"),
    await readFile(join(plain.dir, gh), "utf8"),
  );
});

test("ci-ok.yml step ids equal CI_PLAN ids and its commands equal CI_TASKS", () => {
  const ids = [...ciOk.matchAll(/^ {2}# step: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    CI_PLAN.map((s) => s.id),
  );
  assert.equal(ciOk.match(/pnpm turbo run ([a-z: ]+?) --affected/)?.[1], tasks);
  assert.equal(ciOk.match(/query affected --tasks ([a-z: ]+?) >/)?.[1], tasks);
});

test("ci workflow: no branch or path filters; the job is named ci-ok", async () => {
  const wf = YAML.parse(await read("src/workflows/ci.yml"));
  assert.deepEqual(wf.jobs, ["ci-ok"]);
  for (const f of ["src/workflows/ci.yml", "config.yml"])
    assert.doesNotMatch(await read(f), /filters|paths-ignore/);
  assert.equal((await readdir(join(FILES, "src/jobs"))).join(), "ci-ok.yml");
});

test("every downloaded binary is pinned and checked with sha256sum -c", async () => {
  for (const [name, text] of [
    ["config.yml", await read("config.yml")],
    ["ci-ok.yml", ciOk],
  ]) {
    const downloads = text.split("\n").filter((l) => /\bcurl\b.*(-o |\| tar)/.test(l));
    const checks = text.split("\n").filter((l) => l.includes("sha256sum -c"));
    assert.equal(checks.length, downloads.length, `${name}: ${downloads.length} downloads`);
    assert.ok(downloads.length > 0);
  }
  const pin = cliPin(await read("config.yml"));
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
  assert.match(ciOk, /rustup\/archive\/\d+\.\d+\.\d+\//);
  assert.match(ciOk, /TURBO_VERSION: \d+\.\d+\.\d+/);
  assert.match(ciOk, /TURBO_SHA256: [0-9a-f]{64}/);
  assert.match(ciOk, /sha256: [0-9a-f]{64}/); // hoard
  assert.match(
    await read("src/executors/node.yml"),
    /image: cimg\/node:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}/,
  );
  assert.match(await read("config.yml"), /image: cimg\/base:[\d.]+@sha256:[0-9a-f]{64}/);
});

test("hoard command is the vendored v0.4.0 reference and is called with its pin", async () => {
  const hoard = await read("src/commands/hoard.yml");
  // reference copy from keelstackhq/hoard v0.4.0 (circleci/hoard.yml), byte-identical
  assert.equal(
    createHash("sha256").update(hoard).digest("hex"),
    "b9916d9a4133c93900b79a56613d28209a4af4479b7f754be587e6ab09868b77",
  );
  const cmd = YAML.parse(hoard);
  assert.deepEqual(cmd.parameters.storage.enum, ["fs", "r2"]);
  assert.equal(cmd.parameters.storage.default, "fs");
  assert.match(hoard, /key: hoard-v1-<< parameters.default-branch >>~\{\{ \.Revision \}\}/);
  assert.match(hoard, /- hoard-v1-<< parameters.default-branch >>~/);
  assert.match(hoard, /--fs-root ~\/.cache\/hoard/);
  const stop = cmd.steps.find((s) => s.when?.condition?.equal?.[0] === "stop").when.steps[0];
  assert.equal(stop.run.when, "always");
  assert.match(stop.run.command, /hoard stop/);
  // callers: hoard 0.4.0 verified 2026-10-28, linux-x64 musl archive
  assert.match(
    ciOk,
    /step: start\n {6}version: 0\.4\.0\n {6}sha256: aade187a9a04f0273c8f382265116d77cba234977141f91aefe2072610a24484/,
  );
  assert.match(ciOk, /step: stop\n {6}version: 0\.4\.0/);
});

test("rendered .circleci/src packs to a well-formed config (structural check)", async () => {
  const packed = [
    "version: 2.1",
    "executors:\n  node: " + JSON.stringify(YAML.parse(await read("src/executors/node.yml"))),
    "commands:\n  hoard: " + JSON.stringify(YAML.parse(await read("src/commands/hoard.yml"))),
    "jobs:\n  ci-ok: " + JSON.stringify(YAML.parse(ciOk)),
    "workflows:\n  ci: " + JSON.stringify(YAML.parse(await read("src/workflows/ci.yml"))),
  ].join("\n");
  assert.deepEqual(structuralProblems(packed), []);
  assert.deepEqual(structuralProblems(packed.replace("hoard:", "nohoard:")).length > 0, true);
  assert.deepEqual(structuralProblems(`${packed}\norbs: {a: b}`), ["orbs are not allowed"]);
});

test("the secrets-exec command is not in the circleci piece (HU-5)", async () => {
  const all = await readdir(FILES, { recursive: true });
  assert.ok(!all.some((f) => /secrets-exec|desktop|deploy/.test(f)), all.join());
  assert.doesNotMatch(ciOk, /secrets-exec/);
});

test("scm-base.sh output is assigned before export, so its failure stops the job", async () => {
  const { readFile } = await import("node:fs/promises");
  const yml = await readFile(
    new URL("../template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml", import.meta.url),
    "utf8",
  );
  assert.match(yml, /^\s*base=\$\(sh \.circleci\/scripts\/scm-base\.sh /m);
  assert.doesNotMatch(yml, /export TURBO_SCM_BASE=\$\(/);
});

test("every download is verified before it is used, outside any `set +e`", async () => {
  const bodies = [
    ["config.yml", await read("config.yml"), true],
    ["ci-ok.yml", ciOk, true],
  ];
  for (const [name, text, hard] of bodies) {
    const lines = text.split("\n");
    let relaxed = false;
    const relaxedAt = lines.map((l) => {
      if (/\bset \+e\b/.test(l)) relaxed = true;
      const r = relaxed;
      if (/\bset -e\b/.test(l)) relaxed = false;
      return r;
    });
    const downloads = lines.flatMap((l, i) => {
      const m = /\bcurl\b.*? -o (\S+)/.exec(l);
      return m ? [{ i, file: m[1].replace(/^"|"$/g, "") }] : [];
    });
    assert.ok(downloads.length > 0, name);
    for (const { i, file } of downloads) {
      const check = lines.findIndex(
        (l, j) => j > i && l.includes("sha256sum -c") && l.includes(file),
      );
      assert.ok(check > i, `${name}: no sha256sum -c for ${file}`);
      assert.ok(!relaxedAt[check], `${name}: check of ${file} is under set +e`);
      if (hard) assert.match(lines[check], /sha256sum -c - \|\| exit 1/, `${name}: ${file}`);
      const used = lines.findIndex(
        (l, j) => j > i && l.includes(file) && !/curl|sha256sum/.test(l),
      );
      assert.ok(used > check, `${name}: ${file} used (line ${used}) before it is verified`);
    }
  }
});

test("rust cache keys come from .rust-cache-key, not from Cargo.lock; rust-affected writes it", async () => {
  assert.doesNotMatch(ciOk, /checksum "Cargo\.lock"/);
  const keys = ciOk.match(/rust-v\d+-\{\{ checksum "\.rust-cache-key" \}\}/g) ?? [];
  assert.equal(keys.length, 2, "restore and save use the same key");
  const step = CI_PLAN.find((s) => s.id === "rust-affected").circleci;
  const command = YAML.parse(step)[0].run.command;
  const run = async (env, { script = true, lock = false } = {}) => {
    const dir = await mkdtemp(join(tmpdir(), "hull-rust-affected-"));
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "pnpm"), "#!/bin/sh\necho '{}'\n", { mode: 0o755 });
    await writeFile(join(bin, "node"), '#!/bin/sh\necho "rust=$FAKE_RUST"\n', { mode: 0o755 });
    if (script) {
      await mkdir(join(dir, ".github/scripts"), { recursive: true });
      await writeFile(join(dir, ".github/scripts/rust-affected.mjs"), "");
    }
    await writeFile(join(dir, "rust-toolchain.toml"), "[toolchain]\n");
    if (lock) await writeFile(join(dir, "Cargo.lock"), "# lock\n");
    await writeFile(join(dir, "env"), "");
    execFileSync("bash", ["-eo", "pipefail", "-c", command], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BASH_ENV: join(dir, "env"),
        ...env,
      },
    });
    return {
      key: (await readFile(join(dir, ".rust-cache-key"), "utf8")).trim(),
      exported: (await readFile(join(dir, "env"), "utf8")).includes("RUST=true"),
    };
  };
  assert.deepEqual(await run({ FAKE_RUST: "false" }), { key: "skip", exported: false });
  assert.deepEqual(await run({}, { script: false }), { key: "skip", exported: false });
  const noLock = await run({ FAKE_RUST: "true" });
  assert.match(noLock.key, /^[0-9a-f]{64}$/);
  assert.equal(noLock.exported, true);
  const withLock = await run({ FAKE_RUST: "true" }, { lock: true });
  assert.notEqual(withLock.key, noLock.key);
});

test(".rust-cache-key is git-ignored in a rendered repo (it must not show up as a change)", () => {
  const cwd = web.dir;
  execFileSync("git", ["init", "-q"], { cwd });
  assert.equal(
    execFileSync("git", ["check-ignore", ".rust-cache-key"], { cwd, encoding: "utf8" }).trim(),
    ".rust-cache-key",
  );
});

test("every save_cache is default-branch-only and never saves ~/.cargo/bin", async () => {
  const saves = [];
  const walk = (steps, onDefault) => {
    for (const step of steps ?? []) {
      if (typeof step === "string") continue;
      if (step.save_cache) saves.push({ onDefault, paths: step.save_cache.paths });
      if (step.when?.steps) {
        const c = step.when.condition ?? {};
        const main = [c, ...(c.and ?? [])].some(
          (x) =>
            Array.isArray(x.equal) &&
            ["main", "<< parameters.default-branch >>"].includes(x.equal[0]) &&
            x.equal[1] === "<< pipeline.git.branch >>",
        );
        walk(step.when.steps, onDefault || main);
      }
    }
  };
  walk(YAML.parse(ciOk).steps, false);
  walk(YAML.parse(await read("src/commands/hoard.yml")).steps, false);
  assert.ok(saves.length >= 3, "pnpm, rust and hoard caches");
  for (const s of saves) {
    assert.ok(s.onDefault, `save_cache ${JSON.stringify(s.paths)} runs on every branch`);
    assert.ok(!s.paths.some((p) => p.includes(".cargo/bin")), "no binaries in the cache");
  }
});

test("cargo-deny is verified on every run and cargo-nextest is never taken from a cache", () => {
  const step = CI_PLAN.find((s) => s.id === "rust-tools").circleci;
  const command = YAML.parse(step)[0].run.command;
  assert.doesNotMatch(command, /command -v/);
  const lines = command.split("\n");
  const check = lines.findIndex((l) => l.includes("sha256sum -c") && l.includes("deny"));
  assert.ok(check > 0);
  assert.match(lines[check], /^echo/, "the check is not nested in an if");
  assert.match(command, /cargo install --locked --root \S+ cargo-nextest@/);
});
