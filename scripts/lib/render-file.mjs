import nunjucks from "nunjucks";

export function createEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    trimBlocks: false,
    lstripBlocks: false,
    throwOnUndefined: true,
  });
}

export function renderString(source, context) {
  return createEnv().renderString(source, context);
}
