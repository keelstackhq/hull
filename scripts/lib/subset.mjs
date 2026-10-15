import { IDENT_SRC, RESERVED_IDENTS, segmentProblem } from "./segment.mjs";

// Checks a .jinja source against the portable template subset (contract §4, §9).

const TAG_RE = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}|\{#([\s\S]*?)#\}/g;
const IDENT = IDENT_SRC;
const OUTPUT_RE = new RegExp(`^(${IDENT}(?:\\.${IDENT})*)(?:\\s*\\|\\s*(lower|upper))?$`);
const FILTER_RE = new RegExp(`^${IDENT}(?:\\.${IDENT})*\\s*\\|\\s*(${IDENT})\\b`);
const NAME_RE = new RegExp(`^${IDENT}(?:\\.${IDENT})*$`);
const PIECE_IN_RE = /^"([^"]+)"\s+in\s+pieces$/;
const FOR_RE = new RegExp(`^for\\s+(${IDENT})\\s+in\\s+(\\S+)$`);
const DOTTED = new Set(["piece.id", "piece.name", "template.name", "template.version"]);

/** @typedef {{ file: string, line: number, tag: string, reason: string }} Violation */

const KEYWORDS = new Set(RESERVED_IDENTS);
const BARE_RESERVED = new Set(["pieces", "piece", "template"]);

/** Returns the reason a variable reference is invalid, or null. */
function nameProblem(name) {
  const head = name.split(".")[0];
  if (KEYWORDS.has(head)) return `keyword or literal "${head}" cannot be used as a variable`;
  if (!name.includes(".") && BARE_RESERVED.has(name)) {
    return `bare "${name}" is not allowed (use "id" in pieces, piece.id, piece.name, template.name or template.version)`;
  }
  if (name.includes(".") && !DOTTED.has(name)) {
    return `dotted name "${name}" not allowed (only piece.id, piece.name, template.name, template.version)`;
  }
  return null;
}

function checkOutput(expr) {
  const m = OUTPUT_RE.exec(expr);
  if (m) return nameProblem(m[1]);
  if (/^[^|]*\|[^|]*\|/.test(expr) && NAME_RE.test(expr.split("|")[0].trim())) {
    return "chained filters are not allowed";
  }
  const f = FILTER_RE.exec(expr);
  if (f) return `filter "${f[1]}" not allowed (only lower, upper)`;
  return "expression not allowed in output tag (only var, optionally | lower or | upper)";
}

function checkCondition(expr) {
  const pin = PIECE_IN_RE.exec(expr);
  if (pin) {
    const p = segmentProblem(pin[1]);
    return p ? `piece id ${JSON.stringify(pin[1])} ${p}` : null;
  }
  if (!NAME_RE.test(expr)) {
    return 'expression not allowed in condition (only var or "piece-id" in pieces)';
  }
  return nameProblem(expr);
}

/**
 * @param {string} source
 * @param {string} file
 * @returns {Violation[]}
 */
export function checkSubset(source, file) {
  /** @type {Violation[]} */
  const out = [];
  /** @type {{ kind: string, line: number, tag: string, sawElse?: boolean }[]} */
  const stack = [];
  const report = (line, tag, reason) => out.push({ file, line, tag, reason });

  for (const m of source.matchAll(TAG_RE)) {
    const tag = m[0];
    const line = source.slice(0, m.index).split("\n").length;
    const inner = m[1] ?? m[2] ?? m[3];
    if (/^[-+~]/.test(inner) || /[-+~]$/.test(inner)) {
      report(line, tag, "whitespace control is not allowed");
      continue;
    }
    if (m[3] !== undefined) continue;
    const expr = inner.trim();

    if (m[1] !== undefined) {
      const reason = checkOutput(expr);
      if (reason) report(line, tag, reason);
      continue;
    }

    const kw = /^[A-Za-z_]+/.exec(expr)?.[0] ?? "";
    const rest = expr.slice(kw.length).trim();
    const top = stack.at(-1);
    switch (kw) {
      case "if":
      case "elif": {
        if (kw === "if") stack.push({ kind: "if", line, tag });
        else if (top?.kind !== "if") report(line, tag, "unexpected elif outside if");
        else if (top.sawElse) report(line, tag, "elif after else");
        const reason = checkCondition(rest);
        if (reason) report(line, tag, reason);
        break;
      }
      case "else":
        if (rest) report(line, tag, "else takes no arguments");
        if (top?.kind !== "if") report(line, tag, "unexpected else outside if");
        else if (top.sawElse) report(line, tag, "duplicate else");
        else top.sawElse = true;
        break;
      case "endif":
      case "endfor": {
        const kind = kw.slice(3);
        if (rest) report(line, tag, `${kw} takes no arguments`);
        if (top?.kind === kind) stack.pop();
        else report(line, tag, `unexpected ${kw}`);
        break;
      }
      case "for": {
        stack.push({ kind: "for", line, tag });
        const f = FOR_RE.exec(expr);
        if (!f) report(line, tag, 'for must be "for x in pieces"');
        else if (f[2] !== "pieces") report(line, tag, 'for iterates only "pieces"');
        else if (KEYWORDS.has(f[1]) || BARE_RESERVED.has(f[1])) {
          report(line, tag, `loop variable "${f[1]}" is reserved`);
        }
        break;
      }
      default:
        report(line, tag, `tag "${kw || expr}" is not allowed in the portable subset`);
    }
  }

  const ranges = [...source.matchAll(TAG_RE)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of source.matchAll(/\{[{%#]/g)) {
    if (ranges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const line = source.slice(0, m.index).split("\n").length;
    report(line, m[0], `unterminated tag "${m[0]}"`);
  }

  for (const s of stack) report(s.line, s.tag, `unclosed ${s.kind} block`);
  return out;
}

/**
 * Variable references of a .jinja source, with `for` loop variables resolved.
 * Unparseable tags are skipped (checkSubset reports them).
 * @param {string} source
 * @returns {{ name: string, line: number, loop: boolean }[]} loop: name is a loop variable
 */
export function referencedNames(source) {
  const out = [];
  /** @type {{ kind: string, v?: string }[]} */
  const stack = [];
  const loops = () => stack.filter((s) => s.v).map((s) => s.v);
  const add = (name, line) => {
    if (KEYWORDS.has(name.split(".")[0])) return;
    out.push({ name, line, loop: loops().includes(name.split(".")[0]) });
  };
  for (const m of source.matchAll(TAG_RE)) {
    if (m[3] !== undefined) continue;
    const line = source.slice(0, m.index).split("\n").length;
    const expr = (m[1] ?? m[2]).trim();
    if (m[1] !== undefined) {
      const o = OUTPUT_RE.exec(expr) ?? new RegExp(`^(${IDENT}(?:\\.${IDENT})*)\\s*\\|`).exec(expr);
      if (o) add(o[1], line);
      continue;
    }
    const kw = /^[A-Za-z_]+/.exec(expr)?.[0] ?? "";
    const rest = expr.slice(kw.length).trim();
    if (kw === "if") stack.push({ kind: "if" });
    if ((kw === "if" || kw === "elif") && NAME_RE.test(rest)) add(rest, line);
    if (kw === "for") {
      const f = FOR_RE.exec(expr);
      stack.push({ kind: "for", v: f?.[1] });
    }
    if (kw === "endif" || kw === "endfor") stack.pop();
  }
  return out;
}
