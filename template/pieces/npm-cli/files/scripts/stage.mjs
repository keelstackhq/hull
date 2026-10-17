// @ts-check
// Release-time only: stage the launcher and one package per platform into dist-npm/.
// Usage: node scripts/stage.mjs --artifacts <dir> [--out dist-npm]
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** npm platform-arch to Rust target triple; the single source of the platform list. */
export const TARGETS = {
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

/**
 * @param {string} text Cargo.toml text
 * @returns {string | undefined} the version in the [package] table
 */
export function cargoVersion(text) {
  let inPackage = false;
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) inPackage = header[1] === "package";
    else if (inPackage) {
      const m = /^\s*version\s*=\s*"([^"]+)"/.exec(line);
      if (m) return m[1];
    }
  }
  return undefined;
}

/**
 * @param {string} from
 * @returns {string[]} license files in the directory
 */
const licenses = (from) => readdirSync(from).filter((f) => /^(LICENSE|LICENCE)(\..+)?$/i.test(f));

/**
 * @param {string} file
 * @returns {any}
 */
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Stage the launcher package and one package per platform.
 * @param {{ pkgDir: string, artifactsDir: string, outDir: string, repository?: string }} opts
 *   `repository` is `owner/repo` (the value of GITHUB_REPOSITORY)
 * @returns {string[]} the written package directories
 */
export function stage({ pkgDir, artifactsDir, outDir, repository }) {
  const pkgFile = join(pkgDir, "package.json");
  const pkg = readJson(pkgFile);
  const bin = Object.keys(pkg.bin)[0] ?? "";
  const cargoFile = join(pkgDir, "../..", "crates", bin, "Cargo.toml");
  if (!existsSync(cargoFile)) {
    throw new Error(
      `${cargoFile} is missing: this package needs a rust-cli instance named \`${bin}\``,
    );
  }
  const crateVersion = cargoVersion(readFileSync(cargoFile, "utf8"));
  if (pkg.version !== crateVersion) {
    throw new Error(
      `${pkgFile} version ${pkg.version} differs from ${cargoFile} version ${crateVersion}; bump both together`,
    );
  }
  if (repository !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    throw new Error(`repository must look like owner/repo, got ${JSON.stringify(repository)}`);
  }
  const repo = repository
    ? { repository: { type: "git", url: `git+https://github.com/${repository}.git` } }
    : {};

  const sources = Object.entries(TARGETS).map(([platform, target]) => {
    const file = join(artifactsDir, target, platform.startsWith("win32") ? `${bin}.exe` : bin);
    if (!existsSync(file)) throw new Error(`missing artifact ${file} for ${platform}`);
    return { platform, file };
  });

  const license = pkg.license ? { license: pkg.license } : {};
  const baseName = basename(pkg.name);
  /** @type {string[]} */
  const written = [];

  rmSync(outDir, { recursive: true, force: true });
  for (const { platform, file } of sources) {
    const dir = join(outDir, `${baseName}-${platform}`);
    const [os, cpu] = platform.split("-");
    mkdirSync(join(dir, "bin"), { recursive: true });
    const dest = join(dir, "bin", file.endsWith(".exe") ? `${bin}.exe` : bin);
    copyFileSync(file, dest);
    chmodSync(dest, 0o755);
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify(
        {
          name: `${pkg.name}-${platform}`,
          version: pkg.version,
          description: `${bin} binary for ${platform}`,
          os: [os],
          cpu: [cpu],
          files: ["bin"],
          publishConfig: pkg.publishConfig,
          ...license,
          ...repo,
        },
        null,
        2,
      )}\n`,
    );
    for (const f of licenses(pkgDir)) copyFileSync(join(pkgDir, f), join(dir, f));
    written.push(dir);
  }

  const dir = join(outDir, baseName);
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(join(pkgDir, "bin", "launcher.js"), join(dir, "bin", "launcher.js"));
  chmodSync(join(dir, "bin", "launcher.js"), 0o755);
  if (existsSync(join(pkgDir, "README.md"))) {
    copyFileSync(join(pkgDir, "README.md"), join(dir, "README.md"));
  }
  for (const f of licenses(pkgDir)) copyFileSync(join(pkgDir, f), join(dir, f));
  const { scripts: _scripts, devDependencies: _dev, hull: _hull, ...published } = pkg;
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        ...published,
        optionalDependencies: Object.fromEntries(
          sources.map(({ platform }) => [`${pkg.name}-${platform}`, pkg.version]),
        ),
        ...repo,
      },
      null,
      2,
    )}\n`,
  );
  written.push(dir);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  /** @param {string} name */
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const artifacts = flag("--artifacts");
  if (!artifacts) {
    process.stderr.write("usage: node scripts/stage.mjs --artifacts <dir> [--out dist-npm]\n");
    process.exit(2);
  }
  const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const dirs = stage({
      pkgDir,
      artifactsDir: resolve(artifacts),
      outDir: resolve(pkgDir, flag("--out") ?? "dist-npm"),
      repository: process.env.GITHUB_REPOSITORY || undefined,
    });
    process.stdout.write(`${dirs.join("\n")}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(3);
  }
}
