import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSubset, referencedNames, usesRaw } from "../scripts/lib/subset.mjs";

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
  "{% raw %}{{ x }}{% endraw %}",
  "{%raw%}{{ x }}{%endraw%}",
  "{%\traw\n%}{% if %}{%\tendraw %}",
  "a ${% raw %}{{ secrets.X }}{% endraw %}",
  "{% raw %}#} {# {{ {% set %}{% endraw %}",
  "{% if a %}{% raw %}{% else %}{% endraw %}{% endif %}",
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
  ["{{ None }}", /expression not allowed/],
  ["{{ loop }}", /keyword/],
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

// --- raw blocks (contract §4, §9.23)
const rawBad = [
  ["{% raw %}{% raw %}x{% endraw %}", /nested raw/],
  ["{% raw %}{%raw%}x{% endraw %}", /nested raw/],
  ["{% raw %}{%- raw %}x{% endraw %}", /nested raw/],
  ["{% raw %}x{% endraw -%}", /endraw/],
  ["{% raw %}x{%- endraw %}", /endraw/],
  ["{% raw %}x{% endraw+ %}", /endraw/],
  ["{% raw %}x{%\vendraw %}", /endraw/],
  ["{% raw %}x{%\u00a0endraw %}", /endraw/],
  ["{%- raw %}x{% endraw %}", /raw/],
  ["{% raw -%}x{% endraw %}", /raw/],
  ["{% raw %}x", /unterminated raw/],
  ["a\n{% raw %}x", /unterminated raw/],
  ["{% endraw %}", /stray endraw/],
  ["x {% endraw %} {% raw %}y{% endraw %}", /stray endraw/],
];
for (const [s, re] of rawBad)
  test(`rejects raw misuse ${JSON.stringify(s)}`, () => {
    const v = checkSubset(s, "f");
    assert.ok(v.length > 0, "expected a violation");
    assert.ok(
      v.some((x) => re.test(x.reason)),
      JSON.stringify(v),
    );
  });
test("raw error names file and line", () => {
  const v = checkSubset("a\nb\n{% raw %}x", "g.jinja")[0];
  assert.equal(v.file, "g.jinja");
  assert.equal(v.line, 3);
});
test("stray endraw reports its line", () =>
  assert.equal(checkSubset("a\n{% endraw %}", "f")[0].line, 2));
test("raw is not allowed in a path segment", () => {
  const v = checkSubset("a{% raw %}b{% endraw %}", "f", { path: true });
  assert.match(v[0].reason, /raw.*path/);
});
test("raw bodies are masked from undefined-variable detection", () =>
  assert.deepEqual(referencedNames("{% raw %}{{ nope }}{% endraw %}{{ v }}"), [
    { name: "v", line: 1, loop: false },
  ]));
test("raw bodies are masked from the unterminated-opener check", () =>
  assert.deepEqual(checkSubset("{% raw %}{{ a {% if{% endraw %}", "f"), []));
test("usesRaw detects raw blocks", () => {
  assert.equal(usesRaw("a {% raw %}x{% endraw %}"), true);
  assert.equal(usesRaw("{# {% raw %} #}{{ a }}"), false);
});

// --- stray #} (§9.24)
test("stray #} in plain text is rejected with its line", () => {
  const v = checkSubset("a\nb #} c", "g.jinja");
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
  assert.equal(v[0].file, "g.jinja");
  assert.match(v[0].reason, /stray "#\}"/);
});
test("stray #} in a path segment is rejected", () =>
  assert.match(checkSubset("a#}b", "f", { path: true })[0].reason, /stray/));

// --- whitespace inside tags is [ \t\r\n] only (§9.19)
for (const [name, s] of [
  ["NBSP in output", "{{\u00a0a }}"],
  ["NBSP before the name", "{{ \u00a0a}}"],
  ["NBSP around a filter", "{{ a |\u00a0lower }}"],
  ["vertical tab", "{{\va}}"],
  ["form feed in if", "{% if\fa %}{% endif %}"],
  ["ideographic space in for", "{% for p\u3000in pieces %}{% endfor %}"],
  ["NBSP in tag keyword gap", "{%\u00a0if a %}{% endif %}"],
  ["NBSP in piece test", '{% if "x"\u00a0in pieces %}{% endif %}'],
])
  test(`rejects ${name}`, () => assert.ok(checkSubset(s, "f").length > 0));
for (const s of ["{{\ta\r\n}}", "{{a|lower}}", "{% if\ta\n%}{% endif %}"])
  test(`allows ASCII whitespace ${JSON.stringify(s)}`, () =>
    assert.deepEqual(checkSubset(s, "f"), []));
