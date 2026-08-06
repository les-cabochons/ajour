const path = require("node:path");

const desktopRoot = __dirname;
const repoRoot = path.resolve(desktopRoot, "../..");
const packageVersion = require("./package.json").version;
const electronVersion = require("electron/package.json").version;
const updateChannel = process.env.HARDAY_UPDATE_CHANNEL
  ?? (packageVersion.includes("-nightly.") ? "nightly" : "latest");
if (updateChannel !== "latest" && updateChannel !== "nightly") {
  throw new Error("HARDAY_UPDATE_CHANNEL must be latest or nightly.");
}

module.exports = {
  appId: "com.timetracker.harday",
  productName: "HarDay",
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
    icon: path.resolve(repoRoot, "assets/harday-icon.ico"),
    executableName: "HarDay",
  },
  nsis: {
    artifactName: "HarDay-${version}-${arch}.${ext}",
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
    icon: path.resolve(repoRoot, "assets/harday-icon.icns"),
    category: "public.app-category.productivity",
    artifactName: "HarDay-${version}-${arch}.${ext}",
  },
  dmg: {
    format: "ULFO",
  },
};
