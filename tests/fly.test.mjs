import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { renderNew } from "../scripts/render.mjs";
import { parsePins } from "../template-rust/pieces/base/files/scripts/pins.mjs";
import { check } from "./ci-minutes-gate.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const FILES = join(RUST, "pieces/fly/files");
const SETUP = join(FILES, "scripts/fly-setup.sh");
const SMOKE = join(FILES, "scripts/smoke.sh");
const t = await loadTemplate(RUST);
const read = (dir, rel) => readFile(join(dir, rel), "utf8");

async function render(vars = {}) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-fly-")), "out");
  const result = await renderNew({
    template: RUST,
    out: dir,
    pieces: ["base", "rust-service", "fly"],
    vars,
  });
  return { dir, result };
}

test("piece manifest: root files, requires rust-service, service and app vars", () => {
  const p = t.pieces.get("fly");
  assert.ok(p);
  assert.ok(!p.target);
  assert.deepEqual(p.requires, ["rust-service"]);
  assert.equal(p.vars.service.default, "server");
  assert.equal(p.vars.service.pattern, "^[a-z][a-z0-9-]*$");
  assert.equal(p.vars.app.default, "app");
  assert.equal(p.vars.app.pattern, "^[a-z][a-z0-9-]*$");
});

test("classes: Dockerfile, scripts, workflows, docs owned; fly.toml seed", async () => {
  const { result } = await render({ service: "api", app: "my-api" });
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  for (const f of [
    "Dockerfile",
    "scripts/fly-setup.sh",
    "scripts/smoke.sh",
    ".github/workflows/deploy.yml",
    ".github/workflows/image.yml",
    "docs/fly.md",
  ])
    assert.equal(cls[f], "owned", f);
  assert.equal(cls["fly.toml"], "seed");
});

test("the rust-fly combo exists: base + rust-service + fly", async () => {
  const combo = JSON.parse(
    await readFile(new URL("../scripts/combos/rust-fly.json", import.meta.url), "utf8"),
  );
  assert.equal(combo.template, "template-rust");
  assert.deepEqual(combo.pieces, ["base", "rust-service", "fly"]);
});

test("Dockerfile: builder tag equals pins.toml rust, proxy-ca stage, gates, scratch, non-root", async () => {
  const { dir } = await render({ service: "api", app: "my-api" });
  const docker = await read(dir, "Dockerfile");
  const pins = parsePins(await read(dir, "pins.toml"));
  assert.match(
    docker,
    new RegExp(`^FROM rust:${pins.rust.replaceAll(".", "\\.")}-alpine AS build$`, "m"),
  );
  assert.match(docker, /^FROM scratch AS proxy-ca$/m);
  assert.match(docker, /^COPY --from=proxy-ca \/ \/usr\/local\/share\/ca-certificates\/$/m);
  assert.match(docker, /^ARG FEATURES=""$/m);
  assert.match(docker, /^ARG MAX_BYTES=\d+$/m);
  assert.match(docker, /readelf -l .*INTERP/);
  assert.match(docker, /readelf -d .*NEEDED/);
  assert.match(docker, /MAX_BYTES/);
  assert.match(docker, /cargo build --release --locked --target "\$t" -p api /);
  assert.match(docker, /^ENTRYPOINT \["\/api"\]$/m);
  assert.match(docker, /^USER 65532:65532$/m);
  assert.match(docker, /^FROM scratch$/m);
  assert.doesNotMatch(docker, /\{\{|\{%/);
});

test("fly.toml: one machine, volume with auto-extend, healthz check, concurrency", async () => {
  const { dir } = await render({ service: "api", app: "my-api" });
  const toml = parseToml(await read(dir, "fly.toml"));
  assert.equal(toml.app, "my-api");
  assert.equal(toml.http_service.min_machines_running, 1);
  assert.equal(toml.http_service.auto_stop_machines, "off");
  assert.equal(toml.http_service.internal_port, 8080);
  assert.equal(toml.mounts.destination, "/data");
  for (const k of [
    "auto_extend_size_threshold",
    "auto_extend_size_increment",
    "auto_extend_size_limit",
  ])
    assert.ok(k in toml.mounts, k);
  assert.equal(toml.http_service.checks[0].path, "/healthz");
  assert.equal(toml.http_service.checks[0].method, "GET");
  assert.ok(toml.http_service.concurrency.hard_limit > 0);
  assert.equal(toml.build.args.FEATURES, "");
});

test("deploy.yml: tested sha, production environment, never cancelled, no pull_request; passes the ci-minutes gate", async () => {
  const { dir } = await render({ service: "api", app: "my-api" });
  const text = await read(dir, ".github/workflows/deploy.yml");
  assert.deepEqual(check(text), []);
  const wf = YAML.parse(text);
  assert.deepEqual(Object.keys(wf.on).sort(), ["workflow_dispatch", "workflow_run"]);
  assert.deepEqual(wf.on.workflow_run.workflows, ["ci"]);
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  assert.match(wf.concurrency.group, /^deploy-/);
  assert.equal(wf.jobs.deploy.environment, "production");
  assert.match(wf.jobs.deploy.if, /conclusion == 'success'/);
  assert.match(wf.jobs.deploy.if, /head_branch == github\.event\.repository\.default_branch/);
  assert.match(text, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(text, /SMOKE_URL: https:\/\/my-api\.fly\.dev/);
  assert.match(text, /bash scripts\/smoke\.sh/);
  assert.match(text, /superfly\/flyctl-actions\/setup-flyctl@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
});

test("image.yml: pull_request build with no secrets, environment or push; passes the ci-minutes gate", async () => {
  const { dir } = await render();
  const text = await read(dir, ".github/workflows/image.yml");
  assert.deepEqual(check(text), []);
  assert.doesNotMatch(text, /secrets\.|environment:|--push|login/);
  assert.match(text, /docker build/);
  assert.deepEqual(Object.keys(YAML.parse(text).on), ["pull_request"]);
});

test("docs/fly.md: grey cloud, rollback, proxy-ca build, Fly-Client-IP", async () => {
  const { dir } = await render();
  const doc = await read(dir, "docs/fly.md");
  assert.match(doc, /grey cloud/);
  assert.match(doc, /fly releases/);
  assert.match(doc, /fly deploy .*--image/);
  assert.match(doc, /bash scripts\/proxy-ca\.sh docker build/);
  assert.match(doc, /Fly-Client-IP/);
});

// fly-setup.sh with stub `fly` and `gh`

const STUB_FLY = `#!/usr/bin/env bash
echo "fly $*" >> "$STUB_DIR/calls.log"
st="$STUB_DIR/state"; mkdir -p "$st"
[ "\${STUB_FAIL:-}" = "$1 $2" ] && exit 1
case "$1 $2" in
  "auth whoami") [ -z "\${STUB_NOAUTH:-}" ] || exit 1 ;;
  "apps list") echo "[]"; cat "$st/apps" 2>/dev/null ;;
  "apps create") echo "{\\"Name\\": \\"$3\\"}" >> "$st/apps" ;;
  "volumes list") cat "$st/volumes" 2>/dev/null ;;
  "volumes create") echo '{"name": "data"}' >> "$st/volumes" ;;
  "ips list") cat "$st/ips" 2>/dev/null ;;
  "ips allocate-v4") echo '{"Type": "shared_v4"}' >> "$st/ips" ;;
  "ips allocate-v6") echo '{"Type": "v6"}' >> "$st/ips" ;;
  "certs list") cat "$st/certs" 2>/dev/null ;;
  "certs add") echo "{\\"Hostname\\": \\"$3\\"}" >> "$st/certs" ;;
  "secrets list") cat "$st/secrets" 2>/dev/null ;;
  "secrets import")
    while IFS= read -r l; do
      echo "fly-stdin: $l" >> "$STUB_DIR/stdin.log"
      echo "{\\"Name\\": \\"\${l%%=*}\\"}" >> "$st/secrets"
    done ;;
  "tokens create") echo "FLY-TOKEN-VALUE-123" ;;
  "machine run") ;;
esac
exit 0
`;
const STUB_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_DIR/calls.log"
st="$STUB_DIR/state"; mkdir -p "$st"
case "$1 $2" in
  "auth status") exit 0 ;;
  "secret list") cat "$st/ghsecrets" 2>/dev/null ;;
  "secret set") echo "gh-stdin: $(cat)" >> "$STUB_DIR/stdin.log"; echo "$3 $4 $5" >> "$st/ghsecrets" ;;
esac
exit 0
`;
const MUTATING =
  /^(fly (apps create|volumes create|machine run|ips allocate|certs add|secrets import|tokens create|deploy)|gh secret set)/;

async function sandbox({ fly = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hull-fly-stub-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  if (fly) {
    await writeFile(join(bin, "fly"), STUB_FLY);
    await chmod(join(bin, "fly"), 0o755);
  }
  await writeFile(join(bin, "gh"), STUB_GH);
  await chmod(join(bin, "gh"), 0o755);
  for (const tool of ["bash", "cat", "grep", "env", "mkdir"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    await symlink(found, join(bin, tool)).catch(() => {});
  }
  const run = (args, { input = "", env = {} } = {}) =>
    spawnSync("bash", [SETUP, ...args], {
      encoding: "utf8",
      input,
      env: { PATH: bin, STUB_DIR: dir, ...env },
    });
  const calls = async () =>
    (await readFile(join(dir, "calls.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const stdinLog = () => readFile(join(dir, "stdin.log"), "utf8").catch(() => "");
  return { run, calls, stdinLog };
}

const FULL = ["--app", "my-api", "--region", "iad", "--host", "api.example.com"];

test("fly-setup.sh and smoke.sh pass bash -n (and shellcheck when installed)", () => {
  for (const f of [SETUP, SMOKE]) {
    assert.equal(spawnSync("bash", ["-n", f]).status, 0, f);
    const sc = spawnSync("shellcheck", ["-x", f], { encoding: "utf8" });
    if (sc.error === undefined) assert.equal(sc.status, 0, sc.stdout);
  }
});

test("fly-setup.sh: first run creates app, volume, IPs, cert, token; second run makes no mutating call", async () => {
  const s = await sandbox();
  const args = [...FULL, "--set-gh-secret", "production", "--secrets-stdin"];
  const first = s.run(args, { input: "API_KEY=s3cret\n" });
  assert.equal(first.status, 0, first.stderr);
  const calls1 = await s.calls();
  for (const want of [
    "fly apps create my-api",
    "fly volumes create data --app my-api --region iad --size 1 --yes",
    "fly ips allocate-v4 --shared --app my-api --yes",
    "fly ips allocate-v6 --app my-api",
    "fly certs add api.example.com --app my-api",
    "fly secrets import --stage --app my-api",
    "fly tokens create deploy --app my-api",
    "gh secret set FLY_API_TOKEN --env production",
  ])
    assert.ok(calls1.includes(want), `missing: ${want}`);
  const before = calls1.length;
  const second = s.run(args, { input: "API_KEY=s3cret\n" });
  assert.equal(second.status, 0, second.stderr);
  const calls2 = (await s.calls()).slice(before);
  assert.deepEqual(
    calls2.filter((c) => MUTATING.test(c)),
    [],
  );
});

test("fly-setup.sh: secret values and the deploy token reach stdin only, never argv or output", async () => {
  const s = await sandbox();
  const r = s.run([...FULL, "--set-gh-secret", "production", "--secrets-stdin"], {
    input: "API_KEY=s3cret-value\nOTHER=two\n",
  });
  assert.equal(r.status, 0, r.stderr);
  const all = (await s.calls()).join("\n");
  assert.doesNotMatch(all, /s3cret-value|two\b|FLY-TOKEN-VALUE/);
  assert.doesNotMatch(r.stdout + r.stderr, /s3cret-value|FLY-TOKEN-VALUE/);
  const log = await s.stdinLog();
  assert.match(log, /fly-stdin: API_KEY=s3cret-value/);
  assert.match(log, /gh-stdin: FLY-TOKEN-VALUE-123/);
});

test("fly-setup.sh: only keys not yet set are imported", async () => {
  const s = await sandbox();
  assert.equal(s.run(FULL.concat("--secrets-stdin"), { input: "A_ONE=1\n" }).status, 0);
  const r = s.run(FULL.concat("--secrets-stdin"), { input: "A_ONE=1\nB_TWO=2\n" });
  assert.equal(r.status, 0, r.stderr);
  const log = await s.stdinLog();
  assert.equal(log.match(/A_ONE/g).length, 1);
  assert.match(log, /B_TWO=2/);
});

test("fly-setup.sh --dry-run makes no mutating call and says what it would do", async () => {
  const s = await sandbox();
  const r = s.run(
    [...FULL, "--set-gh-secret", "production", "--secrets-stdin", "--deploy", "--dry-run"],
    {
      input: "API_KEY=s3cret\n",
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    (await s.calls()).filter((c) => MUTATING.test(c)),
    [],
  );
  assert.match(r.stdout, /\[dry-run\] would create app my-api/);
  assert.match(r.stdout, /\[dry-run\] would add certificate for api\.example\.com/);
  assert.doesNotMatch(r.stdout, /s3cret/);
});

test("fly-setup.sh: --app with --set-gh-secret alone stores the token and creates nothing else", async () => {
  const s = await sandbox();
  const r = s.run(["--app", "my-api", "--set-gh-secret", "production"]);
  assert.equal(r.status, 0, r.stderr);
  const calls = await s.calls();
  assert.ok(calls.includes("fly tokens create deploy --app my-api"));
  assert.ok(calls.includes("gh secret set FLY_API_TOKEN --env production"));
  assert.deepEqual(
    calls.filter((c) => /create (app|volume)|allocate|certs add/.test(c)),
    [],
  );
});

test("fly-setup.sh exit codes: 2 usage, 3 missing tool or auth, 4 failed step", async () => {
  const s = await sandbox();
  assert.equal(s.run([]).status, 2);
  assert.equal(s.run(["--app"]).status, 2);
  assert.equal(s.run(["--app", "BAD NAME", "--region", "iad"]).status, 2);
  assert.equal(s.run(["--app", "x"]).status, 2);
  assert.equal(s.run(["--bogus"]).status, 2);
  assert.equal(s.run([...FULL, "--secrets-stdin"], { input: "not a pair\n" }).status, 2);
  assert.equal(s.run(FULL, { env: { STUB_NOAUTH: "1" } }).status, 3);
  assert.equal((await sandbox({ fly: false })).run(FULL).status, 3);
  assert.equal(s.run(FULL, { env: { STUB_FAIL: "volumes create" } }).status, 4);
});

// smoke.sh

function listen(status) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.statusCode = req.url === "/healthz" ? status : 404;
      res.end("x");
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const smoke = (env) =>
  new Promise((resolve) => {
    const p = spawn("bash", [SMOKE], { env: { PATH: process.env.PATH, ...env } });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, err }));
  });

test("smoke.sh: 0 on 200, 1 on timeout, 2 on usage", async () => {
  const ok = await listen(200);
  const bad = await listen(503);
  try {
    const url = (s) => `http://127.0.0.1:${s.address().port}`;
    assert.equal((await smoke({ SMOKE_URL: `${url(ok)}/`, SMOKE_TIMEOUT_SECS: "5" })).code, 0);
    assert.equal((await smoke({ SMOKE_URL: url(bad), SMOKE_TIMEOUT_SECS: "1" })).code, 1);
    assert.equal((await smoke({})).code, 2);
    assert.equal((await smoke({ SMOKE_URL: url(ok), SMOKE_TIMEOUT_SECS: "soon" })).code, 2);
  } finally {
    ok.close();
    bad.close();
  }
});

test("docs/fly.md: Volume ownership section with the one-time chown machine", async () => {
  const { dir } = await render();
  const doc = await read(dir, "docs/fly.md");
  assert.match(doc, /^## Volume ownership$/m);
  assert.match(
    doc,
    /fly machine run alpine:3 .*--volume data:\/data .*chown -R 65532:65532 \/data/,
  );
  assert.match(doc, /--fix-volume-owner/);
});

test("fly-setup.sh --fix-volume-owner: opt-in, runs one throwaway chown machine, needs --region", async () => {
  const s = await sandbox();
  const plain = s.run(FULL);
  assert.equal(plain.status, 0, plain.stderr);
  assert.deepEqual(
    (await s.calls()).filter((c) => c.includes("machine run")),
    [],
  );
  const dry = s.run([...FULL, "--fix-volume-owner", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\[dry-run\] would .*chown/);
  const r = s.run([...FULL, "--fix-volume-owner"]);
  assert.equal(r.status, 0, r.stderr);
  const runs = (await s.calls()).filter((c) => c.startsWith("fly machine run"));
  assert.equal(runs.length, 1);
  assert.match(
    runs[0],
    /alpine:3 --app my-api --region iad --volume data:\/data --rm .*chown -R 65532:65532 \/data/,
  );
  assert.equal(s.run(["--app", "my-api", "--fix-volume-owner"]).status, 2);
  assert.equal(
    s.run(FULL.concat("--fix-volume-owner"), { env: { STUB_FAIL: "machine run" } }).status,
    4,
  );
});
