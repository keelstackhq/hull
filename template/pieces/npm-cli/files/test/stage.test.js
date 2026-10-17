// @ts-check
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { TARGETS, stage } from "../scripts/stage.mjs";

const here = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", here), "utf8"));
const bin = Object.keys(pkg.bin)[0] ?? "";
const short = pkg.name.split("/")[1];
const platforms = Object.keys(TARGETS);

/** A repo-shaped temp tree: packages/x with the real launcher, crates/<bin>, artifacts. */
function fixture({ crateVersion = pkg.version, skip = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const pkgDir = join(root, "packages", short);
  mkdirSync(join(pkgDir, "bin"), { recursive: true });
  copyFileSync(new URL("package.json", here), join(pkgDir, "package.json"));
  copyFileSync(new URL("bin/launcher.js", here), join(pkgDir, "bin/launcher.js"));
  mkdirSync(join(root, "crates", bin), { recursive: true });
  writeFileSync(
    join(root, "crates", bin, "Cargo.toml"),
    `[package]\nname = "${bin}"\nversion = "${crateVersion}"\n`,
  );
  const artifactsDir = join(root, "artifacts");
  for (const [platform, target] of Object.entries(TARGETS)) {
    if (platform === skip) continue;
    mkdirSync(join(artifactsDir, target), { recursive: true });
    const file = join(artifactsDir, target, platform.startsWith("win32") ? `${bin}.exe` : bin);
    writeFileSync(file, `binary ${platform}`);
    chmodSync(file, 0o755);
  }
  return { pkgDir, artifactsDir, outDir: join(root, "dist-npm") };
}

/** @param {string} file */
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

test("stages five platform packages and the launcher", () => {
  const dirs = stage({ ...fixture(), repository: "acme/tool" });
  expect(dirs.map((d) => basename(d))).toEqual([...platforms.map((p) => `${short}-${p}`), short]);
  for (const platform of platforms) {
    const dir = dirs.find((d) => d.endsWith(`${short}-${platform}`)) ?? "";
    const p = json(join(dir, "package.json"));
    const [os, cpu] = platform.split("-");
    expect(p.name).toBe(`${pkg.name}-${platform}`);
    expect(p.version).toBe(pkg.version);
    expect(p.os).toEqual([os]);
    expect(p.cpu).toEqual([cpu]);
    expect(p.scripts).toBeUndefined();
    expect(p.repository.url).toBe("git+https://github.com/acme/tool.git");
    const file = join(dir, "bin", platform.startsWith("win32") ? `${bin}.exe` : bin);
    expect(readFileSync(file, "utf8")).toBe(`binary ${platform}`);
  }
});

test("the launcher lists every platform package at the exact version", () => {
  const dirs = stage({ ...fixture(), repository: "acme/tool" });
  const p = json(join(dirs.at(-1) ?? "", "package.json"));
  expect(p.name).toBe(pkg.name);
  expect(p.optionalDependencies).toEqual(
    Object.fromEntries(platforms.map((x) => [`${pkg.name}-${x}`, pkg.version])),
  );
  expect(p.scripts).toBeUndefined();
  expect(p.devDependencies).toBeUndefined();
  expect(p.bin).toEqual(pkg.bin);
  expect(p.repository.url).toBe("git+https://github.com/acme/tool.git");
  expect(readFileSync(join(dirs.at(-1) ?? "", "bin/launcher.js"), "utf8")).toContain("@ts-check");
});

test("a missing artifact fails and names the file", () => {
  expect(() => stage(fixture({ skip: "darwin-arm64" }))).toThrow(/aarch64-apple-darwin/);
});

test("a launcher version that differs from the crate version fails", () => {
  expect(() => stage(fixture({ crateVersion: "9.9.9" }))).toThrow(/9\.9\.9/);
});

test("a repository that is not owner/repo fails", () => {
  expect(() => stage({ ...fixture(), repository: 'a"b/c' })).toThrow(/owner\/repo/);
});
