import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { TAG_RE, plan } from "../template/pieces/base/files/.github/scripts/release-plan.mjs";
import { TARGETS } from "../template/pieces/npm-cli/files/scripts/stage.mjs";
import { lineCount, renderCombo } from "./helpers.mjs";
import { assertSameBranches, elifBranches } from "./invariants.mjs";

const BASE = fileURLToPath(new URL("../template/pieces/base/files/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/release/", import.meta.url));
const PLAN = join(BASE, ".github/scripts/release-plan.mjs");
const RAW = readFileSync(join(BASE, ".github/workflows/release.yml"), "utf8");
const WF = YAML.parse(RAW);

/** A read-only view of a fixture tree, as release-plan.mjs expects. */
function fixture(name) {
  const root = join(FIXTURES, name);
  return {
    read(rel) {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return null;
      }
    },
    list(rel) {
      try {
        return readdirSync(join(root, rel)).sort();
      } catch {
        return [];
      }
    },
  };
}

/** An in-memory view: `files` maps relative paths to their text. */
function memory(files) {
  return {
    read: (rel) => files[rel] ?? null,
    list: (rel) => [
      ...new Set(
        Object.keys(files)
          .filter((p) => p.startsWith(`${rel}/`))
          .map((p) => p.slice(rel.length + 1).split("/")[0]),
      ),
    ],
  };
}

const steps = (job) => WF.jobs[job].steps;
const runs = (job) => steps(job).map((s) => s.run ?? "");

test("cli-v1.2.0 with crates/cli + packages/cli (bin cli) → rust-cli, npm_dirs [packages/cli]", () => {
  assert.deepEqual(plan("cli-v1.2.0", fixture("cli-pair")), {
    kind: "rust-cli",
    dir: "crates/cli",
    package: "cli",
    bin: "cli",
    version: "1.2.0",
    npm_dirs: ["packages/cli"],
  });
});

test("renamed companion packages/npm (bin cli) is paired → npm_dirs [packages/npm]", () => {
  assert.deepEqual(plan("cli-v1.2.0", fixture("cli-renamed")), {
    kind: "rust-cli",
    dir: "crates/cli",
    package: "cli",
    bin: "cli",
    version: "1.2.0",
    npm_dirs: ["packages/npm"],
  });
});

test("lib-v0.3.0 → ts-lib at packages/lib, npm_dirs [packages/lib]", () => {
  assert.deepEqual(plan("lib-v0.3.0", fixture("lib")), {
    kind: "ts-lib",
    dir: "packages/lib",
    package: "",
    bin: "",
    version: "0.3.0",
    npm_dirs: ["packages/lib"],
  });
});

test("my-tool-v1.0.0-rc.1 → instance my-tool, version 1.0.0-rc.1", () => {
  const m = TAG_RE.exec("my-tool-v1.0.0-rc.1");
  assert.equal(m?.[1], "my-tool");
  assert.equal(m?.[2], "1.0.0-rc.1");
  const fs = memory({
    "packages/my-tool/package.json": JSON.stringify({
      name: "@acme/my-tool",
      version: "1.0.0-rc.1",
      hull: { release: "ts-lib" },
    }),
  });
  assert.deepEqual(plan("my-tool-v1.0.0-rc.1", fs), {
    kind: "ts-lib",
    dir: "packages/my-tool",
    package: "",
    bin: "",
    version: "1.0.0-rc.1",
    npm_dirs: ["packages/my-tool"],
  });
});

test("tag version ≠ Cargo.toml / package.json version → throws naming both", () => {
  assert.throws(() => plan("cli-v1.2.0", fixture("mismatch")), {
    message: "tag cli-v1.2.0 is version 1.2.0 but crates/cli/Cargo.toml has 1.1.0",
  });
  assert.throws(() => plan("lib-v0.3.0", fixture("mismatch")), {
    message: "tag lib-v0.3.0 is version 0.3.0 but packages/lib/package.json has 0.2.0",
  });
});

test("a companion npm-cli package with another version → throws naming its package.json", () => {
  const fs = memory({
    "crates/cli/package.json": '{"hull":{"release":"rust-cli"}}',
    "crates/cli/Cargo.toml": '[package]\nname = "cli"\nversion = "1.2.0"\n',
    "packages/npm/package.json":
      '{"version":"1.1.0","bin":{"cli":"x"},"hull":{"release":"npm-cli"}}',
  });
  assert.throws(() => plan("cli-v1.2.0", fs), {
    message: "tag cli-v1.2.0 is version 1.2.0 but packages/npm/package.json has 1.1.0",
  });
});

test("unknown tag shape (v1.2.0, cli-1.2, cli-vx) → throws 'unknown tag'", () => {
  for (const tag of ["v1.2.0", "cli-1.2", "cli-vx", "cli-v1.2", "../cli-v1.2.0"]) {
    assert.throws(() => plan(tag, fixture("cli-pair")), { message: `unknown tag ${tag}` }, tag);
  }
  // matches TAG_RE, but nothing in crates/ or packages/ carries that name
  assert.throws(() => plan("nope-v1.2.0", fixture("cli-pair")), {
    message: "unknown tag nope-v1.2.0",
  });
  // packages/shared exists but has no hull.release field
  assert.throws(() => plan("shared-v0.0.0", fixture("cli-pair")), {
    message: "unknown tag shared-v0.0.0",
  });
});

test("tag naming only an npm-cli package → throws 'push <crate>-v<version>'", () => {
  assert.throws(() => plan("web-cli-v1.2.0", fixture("npm-only")), {
    message: "packages/web-cli is an npm-cli package: push cli-v1.2.0 to release it with its crate",
  });
});

test("two primaries for one instance (crates/x rust-cli + packages/x ts-lib) → throws 'ambiguous'", () => {
  assert.throws(() => plan("x-v1.0.0", fixture("two-primaries")), {
    message: "ambiguous: crates/x, packages/x",
  });
});

test("npm-cli candidate with another bin → throws 'ambiguous'", () => {
  assert.throws(() => plan("cli-v1.2.0", fixture("other-bin")), {
    message: "ambiguous: crates/cli, packages/cli (bin other, not cli)",
  });
});

test("CLI prints kind/dir/bin/version/npm_dirs lines; exit 1 with the reason on error", () => {
  const ok = spawnSync("node", [PLAN], {
    cwd: join(FIXTURES, "cli-pair"),
    env: { ...process.env, GITHUB_REF_NAME: "cli-v1.2.0" },
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(
    ok.stdout,
    'kind=rust-cli\ndir=crates/cli\npackage=cli\nbin=cli\nversion=1.2.0\nnpm_dirs=["packages/cli"]\n',
  );
  const bad = spawnSync("node", [PLAN], {
    cwd: join(FIXTURES, "cli-pair"),
    env: { ...process.env, GITHUB_REF_NAME: "v1.2.0" },
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "release-plan: unknown tag v1.2.0\n");
});

test("release.yml: on.push.tags deep-equals ['*-v[0-9]*'] only; top-level permissions {contents: read}", () => {
  assert.deepEqual(WF.on, { push: { tags: ["*-v[0-9]*"] } });
  assert.deepEqual(WF.permissions, { contents: "read" });
  assert.deepEqual(WF.concurrency, {
    group: "release-${{ github.ref }}",
    "cancel-in-progress": false,
  });
});

test("jobs plan/binaries/github-release/npm; id-token: write only on github-release and npm", () => {
  assert.deepEqual(Object.keys(WF.jobs), ["plan", "binaries", "github-release", "npm"]);
  const withIdToken = Object.entries(WF.jobs)
    .filter(([, j]) => j.permissions?.["id-token"] === "write")
    .map(([k]) => k);
  assert.deepEqual(withIdToken, ["github-release", "npm"]);
  assert.deepEqual(WF.jobs["github-release"].permissions, {
    contents: "write",
    "id-token": "write",
    attestations: "write",
  });
  assert.deepEqual(WF.jobs.npm.permissions, { contents: "read", "id-token": "write" });
  assert.equal(WF.jobs["github-release"].environment, "release");
  assert.equal(WF.jobs.binaries.if, "needs.plan.outputs.kind == 'rust-cli'");
  assert.equal(WF.jobs["github-release"].if, "needs.plan.outputs.kind == 'rust-cli'");
  for (const job of Object.keys(WF.jobs)) {
    for (const s of steps(job).filter((x) => x.uses?.startsWith("actions/checkout@"))) {
      assert.equal(s.with?.["fetch-depth"], 0, `${job} checkout fetch-depth`);
    }
  }
});

test("npm job: environment release; every npm publish has --provenance --access public and a 'npm view' skip", () => {
  const npm = WF.jobs.npm;
  assert.equal(npm.environment, "release");
  const node = steps("npm").find((s) => s.uses?.startsWith("actions/setup-node@"));
  assert.equal(node.with["node-version"], 24);
  assert.equal(node.with["registry-url"], "https://registry.npmjs.org");
  const publishing = runs("npm").filter((r) => /\bnpm publish\b/.test(r));
  assert.equal(publishing.length, 2); // npm-cli packages, the ts-lib tarball
  for (const r of publishing) {
    const lines = r.split("\n").filter((l) => /\bnpm publish\b/.test(l));
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /npm publish "\$[a-z]+" --provenance --access public --tag "\$dist_tag"$/,
    );
    assert.match(r, /dist_tag=latest\n\s*case "\$VERSION" in \*-\*\) dist_tag=next ;; esac\n/);
    assert.match(r, /if npm view "\$name@\$ver" version >\/dev\/null 2>&1; then/);
  }
  const lib = runs("npm").join("\n");
  assert.match(lib, /pnpm install --frozen-lockfile/);
  assert.match(lib, /pnpm turbo run build test --filter "\$name"/);
  assert.match(
    lib,
    /npm pkg set repository\.type=git "repository\.url=git\+https:\/\/github\.com\/\$GITHUB_REPOSITORY\.git"/,
  );
  assert.match(lib, /pnpm pack --pack-destination/);
  assert.match(lib, /node "\$dir\/scripts\/stage\.mjs" --artifacts "\$RUNNER_TEMP\/artifacts"/);
});

test("no NPM_TOKEN, NODE_AUTH_TOKEN or secrets.* npm token anywhere", () => {
  assert.doesNotMatch(RAW, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.deepEqual(RAW.match(/secrets\.[A-Za-z_]+/g), null);
});

test("binaries matrix targets deep-equal Object.values(TARGETS); runners ubuntu-latest, ubuntu-24.04-arm, macos-latest (both darwin), windows-latest", () => {
  const job = WF.jobs.binaries;
  assert.equal(job["runs-on"], "${{ matrix.os }}");
  const include = job.strategy.matrix.include;
  assert.deepEqual(
    include.map((x) => x.target),
    Object.values(TARGETS),
  );
  assert.deepEqual(
    include.map((x) => x.platform),
    Object.keys(TARGETS),
  );
  assert.deepEqual(
    include.map((x) => x.os),
    ["ubuntu-latest", "ubuntu-24.04-arm", "macos-latest", "macos-latest", "windows-latest"],
  );
  const build = runs("binaries").find((r) => r.includes("cargo build"));
  assert.equal(build.trim(), 'cargo build --release --locked -p "$PACKAGE" --target "$TARGET"');
  assert.equal(WF.jobs.binaries.env.PACKAGE, "${{ needs.plan.outputs.package }}");
  const extras = steps("binaries").find((s) => s.run?.includes("completions"));
  assert.equal(extras.if, "matrix.platform == 'linux-x64'");
  assert.match(extras.run, /for shell in bash zsh fish powershell; do/);
  assert.match(extras.run, /man > "out\/\$BIN\.1"/);
});

test("plan job runs cargo deny check advisories only for rust-cli", () => {
  const deny = steps("plan").filter((s) => /cargo deny|cargo-deny/.test(`${s.run}${s.with?.tool}`));
  assert.deepEqual(
    deny.map((s) => s.if),
    ["steps.plan.outputs.kind == 'rust-cli'", "steps.plan.outputs.kind == 'rust-cli'"],
  );
  assert.equal(deny[0].with.tool, "cargo-deny@0.20.2");
  assert.equal(
    deny[1].run.trim(),
    'cargo deny --manifest-path "$DIR/Cargo.toml" --config "$DIR/deny.toml" check advisories',
  );
  assert.deepEqual(RAW.match(/cargo deny .*/g), [
    'cargo deny --manifest-path "$DIR/Cargo.toml" --config "$DIR/deny.toml" check advisories',
  ]);
  const outputs = WF.jobs.plan.outputs;
  assert.deepEqual(Object.keys(outputs), ["kind", "dir", "package", "bin", "version", "npm_dirs"]);
  const run = steps("plan").find((s) => s.id === "plan").run;
  assert.match(run, /node \.github\/scripts\/release-plan\.mjs > "\$RUNNER_TEMP\/plan\.txt"/);
});

test("release.yml and release-plan.mjs render as owned plain files of base", async () => {
  const { result } = await renderCombo(["base"]);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls[".github/workflows/release.yml"], "owned");
  assert.equal(cls[".github/scripts/release-plan.mjs"], "owned");
});

test("project.md renders the Blocked section only with npm-cli or ts-lib; branches identical", async () => {
  const src = join(BASE, "docs/agents/project.md.jinja");
  assertSameBranches(src);
  assert.equal(elifBranches(readFileSync(src, "utf8")).length, 2);
  const blocked = /^## Blocked$/m;
  const plain = await renderCombo(["base"]);
  const text = await readFile(join(plain.dir, "docs/agents/project.md"), "utf8");
  assert.doesNotMatch(text, blocked);
  assert.equal(
    Object.fromEntries(plain.result.changes.map((c) => [c.path, c.class]))[
      "docs/agents/project.md"
    ],
    "seed",
  );
  const cli = await renderCombo(["base", "rust-cli:cli", "npm-cli:cli"]);
  const lib = await renderCombo(["base", "ts-lib:lib"]);
  const cliText = await readFile(join(cli.dir, "docs/agents/project.md"), "utf8");
  const libText = await readFile(join(lib.dir, "docs/agents/project.md"), "utf8");
  assert.equal(cliText, libText);
  assert.match(cliText, blocked);
  assert.equal(cliText.slice(0, text.length), text);
  assert.match(cliText, /trusted publisher/);
  assert.match(cliText, /environment `release`/);
  assert.match(cliText, /first publish/i);
  assert.match(cliText, /within 2 days/);
  assert.doesNotMatch(cliText, /\n\n\n/);
  assert.ok(lineCount(cliText) - lineCount(text) <= 12, `${lineCount(cliText)} lines`);
});

test("prereleases: dist-tag next on npm, --prerelease on the GitHub release", () => {
  assert.equal(WF.jobs.npm.env.VERSION, "${{ needs.plan.outputs.version }}");
  const dist = (version) => {
    const r = spawnSync(
      "bash",
      ["-c", 'dist_tag=latest\ncase "$VERSION" in *-*) dist_tag=next ;; esac\necho "$dist_tag"'],
      { env: { ...process.env, VERSION: version }, encoding: "utf8" },
    );
    return r.stdout.trim();
  };
  assert.deepEqual([dist("1.0.0"), dist("1.0.0-rc.1")], ["latest", "next"]);
  const gh = runs("github-release").find((r) => r.includes("gh release create"));
  assert.match(gh, /case "\$VERSION" in \*-\*\) extra=\(--prerelease\) ;; esac/);
  assert.match(gh, /--generate-notes "\$\{extra\[@\]\}" "\$\{files\[@\]\}"/);
});

test("npm_dirs loop reads jq output line by line; plan drops unsafe package dir names", () => {
  const loop = runs("npm").find((r) => r.includes("stage.mjs"));
  assert.match(loop, /while read -r dir; do/);
  assert.match(loop, /done < <\(jq -r '\.\[\]' <<< "\$NPM_DIRS"\)/);
  assert.doesNotMatch(loop, /for dir in \$\(/);
  const fs = memory({
    "crates/cli/package.json": '{"hull":{"release":"rust-cli"}}',
    "crates/cli/Cargo.toml": '[package]\nname = "cli"\nversion = "1.2.0"\n',
    "packages/a b/package.json":
      '{"version":"1.2.0","bin":{"cli":"x"},"hull":{"release":"npm-cli"}}',
    "packages/ok/package.json":
      '{"version":"1.2.0","bin":{"cli":"x"},"hull":{"release":"npm-cli"}}',
  });
  assert.deepEqual(plan("cli-v1.2.0", fs).npm_dirs, ["packages/ok"]);
});

test("package is the cargo package name, bin the [[bin]] name", () => {
  const fs = memory({
    "crates/tool/package.json": '{"hull":{"release":"rust-cli"}}',
    "crates/tool/Cargo.toml":
      '[package]\nname = "tool"\nversion = "1.0.0"\n\n[[bin]]\nname = "tl"\npath = "src/main.rs"\n',
  });
  const p = plan("tool-v1.0.0", fs);
  assert.deepEqual([p.package, p.bin], ["tool", "tl"]);
});
