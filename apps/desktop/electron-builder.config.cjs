const { execFileSync } = require("node:child_process");
const path = require("node:path");

const desktopRoot = __dirname;
const repoRoot = path.resolve(desktopRoot, "../..");
const packageVersion = require("./package.json").version;
const electronVersion = require("electron/package.json").version;
const updateChannel =
  process.env.AJOUR_UPDATE_CHANNEL ??
  (packageVersion.includes("-nightly.") ? "nightly" : "latest");
if (updateChannel !== "latest" && updateChannel !== "nightly") {
  throw new Error("AJOUR_UPDATE_CHANNEL must be latest or nightly.");
}

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * The commit the app is built from, which its wide events report:
 * AJOUR_BUILD_COMMIT, or else the checked-out commit. A build outside a git
 * checkout reports none.
 */
function resolveBuildCommit() {
  const named = process.env.AJOUR_BUILD_COMMIT?.trim().toLowerCase();
  if (named && COMMIT.test(named)) return named;
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return COMMIT.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}
const buildCommit = resolveBuildCommit();

module.exports = {
  appId: "com.lescabochons.ajour",
  productName: "Ajour",
  // A per-user one-click NSIS install names its folder after the package
  // name, not productName. Without this, "@ajour/desktop" installs into
  // %LOCALAPPDATA%\Programs\@ajourdesktop. Existing installs keep their
  // folder because the installer reuses the InstallLocation registry value.
  extraMetadata: {
    name: "ajour",
    // main.cjs reads it into the launch context.
    ...(buildCommit ? { buildCommit } : {}),
  },
  electronVersion,
  asar: true,
  // The fuses decided in #231, flipped in the packaged binary before signing.
  // scripts/check-fuses.cjs reads them back in the release workflows.
  //
  // runAsNode stays on: the agent runner has the agent CLI start Playwright
  // MCP with the app's own binary and ELECTRON_RUN_AS_NODE=1
  // (apps/api/src/agent-runner/playwright-mcp.ts). Until that moves off it,
  // anyone who can start Ajour.exe can run Node code as Ajour. #415 tracks
  // moving Playwright MCP to HTTP so release builds can turn it off.
  //
  // Asar integrity covers app.asar only, that is main and preload. The
  // renderer (dist-desktop) and the local API (internal-app-runtime) load
  // from extra resources, which onlyLoadAppFromAsar doesn't restrict and
  // integrity doesn't check. They are loose files in the per-user install
  // folder, so a process that can write there can change code that main
  // imports. Same-user malware is out of scope, and runAsNode being on
  // already gives such a process equal power.
  //
  // The macOS build is unsigned, so every flipped .app (x64 and arm64) is
  // re-signed ad hoc or it won't start.
  electronFuses: {
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    grantFileProtocolExtraPrivileges: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    resetAdHocDarwinSignature: true,
  },
  directories: {
    output: "out/make",
  },
  files: [
    "electron/**/*",
    "package.json",
    "!bin{,/**/*}",
    "!build{,/**/*}",
    "!out{,/**/*}",
    "!scripts{,/**/*}",
    "!*.test.*",
    "!vitest.config.ts",
  ],
  extraResources: [
    {
      from: path.resolve(desktopRoot, "../web/dist-desktop"),
      to: "dist-desktop",
    },
    {
      from: path.resolve(desktopRoot, "build/internal-app-runtime"),
      to: "internal-app-runtime",
    },
    {
      // electron-builder skips a source directory's top-level node_modules.
      from: path.resolve(
        desktopRoot,
        "build/internal-app-runtime/node_modules",
      ),
      to: "internal-app-runtime/node_modules",
    },
    {
      from: path.resolve(repoRoot, "assets"),
      to: "assets",
    },
  ],
  publish: [
    {
      provider: "github",
      owner: "les-cabochons",
      repo: "ajour",
      channel: updateChannel,
    },
  ],
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    icon: path.resolve(repoRoot, "assets/ajour-icon.ico"),
    executableName: "Ajour",
  },
  nsis: {
    artifactName: "Ajour-${version}-${arch}.${ext}",
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
    ],
    icon: path.resolve(repoRoot, "assets/ajour-icon.icns"),
    category: "public.app-category.productivity",
    artifactName: "Ajour-${version}-${arch}.${ext}",
  },
  dmg: {
    format: "ULFO",
  },
};
