import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const CRATES = [
  "tokio",
  "axum",
  "sqlx",
  "hyper",
  "hyper-util",
  "http-body-util",
  "rustls",
  "tokio-rustls",
  "webpki-roots",
];

test("renovate cargo preset pins exactly, alerts on vulnerabilities, keeps transitive crates", async () => {
  const p = await read("../renovate/cargo.json");
  assert.equal(p.rangeStrategy, "pin");
  assert.equal(p.osvVulnerabilityAlerts, true);
  assert.equal(p.vulnerabilityAlerts.enabled, true);
  assert.equal(p.vulnerabilityAlerts.minimumReleaseAge, "0 days");
  assert.deepEqual(p.vulnerabilityAlerts.schedule, ["at any time"]);
  assert.deepEqual(p.vulnerabilityAlerts.labels, ["security"]);
  assert.equal(p.lockFileMaintenance.enabled, true);
  assert.deepEqual(p.lockFileMaintenance.schedule, ["before 5am on monday"]);
  const grouped = p.packageRules.find((r) => r.groupName === "cargo minor");
  assert.deepEqual(grouped.matchManagers, ["cargo"]);
  assert.deepEqual(grouped.matchUpdateTypes, ["minor", "patch"]);
  assert.deepEqual(grouped.schedule, ["before 5am on monday"]);
  const sqlite = p.packageRules.find((r) => r.matchPackageNames?.includes("libsqlite3-sys"));
  assert.ok(sqlite && sqlite.enabled !== false);
  assert.ok(!p.packageRules.some((r) => r.enabled === false));
});

test("renovate cargo preset reads pins.toml [crates] and groups the crates across managers", async () => {
  const p = await read("../renovate/cargo.json");
  const m = p.customManagers.find((c) => c.managerFilePatterns.some((f) => f.includes("pins")));
  assert.equal(m.datasourceTemplate, "crate");
  assert.equal(m.matchStringsStrategy, "recursive");
  // emulate Renovate's recursive strategy: each pattern runs on the previous matches
  const text =
    '[tools]\nnode = "1.2.3"\n\n[crates]\ntokio = "1.40.0"\nhyper-util = "0.1.9"\n\n[other]\nx = "9.9.9"\n';
  let chunks = [text];
  for (const [i, s] of m.matchStrings.entries()) {
    const last = i === m.matchStrings.length - 1;
    const next = [];
    for (const c of chunks) {
      for (const x of c.matchAll(new RegExp(s, "gm"))) next.push(last ? x.groups : x[0]);
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
  assert.deepEqual(rule.matchPackageNames, CRATES);
  assert.equal(rule.matchManagers, undefined);
});

test("template-rust renovate.json extends both presets", async () => {
  const c = await read("../template-rust/pieces/base/files/renovate.json");
  assert.deepEqual(c.extends, [
    "github>keelstackhq/hull//renovate/default",
    "github>keelstackhq/hull//renovate/cargo",
  ]);
});
