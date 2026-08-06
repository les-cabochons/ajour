const { spawnSync } = require("node:child_process");
const path = require("node:path");

const command = process.argv[2];
const requestedPlatform = process.argv[3] ?? "host";
const desktopRoot = path.resolve(__dirname, "..");
const scriptRoot = path.resolve(__dirname);
const repoRoot = path.resolve(desktopRoot, "../..");
const targetPlatform = requestedPlatform === "host" ? process.platform : requestedPlatform;
const electronBuilderBin = path.join(
  path.dirname(require.resolve("electron-builder/package.json", { paths: [repoRoot] })),
  "out/cli/cli.js",
);

if (!["package", "make"].includes(command)) {
  console.error(`Unsupported desktop packaging command: ${command ?? "<missing>"}`);
  process.exit(1);
}

if (!["darwin", "win32"].includes(targetPlatform)) {
  console.error(`Unsupported desktop packaging platform: ${targetPlatform}`);
  process.exit(1);
}

run(process.execPath, [path.join(scriptRoot, "run-renderer.cjs"), "build"], {
  cwd: desktopRoot,
  env: process.env,
});

run(process.execPath, [path.join(scriptRoot, "prepare-internal-api.cjs")], {
  cwd: desktopRoot,
  env: process.env,
});

const targetArgs = targetPlatform === "win32"
  ? ["--win", ...(command === "package" ? ["dir"] : []), "--x64"]
  : [
      "--mac",
      ...(command === "package" ? ["dir", "--x64"] : ["--x64", "--arm64"]),
    ];

run(process.execPath, [
  electronBuilderBin,
  "--config=electron-builder.config.cjs",
  ...targetArgs,
  "--publish=never",
], {
  cwd: desktopRoot,
  env: withDesktopBinOnPath(process.env),
});

function withDesktopBinOnPath(baseEnv) {
  return {
    ...baseEnv,
    PATH: [path.join(desktopRoot, "bin"), baseEnv.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
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
