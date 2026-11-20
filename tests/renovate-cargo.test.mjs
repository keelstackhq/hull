import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parsePins } from "../template-rust/pieces/base/files/scripts/pins.mjs";

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const pinsToml = await readFile(
  new URL("../template-rust/pieces/base/files/pins.toml", import.meta.url),
  "utf8",
);
const PIN_CRATES = Object.keys(parsePins(pinsToml, "crates"));

test("renovate cargo preset pins exactly, alerts on vulnerabilities, keeps transitive crates", async () => {
  const p = await read("../renovate/cargo.json");
  assert.equal(p.rangeStrategy, "pin");
  assert.equal(p.osvVulnerabilityAlerts, true);
  assert.deepEqual(p.vulnerabilityAlerts, {
    enabled: true,
    minimumReleaseAge: "0 days",
    schedule: ["at any time"],
    labels: ["security"],
  });
  assert.deepEqual(p.lockFileMaintenance, {
    enabled: true,
    schedule: ["before 5am on monday"],
  });
  const grouped = p.packageRules.find((r) => r.groupName === "cargo minor");
  assert.deepEqual(grouped, {
    matchManagers: ["cargo"],
    matchUpdateTypes: ["minor", "patch"],
    groupName: "cargo minor",
    schedule: ["before 5am on monday"],
  });
  const sqlite = p.packageRules.find((r) => r.matchPackageNames?.includes("libsqlite3-sys"));
  assert.deepEqual(sqlite, {
    description:
      "Transitive crates (libsqlite3-sys, DNS crates) must keep moving via lockFileMaintenance.",
    matchManagers: ["cargo"],
    matchPackageNames: sqlite.matchPackageNames,
    enabled: true,
  });
  assert.equal(p.packageRules.length, 3);
});

test("renovate cargo preset reads pins.toml [crates] and groups the crates across managers", async () => {
  const p = await read("../renovate/cargo.json");
  const m = p.customManagers.find((c) => c.managerFilePatterns.some((f) => f.includes("pins")));
  assert.equal(m.datasourceTemplate, "crate");
  assert.equal(m.matchStringsStrategy, "recursive");
  assert.equal(m.versioningTemplate, "semver");
  // Renovate compiles matchStrings with flag "g" only (no "m"); emulate's recursive strategy: each pattern runs on the previous matches
  const text =
    '[tools]\nnode = "1.2.3"\n\n[crates]\ntokio = "1.40.0"\nhyper-util = "0.1.9"\n\n[other]\nx = "9.9.9"\n';
  let chunks = [text];
  for (const [i, s] of m.matchStrings.entries()) {
    const last = i === m.matchStrings.length - 1;
    const next = [];
    for (const c of chunks) {
      for (const x of c.matchAll(new RegExp(s, "g"))) next.push(last ? x.groups : x[0]);
    }
    chunks = next;
  }
  assert.deepEqual(
    chunks.map((g) => [g.depName, g.currentValue]),
    [
      ["tokio", "1.40.0"],
      ["hyper-util", "0.1.9"],
    ],
  );
  const rule = p.packageRules.find((r) => r.groupName === "rust service crates");
  for (const c of PIN_CRATES) assert.ok(rule.matchPackageNames.includes(c), `group lacks ${c}`);
  assert.deepEqual(rule, {
    groupName: "rust service crates",
    matchPackageNames: rule.matchPackageNames,
    schedule: ["before 5am on monday"],
  });
});

test("template-rust renovate.json extends both presets", async () => {
  const c = await read("../template-rust/pieces/base/files/renovate.json");
  assert.deepEqual(c.extends, [
    "github>keelstackhq/hull//renovate/default",
    "github>keelstackhq/hull//renovate/cargo",
  ]);
});
