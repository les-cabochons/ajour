const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputRoot = path.resolve(desktopRoot, "build/internal-app-runtime");

const copyTargets = [
  {
    from: path.resolve(repoRoot, "apps/api"),
    to: path.join(outputRoot, "apps/api"),
    excludePackageNodeModules: true,
  },
  {
    from: path.resolve(repoRoot, "packages/shared"),
    to: path.join(outputRoot, "packages/shared"),
    excludePackageNodeModules: true,
  },
];

rmSync(outputRoot, { recursive: true, force: true });

for (const target of copyTargets) {
  if (!existsSync(target.from)) {
    console.error(`Missing internal API runtime dependency: ${target.from}`);
    process.exit(1);
  }

  mkdirSync(path.dirname(target.to), { recursive: true });
  cpSync(target.from, target.to, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (source) =>
      !target.excludePackageNodeModules ||
      path.basename(source) !== "node_modules",
  });
}

const copiedRuntimePackages = new Set();
copyRuntimePackage("zod", [repoRoot]);
copyRuntimePackage("tar", [path.resolve(repoRoot, "apps/api")]);

function copyRuntimePackage(packageName, searchPaths) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`, {
    paths: searchPaths,
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const packageKey = `${packageJson.name}@${packageJson.version}`;
  if (copiedRuntimePackages.has(packageKey)) {
    return;
  }
  copiedRuntimePackages.add(packageKey);

  const packageRoot = path.dirname(packageJsonPath);
  const targetRoot = path.join(outputRoot, "node_modules", packageJson.name);
  mkdirSync(path.dirname(targetRoot), { recursive: true });
  cpSync(packageRoot, targetRoot, {
    recursive: true,
    force: true,
    dereference: true,
  });

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyRuntimePackage(dependencyName, [packageRoot]);
  }
}
