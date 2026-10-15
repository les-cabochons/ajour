const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
copyRuntimePackage("@modelcontextprotocol/sdk", [
  path.resolve(repoRoot, "apps/api"),
]);
// The agent runner starts Playwright MCP through the app's own Node. The runtime
// folder is flat, and the root playwright is an older version used by the
// acceptance tests. findPackageJson looks inside the package's own folder first,
// so its pinned playwright and playwright-core are the ones copied.
copyRuntimePackage("@playwright/mcp", [path.resolve(repoRoot, "apps/api")]);

/**
 * Finds a package's own package.json from `searchPaths`, walking up the
 * node_modules folders like Node does. require.resolve can't be used: packages
 * with an `exports` wildcard map package.json to a file in their dist folder.
 */
function findPackageJson(packageName, searchPaths) {
  for (const searchPath of searchPaths) {
    let directory = realpathSync(searchPath);
    for (;;) {
      const candidate = path.join(
        directory,
        "node_modules",
        packageName,
        "package.json",
      );
      if (existsSync(candidate)) return realpathSync(candidate);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error(`Missing internal API runtime package: ${packageName}`);
}

function copyRuntimePackage(packageName, searchPaths) {
  const packageJsonPath = findPackageJson(packageName, searchPaths);
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
