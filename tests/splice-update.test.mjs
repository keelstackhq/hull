import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { git } from "../scripts/lib/splice.mjs";

const BIN = process.env.SPLICE_BIN;
const HULL = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE = join(HULL, "template");
const WEB = ["preact-app:web", "ui-storybook", "hono-worker:api"];

/** Latest `v<semver>` tag reachable from HEAD, or undefined. */
function previousTag() {
  const r = spawnSync("git", ["tag", "--merged", "HEAD", "--list", "v*", "--sort=-v:refname"], {
    cwd: HULL,
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t)) : undefined;
}

const prev = previousTag();
const skip = !BIN
  ? "SPLICE_BIN is unset (hull CI sets it; see scripts/lib/splice.mjs)"
  : !prev && !process.env.CI && "no v<semver> tag reachable from HEAD (fetch tags)";

/**
 * A template repo with tag `from` (that tag's template/) and `v<next>` (the working tree).
 * @param {string} root
 * @param {string} [from] a `v<semver>` tag of this repo; defaults to the latest one
 */
async function templateRepo(root, from = prev) {
  assert.ok(from, "no v<semver> tag reachable from HEAD; CI must fetch tags (fetch-depth: 0)");
  const repo = join(root, "tpl");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q");
  const tar = spawnSync("git", ["archive", from, "template"], { cwd: HULL });
  assert.equal(tar.status, 0, String(tar.stderr));
  const x = spawnSync("tar", ["-x", "-C", repo], { input: tar.stdout });
  assert.equal(x.status, 0, String(x.stderr));
  // v0.1.0 shipped migrations/.gitkeep, which splice 0.2.0 refuses as a migration file.
  // Drop this line once the previous tag is newer than v0.1.0.
  await rm(join(repo, "template/migrations/.gitkeep"), { force: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", from);
  git(repo, "tag", from);
  await rm(join(repo, "template"), { recursive: true });
  await cp(TEMPLATE, join(repo, "template"), { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", "next");
  const [maj, min] = from.slice(1).split(".").map(Number);
  const next = `v${maj}.${min + 1}.0`;
  git(repo, "tag", next);
  return { source: `${repo}//template`, next };
}

const run = (cwd, ...args) => spawnSync(BIN, args, { cwd, encoding: "utf8" });

test("update keeps seed, merges shared, guards owned", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { source, next } = await templateRepo(root);
  const app = join(root, "app");
  const pieces = WEB.flatMap((p) => ["--piece", p]);
  const opts = ["--data", "scope=hullci", "--yes", "--json", "--no-post"];
  const made = run(root, "new", source, app, "--ref", prev, ...pieces, ...opts);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  git(app, "init", "-q");
  git(app, "add", "-A");
  git(app, "commit", "-q", "-m", "new");

  const seed = join(app, "apps/web/src/app.tsx");
  const editedSeed = `${await readFile(seed, "utf8")}// my edit\n`;
  await writeFile(seed, editedSeed);
  const pkgPath = join(app, "apps/web/package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.dependencies = { ...pkg.dependencies, "left-pad": "1.3.0" };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const owned = join(app, "apps/web/vite.config.ts");
  await writeFile(owned, `${await readFile(owned, "utf8")}// local tweak\n`);
  git(app, "add", "-A");
  git(app, "commit", "-q", "-m", "user edits");

  const check = run(app, "check", "--json", "--offline");
  assert.equal(check.status, 1, check.stdout + check.stderr);
  assert.match(check.stdout, /apps\/web\/vite\.config\.ts/);

  const refused = run(app, "update", "--to", next, "--yes", "--json", "--no-post");
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(await readFile(owned, "utf8"), /local tweak/);

  const up = run(app, "update", "--to", next, "--force", "--yes", "--json", "--no-post");
  assert.equal(up.status, 0, up.stdout + up.stderr);
  assert.equal(JSON.parse(up.stdout).ok, true);

  assert.equal(await readFile(seed, "utf8"), editedSeed);
  assert.equal(JSON.parse(await readFile(pkgPath, "utf8")).dependencies["left-pad"], "1.3.0");
  assert.equal(
    await readFile(owned, "utf8"),
    await readFile(join(TEMPLATE, "pieces/preact-app/files/vite.config.ts"), "utf8"),
  );
  // 0.2.0 moved base's agent files to rigging's claude piece (migrations/0.2.0.toml)
  for (const f of ["explore", "implementer", "reviewer", "ci-fixer"]) {
    assert.ok(!existsSync(join(app, `.claude/agents/${f}.md`)), f);
  }
  const final = run(app, "check", "--json", "--offline");
  assert.equal(final.status, 0, final.stdout + final.stderr);
});

// Repos first rendered before v0.1.0 (dev renderer) and later adopted with `splice new --force`
// still carry `.claude/agents/explorer.md`, which no lock tracks (migrations/0.2.1.toml). The
// update starts at v0.2.0 so that migration is in range whatever the latest tag is.
const FROM_EXPLORER = "v0.2.0";
test(
  "update deletes an unedited pre-0.1.0 explorer.md, keeps an edited one",
  { skip },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "hull-update-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { source, next } = await templateRepo(root, FROM_EXPLORER);
    // The copy hull shipped (git blob ad17ec0f; tests/ai-layer.test.mjs checks the hash).
    const shipped = await readFile(join(HULL, "tests/fixtures/explorer/explorer.md"), "utf8");
    for (const [name, content, kept] of [
      ["unedited", shipped, false],
      ["edited", `${shipped}my note\n`, true],
    ]) {
      const app = join(root, name);
      const opts = ["--data", "scope=hullci", "--yes", "--json", "--no-post"];
      const made = run(root, "new", source, app, "--ref", FROM_EXPLORER, ...opts);
      assert.equal(made.status, 0, made.stdout + made.stderr);
      const explorer = join(app, ".claude/agents/explorer.md");
      await mkdir(join(app, ".claude/agents"), { recursive: true });
      await writeFile(explorer, content);
      git(app, "add", "-A");
      git(app, "commit", "-q", "-m", "old render");
      const up = run(app, "update", "--to", next, "--yes", "--json", "--no-post");
      assert.equal(up.status, 0, up.stdout + up.stderr);
      assert.equal(existsSync(explorer), kept, `${name}: ${up.stdout}`);
    }
  },
);
