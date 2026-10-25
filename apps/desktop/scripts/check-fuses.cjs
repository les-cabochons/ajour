/**
 * Reads the Electron fuses of every packaged app in the builder's output
 * folder and fails unless each matches `electronFuses` in
 * electron-builder.config.cjs. The release workflows run it after packaging.
 *
 * Usage: node scripts/check-fuses.cjs [--out <folder>]
 */
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");
// The package exports FuseState and SENTINEL only from this module.
const { FuseState, SENTINEL } = require("@electron/fuses/dist/constants");

const desktopRoot = path.resolve(__dirname, "..");
const config = require(path.join(desktopRoot, "electron-builder.config.cjs"));

const STATES = new Map([
  [FuseState.DISABLE, "off"],
  [FuseState.ENABLE, "on"],
  [FuseState.REMOVED, "removed"],
  [FuseState.INHERIT, "inherited"],
]);

/**
 * The builder's name for each fuse: the name of its @electron/fuses option
 * with a lower-case first letter, such as runAsNode for RunAsNode.
 */
const BUILDER_NAMES = new Map(
  Object.entries(FuseV1Options)
    .filter(([, index]) => typeof index === "number")
    .map(([option, index]) => [
      option.charAt(0).toLowerCase() + option.slice(1),
      index,
    ]),
);

/** Builder settings that are not fuses. */
const NOT_FUSES = new Set(["resetAdHocDarwinSignature"]);

/** The configured fuses, keyed by their builder name, as "on" or "off". */
function expectedFuses() {
  const expected = new Map();
  for (const [name, value] of Object.entries(config.electronFuses)) {
    if (NOT_FUSES.has(name)) continue;
    if (!BUILDER_NAMES.has(name)) {
      throw new Error(`Unknown Electron fuse in the builder config: ${name}`);
    }
    expected.set(name, {
      index: BUILDER_NAMES.get(name),
      state: value ? "on" : "off",
    });
  }
  return expected;
}

/** The file of a packaged app that holds its fuse wire. */
function fuseFile(appPath) {
  return appPath.endsWith(".app")
    ? path.join(
        appPath,
        "Contents/Frameworks/Electron Framework.framework/Electron Framework",
      )
    : appPath;
}

/** How many fuse wires the app's binary holds; a universal binary holds two. */
function countFuseWires(appPath) {
  const binary = readFileSync(fuseFile(appPath));
  let count = 0;
  for (
    let at = binary.indexOf(SENTINEL);
    at !== -1;
    at = binary.indexOf(SENTINEL, at + SENTINEL.length)
  ) {
    count += 1;
  }
  return count;
}

/** Each `<target>/<productName>.exe` or `.app` one level below `outDir`. */
function packagedApps(outDir) {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      [".exe", ".app"].map((extension) =>
        path.join(outDir, entry.name, `${config.productName}${extension}`),
      ),
    )
    .filter((appPath) => existsSync(appPath));
}

async function main() {
  const outFlag = process.argv.indexOf("--out");
  const outDir =
    outFlag === -1
      ? path.join(desktopRoot, config.directories.output)
      : path.resolve(process.argv[outFlag + 1]);
  const apps = packagedApps(outDir);
  if (apps.length === 0) {
    console.error(`No packaged app in ${outDir}.`);
    return 1;
  }

  const expected = expectedFuses();
  let failed = false;
  for (const appPath of apps) {
    console.log(path.relative(outDir, appPath));
    const wires = countFuseWires(appPath);
    if (wires > 1) {
      // getCurrentFuseWire reads only the first wire, which would leave the
      // other slice of a universal binary unchecked.
      console.error(
        `  ${appPath} holds ${wires} fuse wires, as a universal binary does. This check reads one wire, so it can't vouch for the others; build x64 and arm64 apart.`,
      );
      failed = true;
      continue;
    }
    const wire = await getCurrentFuseWire(appPath);
    const mismatches = [];
    for (const [name, { index, state }] of expected) {
      const actual = STATES.get(wire[index]) ?? "missing";
      console.log(`  ${name}: ${actual}`);
      if (actual !== state) {
        mismatches.push(`${name}: expected ${state}, found ${actual}`);
      }
    }
    for (const mismatch of mismatches) {
      console.error(`  Wrong fuse in ${appPath}: ${mismatch}`);
    }
    failed ||= mismatches.length > 0;
  }
  return failed ? 1 : 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
