// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { cargoVersion } from "../scripts/stage.mjs";

const pkgFile = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
const bin = Object.keys(pkg.bin)[0] ?? "";
const cargoFile = new URL(`../../../crates/${bin}/Cargo.toml`, import.meta.url);

test("package.json version equals the crate version", () => {
  expect(
    existsSync(cargoFile),
    `crates/${bin}/Cargo.toml is missing: this package needs a rust-cli instance named \`${bin}\``,
  ).toBe(true);
  const crate = cargoVersion(readFileSync(cargoFile, "utf8"));
  expect(
    pkg.version,
    `packages version ${pkg.version} (package.json) differs from crate version ${crate} (crates/${bin}/Cargo.toml); bump both together`,
  ).toBe(crate);
});
