import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dogfood } from "../scripts/dogfood.mjs";

test("a render failure fails that combo without throwing", async () => {
  const root = await mkdtemp(join(tmpdir(), "hull-df-"));
  const results = await dogfood({
    combos: ["base", "base"],
    root,
    template: join(root, "missing-template"),
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok === false));
});
