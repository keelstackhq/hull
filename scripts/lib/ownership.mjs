import picomatch from "picomatch";

const CLASSES = ["owned", "shared", "seed"];

const matcherCache = new Map();
function matches(globs, path) {
  if (globs.length === 0) return false;
  const key = globs.join("\0");
  let m = matcherCache.get(key);
  if (!m) {
    m = picomatch(globs, { dot: true });
    matcherCache.set(key, m);
  }
  return m(path);
}

export function outputPath(rel) {
  return rel.endsWith(".jinja") ? rel.slice(0, -".jinja".length) : rel;
}

export function overlaps(path, files) {
  return CLASSES.filter((c) => matches(files[c] ?? [], path));
}

export function classify(path, files) {
  return overlaps(path, files)[0] ?? "owned";
}

export function mergeStrategy(path, merge) {
  for (const [glob, strategy] of Object.entries(merge)) {
    if (matches([glob], path)) return strategy;
  }
  return "text";
}
