// PR previews in two phases. `build` (pull_request, no secrets) packs each app
// (`worker/` bundle and `assets/`, kept apart) into an artifact. `deploy` (workflow_run, default-branch
// checkout, environment preview) rejects anything but plain output, then uploads a version of the
// `<name>-preview` Worker (`wrangler versions upload --no-bundle --preview-alias pr-<n>`) from a
// minimal generated config: no production bindings, routes or domains, only `env.preview` bindings.
// No PR code runs and nothing is built. Node built-ins only.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const NOT_CREATED =
  /\[ERROR\]\s+You cannot upload a new version of a Worker that does not yet exist/;
const FORBIDDEN =
  /^(wrangler\.json|package\.json$|pnpm-lock\.yaml$|_worker\.js|\.assetsignore$)|\.toml$/i;
const forbiddenName = (n) => FORBIDDEN.test(n);
const DIR = /^[a-z0-9][a-z0-9_-]*$/i;
const NAME = /^[a-z0-9][a-z0-9-]*$/i;

/** Violations in an artifact tree: forbidden names, symlinks and anything but files and dirs. */
const SAFE = /^[A-Za-z0-9._@+~-][A-Za-z0-9._@+~ -]*$/;
const noAnsi = (t) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

export function checkArtifact(root) {
  const bad = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (!SAFE.test(e.name)) bad.push(`${JSON.stringify(p)}: unsafe name`);
      else if (forbiddenName(e.name)) bad.push(`${p}: forbidden name`);
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
  if (entry)
    Object.assign(out, { main: entry, find_additional_modules: true, base_dir: dirname(entry) });
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

/**
 * Packs each app with a wrangler.jsonc into `out`: the Worker bundle (`dist`, the
 * `wrangler deploy --dry-run --outdir` output) under `apps/<dir>/worker/` and the static assets
 * (`assets.directory`) under `apps/<dir>/assets/`, plus manifest.json.
 */
export function buildArtifact({ root, out, pr }) {
  const apps = [];
  for (const e of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    const app = join(root, "apps", e.name);
    if (!e.isDirectory() || !existsSync(join(app, "wrangler.jsonc"))) continue;
    const cfg = parseJsonc(readFileSync(join(app, "wrangler.jsonc"), "utf8"));
    const worker = cfg.main ? join(app, "dist") : null;
    const assets = cfg.assets?.directory ? resolve(app, cfg.assets.directory) : null;
    if (worker && worker === assets) throw new Error(`${e.name}: main and assets share ${worker}`);
    for (const [from, to] of [
      [worker, "worker"],
      [assets, "assets"],
    ]) {
      if (from && existsSync(from)) copyPlain(from, join(out, "apps", e.name, to));
    }
    if (existsSync(join(out, "apps", e.name))) apps.push(e.name);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ pr: Number(pr), apps }));
  return apps;
}

/** A default-branch Worker name (top level or any env) equal to some app's `<name>-preview`. */
function previewNameClash(root) {
  if (!existsSync(join(root, "apps"))) return undefined;
  const cfgs = readdirSync(join(root, "apps")).flatMap((d) => {
    try {
      return [parseJsonc(readFileSync(join(root, "apps", d, "wrangler.jsonc"), "utf8"))];
    } catch {
      return [];
    }
  });
  const previews = new Set(cfgs.map((c) => `${c.name}-preview`));
  // An env without a name deploys as `<name>-<env>`; `env.preview` is only the binding source.
  const envNames = (c) =>
    Object.entries(c.env ?? {}).map(
      ([k, e]) => e?.name ?? (k === "preview" ? "" : `${c.name}-${k}`),
    );
  const names = cfgs.flatMap((c) => [c.name, ...envNames(c)]);
  return names.find((n) => previews.has(n));
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
    return fail("artifact is for another PR");
  }
  const apps = Array.isArray(manifest.apps) ? manifest.apps : [];
  if (!apps.every((d) => typeof d === "string" && DIR.test(d))) return fail("bad app in manifest");
  const clash = previewNameClash(root);
  if (clash) return fail(`Worker name ${JSON.stringify(clash)} is also a preview Worker name`);
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
    const appDir = join(root, "apps", dir);
    const aDir = cfg.assets?.directory && resolve(appDir, cfg.assets.directory);
    if (aDir && cfg.main && resolve(appDir, cfg.main).startsWith(aDir + sep)) {
      errors.push(`${dir}: main is inside assets.directory (the bundle would be served publicly)`);
      continue;
    }
    const pv = cfg.env?.preview;
    const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : null);
    const [services, dos, producers, consumers] = [
      pv?.services,
      pv?.durable_objects?.bindings,
      pv?.queues?.producers,
      pv?.queues?.consumers,
    ].map(list);
    if ([services, dos, producers, consumers].includes(null)) {
      errors.push(`${dir}: env.preview services, durable_objects.bindings, queues.* must be lists`);
      continue;
    }
    const refs = [
      ...services.map((x) => x?.service),
      ...dos.map((x) => x?.script_name).filter(Boolean),
    ];
    if (!refs.every((x) => String(x).endsWith("-preview"))) {
      errors.push(`${dir}: env.preview binds a Worker that is not a -preview Worker`);
      continue;
    }
    const queues = [
      ...[...producers, ...consumers].map((x) => x?.queue),
      ...consumers.map((x) => x?.dead_letter_queue).filter((x) => x !== undefined),
    ];
    if (!queues.every((x) => typeof x === "string" && x.endsWith("-preview"))) {
      errors.push(`${dir}: env.preview uses a queue that is not a -preview queue`);
      continue;
    }
    let entry;
    if (typeof cfg.main === "string") {
      const stem = basename(cfg.main).replace(/\.[cm]?[jt]sx?$/, "");
      entry = [".js", ".mjs"].map((x) => join(dist, "worker", stem + x)).find((f) => existsSync(f));
      if (!entry) {
        errors.push(`${dir}: no bundle for ${cfg.main}`);
        continue;
      }
    }
    const tmp = mkdtempSync(join(tmpdir(), "preview-cfg-"));
    const assets = join(dist, "assets");
    const put = (f, x) => (writeFileSync(join(tmp, f), x), join(tmp, f));
    const conf = put("wrangler.json", JSON.stringify(previewConfig(cfg, { entry, assets })));
    const wr = (sub, c, ...x) =>
      run(["wrangler", ...sub.split(" "), "--config", c, "--no-bundle", ...x]);
    const upload = () => wr("versions upload", conf, "--preview-alias", `pr-${pr}`);
    let r = await upload();
    if (r.code !== 0 && NOT_CREATED.test(noAnsi(r.out))) {
      // First preview of this app: create the `<name>-preview` Worker once from a stub (never PR
      // code as its live version), then upload the PR code as a preview version.
      const stub = put("stub.js", 'export default { fetch: () => new Response("") };\n');
      // No module scan: base_dir would be the whole temp dir.
      const sc = previewConfig({ ...cfg, assets: null, env: null }, { entry: stub });
      delete sc.find_additional_modules;
      delete sc.base_dir;
      const sconf = put("stub.json", JSON.stringify(sc));
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

/** Runs `fn` with workflow commands disabled on GitHub Actions: wrangler's output is untrusted. */
export async function fenced(fn, env = process.env, write = (t) => process.stdout.write(t)) {
  if (!env.GITHUB_ACTIONS) return fn();
  const token = randomBytes(16).toString("hex");
  write(`::stop-commands::${token}\n`);
  try {
    return await fn();
  } finally {
    write(`\n::${token}::\n`);
  }
}

export function runWrangler(args, root, { bin = ["pnpm", "exec"], write } = {}) {
  const sink = write ?? ((t) => process.stdout.write(t));
  return new Promise((resolve) => {
    const child = spawn(bin[0], [...bin.slice(1), ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    // Both streams to one sink, so they stay between the fence lines (see `fenced`).
    for (const from of [child.stdout, child.stderr]) {
      from.on("data", (/** @type {Buffer} */ b) => {
        out += b.toString();
        sink(b);
      });
    }
    child.on("error", (e) => resolve({ code: 1, out: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
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
if (isMain()) {
  const [cmd, given] = process.argv.slice(2);
  const artifact = given ?? process.env.PREVIEW_ARTIFACT ?? ".preview";
  const pr = process.env.PR_NUMBER;
  if (cmd === "build") {
    const apps = buildArtifact({ root: process.cwd(), out: ".preview", pr });
    console.log(`preview: packed ${apps.length} app(s): ${apps.join(", ")}`);
  } else if (cmd === "deploy") {
    const root = process.cwd();
    const r = await deploy({
      artifact,
      root,
      pr,
      run: (args) => fenced(() => runWrangler(args, root)),
    });
    for (const e of r.errors) console.error(`preview: ${e}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary);
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error(
      "usage: preview.mjs build | deploy [artifact-dir] (default: $PREVIEW_ARTIFACT or .preview)",
    );
    process.exit(2);
  }
}
