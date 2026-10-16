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

module.exports = {
  appId: "com.lescabochons.ajour",
  productName: "Ajour",
  // A per-user one-click NSIS install names its folder after the package
  // name, not productName. Without this, "@ajour/desktop" installs into
  // %LOCALAPPDATA%\Programs\@ajourdesktop. Existing installs keep their
  // folder because the installer reuses the InstallLocation registry value.
  extraMetadata: {
    name: "ajour",
  },
  electronVersion,
  asar: true,
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
