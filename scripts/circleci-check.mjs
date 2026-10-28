#!/usr/bin/env node
// Packs `.circleci/src` of a rendered repo with the pinned CircleCI CLI and checks the result
// structurally (S§12 item 3: `circleci config validate` needs api.circleci.com, so it only runs
// with CIRCLECI_VALIDATE=1). Usage: circleci-check.mjs <rendered-dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { isMain } from "./lib/is-main.mjs";

const STEP_BUILTINS = new Set(["run", "checkout", "restore_cache", "save_cache", "when", "unless"]);

/** The pinned CLI version and linux amd64 tarball SHA-256 from a rendered setup `config.yml`. */
export function cliPin(configText) {
  const version = configText.match(/CIRCLECI_CLI_VERSION: (\S+)/)?.[1];
  const sha256 = configText.match(/CIRCLECI_CLI_SHA256: ([0-9a-f]{64})/)?.[1];
  if (!version || !sha256) throw new Error("config.yml has no pinned CircleCI CLI");
  return { version, sha256 };
}

/** Problems of a packed (continuation) config; empty when it is well formed and orb-free. */
export function structuralProblems(packed) {
  const c = YAML.parse(packed);
  const out = [];
  if (String(c.version) !== "2.1") out.push("version must be 2.1");
  if (c.orbs) out.push("orbs are not allowed");
  const jobs = c.jobs ?? {};
  const commands = c.commands ?? {};
  const executors = c.executors ?? {};
  const walk = (where, steps) => {
    for (const step of steps ?? []) {
      if (typeof step === "string") continue;
      const [key] = Object.keys(step);
      if (key === "when" || key === "unless") walk(where, step[key].steps);
      else if (!STEP_BUILTINS.has(key) && !commands[key]) out.push(`${where}: unknown step ${key}`);
    }
  };
  for (const [n, j] of Object.entries(jobs)) {
    if (j.executor ? !executors[j.executor] : !j.docker) out.push(`job ${n}: no executor`);
    walk(`job ${n}`, j.steps);
  }
  for (const [n, cmd] of Object.entries(commands)) walk(`command ${n}`, cmd.steps);
  const workflows = Object.entries(c.workflows ?? {}).filter(([k]) => k !== "version");
  if (!workflows.length) out.push("no workflows");
  for (const [n, w] of workflows) {
    for (const j of w.jobs ?? []) {
      const name = typeof j === "string" ? j : Object.keys(j)[0];
      if (!jobs[name]) out.push(`workflow ${n}: unknown job ${name}`);
    }
  }
  return out;
}

async function ensureCli(pin) {
  if (process.env.CIRCLECI_BIN) return process.env.CIRCLECI_BIN;
  // A fresh private dir every run: nothing at a predictable path is ever trusted or reused.
  const dir = await mkdtemp(join(tmpdir(), `hull-circleci-cli-${pin.version}-`));
  const bin = join(dir, "circleci");
  const url = `https://github.com/CircleCI-Public/circleci-cli/releases/download/v${pin.version}/circleci-cli_${pin.version}_linux_amd64.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  if (createHash("sha256").update(tgz).digest("hex") !== pin.sha256)
    throw new Error("circleci CLI archive does not match the pinned SHA-256");
  await writeFile(join(dir, "cli.tgz"), tgz);
  execFileSync("tar", ["-xzf", join(dir, "cli.tgz"), "-C", dir, "circleci"]);
  await chmod(bin, 0o755);
  return bin;
}

if (isMain(import.meta.url)) {
  const dir = process.argv[2];
  const cli = await ensureCli(cliPin(await readFile(join(dir, ".circleci/config.yml"), "utf8")));
  const packed = execFileSync(cli, ["config", "pack", join(dir, ".circleci/src")], {
    encoding: "utf8",
  });
  const out = join(await mkdtemp(join(tmpdir(), "hull-circleci-")), "continue.yml");
  await writeFile(out, packed);
  const problems = structuralProblems(packed);
  if (process.env.CIRCLECI_VALIDATE === "1") execFileSync(cli, ["config", "validate", out]);
  if (problems.length) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("circleci config packed and well formed\n");
}
