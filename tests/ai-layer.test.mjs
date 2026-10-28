import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { REAL_TEMPLATE, lineCount, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const AGENTS_LIST = [
  ["Explore", "explore.md"],
  ["implementer", "implementer.md"],
  ["reviewer", "reviewer.md"],
  ["ci-fixer", "ci-fixer.md"],
];
const combosJson = loadCombos();
const COMBOS = [
  ...combosJson.combos.filter((c) => !c.scheduled && !c.template).map((c) => c.pieces),
  ["base", "docs"],
];
const comboVars = combosJson.vars ?? {};
const varsFor = (pieces) => ({
  ...comboVars,
  ...(pieces.includes("secrets") ? { context_prefix: "hullci" } : {}),
});
/** Always-loaded bytes ceiling: measured max 3,764 (web) plus 10 %, rounded up. */
const CEILING = 4150;

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

const agentsText = async (dir) => ({
  agents: await read(dir, "AGENTS.md"),
  claude: await read(dir, "CLAUDE.md"),
});

test("per combo: AGENTS.md <= 60, CLAUDE.md <= 20, together <= 80, no triple newline", async () => {
  for (const pieces of COMBOS) {
    const { dir } = await renderCombo(pieces, varsFor(pieces));
    const { agents, claude } = await agentsText(dir);
    assert.ok(lineCount(agents) <= 60, `${pieces} AGENTS.md ${lineCount(agents)}`);
    assert.ok(lineCount(claude) <= 20, `${pieces} CLAUDE.md ${lineCount(claude)}`);
    assert.ok(lineCount(agents) + lineCount(claude) <= 80, `${pieces} total`);
    assert.ok(!/\n\n\n/.test(agents), `${pieces} AGENTS.md has a triple newline`);
    assert.ok(!/\n\n\n/.test(claude), `${pieces} CLAUDE.md has a triple newline`);
  }
});

test("root AGENTS.md is seed (channels add sections to it); root CLAUDE.md stays owned", async () => {
  const { result } = await renderCombo(["base", "docs"]);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls["AGENTS.md"], "seed");
  assert.equal(cls["CLAUDE.md"], "owned");
});

test("CLAUDE.md lines 1-3 import AGENTS, project notes and index; docs.md is line 4 only with docs", async () => {
  for (const pieces of [["base"], ["base", "docs"]]) {
    const lines = (await read((await renderCombo(pieces)).dir, "CLAUDE.md")).split("\n");
    assert.deepEqual(lines.slice(0, 3), [
      "@AGENTS.md",
      "@docs/agents/project.md",
      "@docs/agents/index.md",
    ]);
    assert.equal(lines[3], pieces.includes("docs") ? "@docs/agents/docs.md" : "");
    assert.equal(lines.filter((l) => l.startsWith("@")).length, pieces.includes("docs") ? 4 : 3);
  }
});

test("AGENTS.md has no @ line and points to project notes and the index", async () => {
  for (const pieces of [["base"], ["base", "docs"]]) {
    const text = await read((await renderCombo(pieces)).dir, "AGENTS.md");
    assert.ok(!/^@/m.test(text));
    assert.match(text, /`docs\/agents\/project\.md`/);
    assert.match(text, /`docs\/agents\/index\.md`/);
  }
  const withDocs = await read((await renderCombo(["base", "docs"])).dir, "AGENTS.md");
  assert.match(withDocs, /`docs\/agents\/docs\.md`/);
  assert.ok(
    !/docs\/agents\/docs\.md/.test(await read((await renderCombo(["base"])).dir, "AGENTS.md")),
  );
});

test("AGENTS.md commands block lists install, check, run ci, format and agents:index", async () => {
  const text = await read((await renderCombo(["base"])).dir, "AGENTS.md");
  const block = /```bash\n([\s\S]*?)\n```/.exec(text)[1].split("\n");
  const cmds = block.map((l) => l.split("#")[0].trim());
  assert.deepEqual(cmds, [
    "pnpm install",
    "pnpm check",
    "pnpm run ci",
    "pnpm format",
    "pnpm agents:index",
  ]);
});

test("AGENTS.md rules: secrets, releases, parallel agents, ask becomes deny", async () => {
  const text = await read((await renderCombo(["base"])).dir, "AGENTS.md");
  assert.match(text, /never read `\.env\*` or `\.dev\.vars`/);
  assert.match(text, /Releases are tag pushes made by a human/);
  assert.match(text, /At most 2-3 parallel agents/);
  assert.match(text, /hook `ask` becomes a denial in `-p`\/unattended runs/);
});

test("AGENTS.md sends local notes to project.md or a package AGENTS.md, not CLAUDE.md", async () => {
  const text = await read((await renderCombo(["base"])).dir, "AGENTS.md");
  assert.match(
    text,
    /put local changes in seed files, `docs\/agents\/project\.md` or a package's\n {2}`AGENTS\.md`\./,
  );
  assert.ok(!/below the import/.test(text));
});

const RIGGING_AGENTS = join(REAL_TEMPLATE, "../rigging/pieces/claude/files/.claude/agents");

test("base ships no .claude/agents: subagents come from rigging's claude piece", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  assert.ok(!existsSync(join(dir, ".claude/agents")));
  for (const [name, file] of AGENTS_LIST) {
    assert.equal(frontmatter(readFileSync(join(RIGGING_AGENTS, file), "utf8")).name, name, file);
  }
});

test("migration 0.2.0 removes base's four agent files", async () => {
  const { parse } = await import("smol-toml");
  const m = parse(readFileSync(join(REAL_TEMPLATE, "migrations/0.2.0.toml"), "utf8"));
  assert.deepEqual(
    m.remove.map((r) => [r.path, r.piece]),
    AGENTS_LIST.map(([, file]) => [`.claude/agents/${file}`, "base"]),
  );
  assert.equal(m.step, undefined, "not a step: steps run before the main lock is written");
});

// `explorer.md` shipped from 2026-10-14 to 10-17 (88a9409 → renamed in 5ba172a), before any tag,
// so no splice lock tracks it and a [[remove]] keeps it ("not tracked in the lock"): a step.
const EXPLORER_BLOB = "ad17ec0f7072cdef5051c8f5ccafc875cec54f51"; // the only version hull shipped

test("migration 0.2.1 removes the pre-0.1.0 explorer.md, unedited copies only", async () => {
  const { parse } = await import("smol-toml");
  const m = parse(readFileSync(join(REAL_TEMPLATE, "migrations/0.2.1.toml"), "utf8"));
  assert.equal(m.remove, undefined, "a [[remove]] of an untracked file only reports it");
  assert.equal(m.step.length, 1);
  const fixture = fileURLToPath(new URL("./fixtures/explorer/explorer.md", import.meta.url));
  const hash = spawnSync("git", ["hash-object", fixture], { encoding: "utf8" });
  assert.equal(hash.stdout.trim(), EXPLORER_BLOB, "the fixture is the copy hull shipped");
  const shipped = readFileSync(fixture, "utf8");
  const runIn = async (content, env = process.env) => {
    const dir = await mkdtemp(join(tmpdir(), "hull-mig-"));
    await mkdir(join(dir, ".claude/agents"), { recursive: true });
    if (content !== undefined) await writeFile(join(dir, ".claude/agents/explorer.md"), content);
    const r = spawnSync("/bin/sh", ["-c", m.step[0].run], { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return { kept: existsSync(join(dir, ".claude/agents/explorer.md")), stderr: r.stderr };
  };
  assert.deepEqual(await runIn(shipped), { kept: false, stderr: "" }, "unedited copy is deleted");
  const edited = await runIn(`${shipped}\nmy note\n`);
  assert.ok(edited.kept && /kept edited/.test(edited.stderr), "edited copy is kept and reported");
  assert.deepEqual(await runIn(undefined), { kept: false, stderr: "" }, "no copy: still succeeds");
  const noGit = await runIn(shipped, {
    ...process.env,
    PATH: await mkdtemp(join(tmpdir(), "nogit-")),
  });
  assert.ok(noGit.kept && /cannot check/.test(noGit.stderr), "without git: kept, says why");
});

// CLAUDE.md is owned: whoever reads its current text already ran `splice update`, and the template
// cannot see whether a channel was added, so the hint is conditional in prose and never stale.
test("CLAUDE.md: add the rigging channel if .claude/agents lacks the subagents", async () => {
  const text = await read((await renderCombo(["base"])).dir, "CLAUDE.md");
  assert.doesNotMatch(text, /splice update/, "upgrade order lives in hull's README/CHANGELOG");
  assert.match(
    text,
    /if `\.claude\/agents\/`\s+lacks them: `splice channel add gh:keelstackhq\/hull\/\/rigging --piece claude`/,
  );
  for (const [name] of AGENTS_LIST) assert.match(text, new RegExp(`\`${name}\``));
});

test("Explore (rigging): haiku, read-only tools, use proactively", async () => {
  const fm = frontmatter(readFileSync(join(RIGGING_AGENTS, "explore.md"), "utf8"));
  assert.equal(fm.name, "Explore");
  assert.equal(fm.model, "haiku");
  assert.equal(fm.tools, "Read, Grep, Glob");
  assert.match(fm.description, /use proactively/i);
});

test("no 'explorer' in rendered .claude/, AGENTS.md or CLAUDE.md", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  for (const f of [...walk(join(dir, ".claude")), join(dir, "AGENTS.md"), join(dir, "CLAUDE.md")]) {
    assert.ok(!/explorer/i.test(readFileSync(f, "utf8")), f);
  }
});

test("piece bullets sit under ## Pieces in AGENTS.md with no blank lines between items", async () => {
  const { dir } = await renderCombo(["base", "preact-app", "ui-storybook", "astro-site:site"]);
  const text = await read(dir, "AGENTS.md");
  assert.match(
    text,
    /\n## Pieces\n\n- `apps\/\*` \(preact-app\)[^\n]*\n- `packages\/ui`[^\n]*\n- `apps\/\*` \(astro-site\)[^\n]*\n\n## /,
  );
  assert.ok(!/## Pieces/.test(await read((await renderCombo(["base"])).dir, "AGENTS.md")));
  assert.ok(!/## Pieces/.test(await read(dir, "CLAUDE.md")));
});

test("every piece id except base, docs and secrets has a branch in both Pieces chains and one bullet", () => {
  const ids = readdirSync(join(REAL_TEMPLATE, "pieces")).filter(
    (i) => i !== "base" && i !== "docs" && i !== "secrets",
  );
  const src = readFileSync(join(REAL_TEMPLATE, "pieces/base/files/AGENTS.md.jinja"), "utf8");
  const [, heading, rest] = /same-branches #\}([\s\S]*?)\{% endif %\}([\s\S]*)/.exec(src);
  const [bullets, trailing] = rest.split("{# same-branches #}");
  for (const id of ids) {
    const re = new RegExp(`\\{% (?:el)?if "${id}" in pieces %\\}`, "g");
    assert.equal(heading.match(re)?.length, 1, `${id} in heading chain`);
    assert.equal(trailing.match(re)?.length, 1, `${id} in trailing chain`);
    assert.equal(bullets.match(re)?.length, 1, `${id} bullet`);
  }
});

test("always-loaded bytes per combo (AGENTS + CLAUDE + project + index) stay under the ceiling", async () => {
  for (const pieces of COMBOS) {
    const { dir } = await renderCombo(pieces, varsFor(pieces));
    const idx = spawnSync("node", ["scripts/agents-index.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(idx.status, 0, `${pieces}: ${idx.stderr}`);
    let bytes = 0;
    for (const f of ["AGENTS.md", "CLAUDE.md", "docs/agents/project.md", "docs/agents/index.md"]) {
      bytes += Buffer.byteLength(await read(dir, f));
    }
    assert.ok(bytes <= CEILING, `${pieces}: ${bytes} bytes`);
  }
});

test("settings.json is valid and wires hooks", async () => {
  const { dir } = await renderCombo(["base"]);
  const s = JSON.parse(await read(dir, ".claude/settings.json"));
  assert.equal(s.model, "opusplan");
  assert.equal(s.hooks.SessionStart[0].matcher, "startup|resume");
  assert.equal(s.hooks.SessionStart[0].hooks[0].type, "command");
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /bash .*session-start\.sh/);
  assert.match(s.hooks.Stop[0].hooks[0].command, /bash .*stop-checks\.sh/);
  assert.equal(
    s.hooks.PreToolUse[0].matcher,
    "Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit",
  );
  assert.equal(
    s.hooks.PreToolUse[0].hooks[0].command,
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"',
  );
  assert.equal(s.hooks.PreToolUse[0].hooks[0].timeout, 10);
  assert.equal(s.enabledPlugins["superpowers@superpowers-marketplace"], true);
  assert.equal(s.enabledPlugins["caveman@akramsystems-plugins"], true);
  assert.deepEqual(s.extraKnownMarketplaces["superpowers-marketplace"].source, {
    source: "github",
    repo: "obra/superpowers-marketplace",
  });
  assert.deepEqual(s.extraKnownMarketplaces["akramsystems-plugins"].source, {
    source: "github",
    repo: "akramsystems/caveman",
  });
  assert.ok(s.permissions.deny.some((d) => /push \*?--force/.test(d)));
  assert.ok(s.permissions.deny.some((d) => d.includes(".env")));
  assert.ok(s.permissions.allow.includes("Bash(pnpm:*)"));
  assert.equal(s.statusLine, undefined, "statusLine is opt-in");
});

test("docs-lookup skill absent without docs piece", async () => {
  const without = await renderCombo(["base"]);
  assert.ok(!existsSync(join(without.dir, ".claude/skills/docs-lookup/SKILL.md")));
  const withDocs = await renderCombo(["base", "docs"]);
  const fm = frontmatter(await read(withDocs.dir, ".claude/skills/docs-lookup/SKILL.md"));
  assert.equal(fm.name, "docs-lookup");
});

test("hook scripts pass bash -n", async () => {
  const { dir } = await renderCombo(["base"]);
  for (const f of ["hooks/session-start.sh", "hooks/stop-checks.sh", "statusline.sh"]) {
    const r = spawnSync("bash", ["-n", join(dir, ".claude", f)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("stop-checks exits 0 when HULL_STOP_CHECKS is unset", async () => {
  const { dir } = await renderCombo(["base"]);
  const { HULL_STOP_CHECKS: _drop, ...env } = process.env;
  const r = spawnSync("bash", [join(dir, ".claude/hooks/stop-checks.sh")], {
    cwd: dir,
    env,
    input: "{}",
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
});

test("stop-checks exits 0 when stop_hook_active is true", async () => {
  const { dir } = await renderCombo(["base"]);
  const r = spawnSync("bash", [join(dir, ".claude/hooks/stop-checks.sh")], {
    cwd: dir,
    env: { ...process.env, HULL_STOP_CHECKS: "1", PATH: "/usr/bin:/bin" },
    input: '{"stop_hook_active": true}',
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
});

test("session-start exits 0 even when pnpm is missing", async () => {
  const { dir } = await renderCombo(["base"]);
  const r = spawnSync("/bin/bash", [join(dir, ".claude/hooks/session-start.sh")], {
    cwd: dir,
    env: { PATH: "/nonexistent", CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split("\n").length, 1);
});

test("session-start runs repo-local hooks in session-start.d and survives their failure", async () => {
  const { dir } = await renderCombo(["base"]);
  const d = join(dir, ".claude/hooks/session-start.d");
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "a-ok.sh"), 'echo "local: ran"\n: > "$CLAUDE_PROJECT_DIR/ran-a"\n');
  await writeFile(join(d, "b-fails.sh"), "exit 7\n");
  const r = spawnSync("/bin/bash", [join(dir, ".claude/hooks/session-start.sh")], {
    cwd: dir,
    env: { PATH: "/nonexistent", CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(dir, "ran-a")));
  assert.match(r.stdout, /local: ran/);
  assert.match(r.stdout, /session-start: /);
});

test("statusline prints model, context and cost from stdin JSON", async () => {
  const { dir } = await renderCombo(["base"]);
  const r = spawnSync("bash", [join(dir, ".claude/statusline.sh")], {
    input: JSON.stringify({
      model: { display_name: "Opus" },
      context_window: { used_percentage: 8 },
      cost: { total_cost_usd: 0.01234 },
    }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Opus/);
  assert.match(r.stdout, /8%/);
  assert.match(r.stdout, /\$0\.01/);
});

test("skills have name and description frontmatter", async () => {
  const { dir } = await renderCombo(["base", "docs"]);
  for (const s of ["verify", "add-piece", "docs-lookup"]) {
    const fm = frontmatter(await read(dir, `.claude/skills/${s}/SKILL.md`));
    assert.equal(fm.name, s);
    assert.ok(fm.description, s);
  }
  assert.match(await read(dir, ".claude/loop.md"), /verify/);
});

test("no template file runs `pnpm ci` (pnpm's built-in clean install)", async () => {
  const walk = async (d) =>
    (
      await Promise.all(
        (await readdir(d, { withFileTypes: true })).map((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        ),
      )
    ).flat();
  for (const f of await walk(REAL_TEMPLATE)) {
    assert.ok(!/pnpm ci\b/.test(await readFile(f, "utf8")), f);
  }
});

test("settings deny publish and force pushes, hooks have timeouts", async () => {
  const { dir } = await renderCombo(["base"]);
  const s = JSON.parse(await read(dir, ".claude/settings.json"));
  for (const d of ["pnpm publish", "npm publish", "cargo publish"]) {
    assert.ok(s.permissions.deny.includes(`Bash(${d}:*)`), d);
  }
  const deny = s.permissions.deny.join("\n");
  for (const f of ["--force", "-f", "+"])
    assert.ok(deny.includes(`git push`) && deny.includes(f), f);
  assert.ok(!s.permissions.allow.some((a) => a.includes("splice")));
  assert.equal(s.hooks.SessionStart[0].hooks[0].timeout, 120);
  assert.equal(s.hooks.Stop[0].hooks[0].timeout, 120);
});

test("rendered .gitignore keeps secrets out but .env.example in", async () => {
  const { dir } = await renderCombo(["base"]);
  const lines = (await read(dir, ".gitignore")).split("\n");
  for (const l of [".env*", "!.env.example", ".dev.vars"]) assert.ok(lines.includes(l), l);
});

test("statusline without jq does not fabricate model or cost", async () => {
  const { dir } = await renderCombo(["base"]);
  // A PATH with the basic tools but no jq.
  const bin = await mkdtemp(join(tmpdir(), "hull-bin-"));
  for (const t of ["sed", "head", "cat", "cut"]) {
    const found = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim();
    await symlink(found, join(bin, t));
  }
  const r = spawnSync("/bin/bash", [join(dir, ".claude/statusline.sh")], {
    env: { PATH: bin },
    input: JSON.stringify({
      model: { display_name: "Opus" },
      context_window: { used_percentage: 8 },
    }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Opus/);
  assert.match(r.stdout, /8%/);
  assert.match(r.stdout, /\$\?/);
});

test("verify skill runs the index check first and says pnpm run ci does not", async () => {
  const { dir } = await renderCombo(["base"]);
  const text = await read(dir, ".claude/skills/verify/SKILL.md");
  assert.match(text, /node scripts\/agents-index\.mjs --check/);
  assert.match(text, /`pnpm run ci` does not run this check \(it is not a turbo task\); CI does/);
  assert.ok(text.indexOf("agents-index.mjs --check") < text.indexOf("pnpm turbo run"));
});

test("all pieces together: AGENTS.md + CLAUDE.md <= 80 lines, index <= 8192 bytes", async () => {
  const { dir } = await renderCombo(
    [
      "base",
      "preact-app:web",
      "ui-storybook",
      "astro-site:site",
      "hono-worker:api",
      "rust-tool:tool",
      "tauri-app:desktop",
      "docs",
      "ts-lib:lib",
      "rust-cli:cli",
      "npm-cli:npm",
    ],
    { ...comboVars, crate: "cli" },
  );
  const { agents, claude } = await agentsText(dir);
  assert.ok(
    lineCount(agents) + lineCount(claude) <= 80,
    `${lineCount(agents)}+${lineCount(claude)}`,
  );
  const { buildIndex } = await import(
    join(REAL_TEMPLATE, "pieces/base/files/scripts/agents-index.mjs")
  );
  assert.ok(Buffer.byteLength(buildIndex(dir)) <= 8192);
});
