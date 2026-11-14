// Fixture check of the Actions-minutes rules in org decision D-007 on every workflow every combo
// renders. This is NOT bosun's own `ci-minutes` gate (its source was not readable when this was
// written); it keeps rendered workflows inside what D-007 states, so drift is caught here.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderNew } from "../scripts/render.mjs";
import { comboTemplate, comboVars, loadCombos } from "../scripts/lib/combos.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { vars, combos } = loadCombos();
const NOISY = [
  "issue_comment",
  "pull_request_review_comment",
  "pull_request_review",
  "labeled",
  "edited",
];
const RELEASE = /^(release|desktop|deploy)\.yml$/;

/** Event names a workflow triggers on, with their `types`. */
function triggers(wf) {
  const on = wf.on ?? wf[true] ?? {};
  if (typeof on === "string") return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]));
  return on;
}

for (const combo of combos) {
  test(`D-007 rules hold for every workflow of combo ${combo.name}`, async () => {
    const out = join(await mkdtemp(join(tmpdir(), "d007-")), "out");
    await renderNew({
      template: join(ROOT, comboTemplate(combo)),
      out,
      pieces: combo.pieces,
      vars: comboVars(combo, vars),
    });
    const dir = join(out, ".github/workflows");
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const wf = YAML.parse(await readFile(join(dir, file), "utf8"));
      const on = triggers(wf);
      const jobs = Object.values(wf.jobs ?? {});
      // Windows and macOS runners only in release workflows.
      for (const j of jobs) {
        const runner = JSON.stringify(j["runs-on"] ?? "");
        if (/windows|macos/i.test(runner)) assert.match(file, RELEASE, `${file}: ${runner}`);
      }
      // Crons at most weekly: day-of-month and month are `*`, and one day of week at most.
      for (const s of on.schedule ?? []) {
        const [min, hour, dom, mon, dow] = s.cron.trim().split(/\s+/);
        assert.ok(/^\d+$/.test(min) && /^\d+$/.test(hour), `${file}: ${s.cron}`);
        assert.ok(
          dom === "*" && mon === "*" && /^\d$/.test(dow),
          `${file}: ${s.cron} is not weekly`,
        );
      }
      // Comment, label and edit events must be filtered by a job-level `if`.
      const noisy = Object.entries(on).some(
        ([ev, cfg]) => NOISY.includes(ev) || (cfg?.types ?? []).some((t) => NOISY.includes(t)),
      );
      if (noisy) {
        for (const [name, j] of Object.entries(wf.jobs)) {
          assert.ok(j.if, `${file}: job ${name} reacts to comment/label/edit events without an if`);
        }
      }
    }
  });
}
