import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
  require.resolve("electron-builder/package.json"),
);
const { getFileMatchers, copyFiles } = builderRequire(
  "app-builder-lib/out/fileMatcher.js",
);
const temporaryDirectories: string[] = [];
const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopRoot, "../..");
const runtimeRoot = path.join(desktopRoot, "build/internal-app-runtime");

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith("ajour-runtime-resources-")
    ) {
      throw new Error(
        "Refusing to remove a directory outside the test fixture.",
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it("copies API dependencies into resources so the packaged runtime can load", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ajour-runtime-resources-"),
  );
  temporaryDirectories.push(root);
  const staged = path.join(root, "staged");
  const destination = path.join(root, "resources");
  const apiDirectory = path.join(staged, "apps/api");
  await mkdir(apiDirectory, { recursive: true });
  await writeFile(
    path.join(apiDirectory, "server.mjs"),
    'import { name as zod } from "zod"; import { name as tar } from "tar"; console.log(JSON.stringify([zod, tar]));',
  );
  for (const name of ["zod", "tar"]) {
    const directory = path.join(staged, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, type: "module", exports: "./index.js" }),
    );
    await writeFile(
      path.join(directory, "index.js"),
      `export const name = ${JSON.stringify(name)};`,
    );
  }

  const config = require("./electron-builder.config.cjs");
  const runtimeSource = config.extraResources.find(
    (entry: { to: string }) => entry.to === "internal-app-runtime",
  ).from;
  const runtimeResources = config.extraResources
    .filter(
      (entry: { to: string }) =>
        entry.to === "internal-app-runtime" ||
        entry.to.startsWith("internal-app-runtime/"),
    )
    .map((entry: { from: string; to: string }) => ({
      ...entry,
      from: path.join(staged, path.relative(runtimeSource, entry.from)),
    }));
  const matchers = getFileMatchers(
    { extraResources: runtimeResources },
    "extraResources",
    destination,
    {
      defaultSrc: root,
      customBuildOptions: {},
      globalOutDir: path.join(root, "output"),
      macroExpander: (value: string) => value,
    },
  );
  await copyFiles(matchers, null, false);

  const runtimeEntry = path.join(
    destination,
    "internal-app-runtime/apps/api/server.mjs",
  );
  const result = spawnSync(process.execPath, [runtimeEntry], {
    encoding: "utf8",
  });
  expect({
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }).toEqual({
    status: 0,
    stdout: '["zod","tar"]',
    stderr: "",
  });
  expect(
    JSON.parse(
      await readFile(
        path.join(
          destination,
          "internal-app-runtime/node_modules/zod/package.json",
        ),
        "utf8",
      ),
    ).name,
  ).toBe("zod");
});

it("ships every package file the local API imports", () => {
  // Runs the real packaging step. The output folder is a git-ignored build artifact.
  const prepared = spawnSync(
    process.execPath,
    [path.join(desktopRoot, "scripts/prepare-internal-api.cjs")],
    { encoding: "utf8" },
  );
  expect(prepared.status, prepared.stderr).toBe(0);

  const apiSource = path.join(repoRoot, "apps/api/src");
  const imported = new Set<string>();
  for (const entry of readdirSync(apiSource, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/(?<!\.test)\.ts$/.test(entry.name)) continue;
    const source = readFileSync(
      path.join(entry.parentPath, entry.name),
      "utf8",
    );
    for (const [, file] of source.matchAll(
      /from "(?:\.\.\/)+(packages\/[^"]+)"/g,
    )) {
      imported.add(file!);
    }
  }

  expect(imported).toContain("packages/wide-events/index.ts");
  for (const file of imported) {
    expect(existsSync(path.join(runtimeRoot, file)), file).toBe(true);
  }
}, 120_000);

it("ships the wide-events package the main process loads at launch", async () => {
  // Runs the real packaging step. The output folder is a git-ignored build artifact.
  const prepared = spawnSync(
    process.execPath,
    [path.join(desktopRoot, "scripts/prepare-internal-api.cjs")],
    { encoding: "utf8" },
  );
  expect(prepared.status, prepared.stderr).toBe(0);
  const { loadMainEmitter } = require("./electron/main-events.cjs");
  const lines: string[] = [];

  const createEmitter = await loadMainEmitter({
    packageRoot: path.join(runtimeRoot, "packages/wide-events"),
    launch: {
      launch_id: "launch-1",
      app: { version: "1.2.0", channel: "stable", packaged: true },
      device: { platform: "win32" },
    },
    homeDirectory: os.homedir(),
    userDataPath: path.join(os.tmpdir(), "Ajour"),
    sinkSwitch: "console",
    write: (line: string) => lines.push(line),
  });
  createEmitter(Date.now)
    .start("app.lock_refused", { kind: "lifecycle", trigger: "system" })
    .end();

  expect(JSON.parse(lines[0]!)).toMatchObject({
    name: "app.lock_refused",
    runtime: "main",
    launch_id: "launch-1",
  });
}, 120_000);

it("ships the pinned Playwright MCP with the internal API", () => {
  // Runs the real packaging step. The output folder is a git-ignored build artifact.
  const prepared = spawnSync(
    process.execPath,
    [path.join(desktopRoot, "scripts/prepare-internal-api.cjs")],
    { encoding: "utf8" },
  );
  expect(prepared.status, prepared.stderr).toBe(0);

  const readPackage = (...segments: string[]) =>
    JSON.parse(
      readFileSync(path.join(runtimeRoot, ...segments, "package.json"), "utf8"),
    );
  const mcpPackage = readPackage("node_modules/@playwright/mcp");
  const apiPackage = JSON.parse(
    readFileSync(path.join(repoRoot, "apps/api/package.json"), "utf8"),
  );
  expect(mcpPackage.version).toBe(apiPackage.dependencies["@playwright/mcp"]);
  expect(
    existsSync(path.join(runtimeRoot, "node_modules/@playwright/mcp/cli.js")),
  ).toBe(true);

  // The runtime is flat, so both packages must be the versions MCP pins, not
  // the older playwright the acceptance tests use at the repo root.
  for (const name of ["playwright", "playwright-core"]) {
    expect(readPackage("node_modules", name).version).toBe(
      mcpPackage.dependencies[name],
    );
  }
}, 120_000);
