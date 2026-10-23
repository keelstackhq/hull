import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// bosun's channel (keelstackhq/bosun channel/pieces/core) cannot own .claude/settings.json in a
// hull repo, so hull's settings carry its two hooks, guarded to a no-op unless the repo uses bosun.
const SETTINGS = ["template", "template-rust"].map((t) =>
  fileURLToPath(new URL(`../${t}/pieces/base/files/.claude/settings.json`, import.meta.url)),
);
const BOSUN_PRE_MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__github__.*";
const guarded = (sub) =>
  `if [ -f "\${CLAUDE_PROJECT_DIR:-.}/.bosun/bosun.toml" ] && command -v bosun >/dev/null 2>&1; then exec bosun hook ${sub}; fi`;

const bosunEntries = (s) => ({
  pre: s.hooks.PreToolUse.filter((e) => e.hooks.some((h) => /bosun hook/.test(h.command))),
  start: s.hooks.SessionStart.filter((e) => e.hooks.some((h) => /bosun hook/.test(h.command))),
});

test("both templates' settings.json carry bosun's two hooks with bosun's matchers", async () => {
  for (const f of SETTINGS) {
    const s = JSON.parse(await readFile(f, "utf8"));
    const { pre, start } = bosunEntries(s);
    assert.equal(pre.length, 1, f);
    assert.equal(pre[0].matcher, BOSUN_PRE_MATCHER, f);
    assert.deepEqual(pre[0].hooks, [
      { type: "command", command: guarded("pre-tool-use"), timeout: 120 },
    ]);
    assert.equal(start.length, 1, f);
    assert.equal(start[0].matcher, undefined, `${f}: bosun's SessionStart has no matcher`);
    assert.deepEqual(start[0].hooks, [
      { type: "command", command: guarded("session-start"), timeout: 120 },
    ]);
    // hull's own hooks stay first
    assert.match(s.hooks.PreToolUse[0].hooks[0].command, /guard\.mjs/);
    assert.match(s.hooks.SessionStart[0].hooks[0].command, /session-start\.sh/);
  }
});

/** Run a hook command the way Claude Code does (a shell, hook JSON on stdin). */
async function scenario({ bosun, toml }) {
  const root = await mkdtemp(join(tmpdir(), "hull-bosun-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const log = join(root, "called.log");
  if (bosun) {
    // a fake bosun: records its args and stdin, exits 2 (a block) so the exit code must pass through
    await writeFile(
      join(bin, "bosun"),
      `#!/bin/sh\necho "args: $*" > "${log}"\ncat >> "${log}"\nexit 2\n`,
    );
    await chmod(join(bin, "bosun"), 0o755);
  }
  if (toml) {
    await mkdir(join(root, ".bosun"));
    await writeFile(join(root, ".bosun/bosun.toml"), "");
  }
  const run = (cmd) =>
    spawnSync("bash", ["-c", cmd], {
      cwd: root,
      input: '{"hook_event_name":"PreToolUse"}',
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: root },
    });
  const read = () => readFile(log, "utf8").catch(() => null);
  return { run, read };
}

test("guard: a no-op (exit 0, silent, bosun not run) unless bosun is installed AND .bosun/bosun.toml exists", async () => {
  for (const sub of ["pre-tool-use", "session-start"]) {
    for (const c of [
      { bosun: false, toml: false },
      { bosun: false, toml: true },
      { bosun: true, toml: false },
    ]) {
      const { run, read } = await scenario(c);
      const r = run(guarded(sub));
      assert.equal(r.status, 0, `${sub} ${JSON.stringify(c)}: ${r.stderr}`);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, "");
      assert.equal(await read(), null, "bosun must not run");
    }
  }
});

test("guard: with bosun and .bosun/bosun.toml, bosun runs with the hook input and its exit code", async () => {
  const { run, read } = await scenario({ bosun: true, toml: true });
  const r = run(guarded("pre-tool-use"));
  assert.equal(r.status, 2, "a bosun block (exit 2) must reach Claude Code");
  assert.equal(await read(), 'args: hook pre-tool-use\n{"hook_event_name":"PreToolUse"}');
});
