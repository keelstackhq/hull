import assert from "node:assert/strict";
import { test } from "node:test";
import { renderString } from "../scripts/lib/render-file.mjs";

const ctx = {
  name: "x",
  pieces: ["base"],
  piece: { id: "base", name: "base" },
  template: { name: "t" },
};

for (const [label, src, re] of [
  ["if", "a\n{% if typo %}x{% endif %}", /line 2.*"typo"/],
  ["elif", "{% if name %}a{% elif typo %}b{% endif %}", /line 1.*"typo"/],
  ["filter", "{{ typo | lower }}", /"typo"/],
  ["bare output", "{{ typo }}", /"typo"/],
  ["dotted unknown", "{{ piece.nope }}", /"piece\.nope"/],
  ["dotted unknown template", "{{ template.version }}", /"template\.version"/],
]) {
  test(`undefined variable in ${label} → error naming the line`, () =>
    assert.throws(() => renderString(src, ctx), re));
}

test("defined vars, dotted names and loop vars still render", () => {
  const src =
    "{{ name | upper }}{{ piece.id }}{% for p in pieces %}[{{ p }}]{% if p %}!{% endif %}{% endfor %}";
  assert.equal(renderString(src, ctx), "Xbase[base]!");
});

test("loop var is not in scope after endfor", () =>
  assert.throws(() => renderString("{% for p in pieces %}{% endfor %}{{ p }}", ctx), /"p"/));

test("names inside comments are ignored", () =>
  assert.equal(renderString("a{# {{ typo }} {% if typo %} #}b", ctx), "ab"));

test("nested loops: inner loop var is out of scope after its endfor", () =>
  assert.throws(
    () =>
      renderString(
        "{% for p in pieces %}{% for q in pieces %}{% endfor %}{{ q }}{% endfor %}",
        ctx,
      ),
    /"q"/,
  ));

test("filter without spaces still checks the name", () =>
  assert.throws(() => renderString("{{zz|lower}}", ctx), /"zz"/));

test("undefined var errors even in a branch not taken", () =>
  assert.throws(
    () => renderString('{% if "x" in pieces %}{{ undefinedvar }}{% endif %}', ctx),
    /"undefinedvar"/,
  ));
