import nunjucks from "nunjucks";
import { referencedNames } from "./subset.mjs";

export function createEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    trimBlocks: false,
    lstripBlocks: false,
    throwOnUndefined: true,
  });
}

function isDefined(name, context) {
  const [head, ...rest] = name.split(".");
  if (!Object.hasOwn(context, head)) return false;
  let v = context[head];
  for (const k of rest) {
    if (v === null || typeof v !== "object" || !Object.hasOwn(v, k)) return false;
    v = v[k];
  }
  return true;
}

/** Contract §9.12: every referenced variable must exist in the context. */
export function checkDefined(source, context) {
  for (const r of referencedNames(source)) {
    if (!r.loop && !isDefined(r.name, context)) {
      throw new Error(`line ${r.line}: undefined variable "${r.name}"`);
    }
  }
}

export function renderString(source, context) {
  const src = source.replace(/\r\n/g, "\n");
  checkDefined(src, context);
  return createEnv().renderString(src, context).replace(/\r\n/g, "\n");
}
