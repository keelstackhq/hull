import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { git, snapshotTemplate, spliceNewArgs } from "../scripts/lib/splice.mjs";

// Contract rule 9.27 (splice >= 0.3.0): an empty re-render removes an owned/shared file, so
// `splice add circleci-only` on an existing repo deletes the GitHub CI workflow.
const BIN = process.env.SPLICE_BIN;
const version = BIN
  ? spawnSync(BIN, ["--version"], { encoding: "utf8" }).stdout.match(/\d+\.\d+\.\d+/)?.[0]
  : undefined;
const atLeast030 =
  version &&
  version
    .split(".")
    .map(Number)
    .reduce((a, n, i) => a || n - [0, 3, 0][i], 0) >= 0;
const skip = !BIN
  ? "SPLICE_BIN is unset (hull CI sets it; see scripts/lib/splice.mjs)"
  : !atLeast030 &&
    `SPLICE_BIN is splice ${version ?? "of unknown version"}; rule 9.27 needs >= 0.3.0`;
const HULL = fileURLToPath(new URL("..", import.meta.url));
const MIRROR = ".github/workflows/circleci-status.yml";
const CI = ".github/workflows/ci.yml";

const run = (cwd, ...args) => spawnSync(BIN, args, { cwd, encoding: "utf8" });

async function switchToCircleciOnly(t, template, pieces, vars) {
  const root = await mkdtemp(join(tmpdir(), "hull-add-circleci-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await snapshotTemplate(join(HULL, template), root);
  const app = join(root, "app");
  const made = run(root, ...spliceNewArgs(source, app, pieces, vars, ["--no-post"]));
  assert.equal(made.status, 0, made.stdout + made.stderr);
  git(app, "init", "-q");
  git(app, "add", "-A");
  git(app, "commit", "-q", "-m", "new");
  assert.ok(existsSync(join(app, CI)), "ci.yml exists before the switch");

  for (const piece of ["circleci", "circleci-only"]) {
    const r = run(app, "add", piece, "--yes", "--json", "--no-post");
    assert.equal(r.status, 0, `${piece}: ${r.stdout}${r.stderr}`);
    git(app, "add", "-A");
    git(app, "commit", "-q", "-m", `add ${piece}`);
  }
  const check = run(app, "check");
  assert.equal(check.status, 0, check.stdout + check.stderr);
  for (const f of await readdir(join(app, ".splice"), { recursive: true })) {
    const p = join(app, ".splice", f);
    if (!(await stat(p)).isFile()) continue;
    assert.ok(!(await readFile(p, "utf8")).includes(CI), `${f} still lists ${CI}`);
  }
  return app;
}

test("splice add circleci-only removes ci.yml from a web repo (rule 9.27)", { skip }, async (t) => {
  const app = await switchToCircleciOnly(t, "template", ["preact-app:web", "hono-worker:api"], {
    scope: "hullci",
  });
  assert.ok(!existsSync(join(app, CI)), "ci.yml is removed");
  assert.ok(existsSync(join(app, MIRROR)), "circleci-status.yml exists");
});

test(
  "splice add circleci-only removes ci.yml from a rust repo (rule 9.27)",
  { skip },
  async (t) => {
    const app = await switchToCircleciOnly(t, "template-rust", ["rust-cli:cli"], {});
    assert.ok(!existsSync(join(app, CI)), "ci.yml is removed");
    assert.ok(existsSync(join(app, MIRROR)), "circleci-status.yml exists");
  },
);
