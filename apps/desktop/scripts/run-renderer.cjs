const { spawnSync } = require("node:child_process");
const path = require("node:path");

const command = process.argv[2];
const desktopRoot = path.resolve(__dirname, "..");
const scriptRoot = path.resolve(__dirname);
const repoRoot = path.resolve(desktopRoot, "../..");
const viteBin = path.join(
  path.dirname(require.resolve("vite/package.json", { paths: [repoRoot] })),
  "bin",
  "vite.js",
);
const electronCli = path.join(
  path.dirname(require.resolve("electron/package.json", { paths: [repoRoot] })),
  "cli.js",
);

const env = { ...process.env };

switch (command) {
  case "build":
    run(process.execPath, [viteBin, "build", "--mode", "desktop"], {
      cwd: path.resolve(desktopRoot, "../web"),
      env,
    });
    break;
  case "start":
    run(process.execPath, [electronCli, "."], {
      cwd: desktopRoot,
      env: withoutElectronRunAsNode(env),
    });
    break;
  default:
    console.error(`Unsupported renderer command: ${command ?? "<missing>"}`);
    process.exit(1);
}

function withoutElectronRunAsNode(baseEnv) {
  const nextEnv = { ...baseEnv };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  return nextEnv;
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
