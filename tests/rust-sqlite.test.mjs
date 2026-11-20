import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
const read = (dir, rel) => readFile(join(dir, rel), "utf8");

async function render(pieces, vars = {}) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-rust-sqlite-")), "out");
  const result = await renderNew({ template: RUST, out: dir, pieces, vars });
  return { dir, result };
}
const classes = (r) => Object.fromEntries(r.changes.map((c) => [c.path, c.class]));

test("piece manifest: sqlite requires rust-service, same service var, crate target", () => {
  const p = t.pieces.get("sqlite");
  assert.ok(p);
  assert.equal(p.target, "crates/{{ service }}");
  assert.notEqual(p.multiple, true);
  assert.deepEqual(p.requires, ["rust-service"]);
  assert.deepEqual(p.vars.service, t.pieces.get("rust-service").vars.service);
});

test("classes: db seed, strict test owned, Cargo.toml and main.rs stay rust-service's", async () => {
  const { result } = await render(["base", "rust-service", "sqlite"]);
  const cls = classes(result);
  assert.equal(cls["crates/server/tests/strict.rs"], "owned");
  assert.equal(cls["crates/server/migrations/0001_init.sql"], "seed");
  assert.equal(cls["crates/server/docs/restore.md"], "seed");
  for (const f of ["pool", "backup", "restore", "sweeper", "testing", "config", "mod"])
    assert.equal(cls[`crates/server/src/db/${f}.rs`], "seed", f);
});

test("Cargo.toml: sqlx no defaults, s3-backup optional crates, pins equal pins.toml [crates]", async () => {
  const { dir } = await render(["base", "rust-service", "sqlite"], { service: "api" });
  const text = await read(dir, "crates/api/Cargo.toml");
  const cargo = parseToml(text);
  assert.equal(cargo.dependencies.sqlx["default-features"], false);
  assert.deepEqual(cargo.dependencies.sqlx.features, [
    "sqlite",
    "runtime-tokio",
    "migrate",
    "macros",
  ]);
  assert.equal(cargo.dependencies.axum.version.startsWith("="), true);
  assert.deepEqual(Object.keys(cargo.features), ["s3-backup"]);
  for (const name of ["hyper", "hyper-util", "http-body-util", "rustls", "tokio-rustls"])
    assert.equal(cargo.dependencies[name].optional, true, name);
  for (const name of ["openssl", "openssl-sys", "native-tls", "reqwest", "aws-lc-rs"])
    assert.ok(!(name in cargo.dependencies), name);
  assert.deepEqual(cargo.dependencies.rustls.features, ["ring", "std", "tls12"]);
  const crates = parsePins(await read(dir, "pins.toml"), "crates");
  assert.deepEqual(checkCrates(crates, text, "x"), []);
});

test("main.rs wires the database and keeps rustfmt-friendly hooks; without sqlite it is unchanged", async () => {
  const withDb = await render(["base", "rust-service", "sqlite"]);
  const main = await read(withDb.dir, "crates/server/src/main.rs");
  assert.match(main, /^mod config;\nmod db;\n/m);
  assert.match(main, /db::restore_snapshot_arg\(\)/);
  assert.match(main, /db::Db::open/);
  assert.match(main, /#\[cfg\(unix\)\]/);
  assert.doesNotMatch(main, /\n\n\n/);
  const plain = await render(["base", "rust-service"]);
  assert.doesNotMatch(await read(plain.dir, "crates/server/src/main.rs"), /\bdb\b/);
});

test("pragmas, STRICT migration and the s3 env names are in the source", async () => {
  const { dir } = await render(["base", "rust-service", "sqlite"]);
  const pool = await read(dir, "crates/server/src/db/pool.rs");
  for (const p of ["max_connections(1)", "Wal", "Full", "foreign_keys(true)", "secure_delete"])
    assert.ok(pool.includes(p), p);
  assert.match(await read(dir, "crates/server/migrations/0001_init.sql"), /\) STRICT;/);
  const s3 = await read(dir, "crates/server/src/db/s3.rs");
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"])
    assert.ok(s3.includes(k), k);
  assert.doesNotMatch(s3, /BACKUP_S3_(ENDPOINT|BUCKET|ACCESS|SECRET)/);
});

test("the rust-sqlite combo renders base + rust-service + sqlite", async () => {
  const combo = JSON.parse(
    await readFile(new URL("../scripts/combos/rust-sqlite.json", import.meta.url), "utf8"),
  );
  assert.equal(combo.template, "template-rust");
  assert.deepEqual(combo.pieces, ["base", "rust-service", "sqlite"]);
});

test("an unwritable data dir is explained: DATA_DIR, uid 65532, docs/fly.md Volume ownership", async () => {
  const { dir } = await render(["base", "rust-service", "sqlite"]);
  const pool = await read(dir, "crates/server/src/db/pool.rs");
  for (const s of ["DATA_DIR", "65532", "docs/fly.md", "Volume ownership"])
    assert.ok(pool.includes(s), s);
  assert.match(pool, /fn not_writable_message/);
  assert.match(pool, /fn not_writable_message_names_dir_uid_and_doc/);
});

test("root AGENTS.md lists the service pieces within 60 lines; the add-piece skill names them", async () => {
  const { dir } = await render(["base", "rust-service", "sqlite", "fly"]);
  const agents = await read(dir, "AGENTS.md");
  assert.match(agents, /- `crates\/\*` \(rust-service\)/);
  assert.match(agents, /sqlite/);
  assert.match(agents, /docs\/fly\.md/);
  assert.ok(agents.trimEnd().split("\n").length <= 60);
  const none = (await render(["base"])).dir;
  assert.doesNotMatch(await read(none, "AGENTS.md"), /rust-service|docs\/fly\.md/);
  assert.match(
    await read(dir, ".claude/skills/add-piece/SKILL.md"),
    /\(rust-cli, rust-service, sqlite, fly\)/,
  );
});
