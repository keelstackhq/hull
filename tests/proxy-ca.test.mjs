import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../template-rust/pieces/base/files/scripts/proxy-ca.sh", import.meta.url),
);
const PIECE = fileURLToPath(new URL("../template-rust/pieces/base/piece.toml", import.meta.url));

/** Runs the script with a fake `docker` that prints its arguments, one per line. */
function run(args, env) {
  const bin = mkdtempSync(join(tmpdir(), "proxy-ca-bin-"));
  writeFileSync(join(bin, "docker"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
  });
}

test("proxy-ca: without a proxy CA, docker build runs unchanged", () => {
  const r = run(["docker", "build", "-t", "x", "."], {});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), ["build", "-t", "x", "."]);
});

test("proxy-ca: behind the proxy, docker build gets host network, proxy args and the CA context", () => {
  const ca = join(mkdtempSync(join(tmpdir(), "proxy-ca-")), "ca.crt");
  writeFileSync(ca, "CERT\n");
  const r = run(["docker", "build", "-t", "x", "."], {
    SSL_CERT_FILE: ca,
    HTTPS_PROXY: "http://127.0.0.1:9",
  });
  assert.equal(r.status, 0, r.stderr);
  const a = r.stdout.trim().split("\n");
  assert.deepEqual(a.slice(0, 3), ["build", "--network", "host"]);
  assert.ok(a.includes("HTTPS_PROXY=http://127.0.0.1:9"));
  assert.match(
    a.find((x) => x.startsWith("proxy-ca=")),
    /^proxy-ca=\//,
  );
  assert.deepEqual(a.slice(-3), ["-t", "x", "."]);
});

test("proxy-ca: install is a no-op without a CA, and the script is owned by base", () => {
  assert.equal(run(["install"], {}).status, 0);
  assert.equal(run(["nope"], {}).status, 2);
  assert.match(readFileSync(PIECE, "utf8"), /owned = \[[^\]]*"scripts\/proxy-ca\.sh"/);
});

test("proxy-ca install: only PROXY_CA_BUNDLE or the agent proxy CA, copied once", () => {
  const store = mkdtempSync(join(tmpdir(), "proxy-ca-store-"));
  const ca = join(mkdtempSync(join(tmpdir(), "proxy-ca-")), "ca.crt");
  writeFileSync(ca, "CERT\n");
  const env = {
    HTTPS_PROXY: "http://127.0.0.1:9",
    PROXY_CA_STORE: store,
    PROXY_CA_AGENT: "/nonexistent",
  };
  // A CA named only by SSL_CERT_FILE is not trusted system-wide.
  assert.equal(run(["install"], { ...env, SSL_CERT_FILE: ca }).status, 0);
  assert.equal(existsSync(join(store, "agent-proxy-ca.crt")), false);
  const first = run(["install"], { ...env, PROXY_CA_BUNDLE: ca });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(join(store, "agent-proxy-ca.crt"), "utf8"), "CERT\n");
  const again = run(["install"], { ...env, PROXY_CA_BUNDLE: ca });
  assert.match(again.stdout, /unchanged/);
});
