import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  "git push origin refs/tags/cli-v1.2.0",
  "git push origin tag cli-v1.2.0",
  "git push origin HEAD:refs/tags/x",
  "git tag v1.0.0",
  "git tag -a v1.0.0 -m x",
  "git tag -d v1.0.0",
  "bash <<EOF\nnpm publish\nEOF",
  "cat <<EOF > x\nhi\nEOF\nnpm publish",
  "cat .env <<EOF\nx\nEOF",
  'cat ".env"',
  "git update-ref refs/tags/v1 HEAD",
  "git update-ref -d refs/tags/v1",
  "git update-ref --stdin",
  "gh api -X POST repos/o/r/pulls/5/merge",
  "gh api repos/o/r/pulls/5/merge --method PUT",
  "gh api --method=DELETE repos/o/r/git/refs/tags/v1",
  "gh api -XPATCH repos/o/r/pulls/5",
  "gh api repos/o/r/issues -f title=x",
  "gh api repos/o/r/issues -F body=@f",
  "gh api repos/o/r/issues --field a=b",
  "gh api repos/o/r/issues --raw-field a=b",
  "gh api repos/o/r/issues --input body.json",
  "gh api repos/o/r/pulls/5 -X put",
  "gh api graphql -f query='mutation { x }'",
  "gh api graphql --input q.json",
  "python3 <<EOF\nprint(open('.env').read())\nEOF",
  "node <<'EOF'\nrequire('fs').readFileSync('apps/api/.dev.vars')\nEOF",
  "ruby <<EOF\nFile.read('.env.local')\nEOF",
  "perl <<EOF\nopen(F, '<.env')\nEOF",
  'bash -c "cat .env"',
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
  "/usr/bin/npm publish",
  "./node_modules/.bin/pnpm publish",
  "(npm publish)",
  "(git push -f)",
  "{ git push -f;}",
  "env -u FOO npm publish",
  "env --unset=FOO npm publish",
  "env --unset FOO npm publish",
  "env -C /tmp npm publish",
  "env --chdir /tmp npm publish",
  "env --chdir=/tmp npm publish",
  "env -S 'npm publish'",
  "git push origin :main",
  "git push origin :master",
  "git push origin :refs/heads/main",
  "git push --delete origin main",
  "git push -d origin master",
  "git push origin --delete main",
];
// Audit round: each of these was an ALLOW before and must now deny.
const DENY2 = [
  // G1 gh admin verbs
  "gh pr merge 5",
  "gh pr merge 5 --admin",
  "gh pr merge 5 --auto --admin",
  "gh pr merge 5 --squash",
  "gh release delete v1",
  "gh release edit v1",
  "gh workflow run release.yml",
  "gh workflow run release.yml -f x=1",
  "gh secret set X",
  "gh secret list",
  "gh repo edit --visibility public",
  "gh repo delete o/r --yes",
  "gh api -X PUT repos/o/r/branches/main/protection",
  "gh api repos/o/r/rulesets -X POST --input r.json",
  // G2 release as publish
  "pnpm run release",
  "npm run release",
  "pnpm release",
  "cargo release patch",
  "make publish",
  "make release",
  // G3 evasions
  "GIT=git; $GIT push -f",
  'eval "git push -f"',
  'echo "git push -f" | sh',
  'echo "git push -f" | bash -s',
  "python -c \"import os; os.system('git push --force')\"",
  "python3 -c 'import os; os.system(\"npm publish\")'",
  "node -e \"require('child_process').execSync('git push -f')\"",
  "ruby -e 'system(\"git push -f\")'",
  "perl -e 'system(q(npm publish))'",
  "git -c alias.p=push p -f",
  "git -c alias.p='!git push -f' p",
  "setsid git push -f",
  "ionice -c 3 git push -f",
  "stdbuf -oL git push -f",
  "watch -n 1 git push -f",
  "watch 'git push -f'",
  "busybox git push -f",
  "X=push; git $X -f",
  "$(echo git) push -f",
  // G3b default branch
  "git push origin main",
  "git push origin HEAD:main",
  "git push origin HEAD:master",
  "git push origin refs/heads/x:refs/heads/main",
  "git push -u origin main",
  "git push --prune origin",
  "git branch -D main",
  "git branch -d master",
  "git branch --delete main",
  "git branch -f main HEAD",
  "git branch -M main",
  // G4 secrets
  "cat prod.env",
  "cat .envrc",
  "cat server.pem",
  "cat ~/.ssh/id_ed25519",
  "cat id_rsa",
  "cat keys.txt",
  "ls ~/.aws",
  "cat ~/.aws/credentials",
  "cat ~/.config/gh/hosts.yml",
  "cat .age/key",
  "cat /proc/self/environ",
  "cat /proc/1/environ",
  "printenv",
  "env",
  "env -i",
  "printenv API_KEY",
  "echo $API_KEY",
  'echo "$GITHUB_TOKEN"',
  "echo ${AWS_SECRET_ACCESS_KEY}",
  "printf '%s' $DB_PASSWORD",
  "export -p",
  "declare -x",
  "sops -d secrets.yaml",
  "sops decrypt secrets.yaml",
  "sops --decrypt a.enc.yaml",
  "age -d -i key.txt a.age",
  "age --decrypt a.age",
  "hoist secrets exec -- env",
  "hoist secrets exec -- printenv",
  "hoist secrets exec --env prod -- sh -c 'echo $X'",
  "hoist secrets exec -- bash",
  // G5b protected writes
  "rm .claude/hooks/guard.mjs",
  "rm -rf .claude/hooks",
  "sed -i s/a/b/ .claude/settings.json",
  "echo {} > .claude/settings.local.json",
  "tee .github/workflows/release.yml",
  "mv .bosun/bosun.toml /tmp/x",
  "cp /tmp/x .claude/hooks/guard.mjs",
  "git config core.hooksPath /dev/null",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git config alias.p push",
];
const ALLOW = [
  "grep -r publish docs",
  "git push",
  "cat .env.example",
  "cat .env.sample",
  "cat .env.template",
  "cat .dev.vars.example",
  "echo .envrc-notes",
  "pnpm run ci",
  "cargo test",
  "/usr/bin/git push origin feat/x",
  "git push origin :feature",
  "git push --delete origin feature",
  "env -u FOO pnpm test",
  "git push origin m16-t10-policy-v2",
  "git push -u origin feat/x-v2",
  "git push origin HEAD:refs/heads/m16-v3",
  "git tag",
  "gh api repos/o/r/pulls/5 --jq '.title'",
  "gh api -X get repos/o/r/pulls/5",
  "gh api graphql",
  "python3 <<EOF\nprint('see .env.example')\nEOF",
  "python3 <<EOF\nprint(1)\nEOF",
  "git update-ref refs/heads/x HEAD",
  "git tag -l 'v*'",
  "git tag --list",
  "gh api repos/o/r/pulls/5 --jq '.auto_merge'",
  "gh api repos/o/r/pulls/5 -X GET --jq '.auto_merge'",
  "echo 'state: .env needs review'",
  'gh pr create --body "mentions .env and .dev.vars files"',
  "git commit -m 'docs: explain .env.local handling'",
  "cat <<'EOF' > notes.md\nsee .env and .dev.vars\nnpm publish\nEOF",
  "cat <<-EOF\n\t.env\n\tEOF\necho done",
  "git commit -F - <<EOF\nlabel .env\nEOF",
  // legit flows the rail must not block
  "gh pr merge 5 --auto",
  "gh pr merge 5 --auto --squash",
  "gh pr merge --disable-auto 5",
  "gh pr create --title x --body y",
  "gh pr view 5",
  "gh pr checks 5",
  "gh release list",
  "gh release view v1",
  "gh api repos/o/r/pulls",
  "git push -u origin feat/guard",
  "git push origin HEAD",
  "git push origin HEAD:feat/x",
  "git push origin feat/main-fix",
  "git branch -D feat/x",
  "git branch feat/x",
  "git reset --hard origin/feat/x",
  "git config user.name x",
  "pnpm run release-notes",
  "pnpm run ci",
  "make test",
  "python3 -c 'print(1)'",
  "node -e 'console.log(1)'",
  "echo $HOME",
  "echo $PATH",
  "printenv HOME",
  "env FOO=1 pnpm test",
  "cat .claude/hooks/guard.mjs",
  "cat .claude/settings.json",
  "git diff -- .claude/settings.json",
  "grep -n x .github/workflows/release.yml",
  "cp .claude/settings.json /tmp/x",
  "sops -e secrets.yaml",
  "hoist secrets exec -- pnpm test",
  "hoist secrets check",
  "cat id_rsa.pub",
  "echo release notes > notes.md",
  "ionice -c 3 pnpm test",
  "stdbuf -oL pnpm test",
  "watch -n 1 git status",
  "setsid pnpm test",
  "git -c alias.st=status st",
  "FOO=1 git status",
];
for (const c of DENY) {
  test(`deny: ${c}`, () => assert.equal(decide(bash(c), ctx)?.decision, "deny"));
}
for (const c of DENY2) {
  test(`deny2: ${c}`, () => assert.equal(decide(bash(c), ctx)?.decision, "deny"));
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
    decide(bash("git push origin :main"), ctx).reason,
    /never delete the default branch/,
  );
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

test("bare tag destination refused when the tag exists in refs/tags or packed-refs", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-tags-"));
  mkdirSync(join(dir, ".git/refs/tags/sub"), { recursive: true });
  writeFileSync(join(dir, ".git/refs/tags/web-v1.0.0"), "x\n");
  writeFileSync(join(dir, ".git/refs/tags/sub/api-v2"), "x\n");
  writeFileSync(
    join(dir, ".git/packed-refs"),
    "# pack-refs\nabc refs/tags/cli-v3.0.0\nabc refs/heads/m1-v2\n",
  );
  const c = { projectDir: dir };
  for (const cmd of [
    "git push origin web-v1.0.0",
    "git push origin sub/api-v2",
    "git push origin cli-v3.0.0",
    "git push origin HEAD:web-v1.0.0",
    "git push origin web-v1.0.0:web-v1.0.0",
    "git push origin tmp:web-v1.0.0",
    "git push origin web-v1.0.0:newname",
    "git push origin refs/tags/web-v1.0.0:newname",
  ])
    assert.equal(decide(bash(cmd), c)?.decision, "deny", cmd);
  for (const cmd of [
    "git push origin m1-v2",
    "git push origin m16-t10-policy-v2",
    "git push origin HEAD:m1-v2",
    "git push origin tmp:m1-v2",
  ])
    assert.equal(decide(bash(cmd), c), null, cmd);
});

/** A checkout whose HEAD is `branch`, with optional origin/HEAD target. */
function repoOn(branch, originHead) {
  const dir = mkdtempSync(join(tmpdir(), "guard-head-"));
  mkdirSync(join(dir, ".git/refs/remotes/origin"), { recursive: true });
  writeFileSync(join(dir, ".git/HEAD"), `ref: refs/heads/${branch}\n`);
  if (originHead) {
    writeFileSync(
      join(dir, ".git/refs/remotes/origin/HEAD"),
      `ref: refs/remotes/origin/${originHead}\n`,
    );
  }
  return { projectDir: dir };
}

test("rewrites of the default branch deny only on the default branch", () => {
  const onMain = repoOn("main");
  const onFeat = repoOn("feat/x");
  for (const cmd of [
    "git reset --hard origin/main",
    "git reset --hard",
    "git checkout -B main",
    "git switch -C main origin/main",
    "git update-ref refs/heads/main HEAD",
    "git push",
    "git push origin",
    "git push -u origin",
  ])
    assert.equal(decide(bash(cmd), onMain)?.decision, "deny", cmd);
  for (const cmd of [
    "git reset --hard origin/main",
    "git reset --hard",
    "git push",
    "git push origin",
  ])
    assert.equal(decide(bash(cmd), onFeat), null, cmd);
  assert.equal(decide(bash("git checkout -B main"), onFeat)?.decision, "deny");
  assert.equal(decide(bash("git update-ref refs/heads/main HEAD"), onFeat)?.decision, "deny");
});

test("default branch is read from origin/HEAD, not only main and master", () => {
  const c = repoOn("feat/x", "trunk");
  assert.equal(decide(bash("git push origin HEAD:trunk"), c)?.decision, "deny");
  assert.equal(decide(bash("git push origin trunk"), c)?.decision, "deny");
  assert.equal(decide(bash("git branch -D trunk"), c)?.decision, "deny");
  assert.equal(decide(bash("git push origin feat/x"), c), null);
});

test("evasion constructs without a risky word are allowed", () => {
  for (const cmd of [
    'eval "$(ssh-agent -s)"',
    "X=1; $X",
    "echo ls | sh",
    "python3 -c 'print(open(\"README.md\").read())'",
  ])
    assert.equal(decide(bash(cmd), ctx), null, cmd);
});

test("interpreter inline bodies still scan for secret files", () => {
  assert.equal(decide(bash("python3 -c \"print(open('.env').read())\""), ctx)?.decision, "deny");
  assert.equal(
    decide(bash("node -e \"require('fs').readFileSync('prod.env')\""), ctx)?.decision,
    "deny",
  );
});

test("Edit/Write on protected files deny regardless of the lock", () => {
  for (const f of [
    ".claude/hooks/guard.mjs",
    ".claude/hooks/session-start.sh",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".github/workflows/release.yml",
    ".github/workflows/release-npm.yml",
    ".splice/lock.toml",
    ".bosun/bosun.toml",
    "/r/.claude/hooks/guard.mjs",
  ])
    for (const name of ["Edit", "Write", "MultiEdit"]) {
      const d = decide(tool(name, { file_path: f }), ctx);
      assert.equal(d?.decision, "deny", `${name} ${f}`);
    }
  assert.equal(decide(tool("Edit", { file_path: ".github/workflows/ci.yml" }), ctx), null);
  assert.equal(decide(tool("Read", { file_path: ".claude/settings.json" }), ctx), null);
});

test("Read/Grep of key and cloud-credential paths deny", () => {
  for (const [name, input] of [
    ["Read", { file_path: "/root/.ssh/id_ed25519" }],
    ["Read", { file_path: "/home/u/.aws/credentials" }],
    ["Read", { file_path: "/home/u/.config/gh/hosts.yml" }],
    ["Read", { file_path: "/proc/self/environ" }],
    ["Read", { file_path: "certs/server.pem" }],
    ["Read", { file_path: "prod.env" }],
    ["Grep", { pattern: "x", path: "/home/u/.age" }],
  ])
    assert.equal(decide(tool(name, input), ctx)?.decision, "deny", JSON.stringify(input));
  assert.equal(decide(tool("Read", { file_path: "/home/u/keys/id_rsa.pub" }), ctx), null);
});

test("owned ask names the alternative: ci.yml → scripts/ci-extra.sh, else docs/agents/project.md", () => {
  const lockText = `[files]\n".github/workflows/ci.yml" = { class = "owned" }\n"renovate.json" = { class = "owned" }\n`;
  const ci = decide(tool("Edit", { file_path: ".github/workflows/ci.yml" }), {
    projectDir: "/r",
    lockText,
  });
  assert.equal(ci.decision, "ask");
  assert.match(ci.reason, /scripts\/ci-extra\.sh/);
  const other = decide(tool("Edit", { file_path: "renovate.json" }), {
    projectDir: "/r",
    lockText,
  });
  assert.match(other.reason, /docs\/agents\/project\.md/);
});

test("every new deny reason names an allowed alternative", () => {
  const want = [
    ["gh pr merge 5", /--auto/],
    ["gh release delete v1", /human/],
    ["gh secret set X", /human/],
    ["pnpm run release", /release\.yml/],
    ["echo 'git push -f' | sh", /run the command directly/],
    ["git push origin main", /feature branch/],
    ["git branch -D main", /feature branch/],
    ["printenv", /hoist secrets exec/],
    ["sops -d x.yaml", /hoist secrets exec/],
    ["rm .claude/hooks/guard.mjs", /docs\/agents\/project\.md/],
  ];
  for (const [cmd, re] of want) assert.match(decide(bash(cmd), ctx)?.reason ?? "", re, cmd);
});

test("CLI: internal error fails closed for risky text, open otherwise", () => {
  const risky = run('{"tool_name":"Bash","tool_input":{"command":"git push -f"', {
    CLAUDE_PROJECT_DIR: "/r",
  });
  assert.equal(risky.status, 0);
  assert.equal(JSON.parse(risky.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.match(JSON.parse(risky.stdout).hookSpecificOutput.permissionDecisionReason, /retry/);
  assert.equal(risky.stderr.split("\n").filter(Boolean).length, 1);
  for (const word of ["publish", "release", "gh pr", "secret"]) {
    const r = run(`{"tool_name":"Bash","tool_input":{"command":"x ${word}"`, {
      CLAUDE_PROJECT_DIR: "/r",
    });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny", word);
  }
  const safe = run('{"tool_name":"Bash","tool_input":{"command":"ls"', {
    CLAUDE_PROJECT_DIR: "/r",
  });
  assert.equal(safe.stdout, "");
  assert.equal(safe.stderr.split("\n").filter(Boolean).length, 1);
});

// Review round: bypasses found after the first pass.
test("review round: default-branch aliases, wrappers and more secret reads deny", () => {
  const onMain = repoOn("main");
  for (const cmd of [
    "git push origin HEAD",
    "git push origin @",
    "git push -u origin HEAD",
    "git -c remote.origin.push=HEAD:main push",
    "git -c push.default=matching push",
    "git push --all",
    "git push --all origin",
  ])
    assert.equal(decide(bash(cmd), onMain)?.decision, "deny", `on main: ${cmd}`);
  for (const cmd of [
    "git -c remote.origin.push=HEAD:main push",
    "git push --all",
    "echo main | xargs git push origin",
    "find . -exec git push origin main \\;",
    "git checkout -- .claude/hooks",
    "git restore .claude/hooks/guard.mjs",
    "cat x >| .claude/settings.json",
    "cat<.env",
    "cat .e*",
    "cat .en?",
    "node -p process.env",
    "python3 -c 'import os;print(os.environ)'",
    "hoist secrets exec -- awk 'BEGIN{for(k in ENVIRON) print k}'",
    "hoist secrets exec -- pnpm exec node -e 'x'",
    "hoist secrets exec -- pnpm exec env",
  ])
    assert.equal(decide(bash(cmd), ctx)?.decision, "deny", cmd);
  assert.equal(decide(bash("git push origin HEAD"), repoOn("feat/x")), null);
  assert.equal(decide(bash("git push -u origin HEAD"), repoOn("feat/x")), null);
});

test("review round: legit commands next to risky words are not denied", () => {
  for (const cmd of [
    "node --version && git push -u origin feat",
    "bash --version; gh pr create --fill",
    "$PWD/node_modules/.bin/vp build && git push -u origin feat",
    "grep -r .env docs",
    "rg .envrc README.md",
    "node -e 'console.log(process.env.NODE_ENV)'",
    "python3 -c 'import os;print(os.environ[\"HOME\"])'",
    "cargo build --release",
  ])
    assert.equal(decide(bash(cmd), ctx), null, cmd);
});

// Orchestrator review round.
test("protected paths: trailing slash, case, here-strings, rsync/awk/ex writes deny", () => {
  for (const cmd of [
    "rm -rf .claude/",
    "mv .claude/ /tmp/x",
    "cp -r /tmp/evil/. .claude/",
    "rm .CLAUDE/hooks/guard.mjs",
    "echo x > .Claude/Settings.json",
    "rsync -a /tmp/evil/ .claude/hooks/",
    "awk -i inplace '{print}' .claude/settings.json",
    "ex -c 'wq' .claude/settings.json",
    "vi -c 'wq' .claude/hooks/guard.mjs",
    "echo x > .SPLICE/lock.toml",
    "bash <<< 'git push origin main'",
    'bash -s <<< "npm publish"',
    "sh <<<'git push -f'",
    "python3 <<< \"import os; os.system('git push -f')\"",
  ])
    assert.equal(decide(bash(cmd), ctx)?.decision, "deny", cmd);
  for (const cmd of ["bash <<< 'echo hi'", "cat <<< 'git push -f'", "rsync -a src/ dist/"])
    assert.equal(decide(bash(cmd), ctx), null, cmd);
});

test("a symlink into a protected dir does not hide the write", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-sym-"));
  mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
  writeFileSync(join(dir, ".claude/hooks/guard.mjs"), "x\n");
  symlinkSync(join(dir, ".claude/hooks"), join(dir, "hk"));
  const c = { projectDir: dir };
  for (const input of [
    tool("Edit", { file_path: join(dir, "hk/guard.mjs") }),
    tool("Write", { file_path: "hk/new.mjs" }),
    bash("cp /dev/null hk/guard.mjs"),
    bash("unlink hk/guard.mjs"),
    bash("echo x > hk/guard.mjs"),
  ])
    assert.equal(decide(input, c)?.decision, "deny", JSON.stringify(input));
  assert.equal(decide(tool("Edit", { file_path: "src/a.ts" }), c), null);
});

test("lock: symlink to it, case variants, and rsync source are handled", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-lk-"));
  mkdirSync(join(dir, ".splice"), { recursive: true });
  writeFileSync(join(dir, ".splice/lock.toml"), "x\n");
  symlinkSync(join(dir, ".splice/lock.toml"), join(dir, "lk"));
  const c = { projectDir: dir };
  assert.equal(decide(bash("echo x > lk"), c)?.decision, "deny");
  assert.equal(decide(tool("Write", { file_path: ".SPLICE/lock.toml" }), ctx)?.decision, "deny");
  assert.equal(decide(tool("Edit", { file_path: "lk" }), c)?.decision, "deny");
  assert.equal(decide(bash("rsync -a .claude/ /tmp/backup/"), ctx), null);
  assert.equal(decide(bash("rsync -a /tmp/evil/ .claude/hooks/"), ctx)?.decision, "deny");
});

test("cd into a guarded dir, a persisted cwd there, patch and git apply do not hide a protected write", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-cd-"));
  mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  const evil = "--- a/.claude/settings.json\n+++ b/.claude/settings.json\n@@ -1 +1 @@\n-a\n+b\n";
  const fine = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
  writeFileSync(join(dir, "evil.diff"), evil);
  writeFileSync(join(dir, "fine.diff"), fine);
  const c = { projectDir: dir };
  for (const cmd of [
    "cd .claude && echo x > settings.json",
    "cd .claude/hooks && sed -i s/a/b/ guard.mjs",
    "pushd .claude; tee settings.json",
    "cd .github/workflows && echo > release.yml",
    "cd .bosun",
    "cd ./.claude/",
    "git -C .claude checkout -- settings.json",
    "patch -p1 < evil.diff",
    "patch -p1 -i evil.diff",
    "git apply evil.diff",
    "cat evil.diff | git apply -",
    `patch -p1 <<'EOF'\n${evil}EOF`,
    `git apply <<EOF\n${evil}EOF`,
    "find . -name x -exec sh -c 'npm publish' ;",
    "find . -exec bash -c 'git push origin main' ;",
  ])
    assert.equal(decide(bash(cmd), c)?.decision, "deny", cmd);
  const inClaude = { projectDir: dir, cwd: join(dir, ".claude") };
  for (const cmd of ["echo x > settings.json", "rm hooks/guard.mjs"])
    assert.equal(decide(bash(cmd), inClaude)?.decision, "deny", cmd);
  assert.equal(decide(tool("Write", { file_path: "settings.json" }), inClaude)?.decision, "deny");
  for (const cmd of [
    "cd src",
    "cd .github",
    "git apply fine.diff",
    "patch -p1 < fine.diff",
    "git apply --check fine.diff",
    "find . -name x -exec sh -c 'echo hi' ;",
  ])
    assert.equal(decide(bash(cmd), c), null, cmd);
});

test("a patch file made earlier in the chain by git diff is applied; other chain writes stay refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-chain-"));
  mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
  writeFileSync(join(dir, "fine.diff"), "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n");
  const c = { projectDir: dir };
  for (const cmd of [
    "git diff -- src > x.diff && git apply -R x.diff",
    "git diff -- src >x.diff; git apply --reverse x.diff",
    "git diff HEAD -- src docs/a.md --output=x.diff && git apply -R x.diff",
    "git diff HEAD~1 -- src/a.ts > ./x.diff && git apply -R ./x.diff",
    "git format-patch -1 HEAD --stdout -- src > p && git apply p",
    "git show HEAD -- src > p && patch -p1 -R < p",
  ])
    assert.equal(decide(bash(cmd), c), null, cmd);
  for (const cmd of [
    "echo '--- a/.claude/settings.json' > x.diff && git apply x.diff",
    "git diff > x.diff && echo evil >> x.diff && git apply x.diff",
    "printf evil | tee x.diff && git apply x.diff",
    "echo evil > fine.diff && git apply fine.diff",
    "git diff > .claude/hooks/x.diff",
    "git apply x.diff",
    "git diff -- .claude/hooks > x.diff && git apply -R x.diff",
    "git diff HEAD~3 HEAD > p && git apply -R p",
    "git show HEAD~2 > p && git apply p",
    "git stash show -p > p && git apply p",
    "git format-patch -1 HEAD --stdout > p && git apply p",
    "git diff -- . > p && git apply p",
    "git diff -- .github > p && git apply p",
    "git diff -- src .bosun > p && git apply -R p",
    "git diff -- 'src/*' > p && git apply p",
    "git diff -- :/ > p && git apply p",
    "git diff -- ../x > p && git apply p",
    "git diff --src-prefix=.claude/ -- src > p && git apply p",
    "diff -u .claude/hooks/guard.mjs /tmp/evil.mjs > p && patch -p0 < p",
    "diff -u a b > p && patch -p0 < p",
    "git diff --no-index -- /dev/null /tmp/evil > p && git apply p",
    "git diff --no-index /dev/null /tmp/evil -- src > p && git apply p",
  ])
    assert.equal(decide(bash(cmd), c)?.decision, "deny", cmd);
});

test("deny reason for a protected path tells the agent to use paths from the repo root", () => {
  const r = decide(bash("echo x > .claude/settings.json"), { projectDir: "/r" });
  assert.match(r.reason, /repo root/);
});

test("chdir flags and globs into a guarded dir are treated like cd", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-chdir-"));
  mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  mkdirSync(join(dir, ".bosun"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  const c = { projectDir: dir };
  for (const cmd of [
    "env -C .claude sh -c 'echo x > settings.json'",
    "env --chdir=.claude/hooks rm guard.mjs",
    "env --chdir .bosun touch x",
    "tar -C .claude -xf a.tar",
    "tar -C.claude -xf a.tar",
    "tar --directory=.claude/hooks -xf a.tar",
    "tar xf a.tar --directory .github/workflows",
    "make -C .claude",
    "make --directory=.bosun all",
    "git --work-tree=.claude checkout -- .",
    "git --work-tree .claude restore .",
    "cd .cla*",
    "cd .?laude/hooks",
    "cd .[c]laude",
    "cd .claud{e,x}",
    "cd .git*/workflows",
    "cd .bos*",
    "pnpm --prefix .claude exec sh",
    "git -C .cla* checkout -- settings.json",
    "env -iC .claude ls",
    "tar -xC .claude -f a.tar",
    "tar -xzC.claude -f a.tar",
    "cp -t .claude/hooks x",
    "cp x --target-directory=.claude/hooks",
    "mv -t .bosun x",
    "unzip a.zip -d .claude/hooks",
    "curl -o .claude/settings.json http://x",
    "wget -O .claude/hooks/guard.mjs http://x",
    'cd "$(echo .claude)"',
    "cd $(echo .claude)",
    "cd `echo .bosun`",
    "cd $X",
    'pushd "$D"',
  ])
    assert.equal(decide(bash(cmd), c)?.decision, "deny", cmd);
  for (const cmd of [
    "env -C src ls",
    "tar -C src -xf a.tar",
    "make -C src",
    "git --work-tree=src status",
    "cd s*",
    "cd src/*",
    "grep -C 3 foo src/a.ts",
    "git -C src status",
    "tar -xC src -f a.tar",
    "cp -t src x",
    "unzip a.zip -d out",
    "curl -o out.json http://x",
    "grep -rC 3 foo src",
  ])
    assert.equal(decide(bash(cmd), c), null, cmd);
});

// Client feedback 2026-11-18: judge the command that runs, not text inside heredocs or strings.
test("false positives from a client repo: scripts, GET API reads, interpreter text, piped pushes", () => {
  const c = repoOn("feat/x");
  for (const cmd of [
    "bash scripts/tests/dev-slack-test.sh",
    "bash scripts/tests/dev-slack-test.sh 2>&1 | tail -20",
    "gh api repos/o/r/pulls/7",
    "gh api repos/o/r/pulls/7 --jq .auto_merge",
    "gh api repos/o/r/pulls/7 -q '.auto_merge.enabled_by.login'",
    "gh api --method GET repos/o/r/pulls -f state=open",
    "gh api -X GET search/issues -f q='repo:o/r is:pr auto-merge'",
    'gh api graphql -f query=\'query { repository(owner:"o", name:"r") { pullRequest(number: 7) { autoMergeRequest { enabledAt } } } }\'',
    "python3 - <<'PY'\nprint('see `scripts/release.sh` before git push')\nPY",
    "python3 <<'PY'\nt = open('docs/release.md').read()\nprint('npm publish' in t, '`gh pr merge --auto`')\nPY",
    "node <<'EOF'\nconsole.log(`run git push -u origin <branch>, never npm publish`);\nEOF",
    "python3 -c \"print('git push and npm publish are in docs/release.md')\"",
    'python3 -c \'v=open("VERSION").read().split("."); print("release", v)\'',
    "git push -u origin feat/x 2>&1 | tail -5",
    "git push 2>&1 | tail",
    "git push origin HEAD 2>&1 | tee /tmp/push.log | tail -3",
  ])
    assert.equal(decide(bash(cmd), c), null, cmd);
});

test("code that runs still denies: substitutions, unquoted heredocs, interpreters that exec", () => {
  const c = repoOn("feat/x");
  for (const cmd of [
    'echo "$(git push -f)"',
    "echo $(npm publish)",
    "echo `git push --tags`",
    "x=$(cargo publish)",
    "diff <(git push origin main) /dev/null",
    "cat <<EOF\n$(git push --force)\nEOF",
    'python3 <<PY\nprint("`npm publish`")\nPY',
    "python3 <<'PY'\nimport subprocess\nsubprocess.run(['git', 'push', '--force'])\nPY",
    "python3 -c \"import os; os.system('g'+'it push -f')\"",
    "node -e \"require('child_process').execSync('npm publish')\"",
    "node <<'EOF'\nrequire('node:child_process').execSync('git push origin main');\nEOF",
    "ruby -e '`git push -f`'",
    "perl -e 'system(\"npm publish\")'",
    "gh api -X PUT repos/o/r/pulls/7/merge",
    "gh api repos/o/r/pulls/7/merge -f merge_method=squash",
    "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
    "gh api graphql -F query=@q.graphql",
    "gh api graphql --input q.json",
    "gh api graphql -Fquery=@m.graphql",
    // review round: pipe opens, names built from strings, case in $(...), $'...', other -e forms
    "perl -e 'open(F, \"|git push -f origin main\")'",
    'perl -e \'open(my $f, "-|", "git", "push", "-f")\'',
    "ruby -e 'open(\"|git push -f origin main\")'",
    "python3 -c \"import os; os.__dict__['sys'+'tem']('git push -f origin main')\"",
    "node -e \"require('child_'+'process')['ex'+'ecSync']('git push -f origin main')\"",
    "echo $(case x in x) git push -f origin main;; esac)",
    "echo $(case x in (x) npm publish;; esac)",
    "case $x in a) ls ;; b) npm publish ;; esac",
    "case x in x)git push -f origin main;; esac",
    'echo "$(echo case)" ; git push -f origin main',
    "node -r dotenv/config -e \"require('child_process').execSync('git push -f origin main')\"",
    "ruby -r json -e 'system(\"git push -f origin main\")'",
    "node -e \"require('child_'.concat('process'))['ex'.concat('ecSync')]('git push -f origin main')\"",
    'php -r \'$f="sys"."tem"; $f("git push -f origin main");\'',
    "echo $'\\'' $(git push -f origin main) $'\\''",
    "php -r 'system(\"npm publish\");'",
    'deno eval \'new Deno.Command("git", { args: ["push", "-f"] }).outputSync()\'',
  ])
    assert.equal(decide(bash(cmd), c)?.decision, "deny", cmd);
  assert.equal(decide(bash("echo '$(git push -f)'"), c), null, "single quotes are data");
  assert.equal(
    decide(bash("echo hi # $(git push -f origin main)"), c),
    null,
    "a comment never runs",
  );
  assert.equal(decide(bash("echo $# a#b"), c), null);
  assert.equal(
    decide(bash("cat <<'EOF'\n$(git push --force)\nEOF"), c),
    null,
    "quoted heredoc is data",
  );
});

test("deny reason names the matched rule and the exact command", () => {
  const c = repoOn("feat/x");
  const r = decide(bash("ls && git push --force origin feat/x | tail"), c).reason;
  assert.match(r, /rule force/);
  assert.match(r, /`git push --force origin feat\/x`/);
  const e = decide(bash("python3 -c \"import os; os.system('g'+'it push -f')\""), c).reason;
  assert.match(e, /rule evasion/);
  assert.match(e, /`push`/);
  assert.match(decide(tool("Read", { file_path: ".env" }), c).reason, /rule secret.*`\.env`/);
});
