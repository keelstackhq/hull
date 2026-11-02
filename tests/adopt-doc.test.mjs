import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const DOC = read("docs/adopt.md");
const { CLASH, DETECT } = await import(
  fileURLToPath(new URL("../template/pieces/base/files/scripts/ready.mjs", import.meta.url))
);

/** Detection table rows: | `id` | signal | template/piece | */
const rows = () =>
  [...DOC.matchAll(/^\| `([a-z-]+)` +\| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => ({
    id: m[1],
    signal: m[2].trim(),
    gives: m[3].trim(),
  }));

test("adopt.md's detection table lists DETECT in order, with the same signal and result", () => {
  assert.deepEqual(
    rows(),
    DETECT.map((r) => ({
      id: r.id,
      signal: r.signal,
      gives: r.template ? `\`${r.template}/\`` : r.piece ? `\`${r.piece}\`` : "where pieces go",
    })),
  );
});

test("adopt.md lists CLASH exactly, per class and template", () => {
  for (const [t, classes] of Object.entries(CLASH)) {
    for (const [cls, patterns] of Object.entries(classes)) {
      const line = `  - \`${t}/\`: ${patterns
        .split(" ")
        .map((p) => `\`${p}\``)
        .join(", ")}`;
      assert.ok(DOC.includes(line), `${t} ${cls}: missing ${line}`);
    }
  }
});

test("adopt.md names every CLASH class and the flow steps in order", () => {
  for (const cls of Object.keys(CLASH.template))
    assert.match(DOC, new RegExp(`\\*\\*${cls}\\*\\*`), cls);
  const steps = [...DOC.matchAll(/^\d+\. \*\*([a-z-]+)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(steps, [
    "assess",
    "confirm",
    "branch",
    "dry-run",
    "review",
    "adopt",
    "fix",
    "ready",
    "pr",
    "channels",
    "hoist",
  ]);
  assert.match(DOC, /node ready\.mjs --assess --json/);
  assert.match(DOC, /needs splice >= 0\.4\.0/);
  assert.match(DOC, /--allow-dirty/);
  assert.match(DOC, /`splice check` fails until/);
});

test("the start checklist sends existing repos to adopt.md", () => {
  assert.match(read("docs/start-checklist.md"), /existing repo.*\(adopt\.md\)/i);
});
