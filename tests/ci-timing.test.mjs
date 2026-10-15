import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { jobSeconds, run, summarize } from "../scripts/ci-timing.mjs";

const fx = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/gh/${name}.json`, import.meta.url), "utf8"));

/** Fake gh: list returns runs.json, view returns the fixture mapped from the run id. */
function fakeGh(byId) {
  return async (args) => {
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(fx("runs"));
    if (args[0] === "run" && args[1] === "view") return JSON.stringify(fx(byId[args[2]]));
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
}

test("job seconds from startedAt/completedAt", () => assert.equal(jobSeconds(fx("run-ok")), 38));

test("cancelled and skipped jobs are null", () => {
  assert.equal(jobSeconds(fx("run-cancelled")), null);
  assert.equal(jobSeconds(fx("run-skipped")), null);
});

test("a missing job or another job name", () => {
  assert.equal(jobSeconds({ jobs: [] }), null);
  assert.equal(jobSeconds(fx("run-ok"), "ci-ok"), 2);
});

test("p50/p90", () => {
  assert.deepEqual(summarize([10, 20, 30, 40, 50]), { n: 5, p50: 30, p90: 50 });
  assert.deepEqual(summarize([5]), { n: 1, p50: 5, p90: 5 });
  assert.deepEqual(summarize([9, 5]), { n: 2, p50: 5, p90: 9 });
});

test("summarize of nothing", () => assert.deepEqual(summarize([]), { n: 0, p50: null, p90: null }));

test("CLI exits 1 over budget", async () => {
  const gh = fakeGh({ 101: "run-slow", 102: "run-slow", 103: "run-ok", 104: "run-slow" });
  const r = await run(["--repo", "o/r", "--budget", "45"], { gh });
  assert.equal(r.code, 1);
  assert.match(r.out, /p50/);
});

test("CLI exits 0 within budget and ignores cancelled/skipped runs", async () => {
  const gh = fakeGh({ 101: "run-ok", 102: "run-cancelled", 103: "run-skipped", 104: "run-ok" });
  const r = await run(["--repo", "o/r", "--budget", "45"], { gh });
  assert.equal(r.code, 0);
  assert.match(r.out, /n=2/);
  assert.match(r.out, /p50=38/);
});

test("gh run list is limited to pull_request runs", async () => {
  const seen = [];
  const gh = async (args) => {
    seen.push(args);
    return args[1] === "list" ? "[]" : "{}";
  };
  await run(["--repo", "o/r"], { gh });
  const list = seen.find((a) => a[1] === "list");
  assert.equal(list[list.indexOf("-e") + 1], "pull_request");
});

test("CLI with no usable runs exits 1", async () => {
  const gh = fakeGh({
    101: "run-cancelled",
    102: "run-cancelled",
    103: "run-skipped",
    104: "run-skipped",
  });
  const r = await run(["--repo", "o/r"], { gh });
  assert.equal(r.code, 1);
});

test("bad --repo or missing flag exits 2", async () => {
  for (const argv of [
    ["--repo", "nope"],
    ["--repo", "a/b/c"],
    [],
    ["--repo", "o/r", "--limit", "x"],
  ]) {
    const r = await run(argv, { gh: fakeGh({}) });
    assert.equal(r.code, 2, argv.join(" "));
  }
});

test("missing gh exits 2 with a clear message", async () => {
  const gh = async () => {
    throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
  };
  const r = await run(["--repo", "o/r"], { gh });
  assert.equal(r.code, 2);
  assert.match(r.err, /gh/);
  assert.match(r.err, /install/i);
});
