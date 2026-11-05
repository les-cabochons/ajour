// Runs the release check of the six official plugins (#403, seam 3 of the
// spec #381): `sandbox-check/official-plugins.cjs`, inside the packaged
// check build that `just plugin-release-package` makes, against the plugins
// at a commit of the official source repository.
//
//   AJOUR_PLUGINS_CHECKOUT      a clone of les-cabochons/ajour-plugins
//   AJOUR_PLUGINS_COMMIT        the commit to check (default: `releaseCommit`
//                               of `sandbox-check/release-baseline.json`)
//   AJOUR_PLUGINS_LEGACY_COMMIT the commit or tag whose `ajour.json` names the
//                               packages users have installed today, at API 3
//                               (default: `legacyCatalogCommit` of
//                               `sandbox-check/release-baseline.json`)
//   AJOUR_PLUGIN_RELEASE_EXECUTABLE
//                               the packaged check app, from
//                               apps/desktop/out/plugin-release-check
//   AJOUR_RELEASE_CHECK_UNPACKAGED=1
//                               for quick turns while writing the check:
//                               run the entrypoint on the repository's
//                               Electron instead of a packaged build. It is
//                               no release check.
//
// The previous release's `ajour.json` (not the commit's own, which lists API 4
// once the signed catalog is released) names the packages users have
// installed today, at API 3. This script extracts them too, to seed the data
// folder an upgrade starts from. Exits 1 when any case fails.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "tar";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const checkout = process.env.AJOUR_PLUGINS_CHECKOUT;
const unpackaged = process.env.AJOUR_RELEASE_CHECK_UNPACKAGED === "1";
const executable = unpackaged
  ? require("electron")
  : process.env.AJOUR_PLUGIN_RELEASE_EXECUTABLE;
if (!checkout || !executable) {
  throw new Error(
    "Set AJOUR_PLUGINS_CHECKOUT to a clone of the official plugin source and AJOUR_PLUGIN_RELEASE_EXECUTABLE to the packaged release-check app (just plugin-release-package).",
  );
}
const git = (...args) =>
  execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
// Both commits are pinned, so every run checks the same plugins whatever the
// checkout's HEAD is.
const baseline = JSON.parse(
  await readFile(
    path.join(desktopRoot, "sandbox-check/release-baseline.json"),
    "utf8",
  ),
);
const commit = git(
  "rev-parse",
  "--verify",
  `${process.env.AJOUR_PLUGINS_COMMIT ?? baseline.releaseCommit}^{commit}`,
).trim();
const root = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-release-"));
try {
  const source = path.join(root, "source");
  await mkdir(source);
  const archive = path.join(root, "plugins.tar");
  execFileSync("git", [
    "-C",
    checkout,
    "archive",
    "--format=tar",
    `--output=${archive}`,
    commit,
  ]);
  await extract({ file: archive, cwd: source });

  const folders = [
    "jira",
    "github",
    "azure-devops",
    "ics",
    "workday-agent",
    "workday-project-data",
  ];
  for (const folder of folders) {
    const manifest = JSON.parse(
      await readFile(
        path.join(source, "plugins", folder, "plugin.json"),
        "utf8",
      ),
    );
    if (manifest.apiVersion !== 4)
      throw new Error(
        `${folder} is API ${manifest.apiVersion} at ${commit}; the six API 4 ports must land before the release check can pass.`,
      );
  }

  // What users have installed: the packages the previous release's
  // ajour.json lists at an older plugin API.
  const legacyCommit = git(
    "rev-parse",
    "--verify",
    `${process.env.AJOUR_PLUGINS_LEGACY_COMMIT ?? baseline.legacyCatalogCommit}^{commit}`,
  ).trim();
  const legacy = path.join(root, "legacy");
  await mkdir(legacy);
  const listing = JSON.parse(git("show", `${legacyCommit}:ajour.json`));
  const legacyIds = [];
  for (const entry of listing.plugins) {
    // Only an available entry names a package users can have installed.
    if (entry.pluginApiVersion >= 4 || !entry.commit || !entry.path) continue;
    const packed = path.join(root, `${entry.id}.tar`);
    execFileSync("git", [
      "-C",
      checkout,
      "archive",
      "--format=tar",
      `--output=${packed}`,
      entry.commit,
      entry.path,
    ]);
    await mkdir(path.join(legacy, entry.id));
    await extract({
      file: packed,
      cwd: path.join(legacy, entry.id),
      strip: entry.path.split("/").length,
    });
    legacyIds.push(entry.id);
  }

  if (legacyIds.length === 0)
    throw new Error(
      `The ajour.json at ${legacyCommit} lists no API 3 package, so there is no upgrade to check. Set AJOUR_PLUGINS_LEGACY_COMMIT to the last release that still listed API 3.`,
    );
  process.stdout.write(
    `Checking six official plugins at ${commit} (upgrading from ${legacyIds.join(", ")})\n`,
  );
  await mkdir(path.join(root, "user-data"));
  const env = {
    ...process.env,
    AJOUR_PLUGINS_CHECK_SOURCE: source,
    AJOUR_PLUGINS_CHECK_LEGACY: legacy,
    AJOUR_USER_DATA_PATH: path.join(root, "user-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.resolve(executable),
    unpackaged
      ? [path.join(desktopRoot, "sandbox-check/official-plugins.cjs")]
      : [],
    { env, stdio: "inherit", windowsHide: true },
  );
  const timeout = setTimeout(() => child.kill(), 180_000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timeout);
  if (code !== 0)
    throw new Error(`The official plugin release check failed with ${code}.`);
  process.stdout.write("The official plugin release check passed.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
