import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

test("hull's own workflows are valid YAML with jobs", async () => {
  const files = (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const doc = YAML.parseDocument(await readFile(DIR + f, "utf8"));
    assert.deepEqual(doc.errors.map(String), [], f);
    assert.ok(doc.toJS().jobs, `${f} has jobs`);
  }
});
