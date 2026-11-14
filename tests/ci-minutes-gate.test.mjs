import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";
import { comboTemplate, comboVars, loadCombos } from "../scripts/lib/combos.mjs";
import { check, skipsDraft } from "./ci-minutes-gate.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { vars, combos } = loadCombos();

test("skipsDraft: the accepted guards, && and || forms", () => {
  assert.ok(
    skipsDraft("github.event_name != 'pull_request' || github.event.pull_request.draft == false"),
  );
  assert.ok(skipsDraft("github.event.pull_request.draft != true"));
  assert.ok(skipsDraft("github.event.pull_request.draft != true && needs.x.result == 'success'"));
  assert.ok(skipsDraft("github.event_name == 'push' || github.event.pull_request.draft == false"));
  assert.ok(!skipsDraft("needs.x.result == 'success'"));
  assert.ok(!skipsDraft("github.event_name == 'pull_request'"));
  assert.ok(!skipsDraft(undefined));
});

test("check: a bare PR workflow trips draft, ready_for_review and concurrency", () => {
  const found = check("on: pull_request\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n");
  for (const rule of ["draft", "ready_for_review", "concurrency"]) {
    assert.ok(
      found.some((f) => f.startsWith(`${rule}:`)),
      `${rule} in ${found}`,
    );
  }
});

test("check: ci-ok that skips drafts or lacks always() is flagged; the allow marker silences concurrency", () => {
  const wf = `# ci-minutes: allow concurrency never cancelled\non:\n  pull_request:\n    types: [opened, ready_for_review]\njobs:\n  ci-ok:\n    needs: [a]\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    steps: []\n`;
  const found = check(wf);
  assert.ok(found.some((f) => f.startsWith("aggregate: ci-ok must not skip")));
  assert.ok(found.some((f) => f.includes("always()")));
  assert.ok(!found.some((f) => f.startsWith("concurrency:")));
});

for (const combo of combos) {
  test(`bosun ci-minutes rules hold for every workflow of combo ${combo.name}`, async () => {
    const out = join(await mkdtemp(join(tmpdir(), "cim-")), "out");
    await renderNew({
      template: join(ROOT, comboTemplate(combo)),
      out,
      pieces: combo.pieces,
      vars: comboVars(combo, vars),
    });
    const dir = join(out, ".github/workflows");
    if (!existsSync(dir)) return;
    const findings = [];
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      for (const f of check(await readFile(join(dir, file), "utf8")))
        findings.push(`${file}: ${f}`);
    }
    assert.deepEqual(findings, []);
  });
}
