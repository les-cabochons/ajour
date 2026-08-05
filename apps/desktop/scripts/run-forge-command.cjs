const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

const command = process.argv[2];
const requestedPlatform = process.argv[3] ?? "host";
const desktopRoot = path.resolve(__dirname, "..");
const scriptRoot = path.resolve(__dirname);
const repoRoot = path.resolve(desktopRoot, "../..");
const targetPlatform = requestedPlatform === "host" ? process.platform : requestedPlatform;
const electronForgeBin = path.join(path.dirname(require.resolve("@electron-forge/cli/package.json", { paths: [repoRoot] })), "dist", "electron-forge.js");

if (!["darwin", "win32"].includes(targetPlatform)) {
  console.error(`Unsupported desktop packaging platform: ${targetPlatform}`);
  process.exit(1);
}

if (command === "make" && targetPlatform === "darwin") {
  run(process.execPath, [path.join(scriptRoot, "prepare-dmg-deps.cjs")], {
    cwd: desktopRoot,
    env: process.env,
  });
}

run(process.execPath, [path.join(scriptRoot, "run-renderer.cjs"), "build"], {
  cwd: desktopRoot,
  env: process.env,
});

run(process.execPath, [path.join(scriptRoot, "prepare-internal-api.cjs")], {
  cwd: desktopRoot,
  env: process.env,
});

if (command === "make" && targetPlatform === "darwin") {
  runForge("package");
  signMacAppBundles();
  runForge("make", ["--skip-package"]);
} else {
  runForge(command);
  if (command === "package" && targetPlatform === "darwin") {
    signMacAppBundles();
  }
}

function withDesktopBinOnPath(baseEnv) {
  return {
    ...baseEnv,
    PATH: [path.join(desktopRoot, "bin"), baseEnv.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

function runForge(forgeCommand, extraArgs = []) {
  run(process.execPath, [electronForgeBin, forgeCommand, `--platform=${targetPlatform}`, ...(targetPlatform === "win32" ? ["--arch=x64"] : []), ...extraArgs], {
    cwd: desktopRoot,
    env: withDesktopBinOnPath(process.env),
  });
}

function signMacAppBundles() {
  const appBundlePaths = findMacAppBundles();

  for (const appBundlePath of appBundlePaths) {
    run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundlePath], {
      cwd: desktopRoot,
      env: process.env,
    });
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundlePath], {
      cwd: desktopRoot,
      env: process.env,
    });
  }
}

function findMacAppBundles() {
  const outRoot = path.join(desktopRoot, "out");
  if (!existsSync(outRoot)) {
    console.error(`Missing Electron Forge output directory: ${outRoot}`);
    process.exit(1);
  }

  const appBundlePaths = [];
  for (const entry of readdirSync(outRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("HarDay-darwin-")) {
      continue;
    }

    const packageRoot = path.join(outRoot, entry.name);
    for (const child of readdirSync(packageRoot, { withFileTypes: true })) {
      if (child.isDirectory() && child.name.endsWith(".app")) {
        appBundlePaths.push(path.join(packageRoot, child.name));
      }
    }
  }

  if (appBundlePaths.length === 0) {
    console.error(`No macOS app bundles found under: ${outRoot}`);
    process.exit(1);
  }

  return appBundlePaths;
}

function run(file, args, options) {
  const result = spawnSync(file, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
