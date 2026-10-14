import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSubset } from "../scripts/lib/subset.mjs";

const ok = [
  "{{ scope }}",
  "{{ piece.name | upper }}",
  "{{ name | lower }}",
  "{{ template.version }}",
  "{% if scope %}a{% elif x %}b{% else %}c{% endif %}",
  '{% if "hono-worker" in pieces %}x{% endif %}',
  "{% for p in pieces %}{{ p }}{% endfor %}",
  "{# note #}",
  "{{ piece.name }}",
  "{# c {{ x #}",
];
for (const s of ok) test(`allows ${s}`, () => assert.deepEqual(checkSubset(s, "f"), []));

const bad = [
  ["{% set x = 1 %}", /set/],
  ["{%- if a %}{% endif %}", /whitespace control/],
  ['{{ a | default("x") }}', /filter "default"/],
  ['{% if a == "b" %}{% endif %}', /expression/],
  ["{% if a or b %}{% endif %}", /expression/],
  ['{% include "x" %}', /include/],
  ["{% macro m() %}{% endmacro %}", /macro/],
  ["{{ a ~ b }}", /expression/],
  ["{% for k in vars %}{% endfor %}", /only "pieces"/],
  ["{% if not a %}{% endif %}", /expression/],
  ["{% if a and b %}{% endif %}", /expression/],
  ["{% if a %}{% elif b or c %}{% endif %}", /expression/],
  ["{% if pieces %}{% endif %}", /pieces/],
  ["{% if a -%}{% endif %}", /whitespace control/],
  ["{{- a }}", /whitespace control/],
  ["{{ vars.scope }}", /dotted/],
  ['{% if "x" not in pieces %}{% endif %}', /expression/],
  ["{{ pieces }}", /bare "pieces"/],
  ["{{ piece }}", /bare "piece"/],
  ["{{ template }}", /bare "template"/],
  ["{% if piece %}{% endif %}", /bare "piece"/],
  ["{% if template %}{% endif %}", /bare "template"/],
  ["{{ a", /unterminated/],
  ["{% if a", /unterminated/],
  ["{# x", /unterminated/],
  ["{{ a }", /unterminated/],
  ["{% if a %}{% else %}{% else %}{% endif %}", /duplicate else/],
  ["{% if a %}{% else %}{% elif b %}{% endif %}", /elif after else/],
  ["{{ true }}", /keyword/],
  ["{{ None }}", /keyword/],
  ["{% if and %}{% endif %}", /keyword/],
  ["{% if is %}{% endif %}", /keyword/],
  ["{{ a | lower | upper }}", /chained filters/],
  ["{% for pieces in pieces %}{% endfor %}", /loop variable/],
  ["{% for piece in pieces %}{% endfor %}", /loop variable/],
  ["{% for in in pieces %}{% endfor %}", /loop variable/],
];
for (const [s, re] of bad)
  test(`rejects ${s}`, () => assert.match(checkSubset(s, "f")[0].reason, re));

test("reports the line number", () =>
  assert.equal(checkSubset("a\nb\n{% set x %}", "f")[0].line, 3));
test("flags unbalanced if/endif", () =>
  assert.match(checkSubset("{% if a %}", "f")[0].reason, /unclosed/));
test("flags stray endif and file name", () => {
  const v = checkSubset("{% endif %}", "g.jinja")[0];
  assert.equal(v.file, "g.jinja");
  assert.match(v.reason, /unexpected/);
});
