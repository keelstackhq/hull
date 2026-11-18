const CLASSES = ["owned", "shared", "seed"];

/** Contract §9.1 glob: `*` stays within one segment, `**` crosses segments; dotfiles match; every
 * other character is literal. */
function globSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?"; // zero or more whole segments
      i += 2;
    } else if (glob.startsWith("/**", i) && i + 3 === glob.length) {
      out += "(?:/.*)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (glob[i] === "*") out += "[^/]*";
    else out += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/** A matcher for any of `globs` (contract §9.1). */
export function globMatcher(globs) {
  if (globs.length === 0) return () => false;
  const re = new RegExp(`^(?:${globs.map(globSource).join("|")})$`);
  return (path) => re.test(path);
}

const matcherCache = new Map();
function matches(globs, path) {
  if (globs.length === 0) return false;
  const key = globs.join("\0");
  let m = matcherCache.get(key);
  if (!m) {
    m = globMatcher(globs);
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
