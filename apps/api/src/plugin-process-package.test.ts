import {
  mkdtemp,
  mkdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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

it("changes the development package key after a same-length edit with restored mtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-package-edit-"));
  roots.push(root);
  const file = path.join(root, "index.js");
  await writeFile(file, "export const value = 1;");
  // Use a whole-second timestamp so restoring it loses no filesystem precision.
  const modifiedAt = new Date("2020-01-01T00:00:00.000Z");
  await utimes(file, modifiedAt, modifiedAt);
  const before = await pluginProcessPackageKey(root);
  const original = await stat(file);

  // Let the filesystem's change timestamp advance before editing.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(file, "export const value = 2;");
  await utimes(file, original.atime, modifiedAt);

  const edited = await stat(file);
  expect(edited.size).toBe(original.size);
  expect(edited.mtimeMs).toBe(original.mtimeMs);
  expect(edited.ctimeMs).not.toBe(original.ctimeMs);
  expect(await pluginProcessPackageKey(root)).not.toBe(before);
});
