import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkProcessFolder } from "./process-folder.ts";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ajour-folder-check-")),
  );
  roots.push(root);
  const data = path.join(root, "data"),
    alias = path.join(root, "alias");
  await fs.mkdir(path.join(data, "nested"), { recursive: true });
  await fs.symlink(data, alias, "junction");
  return { root, data, alias };
}
it.each(["same", "child", "parent", "alias", "alias-child", "alias-parent"])(
  "Given %s of protected data, refuses even when realpath retains the alias",
  async (kind) => {
    const { root, data, alias } = await fixture();
    const real = fs.realpath;
    vi.spyOn(fs, "realpath").mockImplementation(async (value, ...options) =>
      String(value).startsWith(alias) ? String(value) : real(value, ...options),
    );
    const candidate =
      kind === "same"
        ? data
        : kind === "child"
          ? path.join(data, "nested")
          : kind === "parent"
            ? root
            : kind === "alias-child"
              ? path.join(alias, "nested")
              : alias;
    const protectedPath =
      kind === "alias-parent" ? path.join(data, "nested") : data;
    await expect(
      checkProcessFolder(candidate, [protectedPath]),
    ).rejects.toThrow();
  },
);
it.each(["localhost", "127.0.0.1", "::1", "[::1]", os.hostname(), ".", "?"])(
  "Given local UNC or device host %s, refuses before filesystem access",
  async (host) => {
    const spy = vi.spyOn(fs, "realpath");
    await expect(
      checkProcessFolder(`\\\\${host}\\C$\\private`, []),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  },
);
it("Given extended local UNC, refuses before filesystem access", async () => {
  const spy = vi.spyOn(fs, "realpath");
  await expect(
    checkProcessFolder(String.raw`\\?\UNC\localhost\C$\private`, []),
  ).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});
it("Given an unrelated folder, returns its canonical path", async () => {
  const { root, data } = await fixture();
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  expect(await checkProcessFolder(repo, [data])).toBe(repo);
});
