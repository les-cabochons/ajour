import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../shared/plugin-api-4.ts";
import { manifest } from "./sample-plugin/plugin.ts";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The files the published package is built from. */
async function publishedSources() {
  const root = (await readdir(packageRoot)).filter((name) =>
    name.endsWith(".ts"),
  );
  const lib = (await readdir(path.join(packageRoot, "lib"))).map((name) =>
    path.join("lib", name),
  );
  return [...root, ...lib];
}

describe("the SDK's contract", () => {
  it("matches Ajour's shared schemas", async () => {
    const { stderr } = await promisify(execFile)(process.execPath, [
      path.join(packageRoot, "scripts", "generate-contract.mjs"),
      "--check",
    ]).catch((error: { stderr: string }) => ({ stderr: error.stderr }));

    expect(stderr).toBe("");
  }, 60_000);

  it("is self-contained: the published files import only each other", async () => {
    const outside: string[] = [];
    for (const file of await publishedSources()) {
      const text = await readFile(path.join(packageRoot, file), "utf8");
      for (const [, specifier] of text.matchAll(/\bfrom\s+"([^"]+)"/g)) {
        if (!specifier!.startsWith("./")) outside.push(`${file}: ${specifier}`);
      }
    }

    expect(outside).toEqual([]);
  });

  it("types a manifest Ajour's schema accepts", () => {
    expect(pluginApi4ManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
