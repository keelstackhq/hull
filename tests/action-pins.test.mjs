import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { allUses, findUses, HOIST_EXEMPT, ROOT } from "../scripts/lib/actions.mjs";

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[^@\s]+)?@[0-9a-f]{40}$/;
const COMMENT = /^# v\d+\.\d+\.\d+$/;
const BRANCH_COMMENT = /^# stable branch, \d{4}-\d{2}-\d{2}$/;
const sha = "b".repeat(40);

/** @returns {boolean} whether a pinned ref and its comment are acceptable */
function okPin(ref, comment) {
  if (!PINNED.test(ref)) return false;
  return ref.startsWith("dtolnay/rust-toolchain@")
    ? BRANCH_COMMENT.test(comment) || COMMENT.test(comment)
    : COMMENT.test(comment);
}

test("the stable-branch comment is accepted only for dtolnay/rust-toolchain", () => {
  const c = "# stable branch, 2026-10-28";
  assert.ok(okPin(`dtolnay/rust-toolchain@${sha}`, c));
  assert.ok(!okPin(`actions/checkout@${sha}`, c));
  assert.ok(okPin(`actions/checkout@${sha}`, "# v5.1.0"));
});

test("findUses reads plain, quoted and raw-block lines", () => {
  assert.deepEqual(findUses("      - uses: a/b@v1\n"), [{ line: 1, ref: "a/b@v1", comment: "" }]);
  assert.deepEqual(findUses('  "      - uses: a/b@v1 # v1.0.0",\n')[0], {
    line: 1,
    ref: "a/b@v1",
    comment: "# v1.0.0",
  });
  assert.equal(findUses("  statuses: write\n").length, 0);
});

test("every workflow `uses:` is a full commit SHA with a version comment", async () => {
  const uses = await allUses();
  assert.ok(uses.length > 60, `found ${uses.length} uses`);
  for (const u of uses) {
    const at = `${u.file}:${u.line} ${u.ref}`;
    if (u.ref.startsWith("./")) continue;
    if (HOIST_EXEMPT.test(u.ref)) {
      assert.match(u.comment, /^# TODO\(hoist-release\)/, at);
      continue;
    }
    assert.match(u.ref, PINNED, `${at} must be pinned by 40-hex SHA`);
    assert.ok(okPin(u.ref, u.comment), `${at} needs a "# vX.Y.Z" comment`);
  }
});

test("dtolnay/rust-toolchain pinned by SHA sets toolchain: stable", async () => {
  const files = [
    ".github/workflows/ci.yml",
    ".github/workflows/desktop.yml",
    "template/pieces/base/files/.github/workflows/desktop.yml.jinja",
  ];
  for (const f of files) {
    const text = await readFile(ROOT + f, "utf8");
    assert.match(text, /dtolnay\/rust-toolchain@[0-9a-f]{40} # stable branch/, f);
    assert.match(
      text,
      /rust-toolchain@[0-9a-f]{40}[^\n]*\n(?:[^\n]*\n)*?\s+toolchain: stable\n/,
      f,
    );
  }
});

test("renovate preset keeps github-actions digests pinned and updated", async () => {
  const cfg = JSON.parse(await readFile(ROOT + "renovate/default.json", "utf8"));
  assert.ok(cfg.extends.includes("helpers:pinGitHubActionDigests"));
  for (const r of cfg.packageRules ?? []) {
    assert.notEqual(r.enabled, false, JSON.stringify(r));
    assert.ok(!(r.matchManagers ?? []).includes("github-actions") || r.pinDigests !== false);
  }
  assert.ok(!(cfg.ignorePaths ?? []).some((p) => /workflows/.test(p)));
  assert.ok(!(cfg.enabledManagers ?? ["github-actions"]).includes("-github-actions"));
});

test("docs/actions.md on disk equals actionsDoc()", async () => {
  const { actionsDoc } = await import("../scripts/actions-doc.mjs");
  const disk = await readFile(ROOT + "docs/actions.md", "utf8");
  assert.equal(disk, await actionsDoc(), "run: pnpm docs:actions");
  assert.match(disk, /fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/);
});
