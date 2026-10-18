// @ts-check
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const pkgFile = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
const bin = Object.keys(pkg.bin)[0] ?? "";
const envName = `${bin.toUpperCase().replaceAll("-", "_")}_BINARY`;
const platform = `${process.platform}-${process.arch}`;
const posix = process.platform !== "win32";

/** A temp node_modules holding a copy of the launcher; `fake` adds a platform package. */
function install(fake = "", repository = "") {
  const root = mkdtempSync(join(tmpdir(), "launcher-"));
  const own = join(root, "node_modules", pkg.name);
  mkdirSync(join(own, "bin"), { recursive: true });
  writeFileSync(
    join(own, "package.json"),
    JSON.stringify(repository ? { ...pkg, repository: { type: "git", url: repository } } : pkg),
  );
  copyFileSync(new URL("../bin/launcher.js", import.meta.url), join(own, "bin/launcher.js"));
  if (fake) {
    const dir = join(root, "node_modules", `${pkg.name}-${platform}`);
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: `${pkg.name}-${platform}`, version: pkg.version }),
    );
    writeFileSync(join(dir, "bin", bin), fake);
    chmodSync(join(dir, "bin", bin), 0o755);
  }
  return join(own, "bin/launcher.js");
}

/**
 * @param {string} launcher
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
const run = (launcher, args, env = {}) =>
  spawnSync(process.execPath, [launcher, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });

/** @param {string} body */
const script = (body) => `#!${process.execPath}\n${body}\n`;

test.skipIf(!posix)("forwards the exit code and inherits stdout and stderr", () => {
  const launcher = install(
    script(`process.stdout.write("out:" + process.argv.slice(2).join(","));
process.stderr.write("err");
process.exit(7);`),
  );
  const r = run(launcher, ["a", "b"]);
  expect(r.status).toBe(7);
  expect(r.stdout).toBe("out:a,b");
  expect(r.stderr).toBe("err");
});

test.skipIf(!posix)(`${envName} overrides the platform package`, () => {
  const launcher = install();
  const dir = mkdtempSync(join(tmpdir(), "override-"));
  const file = join(dir, "custom");
  writeFileSync(file, script(`process.stdout.write("override"); process.exit(4);`));
  chmodSync(file, 0o755);
  const r = run(launcher, [], { [envName]: file });
  expect(r.status).toBe(4);
  expect(r.stdout).toBe("override");
});

test("a missing platform package exits 3 with one line naming the platform and a safe install", () => {
  const r = run(install(), []);
  expect(r.status).toBe(3);
  const lines = r.stderr.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(platform);
  expect(lines[0]).toContain(`cargo install --locked --path crates/${bin}`);
  expect(lines[0]).not.toContain(`cargo install ${bin}`);
});

test("the install hint uses --git when package.json has a repository url", () => {
  const r = run(install("", "git+https://github.com/acme/tool.git"), []);
  expect(r.status).toBe(3);
  expect(r.stderr.trim()).toContain(
    `cargo install --locked --git https://github.com/acme/tool.git ${bin}`,
  );
});

test.skipIf(!posix)("re-raises the child's signal", () => {
  const launcher = install(
    script(`process.kill(process.pid, "SIGTERM");\nsetTimeout(() => {}, 5000);`),
  );
  const r = run(launcher, []);
  expect(r.signal).toBe("SIGTERM");
});
