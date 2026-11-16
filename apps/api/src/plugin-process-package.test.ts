import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pluginProcessPackageKey } from "./plugin-package.ts";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("hashes junction paths and targets without following them, and reuses unchanged file hashes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-package-key-"));
  roots.push(root);
  const pkg = path.join(root, "plugin");
  const target = path.join(root, "external");
  await mkdir(pkg);
  await mkdir(target);
  await writeFile(path.join(pkg, "index.js"), "export {};");
  await symlink(target, path.join(pkg, "node_modules"), "junction");
  const before = await pluginProcessPackageKey(pkg);
  const reads = vi.mocked(fs.readFile);
  reads.mockClear();
  expect(await pluginProcessPackageKey(pkg)).toBe(before);
  expect(reads).not.toHaveBeenCalled();
  await writeFile(path.join(target, "outside.js"), "not followed");
  expect(await pluginProcessPackageKey(pkg)).toBe(before);
  await rm(path.join(pkg, "node_modules"));
  expect(await pluginProcessPackageKey(pkg)).not.toBe(before);
});
it("hashes file symlinks without reading their targets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-package-link-"));
  roots.push(root);
  try {
    await symlink(path.join(root, "missing"), path.join(root, "bin"), "file");
  } catch (error) {
    // Windows requires Developer Mode or symlink privileges for file links.
    if (
      ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      context.skip();
      return;
    }
    throw error;
  }
  expect(await pluginProcessPackageKey(root)).toMatch(/^[a-f0-9]{64}$/);
});
