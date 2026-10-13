import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
  require.resolve("electron-builder/package.json"),
);
const { getFileMatchers, copyFiles } = builderRequire(
  "app-builder-lib/out/fileMatcher.js",
);
const temporaryDirectories: string[] = [];

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
