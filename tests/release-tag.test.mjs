import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { changelogRelease, previousTag, releaseTag } from "../scripts/release-tag.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const line = (commit, name) => `${commit}\t${name}`;

test("changelogRelease reads a dated top heading and its notes", () => {
  const text =
    "# Changelog\n\nintro\n\n## v1.2.3 — 2026-10-26\n\n\nbody one\n\n- item\n\n## v1.2.2 — 2026-10-01\n\nold\n";
  assert.deepEqual(changelogRelease(text), {
    version: "1.2.3",
    date: "2026-10-26",
    notes: "body one\n\n- item\n",
  });
});

test("changelogRelease reads unreleased as date null", () => {
  const r = changelogRelease("# C\n\n## v0.4.0 — unreleased\n\nstuff\n");
  assert.equal(r.version, "0.4.0");
  assert.equal(r.date, null);
  assert.equal(r.notes, "stuff\n");
});

test("changelogRelease notes run to end of file for the last section", () => {
  assert.equal(changelogRelease("## v0.1.0 — 2026-01-02\n\nlast\n").notes, "last\n");
});

test("changelogRelease throws on missing or malformed headings", () => {
  assert.throws(() => changelogRelease("# Changelog\n\nnothing\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## v1.0.0 - 2026-10-26\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## v1.0.0 — soon\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## v1.0.0 — 26-10-2026\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## v1.0.0-rc.1 — 2026-10-26\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## v1.0 — 2026-10-26\n"), /CHANGELOG/);
  assert.throws(() => changelogRelease("## 1.0.0 — 2026-10-26\n"), /CHANGELOG/);
});

test("releaseTag creates a missing tag", () => {
  assert.deepEqual(releaseTag({ version: "0.4.0", remoteTags: "", sha: SHA }), {
    tag: "v0.4.0",
    create: true,
  });
});

test("releaseTag releases nothing when the tag exists elsewhere or on a first attempt", () => {
  const elsewhere = line(OTHER, "refs/tags/v0.4.0");
  assert.deepEqual(releaseTag({ version: "0.4.0", remoteTags: elsewhere, sha: SHA, attempt: 2 }), {
    tag: "",
    create: false,
  });
  const here = line(SHA, "refs/tags/v0.4.0");
  assert.deepEqual(releaseTag({ version: "0.4.0", remoteTags: here, sha: SHA }), {
    tag: "",
    create: false,
  });
});

test("releaseTag releases again on a re-run of the tagged commit", () => {
  const here = line(SHA, "refs/tags/v0.4.0");
  assert.deepEqual(releaseTag({ version: "0.4.0", remoteTags: here, sha: SHA, attempt: 2 }), {
    tag: "v0.4.0",
    create: false,
  });
});

test("releaseTag prefers the peeled commit", () => {
  const tags = [line(OTHER, "refs/tags/v0.4.0"), line(SHA, "refs/tags/v0.4.0^{}")].join("\n");
  assert.equal(
    releaseTag({ version: "0.4.0", remoteTags: tags, sha: SHA, attempt: 2 }).tag,
    "v0.4.0",
  );
  const swapped = [line(SHA, "refs/tags/v0.4.0"), line(OTHER, "refs/tags/v0.4.0^{}")].join("\n");
  assert.equal(releaseTag({ version: "0.4.0", remoteTags: swapped, sha: SHA, attempt: 2 }).tag, "");
});

test("previousTag picks the highest lower plain tag", () => {
  const tags = ["v0.1.0", "v0.1.1", "v0.2.0", "v0.2.1", "v0.2.2", "v0.3.0"]
    .flatMap((t, i) => [
      line(`${i}`.repeat(40), `refs/tags/${t}`),
      line(OTHER, `refs/tags/${t}^{}`),
    ])
    .join("\n");
  assert.equal(previousTag("0.3.0", tags), "v0.2.2");
  assert.equal(previousTag("0.2.0", tags), "v0.1.1");
  assert.equal(previousTag("0.4.0", tags), "v0.3.0");
});

test("previousTag compares numerically and ignores non-plain tags", () => {
  const tags = [
    line(SHA, "refs/tags/v9.0.0"),
    line(SHA, "refs/tags/v10.0.0"),
    line(SHA, "refs/tags/v10.1.0-rc.1"),
    line(SHA, "refs/tags/vnext"),
  ].join("\n");
  assert.equal(previousTag("10.2.0", tags), "v10.0.0");
  assert.equal(previousTag("10.0.0", tags), "v9.0.0");
});

test("previousTag returns empty when no lower tag exists", () => {
  assert.equal(previousTag("0.1.0", ""), "");
  assert.equal(previousTag("0.1.0", line(SHA, "refs/tags/v0.1.0")), "");
});

test("the real CHANGELOG.md parses", async () => {
  const text = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const r = changelogRelease(text);
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  assert.ok(r.date === null || /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  assert.ok(r.notes.endsWith("\n") && !r.notes.endsWith("\n\n"));
});

const SCRIPT = fileURLToPath(new URL("../scripts/release-tag.mjs", import.meta.url));

test("CLI: an unreleased top heading writes release=false and an empty tag", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
  const changelog = join(dir, "CHANGELOG.md");
  const out = join(dir, "out");
  writeFileSync(changelog, "# Changelog\n\n## v9.9.9 — unreleased\n\n- wip\n");
  writeFileSync(out, "");
  const r = spawnSync("node", [SCRIPT, "--changelog", changelog], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: out },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /v9\.9\.9 is unreleased/);
  assert.equal(
    readFileSync(out, "utf8"),
    "version=9.9.9\ntag=\ncreate=false\nrelease=false\nprevious=\n",
  );
});

test("CLI: --notes prints the top section and a malformed heading exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
  const changelog = join(dir, "CHANGELOG.md");
  writeFileSync(
    changelog,
    "# Changelog\n\n## v1.0.0 — 2026-10-26\n\n- one\n\n## v0.9.0 — 2026-01-01\n\n- old\n",
  );
  const notes = spawnSync("node", [SCRIPT, "--notes", "--changelog", changelog], {
    encoding: "utf8",
  });
  assert.equal(notes.status, 0, notes.stderr);
  assert.equal(notes.stdout, "- one\n");
  writeFileSync(changelog, "# Changelog\n\n## v1.0.0 — soon\n");
  const bad = spawnSync("node", [SCRIPT, "--changelog", changelog], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^release-tag: /);
});
