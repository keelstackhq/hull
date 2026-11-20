import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { renderNew } from "../scripts/render.mjs";
import { checkCrates, parsePins } from "../template-rust/pieces/base/files/scripts/pins.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const t = await loadTemplate(RUST);
const plain = (v) => JSON.parse(JSON.stringify(v));
const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const lines = (text) => text.split("\n").length - 1;

async function render(pieces, vars = {}) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-rust-service-")), "out");
  const result = await renderNew({ template: RUST, out: dir, pieces, vars });
  return { dir, result };
}
const classes = (r) => Object.fromEntries(r.changes.map((c) => [c.path, c.class]));

test("piece manifest: service var, target crates/{{ service }}, requires base", () => {
  const p = t.pieces.get("rust-service");
  assert.ok(p);
  assert.equal(p.target, "crates/{{ service }}");
  assert.notEqual(p.multiple, true);
  assert.equal(p.vars.service.default, "server");
  assert.equal(p.vars.service.pattern, "^[a-z][a-z0-9-]*$");
  assert.deepEqual(p.requires, ["base"]);
});

test("classes: Cargo.toml shared, src seed, AGENTS.md owned, CLAUDE.md seed", async () => {
  const { result } = await render(["base", "rust-service"]);
  const cls = classes(result);
  assert.equal(cls["crates/server/Cargo.toml"], "shared");
  assert.equal(cls["crates/server/AGENTS.md"], "owned");
  assert.equal(cls["crates/server/CLAUDE.md"], "seed");
  for (const f of ["main", "app", "config", "client_ip"])
    assert.equal(cls[`crates/server/src/${f}.rs`], "seed", f);
});

test("Cargo.toml: named by the service var, pins equal pins.toml [crates], small feature sets", async () => {
  const { dir } = await render(["base", "rust-service"], { service: "api" });
  const cargo = parseToml(await read(dir, "crates/api/Cargo.toml"));
  assert.equal(cargo.package.name, "api");
  assert.equal(cargo.package.publish, false);
  assert.deepEqual(plain(cargo.bin), [{ name: "api", path: "src/main.rs" }]);
  const crates = parsePins(await read(dir, "pins.toml"), "crates");
  assert.deepEqual(checkCrates(crates, await read(dir, "crates/api/Cargo.toml"), "x"), []);
  assert.deepEqual(cargo.dependencies.tokio.features, [
    "rt-multi-thread",
    "macros",
    "net",
    "signal",
    "time",
  ]);
  assert.equal(cargo.dependencies.axum["default-features"], false);
  for (const table of ["dependencies", "dev-dependencies"])
    for (const name of ["openssl", "openssl-sys", "native-tls", "reqwest"])
      assert.ok(!(name in (cargo[table] ?? {})), name);
});

test("main.rs: sqlite hooks render only with the sqlite piece id; healthz and signals are wired", async () => {
  const { dir } = await render(["base", "rust-service"]);
  const main = await read(dir, "crates/server/src/main.rs");
  assert.doesNotMatch(main, /sqlite|mod db/);
  assert.doesNotMatch(main, /\n\n\n/);
  assert.match(main, /SignalKind::terminate\(\)/);
  assert.match(main, /with_graceful_shutdown/);
  assert.match(await read(dir, "crates/server/src/app.rs"), /"\/healthz"/);
  assert.match(await read(dir, "crates/server/src/client_ip.rs"), /fly-client-ip/);
});

test("per-instance notes: AGENTS.md owned within 25 lines, CLAUDE.md seed", async () => {
  const { dir } = await render(["base", "rust-service"]);
  const agents = await read(dir, "crates/server/AGENTS.md");
  assert.ok(lines(agents) <= 25);
  assert.match(agents, /Fly-Client-IP/);
  assert.equal(await read(dir, "crates/server/CLAUDE.md"), "@AGENTS.md\n");
});

test("the rust-service combo exists and renders base + rust-service", async () => {
  const combo = JSON.parse(
    await readFile(new URL("../scripts/combos/rust-service.json", import.meta.url), "utf8"),
  );
  assert.equal(combo.template, "template-rust");
  assert.deepEqual(combo.pieces, ["base", "rust-service"]);
  const names = await readdir(new URL("../scripts/combos", import.meta.url));
  assert.ok(names.includes("rust-service.json"));
});
