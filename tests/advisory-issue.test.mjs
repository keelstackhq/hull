import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { check } from "./ci-minutes-gate.mjs";

const BASE = fileURLToPath(new URL("../template-rust/pieces/base/files/", import.meta.url));
const { plan, TITLE, LABEL, fence } = await import(`${BASE}.github/scripts/advisory-issue.mjs`);
const wfText = readFileSync(`${BASE}.github/workflows/advisories.yml`, "utf8");

const open = (n, body = "old") => ({ number: n, title: TITLE, body });

test("advisory plan: findings and no open issue creates one", () => {
  const p = plan({ ok: false, report: "RUSTSEC-1", issues: [] });
  assert.equal(p.action, "create");
  assert.equal(p.title, TITLE);
  assert.match(p.body, /RUSTSEC-1/);
});

test("advisory plan: findings update the lowest open issue with the fixed title only", () => {
  const issues = [open(9), { number: 2, title: "other", body: "" }, open(5)];
  const p = plan({ ok: false, report: "R", issues });
  assert.equal(p.action, "update");
  assert.equal(p.number, 5);
});

test("advisory plan: an unchanged report is a no-op", () => {
  const first = plan({ ok: false, report: "R", issues: [] });
  assert.equal(plan({ ok: false, report: "R", issues: [open(3, first.body)] }).action, "none");
});

test("advisory plan: clean scan closes the open issue, else does nothing", () => {
  const c = plan({ ok: true, report: "", issues: [open(4)] });
  assert.equal(c.action, "close");
  assert.equal(c.number, 4);
  assert.ok(c.comment);
  assert.equal(plan({ ok: true, report: "", issues: [] }).action, "none");
});

test("advisory plan: a long report is truncated and fences cannot be closed by it", () => {
  const p = plan({ ok: false, report: "x".repeat(100000), issues: [] });
  assert.ok(p.body.length < 65536);
  assert.ok(fence("a\n```\nb").startsWith("````"));
  assert.equal(LABEL, "advisories");
});

test("advisories.yml: weekly schedule, default-branch gate, least privilege, one job", () => {
  const wf = YAML.parse(wfText);
  assert.equal(wf.on.schedule.length, 1);
  assert.match(wf.on.schedule[0].cron, /^([1-9]\d?) \d+ \* \* \d$/);
  assert.ok("workflow_dispatch" in wf.on);
  assert.deepEqual(wf.concurrency, { group: "advisories", "cancel-in-progress": true });
  assert.deepEqual(Object.keys(wf.jobs), ["scan"]);
  assert.deepEqual(wf.jobs.scan.permissions, { contents: "read", issues: "write" });
  assert.match(wf.jobs.scan.if, /default_branch/);
  assert.ok(!/secrets\./.test(wfText));
  assert.deepEqual(check(wfText), []);
});
