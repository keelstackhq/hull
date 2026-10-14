import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ciCommand, comboSteps } from "../scripts/dogfood.mjs";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";

const base = fileURLToPath(new URL("../template/pieces/base/files/", import.meta.url));
const tasks = CI_TASKS.join(" ");

test("parity: generated ci.yml, base ci script and dogfood use CI_TASKS", async () => {
  const yml = await readFile(`${base}.github/workflows/ci.yml`, "utf8");
  const turbo = yml.match(/pnpm turbo run ([a-z: ]+?) --affected/);
  assert.equal(turbo?.[1], tasks);
  const query = yml.match(/query affected --tasks ([a-z: ]+?) >/);
  assert.equal(query?.[1], tasks);

  const pkg = await readFile(`${base}package.json.jinja`, "utf8");
  const ci = pkg.match(/"ci": "turbo run ([a-z: ]+?) --affected"/);
  assert.equal(ci?.[1], tasks);

  assert.deepEqual(ciCommand(), ["pnpm", "turbo", "run", ...CI_TASKS]);
  const [cmd, ...args] = [...ciCommand(), "--cache-dir=/c"];
  assert.ok(comboSteps("/c").some(([c, a]) => c === cmd && a.join(" ") === args.join(" ")));
});
