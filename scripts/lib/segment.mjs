// Path-segment and identifier rules shared by manifest, subset and plan (contract proposals).

export const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
export const IDENT_SRC = "[a-z_][a-z0-9_]*";
export const RESERVED_IDENTS = new Set([
  "true",
  "false",
  "none",
  "not",
  "and",
  "or",
  "in",
  "is",
  "loop",
  "self",
  "range",
  "namespace",
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Returns why `seg` cannot be a rendered path segment, or null. */
export function segmentProblem(seg) {
  if (seg === "") return "is empty";
  if (seg === "." || seg === "..") return `"${seg}" is not allowed`;
  // eslint-disable-next-line no-control-regex
  if (/[/\\:\u0000-\u001f\u007f]/.test(seg))
    return "contains a forbidden character (/ \\ : or control)";
  if (/[. ]$/.test(seg)) return "ends with a dot or space";
  if (WINDOWS_RESERVED.test(seg.split(".")[0].replace(/ +$/, ""))) {
    return "is a Windows reserved name";
  }
  if (seg.toLowerCase() === ".git") return 'is ".git"';
  return null;
}

/** Checks every segment of a "/"-separated path; returns a reason or null. */
export function pathProblem(path) {
  for (const seg of path.split("/")) {
    const p = segmentProblem(seg);
    if (p) return `segment ${JSON.stringify(seg)} ${p}`;
  }
  return null;
}
