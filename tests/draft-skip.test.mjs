import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderString } from "../scripts/lib/render-file.mjs";
import { referencedNames } from "../scripts/lib/subset.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = ["opened", "synchronize", "reopened", "ready_for_review"];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function render(src) {
  const ctx = { pieces: ["base"] };
  for (const r of referencedNames(src)) if (!r.loop) ctx[r.name.split(".")[0]] ??= "x";
  return renderString(src, ctx);
}

/** Hull's own and every template workflow that runs on pull_request. */
function prWorkflows() {
  const files = [join(ROOT, ".github/workflows")].flatMap((d) => walk(d));
  for (const d of ["template", "template-rust", "rigging"]) files.push(...walk(join(ROOT, d)));
  const out = [];
  for (const f of files) {
    if (!/\.github\/workflows\/[^/]+\.ya?ml(\.jinja)?$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    const text = f.endsWith(".jinja") ? render(src) : src;
    if (!text.trim()) continue;
    const wf = YAML.parse(text);
    const on = wf.on;
    if (on && typeof on === "object" && !Array.isArray(on) && "pull_request" in on)
      out.push({ rel: relative(ROOT, f), wf });
  }
  return out;
}

const all = prWorkflows();

test("PR-triggered workflows are found (hull, template, template-rust)", () => {
  const rels = all.map((w) => w.rel);
  assert.ok(rels.includes(".github/workflows/ci.yml"));
  assert.ok(rels.some((r) => r.startsWith("template/") && r.endsWith("ci.yml.jinja")));
  assert.ok(rels.some((r) => r.startsWith("template/") && r.endsWith("preview.yml")));
  assert.ok(rels.some((r) => r.startsWith("template-rust/")));
});

test("every PR workflow runs on ready_for_review", () => {
  for (const { rel, wf } of all)
    assert.deepEqual(wf.on.pull_request?.types, TYPES, `${rel}: pull_request.types`);
});

test("every job of a PR workflow skips drafts", () => {
  for (const { rel, wf } of all)
    for (const [id, job] of Object.entries(wf.jobs))
      assert.match(
        String(job.if),
        /github\.event\.pull_request\.draft != true/,
        `${rel} job ${id} must skip drafts`,
      );
});

test("every PR workflow cancels superseded PR runs", () => {
  for (const { rel, wf } of all) {
    const c = wf.concurrency;
    assert.ok(c?.group, `${rel}: concurrency group`);
    assert.match(String(c["cancel-in-progress"]), /^true$|event_name == 'pull_request'/, rel);
  }
});
