#!/usr/bin/env node
// @ts-check
// Starts the native binary from the matching platform package; nothing is installed or fetched here.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bin = Object.keys(pkg.bin)[0] ?? "";
const platform = `${process.platform}-${process.arch}`;
const override = process.env[`${bin.toUpperCase().replaceAll("-", "_")}_BINARY`];

/** @returns {string} path of the native binary */
function binaryPath() {
  if (override) return override;
  const name = `${pkg.name}-${platform}`;
  try {
    const manifest = createRequire(import.meta.url).resolve(`${name}/package.json`);
    return join(dirname(manifest), "bin", process.platform === "win32" ? `${bin}.exe` : bin);
  } catch {
    process.stderr.write(
      `${bin}: no prebuilt binary for ${platform} (package ${name} is not installed); ` +
        `build from source with \`cargo install ${bin}\`\n`,
    );
    process.exit(3);
  }
}

const result = spawnSync(binaryPath(), process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`${bin}: cannot run the binary: ${result.error.message}\n`);
  process.exit(3);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
  process.exit(1);
}
process.exit(result.status ?? 3);
