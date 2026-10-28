import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderString } from "../scripts/lib/render-file.mjs";
import { referencedNames } from "../scripts/lib/subset.mjs";
import { renderCombo } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UNTRUSTED = [
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
  "merge_group",
  "issue_comment",
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Context for a lone .jinja: `pieces` as given, every other referenced variable "x". */
function contextFor(source, pieces) {
  const ctx = { pieces };
  for (const r of referencedNames(source)) if (!r.loop) ctx[r.name.split(".")[0]] ??= "x";
  return ctx;
}

/** Every workflow of template/ and template-rust/; .jinja ones rendered with and without secrets. */
function workflows() {
  const out = [];
  for (const dir of ["template", "template-rust", "rigging"]) {
    for (const f of walk(join(ROOT, dir))) {
      if (!/\.github\/workflows\/[^/]+\.ya?ml(\.jinja)?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      const rel = relative(ROOT, f);
      if (!f.endsWith(".jinja")) out.push({ rel, text: src });
      else
        for (const pieces of [
          ["base"],
          ["base", "hono-worker", "tauri-app", "secrets", "circleci"],
        ]) {
          const text = renderString(src, contextFor(src, pieces));
          if (text.trim()) out.push({ rel: `${rel} [${pieces.join(",")}]`, text });
        }
    }
  }
  return out;
}

function triggers(wf) {
  const on = wf.on;
  return typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
}

/** Every key and string value under `node`, except step and job `name`s. */
function* strings(node, key = "") {
  if (typeof node === "string") {
    if (key !== "name" || node.includes("${{")) yield node;
  } else if (Array.isArray(node)) for (const x of node) yield* strings(x, key);
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      yield k;
      yield* strings(v, k);
    }
}

const LOCAL = /^\.\/(\.github\/workflows\/[^/@]+\.ya?ml)$/;

/**
 * Violations of the rule: untrusted-trigger workflows (and the local reusable workflows they call)
 * never touch secrets or an environment. `load(path)` returns a parsed local workflow.
 */
function untrustedViolations(rel, wf, load = () => undefined, seen = new Set()) {
  if (!seen.size && !triggers(wf).some((t) => UNTRUSTED.includes(t))) return [];
  const bad = [];
  const scan = (where, node) => {
    const json = JSON.stringify(node);
    for (const str of strings(node)) {
      const rest = str.replaceAll("secrets.GITHUB_TOKEN", "");
      if (/\bsecrets\b/.test(rest))
        bad.push(`${rel} ${where}: secrets use in ${JSON.stringify(str)}`);
    }
    if (/keelstackhq\/hoist\/secrets/.test(json)) bad.push(`${rel} ${where}: hoist secrets action`);
    if (/"environment":/.test(json)) bad.push(`${rel} ${where}: environment`);
    const name = /"([A-Za-z0-9_]*(?:CLOUDFLARE|SOPS_AGE_KEY|SECRETS_READ)[A-Za-z0-9_]*)":/g;
    for (const m of json.matchAll(name)) bad.push(`${rel} ${where}: env ${m[1]}`);
  };
  scan("workflow", { ...wf, jobs: undefined });
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    scan(`job ${id}`, job);
    const m = LOCAL.exec(job.uses ?? "");
    if (job.uses && !m) bad.push(`${rel} job ${id}: non-local reusable workflow ${job.uses}`);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const callee = load(m[1]);
      if (!callee) bad.push(`${rel} job ${id}: cannot read ${m[1]}`);
      else bad.push(...untrustedViolations(`${rel} -> ${m[1]}`, callee, load, seen));
    }
  }
  return bad;
}

test("workflows triggered by pull_request, pull_request_target, merge_group or issue_comment never touch secrets", () => {
  const all = workflows();
  assert.ok(all.length >= 7, `only ${all.length} workflows found`);
  const load = (p) => {
    const hit = all.find((w) => w.rel.includes(`/${p}`));
    return hit && YAML.parse(hit.text);
  };
  const bad = all.flatMap((w) => untrustedViolations(w.rel, YAML.parse(w.text), load));
  assert.deepEqual(bad, []);
});

test("the untrusted-trigger check catches each kind of leak", () => {
  const wf = (job, on = { pull_request: null }) => ({ on, jobs: { j: { steps: [], ...job } } });
  const leaks = [
    { env: { T: "${{ secrets.NPM_TOKEN }}" } },
    { env: { CLOUDFLARE_API_TOKEN: "x" } },
    { env: { SOPS_AGE_KEY: "x" } },
    { env: { SECRETS_READ_APP_KEY: "x" } },
    { environment: "preview" },
    { steps: [{ uses: "keelstackhq/hoist/secrets@" + "a".repeat(40) }] },
    { secrets: "inherit" },
    { env: { T: "${{ secrets['NPM_TOKEN'] }}" } },
    { env: { T: "${{ toJSON(secrets) }}" } },
    { if: "secrets.X != ''" },
  ];
  for (const job of leaks)
    assert.ok(untrustedViolations("x", wf(job)).length > 0, JSON.stringify(job));
  for (const on of UNTRUSTED)
    assert.ok(untrustedViolations("x", wf(leaks[0], { [on]: null })).length > 0, on);
  const token = { env: { T: "${{ secrets.GITHUB_TOKEN }}" } };
  assert.deepEqual(untrustedViolations("x", wf(token)), []);
  assert.deepEqual(untrustedViolations("x", wf(leaks[4], { workflow_run: null })), []);
});

test("the untrusted-trigger check reads expressions in names and flags remote reusable workflows", () => {
  const wf = (job) => ({ on: { pull_request: null }, jobs: { j: job } });
  const named = wf({ steps: [{ name: "${{ secrets.NPM_TOKEN }}" }] });
  assert.ok(untrustedViolations("x", named).length > 0);
  assert.deepEqual(untrustedViolations("x", wf({ steps: [{ name: "no secrets here" }] })), []);
  const remote = wf({ uses: "acme/ci/.github/workflows/x.yml@main" });
  assert.match(untrustedViolations("x", remote).join(), /non-local reusable workflow/);
});

test("the untrusted-trigger check follows local reusable workflows into the callee", () => {
  const caller = { on: { pull_request: null }, jobs: { c: { uses: "./.github/workflows/x.yml" } } };
  const callee = (job) => ({ on: { workflow_call: null }, jobs: { j: { steps: [], ...job } } });
  const load = (job) => (p) => (p === ".github/workflows/x.yml" ? callee(job) : undefined);
  for (const job of [{ environment: "prod" }, { env: { T: "${{ secrets.NPM_TOKEN }}" } }])
    assert.ok(untrustedViolations("x", caller, load(job)).length > 0, JSON.stringify(job));
  assert.deepEqual(untrustedViolations("x", caller, load({ steps: [{ run: "true" }] })), []);
  assert.ok(untrustedViolations("x", caller, () => undefined).length > 0);
  const loop = { on: { workflow_call: null }, jobs: { c: { uses: "./.github/workflows/x.yml" } } };
  assert.deepEqual(
    untrustedViolations("x", caller, () => loop),
    [],
  );
});

test("rendered workflows of a deployable combo, and every .jinja with secrets, are valid YAML", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const wfDir = join(dir, ".github/workflows");
  const files = readdirSync(wfDir);
  assert.ok(files.includes("preview-deploy.yml"));
  for (const f of files) {
    const wf = YAML.parse(readFileSync(join(wfDir, f), "utf8"));
    assert.ok(wf.jobs, f);
    assert.deepEqual(untrustedViolations(f, wf), []);
  }
  for (const w of workflows()) assert.ok(YAML.parse(w.text).jobs, w.rel);
});

const PIN = /^[0-9a-f]{40} +# (v\d\S*|TODO\(hoist-release\))$/;
const HOIST_REF = /keelstackhq\/hoist\/(?:secrets|\.github\/workflows\/secrets-run\.yml)@(.*)$/gm;

function unpinned(text) {
  return [...text.matchAll(HOIST_REF)].filter((m) => !PIN.test(m[1])).map((m) => m[0]);
}

test("every hoist secrets action or secrets-run.yml reference is a 40-hex SHA with a version comment", () => {
  assert.deepEqual(unpinned(`uses: keelstackhq/hoist/secrets@${"a".repeat(40)} # v0.1.0`), []);
  const todo = `uses: keelstackhq/hoist/secrets@${"0".repeat(40)} # TODO(hoist-release)`;
  assert.deepEqual(unpinned(todo), []);
  for (const bad of [
    "keelstackhq/hoist/secrets@v0",
    `keelstackhq/hoist/secrets@${"a".repeat(40)}`,
    `keelstackhq/hoist/secrets@${"a".repeat(39)} # v1`,
    "keelstackhq/hoist/.github/workflows/secrets-run.yml@main # v1",
  ])
    assert.equal(unpinned(bad).length, 1, bad);
  let refs = 0;
  for (const dir of ["template", "template-rust", "rigging"])
    for (const f of walk(join(ROOT, dir))) {
      const text = readFileSync(f, "utf8");
      assert.deepEqual(unpinned(text), [], f);
      refs += [...text.matchAll(HOIST_REF)].length;
    }
  assert.ok(refs >= 1, "preview-deploy.yml.jinja references the action");
});

const EXPR = /\$\{\{([\s\S]*?)\}\}/g;
const SECRETS_REF = /(?<![\w.-])secrets(?![\w-])/i;

/** True when `node` reads a secret other than GITHUB_TOKEN: inside `${{ }}` (or an `if:`), or `secrets:` inherit/map. */
function usesSecret(node, key = "") {
  if (typeof node === "string") {
    const spans = key === "if" ? [node] : [...node.matchAll(EXPR)].map((m) => m[1]);
    return spans.some((e) => SECRETS_REF.test(e.replace(/secrets\.GITHUB_TOKEN/gi, "")));
  }
  if (Array.isArray(node)) return node.some((x) => usesSecret(x, key));
  if (node && typeof node === "object")
    return Object.entries(node).some(
      ([k, v]) =>
        (k === "secrets" && (v === "inherit" || (v && typeof v === "object"))) || usesSecret(v, k),
    );
  return false;
}

/** An `environment:` counts only as a literal name or `{ name: <literal> }`, never an expression. */
function literalEnvironment(e) {
  const name = e && typeof e === "object" ? e.name : e;
  return typeof name === "string" && name !== "" && !name.includes("${{");
}

/**
 * Jobs that reference a secret other than secrets.GITHUB_TOKEN but declare no `environment:`.
 * A secret in workflow-level `env:` applies to every job.
 */
function envlessSecretJobs(rel, wf) {
  const wfWide = usesSecret(wf.env);
  const bad = [];
  for (const [id, job] of Object.entries(wf.jobs ?? {}))
    if ((wfWide || usesSecret(job)) && !literalEnvironment(job.environment))
      bad.push(`${rel} job ${id}: secrets without environment`);
  return bad;
}

test("every job that reads a secret other than GITHUB_TOKEN declares an environment", () => {
  const all = workflows();
  assert.ok(all.length >= 7, `only ${all.length} workflows found`);
  assert.deepEqual(
    all.flatMap((w) => envlessSecretJobs(w.rel, YAML.parse(w.text))),
    [],
  );
});

test("hull's own workflows: every job that reads a secret other than GITHUB_TOKEN declares an environment", () => {
  const dir = join(ROOT, ".github/workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes("splice.yml"));
  const bad = files.flatMap((f) =>
    envlessSecretJobs(f, YAML.parse(readFileSync(join(dir, f), "utf8"))),
  );
  assert.deepEqual(bad, []);
});

test("the environment check catches each form of secret use", () => {
  const job = (x) => ({ jobs: { j: { steps: [], ...x } } });
  for (const x of [
    { env: { T: "${{ secrets.NPM_TOKEN || github.token }}" } },
    { env: { T: "${{ secrets['NPM_TOKEN'] }}" } },
    { env: { T: "${{ toJSON(secrets) }}" } },
    { secrets: "inherit" },
  ])
    assert.equal(envlessSecretJobs("x", job(x)).length, 1, JSON.stringify(x));
  for (const x of [
    { env: { T: "${{ SECRETS.NPM_TOKEN }}" } },
    { secrets: { X: "${{ github.token }}" } },
    { uses: "./.github/workflows/x.yml", secrets: { X: "y" } },
  ])
    assert.equal(envlessSecretJobs("x", job(x)).length, 1, JSON.stringify(x));
  assert.deepEqual(envlessSecretJobs("x", job({ env: { T: "${{ secrets.GITHUB_TOKEN }}" } })), []);
  assert.deepEqual(envlessSecretJobs("x", job({ env: { T: "${{ Secrets.github_token }}" } })), []);
  assert.deepEqual(envlessSecretJobs("x", job({ steps: [{ run: 'echo "no secrets"' }] })), []);
  assert.deepEqual(envlessSecretJobs("x", job({ steps: [{ name: "rotate secrets" }] })), []);
  const wide = { env: { T: "${{ secrets.X }}" }, jobs: { a: {}, b: { environment: "e" } } };
  assert.equal(envlessSecretJobs("x", wide).length, 1);
  assert.deepEqual(envlessSecretJobs("x", job({ environment: "e", secrets: "inherit" })), []);
  assert.deepEqual(
    envlessSecretJobs("x", job({ environment: { name: "e" }, secrets: "inherit" })),
    [],
  );
  for (const environment of ["${{ inputs.env }}", { name: "${{ inputs.env }}" }, { url: "u" }])
    assert.equal(
      envlessSecretJobs("x", job({ environment, env: { T: "${{ secrets.X }}" } })).length,
      1,
      JSON.stringify(environment),
    );
});
