import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  commands,
  decide,
  ownedPaths,
  targetPath,
} from "../template/pieces/base/files/.claude/hooks/guard.mjs";
import { renderCombo } from "./helpers.mjs";

const GUARD = fileURLToPath(
  new URL("../template/pieces/base/files/.claude/hooks/guard.mjs", import.meta.url),
);
const LOCK = fileURLToPath(new URL("./fixtures/lock/owned.toml", import.meta.url));
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const tool = (tool_name, tool_input) => ({ tool_name, tool_input });
const ctx = { projectDir: "/r" };

const DENY = [
  "npm publish",
  "pnpm publish --access public",
  "yarn publish",
  "bun publish",
  "npm unpublish x",
  "npm dist-tag add x@1 latest",
  "cargo publish",
  "changeset publish",
  "gh release create v1",
  "gh release upload v1 a.tgz",
  "FOO=1 pnpm publish",
  "env A=b npm publish",
  "sudo npm publish",
  "npx npm publish",
  "pnpm exec changeset publish",
  "bash -c 'npm publish'",
  "ls && npm publish",
  "git push -f",
  "git push --force origin main",
  "git push --force-with-lease",
  "git push --force-if-includes",
  "git push origin +main",
  "git -C . push -f",
  "git -c a=b push --force",
  "git --git-dir=.git push -f",
  "git push --tags",
  "git push --follow-tags",
  "git push origin cli-v1.2.0",
  "git push origin refs/tags/x",
  "cat .env",
  "cat apps/api/.env.local",
  "grep KEY .dev.vars",
  "echo x > .splice/lock.toml",
  "sed -i s/a/b/ .splice/lock.toml",
  "{ npm publish; }",
  "if true; then npm publish; fi",
  "timeout 60 npm publish",
  "exec npm publish",
  "xargs npm publish",
  "nice npm publish",
  "nice -n 5 npm publish",
  "sudo -u bob npm publish",
  "! npm publish",
  "git push --mirror",
];
const ALLOW = [
  "grep -r publish docs",
  "git push origin main",
  "git push",
  "cat .env.example",
  "cat .env.sample",
  "cat .env.template",
  "cat .dev.vars.example",
  "echo .envrc-notes",
  "pnpm run ci",
  "cargo test",
];
for (const c of DENY) {
  test(`deny: ${c}`, () => assert.equal(decide(bash(c), ctx)?.decision, "deny"));
}
for (const c of ALLOW) {
  test(`allow: ${c}`, () => assert.equal(decide(bash(c), ctx), null));
}

test("secret files: Read file_path, Grep path and glob, Glob pattern deny; .env.example allowed", () => {
  assert.equal(decide(tool("Read", { file_path: "/r/.env" }), ctx).decision, "deny");
  assert.equal(
    decide(tool("Grep", { pattern: "KEY", path: "/r/apps/api/.dev.vars" }), ctx).decision,
    "deny",
  );
  assert.equal(decide(tool("Grep", { pattern: "KEY", glob: ".env*" }), ctx).decision, "deny");
  assert.equal(decide(tool("Glob", { pattern: "**/.env.local" }), ctx).decision, "deny");
  assert.equal(decide(tool("Read", { file_path: "/r/.env.example" }), ctx), null);
});

test("Edit/Write/MultiEdit/NotebookEdit on .splice/lock.toml deny with 'only splice writes the lock'", () => {
  for (const [name, input] of [
    ["Edit", { file_path: "/r/.splice/lock.toml" }],
    ["Write", { file_path: "/r/.splice/lock.toml" }],
    ["MultiEdit", { file_path: ".splice/lock.toml" }],
    ["NotebookEdit", { notebook_path: "/r/.splice/lock.toml" }],
  ]) {
    const d = decide(tool(name, input), ctx);
    assert.equal(d.decision, "deny", name);
    assert.match(d.reason, /only splice writes the lock/, name);
  }
});

test("targetPath is file_path ?? notebook_path ?? path", () => {
  assert.equal(targetPath({ file_path: "a", notebook_path: "b", path: "c" }), "a");
  assert.equal(targetPath({ notebook_path: "b", path: "c" }), "b");
  assert.equal(targetPath({ path: "c" }), "c");
  assert.equal(targetPath({}), undefined);
});

test("commands strips prefixes and splits on separators", () => {
  assert.deepEqual(commands("FOO=1 sudo env A=b pnpm exec changeset publish; ls -a | wc"), [
    ["changeset", "publish"],
    ["ls", "-a"],
    ["wc"],
  ]);
  assert.deepEqual(commands("bash -c 'npm publish && echo hi'"), [
    ["bash", "-c", "npm publish && echo hi"],
    ["npm", "publish"],
    ["echo", "hi"],
  ]);
});

test("owned edit asks; seed edit and no lock allow", () => {
  const lockText = readFileSync(LOCK, "utf8");
  const edit = (p) => tool("Edit", { file_path: p });
  const c = { lockText, projectDir: "/r" };
  assert.deepEqual([...ownedPaths(lockText)].sort(), [
    "apps/web/notes.ipynb",
    "apps/web/vite.config.ts",
  ]);
  assert.equal(decide(edit("/r/apps/web/vite.config.ts"), c).decision, "ask");
  assert.match(decide(edit("/r/apps/web/vite.config.ts"), c).reason, /splice update/);
  assert.equal(decide(edit("/r/apps/web/src/app.tsx"), c), null);
  assert.equal(decide(edit("/r/README.md"), c), null);
  assert.equal(decide(edit("/r/apps/web/vite.config.ts"), { projectDir: "/r" }), null);
});

test("NotebookEdit reads notebook_path: owned notebook asks", () => {
  const c = { lockText: readFileSync(LOCK, "utf8"), projectDir: "/r" };
  const nb = tool("NotebookEdit", { notebook_path: "/r/apps/web/notes.ipynb", new_source: "x" });
  assert.equal(decide(nb, c).decision, "ask");
});

test("every deny reason says what to do instead", () => {
  assert.match(decide(bash("npm publish"), ctx).reason, /release\.yml/);
  assert.match(decide(bash("git push -f"), ctx).reason, /without --force/);
  assert.match(decide(bash("git push --tags"), ctx).reason, /a tag push publishes/);
  assert.match(decide(bash("cat .env"), ctx).reason, /\.env\.example/);
  assert.match(
    decide(bash("echo x > .splice/lock.toml"), ctx).reason,
    /only splice writes the lock/,
  );
});

const run = (input, env = {}) =>
  spawnSync("node", [GUARD], {
    input,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });

test("CLI: deny prints hookSpecificOutput JSON and exits 0", () => {
  const r = run(JSON.stringify(bash("git -C . push -f")), { CLAUDE_PROJECT_DIR: "/r" });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /without --force/);
  assert.equal(r.stderr, "");
});

test("CLI: malformed stdin, empty stdin, unknown tool → exit 0, empty stdout, exactly 1 stderr line", () => {
  for (const input of ["{not json", "", JSON.stringify(tool("Mystery", {}))]) {
    const r = run(input, { CLAUDE_PROJECT_DIR: "/r" });
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, "", input);
    if (input === JSON.stringify(tool("Mystery", {}))) {
      assert.equal(r.stderr, "", "unknown tool is a plain allow");
    } else {
      assert.equal(r.stderr.split("\n").filter(Boolean).length, 1, input);
    }
  }
});

test("guard imports only node: built-ins", () => {
  const src = readFileSync(GUARD, "utf8");
  const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.match(s, /^node:/);
});

test("rendered base tree contains .github/workflows/release.yml, the file the guard's publish reason names", async () => {
  const { reason } = decide(bash("npm publish"), ctx);
  const named = /\(([a-z]+\.yml)\)/.exec(reason)?.[1];
  assert.equal(named, "release.yml");
  const { dir, result } = await renderCombo(["base"]);
  const c = result.changes.find((x) => x.path === `.github/workflows/${named}`);
  assert.equal(c?.class, "owned");
  assert.match(readFileSync(join(dir, ".github/workflows", named), "utf8"), /^name: release$/m);
});
