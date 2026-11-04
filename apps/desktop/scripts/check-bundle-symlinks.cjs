/**
 * Fails when a packaged macOS app holds a symbolic link that codesign rejects:
 * an absolute link, a link that resolves outside the .app, or a broken link.
 * A Developer ID signature fails its strict verification on any of them
 * ("invalid destination for symbolic link in bundle"), so the release
 * workflows would fail after minutes of signing. The test workflow runs this
 * on the unsigned apps instead.
 *
 * Usage: node scripts/check-bundle-symlinks.cjs [--out <folder>]
 */
const { existsSync, lstatSync, readdirSync, readlinkSync } = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const outFlag = process.argv.indexOf("--out");
const outRoot =
  outFlag === -1
    ? path.join(desktopRoot, "out/make")
    : path.resolve(process.argv[outFlag + 1]);

/** Every .app bundle one level inside the builder's platform folders. */
function findApps() {
  if (!existsSync(outRoot)) return [];
  return readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const folder = path.join(outRoot, entry.name);
      return readdirSync(folder)
        .filter((name) => name.endsWith(".app"))
        .map((name) => path.join(folder, name));
    });
}

/** The reason codesign would reject the link, or undefined. */
function problem(appRoot, linkPath) {
  const target = readlinkSync(linkPath);
  if (path.isAbsolute(target)) return `absolute target ${target}`;
  const resolved = path.resolve(path.dirname(linkPath), target);
  const relative = path.relative(appRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return `resolves outside the app: ${target}`;
  }
  if (!existsSync(resolved)) return `broken: ${target}`;
  return undefined;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) yield entryPath;
    else if (entry.isDirectory()) yield* walk(entryPath);
  }
}

const apps = findApps();
if (apps.length === 0) {
  console.error(`No packaged .app found under ${outRoot}.`);
  process.exit(1);
}

let failures = 0;
for (const appRoot of apps) {
  let links = 0;
  for (const linkPath of walk(appRoot)) {
    if (!lstatSync(linkPath).isSymbolicLink()) continue;
    links += 1;
    const reason = problem(appRoot, linkPath);
    if (reason) {
      failures += 1;
      console.error(`${path.relative(appRoot, linkPath)}: ${reason}`);
    }
  }
  console.log(`${appRoot}: ${links} symbolic links checked.`);
}

if (failures > 0) {
  console.error(`${failures} symbolic links would fail codesign.`);
  process.exit(1);
}
