import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { piecesDoc } from "../scripts/pieces-doc.mjs";
import { REAL_TEMPLATE } from "./helpers.mjs";

test("piecesDoc has a heading per piece and every var default", async () => {
  const t = await loadTemplate(REAL_TEMPLATE);
  const doc = piecesDoc(t);
  for (const id of t.pieces.keys()) assert.match(doc, new RegExp(`^## ${id}$`, "m"));
  const all = [
    ...Object.values(t.vars),
    ...[...t.pieces.values()].flatMap((p) => Object.values(p.vars)),
  ];
  assert.ok(all.length > 0);
  for (const v of all) if (v.default !== undefined) assert.ok(doc.includes(`\`${v.default}\``));
  assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"));
  const sections = doc.split(/^## /m);
  for (const [id, p] of t.pieces) {
    const sec = sections.find((x) => x.startsWith(`${id}\n`));
    assert.ok(sec, id);
    assert.ok(sec.includes(`- Multiple instances: ${p.multiple ? "yes" : "no"}`), id);
    if (p.target) assert.ok(sec.includes(`- Target: \`${p.target}\``), id);
    for (const r of p.requires) assert.ok(sec.includes(`\`${r}\``), `${id} requires ${r}`);
    for (const v of Object.values(p.vars))
      if (v.default !== undefined) assert.ok(sec.includes(`\`${v.default}\``), `${id} var default`);
    for (const cls of ["owned", "shared", "seed"])
      for (const g of p.files[cls]) assert.ok(sec.includes(`- \`${g}\``), `${id} ${cls} ${g}`);
  }
});

test("docs/pieces.md on disk equals piecesDoc(template)", async () => {
  const t = await loadTemplate(REAL_TEMPLATE);
  const disk = await readFile(fileURLToPath(new URL("../docs/pieces.md", import.meta.url)), "utf8");
  assert.equal(disk, piecesDoc(t), "run: pnpm docs:pieces");
});
