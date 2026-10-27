// PR previews in two phases. `build` (pull_request, no secrets) packs each app's built output
// (`dist`: a Worker bundle or static dir) into an artifact. `deploy` (workflow_run, default-branch
// checkout, environment preview) rejects anything but plain output, then uploads a version of the
// `<name>-preview` Worker (`wrangler versions upload --no-bundle --preview-alias pr-<n>`) from a
// minimal generated config: no production bindings, routes or domains, only `env.preview` bindings.
// No PR code runs and nothing is built. With no subcommand: the legacy single-job turbo path, until
// preview.yml moves to the two phases. Node built-ins only.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TURBO_ARGS = [
  "turbo",
  "run",
  "deploy:preview",
  "--affected",
  "--continue",
  "--log-prefix=task",
];

const NOT_CREATED = /cannot upload a new version of a Worker that does not yet exist/;
const FORBIDDEN =
  /^(wrangler\.json|package\.json$|pnpm-lock\.yaml$|_worker\.js|\.assetsignore$)|\.toml$/i;
const forbiddenName = (n) => FORBIDDEN.test(n);
const DIR = /^[a-z0-9][a-z0-9_-]*$/i;
const NAME = /^[a-z0-9][a-z0-9-]*$/i;

/** Violations in an artifact tree: forbidden names, symlinks and anything but files and dirs. */
export function checkArtifact(root) {
  const bad = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (forbiddenName(e.name)) bad.push(`${p}: forbidden name`);
      else if (e.isDirectory()) walk(p);
      else if (!e.isFile()) bad.push(`${p}: ${e.isSymbolicLink() ? "symlink" : "special file"}`);
    }
  };
  walk("");
  return bad;
}

/** JSON.parse of JSONC: comments and trailing commas outside strings are dropped. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"' && j < text.length) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      i = i < 0 ? text.length : i + 1;
      out += " ";
    } else if (c === "]" || c === "}") {
      // A comma right before a closer (only whitespace between) is a trailing comma.
      const t = out.trimEnd();
      out = (t.endsWith(",") ? t.slice(0, -1) + out.slice(t.length) : out) + c;
    } else out += c;
  }
  return JSON.parse(out);
}

const BINDINGS = "vars kv_namespaces d1_databases r2_buckets services queues durable_objects".split(
  " ",
);

/**
 * The only config a preview is deployed with, built from the default-branch wrangler.jsonc: name,
 * entry or assets, compatibility, and the bindings of `env.preview` (never top-level bindings,
 * routes, domains or workers_dev).
 */
export function previewConfig(cfg, { entry, assets }) {
  const out = { name: `${cfg.name}-preview` };
  if (entry) out.main = entry;
  if (!entry || cfg.assets) {
    // Only the directory and not_found_handling: never `binding` or `run_worker_first`.
    out.assets = { directory: assets };
    if (cfg.assets?.not_found_handling)
      out.assets.not_found_handling = cfg.assets.not_found_handling;
  }
  for (const k of ["compatibility_date", "compatibility_flags"]) if (cfg[k]) out[k] = cfg[k];
  const env = cfg.env?.preview;
  if (env && typeof env === "object") for (const k of BINDINGS) if (env[k]) out[k] = env[k];
  return out;
}

function copyPlain(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isSymbolicLink() || forbiddenName(e.name)) continue;
    if (e.isDirectory()) copyPlain(join(from, e.name), join(to, e.name));
    else if (e.isFile()) copyFileSync(join(from, e.name), join(to, e.name));
  }
}

/** Packs `apps/<dir>/dist` of every app with a wrangler.jsonc into `out`, plus manifest.json. */
export function buildArtifact({ root, out, pr }) {
  const apps = [];
  for (const e of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    const app = join(root, "apps", e.name);
    if (!e.isDirectory() || !existsSync(join(app, "wrangler.jsonc"))) continue;
    if (!existsSync(join(app, "dist"))) continue;
    copyPlain(join(app, "dist"), join(out, "apps", e.name));
    apps.push(e.name);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ pr: Number(pr), apps }));
  return apps;
}

/**
 * Deploys an artifact. `root` is the default-branch checkout; `run(args)` runs
 * `pnpm exec <args>` there and resolves `{ code, out }`.
 */
export async function deploy({ artifact: given, root, pr, run }) {
  const artifact = resolve(given);
  const fail = (...errors) => ({ ok: false, errors, notices: [], summary: "" });
  if (!/^\d+$/.test(String(pr ?? ""))) return fail("no PR number for this workflow run");
  const bad = checkArtifact(artifact);
  if (bad.length) return fail(...bad);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(artifact, "manifest.json"), "utf8"));
  } catch {
    return fail("manifest.json is missing or not JSON");
  }
  if (String(manifest.pr) !== String(pr)) {
    return fail(`artifact is for PR ${manifest.pr}, not ${pr}`);
  }
  const apps = Array.isArray(manifest.apps) ? manifest.apps : [];
  if (!apps.every((d) => typeof d === "string" && DIR.test(d))) return fail("bad app in manifest");
  const urls = [];
  const errors = [];
  for (const dir of apps) {
    const cfgPath = join(root, "apps", dir, "wrangler.jsonc");
    const dist = join(artifact, "apps", dir);
    if (
      !existsSync(cfgPath) ||
      !existsSync(dist) ||
      !realpathSync(dist).startsWith(realpathSync(artifact) + sep)
    ) {
      errors.push(
        `${dir}: no default-branch wrangler.jsonc, or output missing or outside the artifact`,
      );
      continue;
    }
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(cfgPath, "utf8"));
    } catch (e) {
      errors.push(`${dir}: wrangler.jsonc is not valid JSONC (${e.message})`);
      continue;
    }
    if (typeof cfg.name !== "string" || !NAME.test(cfg.name)) {
      errors.push(`${dir}: wrangler.jsonc has no usable name`);
      continue;
    }
    let entry;
    if (typeof cfg.main === "string") {
      const stem = basename(cfg.main).replace(/\.[cm]?[jt]sx?$/, "");
      entry = [".js", ".mjs"].map((x) => join(dist, stem + x)).find((f) => existsSync(f));
      if (!entry) {
        errors.push(`${dir}: no bundle for ${cfg.main}`);
        continue;
      }
    }
    const tmp = mkdtempSync(join(tmpdir(), "preview-cfg-"));
    let assets = dist;
    if (entry && cfg.assets) {
      // The server bundle must not be served as a public asset.
      assets = join(tmp, "assets");
      cpSync(dist, assets, { recursive: true, filter: (p) => p !== entry });
    }
    const put = (f, x) => (writeFileSync(join(tmp, f), x), join(tmp, f));
    const conf = put("wrangler.json", JSON.stringify(previewConfig(cfg, { entry, assets })));
    const wr = (sub, c, ...x) =>
      run(["wrangler", ...sub.split(" "), "--config", c, "--no-bundle", ...x]);
    const upload = () => wr("versions upload", conf, "--preview-alias", `pr-${pr}`);
    let r = await upload();
    if (r.code !== 0 && NOT_CREATED.test(r.out)) {
      // First preview of this app: create the `<name>-preview` Worker once from a stub (never PR
      // code as its live version), then upload the PR code as a preview version.
      const stub = put("stub.js", 'export default { fetch: () => new Response("") };\n');
      const sconf = put(
        "stub.json",
        JSON.stringify(previewConfig({ ...cfg, assets: null, env: null }, { entry: stub })),
      );
      r = await wr("deploy", sconf);
      if (r.code === 0) r = await upload();
    }
    if (r.code === 0) urls.push(...(r.out.match(/https:\/\/[^\s)]*\.workers\.dev[^\s)]*/g) ?? []));
    else errors.push(`${dir}: wrangler exited ${r.code}`);
  }
  const list = [...new Set(urls)].sort();
  const summary =
    "## Preview deployments\n\n" +
    (list.length ? list.map((u) => `- ${u}`).join("\n") + "\n" : "No preview URLs.\n");
  return { ok: errors.length === 0, errors, notices: [], summary };
}

function runWrangler(args, root) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    for (const [from, to] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      from.on("data", (/** @type {Buffer} */ b) => {
        out += b.toString();
        to.write(b);
      });
    }
    child.on("error", (e) => resolve({ code: 1, out: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/**
 * @param {string} log turbo output (ANSI allowed)
 * @param {number} exitCode turbo exit code
 */
export function report(log, exitCode) {
  const text = log.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const urls = [...new Set(text.match(/https:\/\/[^\s)]*\.workers\.dev[^\s)]*/g) ?? [])].sort();
  const notCreated = [
    ...new Set(
      text
        .split("\n")
        .filter((l) => NOT_CREATED.test(l))
        .map((l) => /^(\S+):deploy:preview: /.exec(l)?.[1])
        .filter((p) => p !== undefined),
    ),
  ].sort();
  const failedLine = /^Failed:\s+(.+)$/m.exec(text);
  const failed = failedLine ? failedLine[1].split(",").map((s) => s.trim()) : [];
  const ok =
    exitCode === 0 ||
    (failed.length > 0 &&
      failed.every((t) => t.endsWith("#deploy:preview") && notCreated.includes(t.slice(0, -15))));

  let summary = "## Preview deployments\n\n";
  summary += urls.length ? urls.map((u) => `- ${u}`).join("\n") + "\n" : "No preview URLs.\n";
  /** @type {string[]} */
  const notices = [];
  if (notCreated.length) {
    summary +=
      "\n### Skipped: Worker does not exist yet\n\n" +
      "Previews are versions of an existing Worker. Deploy each app below once, from a machine " +
      "logged in to Cloudflare (`wrangler login`); later PRs get previews.\n\n";
    for (const p of notCreated) {
      summary += `- \`${p}\`: \`pnpm turbo run deploy --filter=${p}\`\n`;
      notices.push(
        `::notice title=Preview skipped::${p}: its Worker does not exist yet. Run \`pnpm turbo run deploy --filter=${p}\` once.`,
      );
    }
  }
  return { ok, urls, notCreated, failed, notices, summary };
}

/** True when this file is the entry script; symlink-safe (Node resolves import.meta.url). */
const isMain = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isMain() && process.argv.length === 2) {
  const child = spawn("pnpm", TURBO_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
  // One log for both streams: a garbled line can only turn a skip into a failure (fail closed).
  let log = "";
  for (const [from, to] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    from.on("data", (/** @type {Buffer} */ b) => {
      log += b.toString();
      to.write(b);
    });
  }
  child.on("error", (e) => {
    console.error(`preview: ${e.message}`);
    process.exit(1);
  });
  child.on("close", (code) => {
    const r = report(log, code ?? 1);
    for (const n of r.notices) console.log(n);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary);
    process.exit(r.ok ? 0 : 1);
  });
}

if (isMain() && process.argv.length > 2) {
  const [cmd, artifact = ".preview"] = process.argv.slice(2);
  const pr = process.env.PR_NUMBER;
  if (cmd === "build") {
    const apps = buildArtifact({ root: process.cwd(), out: ".preview", pr });
    console.log(`preview: packed ${apps.length} app(s): ${apps.join(", ")}`);
  } else if (cmd === "deploy") {
    const root = process.cwd();
    const r = await deploy({ artifact, root, pr, run: (args) => runWrangler(args, root) });
    for (const e of r.errors) console.error(`preview: ${e}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary);
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error("usage: preview.mjs [build | deploy [artifact-dir]]");
    process.exit(2);
  }
}
