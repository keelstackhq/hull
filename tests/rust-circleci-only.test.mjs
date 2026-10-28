import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { RUST_GITHUB_CI_PATH, rustGithubCi, rustGithubCiTemplate } from "../scripts/gen-ci.mjs";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { renderString } from "../scripts/lib/render-file.mjs";
import { renderNew } from "../scripts/render.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const PIECE = join(RUST, "pieces/circleci-only");
const MIRROR = ".github/workflows/circleci-status.yml";
const SNAPSHOT = JSON.parse(
  await readFile(new URL("./fixtures/github-workflows.sha256.json", import.meta.url), "utf8"),
);
const ONLY = ["base", "circleci", "circleci-only", "rust-cli:cli"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const wfs = (dir) => readdirSync(join(dir, ".github/workflows")).sort();

async function render(pieces) {
  const out = join(await mkdtemp(join(tmpdir(), "hull-rust-only-")), "out");
  const result = await renderNew({ template: RUST, out, pieces, vars: {} });
  return { out, result };
}

const only = await render(ONLY);

test("the rust-circleci-only combo is registered", () => {
  const c = loadCombos().combos.find((x) => x.name === "rust-circleci-only");
  assert.deepEqual(c, {
    name: "rust-circleci-only",
    template: "template-rust",
    pieces: ONLY,
    vars: {},
  });
});

test("template-rust min_splice allows raw blocks (0.2.0)", async () => {
  const t = parseToml(await readFile(join(RUST, "splice.toml"), "utf8"));
  assert.equal(t.min_splice, "0.2.0");
});

test("circleci-only piece requires circleci and owns only the mirror", async () => {
  const t = parseToml(await readFile(join(PIECE, "piece.toml"), "utf8"));
  assert.deepEqual(t.requires, ["circleci"]);
  assert.ok(t.description);
  assert.deepEqual(t.files.owned, [MIRROR]);
  assert.equal(only.result.changes.find((c) => c.path === MIRROR)?.class, "owned");
});

test("the mirror is byte-identical to template's circleci-only mirror", async () => {
  const main = new URL(`../template/pieces/circleci-only/files/${MIRROR}`, import.meta.url);
  assert.equal(await readFile(join(PIECE, "files", MIRROR), "utf8"), await readFile(main, "utf8"));
});

test("circleci-only render has no ci.yml but release, splice, the mirror and .circleci", () => {
  assert.deepEqual(wfs(only.out), ["circleci-status.yml", "release.yml", "splice.yml"]);
  assert.ok(!existsSync(join(only.out, ".github/workflows/ci.yml")));
  for (const f of [".circleci/config.yml", ".circleci/src/jobs/ci-ok.yml"])
    assert.ok(existsSync(join(only.out, f)), f);
});

test("GitHub-mode renders (rust, rust-circleci) are byte-identical to the pre-circleci-only render", async () => {
  const cases = {
    rust: ["base", "rust-cli:cli"],
    "rust-circleci": ["base", "circleci", "rust-cli:cli"],
  };
  for (const [name, pieces] of Object.entries(cases)) {
    const { out } = await render(pieces);
    const got = Object.fromEntries(
      await Promise.all(
        wfs(out).map(async (f) => [f, sha(await readFile(join(out, ".github/workflows", f)))]),
      ),
    );
    assert.deepEqual(got, SNAPSHOT[name], name);
  }
});

test("ci.yml.jinja is guarded like template's and stays in the contract subset", async () => {
  assert.ok(
    RUST_GITHUB_CI_PATH.endsWith("template-rust/pieces/base/files/.github/workflows/ci.yml.jinja"),
  );
  const source = await readFile(RUST_GITHUB_CI_PATH, "utf8");
  assert.equal(source, rustGithubCiTemplate());
  assert.ok(source.startsWith('{% if "circleci-only" in pieces %}{% else %}{% raw %}name: ci\n'));
  assert.ok(source.endsWith("{% endraw %}{% endif %}"));
  assert.equal(renderString(source, { pieces: ONLY }), "");
  assert.equal(renderString(source, { pieces: ["base"] }), rustGithubCi());
  const outside = source.replace(/\{% raw %\}[\s\S]*\{% endraw %\}/, "");
  assert.equal(outside, '{% if "circleci-only" in pieces %}{% else %}{% endif %}');
  const base = parseToml(await readFile(join(RUST, "pieces/base/piece.toml"), "utf8"));
  assert.ok(base.files.owned.includes(".github/workflows/ci.yml"));
  assert.ok(!base.files.owned.some((p) => p.endsWith(".jinja")));
});

test("the mirror workflow only triggers on status and keeps statuses: write", async () => {
  const w = YAML.parse(await readFile(join(only.out, MIRROR), "utf8"));
  assert.equal(w.on, "status");
  assert.deepEqual(w.permissions, { statuses: "write" });
});
