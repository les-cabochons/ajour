/**
 * Reads the Electron fuses of every packaged app in the builder's output
 * folder and fails unless each matches `electronFuses` in
 * electron-builder.config.cjs. The release workflows run it after packaging.
 *
 * Usage: node scripts/check-fuses.cjs [--out <folder>]
 */
const { existsSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");

const desktopRoot = path.resolve(__dirname, "..");
const config = require(path.join(desktopRoot, "electron-builder.config.cjs"));

const STATES = new Map([
  ["0".charCodeAt(0), "off"],
  ["1".charCodeAt(0), "on"],
  ["r".charCodeAt(0), "removed"],
  [144, "inherited"],
]);

/** The configured fuses, keyed by their builder name, as "on" or "off". */
function expectedFuses() {
  const expected = new Map();
  for (const [name, value] of Object.entries(config.electronFuses)) {
    if (name === "resetAdHocDarwinSignature") continue;
    const option = name[0].toUpperCase() + name.slice(1);
    if (!(option in FuseV1Options)) {
      throw new Error(`Unknown Electron fuse in the builder config: ${name}`);
    }
    expected.set(name, {
      index: FuseV1Options[option],
      state: value ? "on" : "off",
    });
  }
  return expected;
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
    const wire = await getCurrentFuseWire(appPath);
    const mismatches = [];
    console.log(path.relative(outDir, appPath));
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
