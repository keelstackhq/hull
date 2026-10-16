import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const AGENTS = ["explorer", "implementer", "reviewer", "ci-fixer"];

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

const agentFm = async (dir, name) => frontmatter(await read(dir, `.claude/agents/${name}.md`));

test("piece bullets sit under a Pieces heading and no blank lines between items", async () => {
  const { dir } = await renderCombo(["base", "preact-app", "ui-storybook", "astro-site:site"]);
  const text = await read(dir, "CLAUDE.md");
  assert.match(
    text,
    /\n## Pieces\n\n- `apps\/\*` \(preact-app\)[^\n]*\n- `packages\/ui`[^\n]*\n- `apps\/\*` \(astro-site\)[^\n]*\n\n## /,
  );
  assert.ok(!/## Pieces/.test(await read((await renderCombo(["base"])).dir, "CLAUDE.md")));
});

test("CLAUDE.md ≤ 80 lines and imports project notes", async () => {
  for (const pieces of [["base"], ["base", "docs"]]) {
    const { dir } = await renderCombo(pieces);
    const text = await read(dir, "CLAUDE.md");
    assert.ok(text.split("\n").length <= 80, `${pieces} has ${text.split("\n").length} lines`);
    assert.match(text, /^@docs\/agents\/project\.md$/m);
    assert.match(text, /pnpm check/);
    assert.match(text, /pnpm run ci/);
    assert.equal(/^@docs\/agents\/docs\.md$/m.test(text), pieces.includes("docs"));
  }
});

test("AGENTS.md points to CLAUDE.md", async () => {
  const { dir } = await renderCombo(["base"]);
  assert.match(await read(dir, "AGENTS.md"), /CLAUDE\.md/);
});

test("agents have name/description/tools/model with the routing table", async () => {
  const { dir } = await renderCombo(["base"]);
  const fms = Object.fromEntries(
    await Promise.all(AGENTS.map(async (a) => [a, await agentFm(dir, a)])),
  );
  for (const a of AGENTS) {
    assert.equal(fms[a].name, a);
    assert.ok(fms[a].description && fms[a].tools && fms[a].model, a);
  }
  const models = Object.fromEntries(AGENTS.map((a) => [a, fms[a].model]));
  assert.deepEqual(models, {
    explorer: "haiku",
    implementer: "sonnet",
    reviewer: "opus",
    "ci-fixer": "sonnet",
  });
  assert.match(fms.explorer.description, /use proactively/i);
  assert.ok(!/Edit|Write/.test(fms.reviewer.tools));
  assert.ok(!/Edit|Write|Bash/.test(fms.explorer.tools));
});

test("settings.json is valid and wires hooks", async () => {
  const { dir } = await renderCombo(["base"]);
  const s = JSON.parse(await read(dir, ".claude/settings.json"));
  assert.equal(s.model, "opusplan");
  assert.equal(s.hooks.SessionStart[0].matcher, "startup|resume");
  assert.equal(s.hooks.SessionStart[0].hooks[0].type, "command");
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /bash .*session-start\.sh/);
  assert.match(s.hooks.Stop[0].hooks[0].command, /bash .*stop-checks\.sh/);
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

test("rendered CLAUDE.md has no consecutive blank lines", async () => {
  for (const r of [await renderCombo(["base"]), await renderCombo(["base", "docs"])]) {
    assert.ok(!/\n\n\n/.test(await read(r.dir, "CLAUDE.md")));
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
