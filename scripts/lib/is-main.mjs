import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the module at `url` (pass `import.meta.url`) is the script node was started with.
 * Compares real paths: `import.meta.url` has symlinks resolved, `process.argv[1]` does not, so a
 * plain comparison is false in a symlinked checkout and the script would silently do nothing.
 * @param {string} url
 */
export function isMain(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(url);
  } catch {
    return false;
  }
}
