// `rigging/`: hull's second template, a splice channel (splice channels spec §6-§7, hull spec
// §14). hull's dev renderer does not know `[sections]` (a splice 0.2.0 piece key), so these
// tests check the channel's shape instead of rendering it with scripts/render.mjs.
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { outputPath, overlaps } from "../scripts/lib/ownership.mjs";
import { renderString } from "../scripts/lib/render-file.mjs";
import { pathProblem } from "../scripts/lib/segment.mjs";
import { checkSubset } from "../scripts/lib/subset.mjs";
import { REAL_TEMPLATE } from "./helpers.mjs";

const RIGGING = fileURLToPath(new URL("../rigging", import.meta.url));
const toml = (rel) => parse(readFileSync(join(RIGGING, rel), "utf8"));
const AGENT_FILES = ["ci-fixer.md", "explore.md", "implementer.md", "reviewer.md"];

/** Every entry below `dir` (files, dirs, links) as paths relative to `dir`, lstat only. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const st = lstatSync(p);
    const rel = [relative(dir, p)];
    if (st.isDirectory() && !st.isSymbolicLink()) {
      return [...rel, ...walk(p).map((r) => join(name, r))];
    }
    return rel;
  });
}

const pieceIds = () => readdirSync(join(RIGGING, "pieces")).sort();
const piece = (id) => toml(`pieces/${id}/piece.toml`);
const filesOf = (id) => {
  const dir = join(RIGGING, "pieces", id, "files");
  return existsSync(dir) ? walk(dir).filter((r) => lstatSync(join(dir, r)).isFile()) : [];
};
/** Paths under files/ that splice renders as files: everything except section fragments. */
const renderedFiles = (id) => {
  const fragments = new Set(Object.values(piece(id).sections ?? {}));
  return filesOf(id).filter((r) => !fragments.has(r));
};

/** Parse flat `key: value` frontmatter. */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, "missing frontmatter");
  return Object.fromEntries(
    m[1].split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}

test("splice.toml: format 1, rigging, base core, needs splice 0.2.0", () => {
  assert.deepEqual(
    { ...toml("splice.toml") },
    {
      format: 1,
      name: "rigging",
      min_splice: "0.2.0",
      base: "core",
    },
  );
  assert.deepEqual(pieceIds(), ["claude", "core", "skills"]);
  for (const id of pieceIds()) assert.equal(piece(id).id, id);
});

test("hull's dev renderer refuses rigging: [sections] is splice 0.2.0 only", async () => {
  await assert.rejects(loadTemplate(RIGGING), /unknown key "sections"/);
});

test("core: one AGENTS.md section, no files of its own", () => {
  const core = piece("core");
  assert.equal(core.multiple ?? false, false);
  assert.deepEqual({ ...core.sections }, { "AGENTS.md": "sections/rules.md.jinja" });
  assert.deepEqual(renderedFiles("core"), []);
});

test("claude: the four agent files owned, no CLAUDE.md section (hull owns CLAUDE.md)", () => {
  const claude = piece("claude");
  assert.deepEqual(claude.requires, ["core"]);
  assert.equal(claude.sections, undefined);
  assert.deepEqual(
    renderedFiles("claude").sort(),
    AGENT_FILES.map((f) => `.claude/agents/${f}`),
  );
  for (const f of renderedFiles("claude")) {
    assert.deepEqual(overlaps(outputPath(f), claude.files), ["owned"], f);
  }
});

test("claude agents: same file set as hull base, frontmatter name/description/tools/model", () => {
  assert.deepEqual(
    readdirSync(join(REAL_TEMPLATE, "pieces/base/files/.claude/agents")).sort(),
    AGENT_FILES,
  );
  const want = {
    "explore.md": ["Explore", "haiku", "Read, Grep, Glob"],
    "implementer.md": ["implementer", "sonnet", "Read, Edit, Write, Bash, Grep, Glob"],
    "reviewer.md": ["reviewer", "opus", "Read, Grep, Glob, Bash"],
    "ci-fixer.md": ["ci-fixer", "sonnet", "Read, Edit, Write, Bash, Grep, Glob"],
  };
  for (const [file, [name, model, tools]] of Object.entries(want)) {
    const text = readFileSync(join(RIGGING, "pieces/claude/files/.claude/agents", file), "utf8");
    const fm = frontmatter(text);
    assert.equal(fm.name, name, file);
    assert.equal(fm.model, model, file);
    assert.equal(fm.tools, tools, file);
    assert.ok(fm.description, file);
    // Org-generic: no hull stack commands (pnpm/turbo/vp) in the channel's agents.
    assert.doesNotMatch(text, /\b(pnpm|turbo|vp) /, file);
  }
});

test("skills: multiple, target .{{ dir }}/skills, dir is claude or agents", () => {
  const skills = piece("skills");
  assert.equal(skills.multiple, true);
  assert.deepEqual(skills.requires, ["core"]);
  assert.equal(skills.target, ".{{ dir }}/skills");
  const re = new RegExp(skills.vars.dir.pattern);
  assert.equal(skills.vars.dir.pattern, "^(claude|agents)$");
  for (const ok of ["claude", "agents"]) assert.ok(re.test(ok));
  for (const bad of ["codex", "claude/x", "", "agents "]) assert.ok(!re.test(bad), bad);
  assert.equal(skills.vars.dir.default, undefined, "each instance names its harness");
});

test("skills: every skill is <name>/SKILL.md, owned, with name + description frontmatter", () => {
  const skills = piece("skills");
  const files = renderedFiles("skills");
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.match(f, /^[a-z][a-z0-9-]*\/SKILL\.md$/, f);
    assert.deepEqual(overlaps(f, skills.files), ["owned"], f);
    const fm = frontmatter(readFileSync(join(RIGGING, "pieces/skills/files", f), "utf8"));
    assert.equal(fm.name, f.split("/")[0], f);
    assert.ok(fm.description, f);
  }
});

test("skills never collide with a path hull's template renders (no claim conflict)", () => {
  const hullSkills = readdirSync(join(REAL_TEMPLATE, "pieces/base/files/.claude/skills"));
  for (const f of renderedFiles("skills")) {
    assert.ok(!hullSkills.includes(f.split("/")[0]), `${f} is also a hull skill`);
  }
});

test("sections: host and fragment end in .md(.jinja), fragment exists under files/", () => {
  for (const id of pieceIds()) {
    for (const [host, frag] of Object.entries(piece(id).sections ?? {})) {
      assert.match(host, /\.md$/, `${id}: ${host}`);
      assert.match(frag, /\.md(\.jinja)?$/, `${id}: ${frag}`);
      assert.ok(lstatSync(join(RIGGING, "pieces", id, "files", frag)).isFile(), frag);
    }
  }
});

test("no symlinks; portable paths; no {{ in files/ paths; at most one class per path", () => {
  for (const rel of walk(RIGGING)) {
    assert.ok(!lstatSync(join(RIGGING, rel)).isSymbolicLink(), `${rel} is a symlink`);
    assert.equal(pathProblem(rel.split("\\").join("/")), null, rel);
  }
  for (const id of pieceIds()) {
    for (const f of filesOf(id)) {
      assert.ok(!f.includes("{{"), `${id}: ${f}`);
      assert.ok(overlaps(outputPath(f), piece(id).files ?? {}).length <= 1, `${id}: ${f}`);
    }
  }
});

test("every .jinja (fragments included) passes the subset", () => {
  for (const id of pieceIds()) {
    for (const f of filesOf(id).filter((r) => r.endsWith(".jinja"))) {
      const src = join(RIGGING, "pieces", id, "files", f);
      assert.deepEqual(checkSubset(readFileSync(src, "utf8"), src), [], src);
    }
  }
});

test("core rules fragment: harness-neutral, names the agents only with claude", () => {
  const src = readFileSync(join(RIGGING, "pieces/core/files/sections/rules.md.jinja"), "utf8");
  const ctx = (pieces) => ({
    pieces,
    piece: { id: "core", name: "core" },
    template: { name: "rigging", version: "0.0.0" },
  });
  const plain = renderString(src, ctx(["core"]));
  const claude = renderString(src, ctx(["core", "claude"]));
  for (const out of [plain, claude]) {
    assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"), "ends in one newline");
    assert.ok(!/\n\n\n/.test(out));
    assert.ok(!/^@/m.test(out), "no @ imports (Codex does not resolve them)");
    assert.ok(!/<!-- splice:/.test(out), "no marker lines in the body");
    assert.match(out, /Test first/);
    assert.match(out, /never read `\.env\*`/);
    assert.ok(out.split("\n").length - 1 <= 12, "section stays short");
  }
  assert.ok(!/\.claude|Explore/.test(plain));
  assert.match(claude, /`\.claude\/agents`/);
  for (const a of ["Explore", "implementer", "reviewer", "ci-fixer"]) {
    assert.match(claude, new RegExp(`\`${a}\``));
  }
});
