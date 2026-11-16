import fs from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

// Keep aligned with repository-folders (#730) until it uses this shared check.
export async function checkProcessFolder(
  folder: string,
  protectedDirectories: readonly string[],
): Promise<string> {
  const host = folder
    .replaceAll("/", "\\")
    .match(/^\\\\([^\\]+)\\/)?.[1]
    ?.toLowerCase();
  if (
    host &&
    [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      hostname().toLowerCase(),
      ".",
      "?",
    ].includes(host)
  )
    throw new Error(
      "Ajour cannot use local UNC or device paths as repository folders.",
    );
  if (!path.isAbsolute(folder)) throw new Error("Choose an absolute folder.");
  let canonical: string;
  try {
    canonical = await fs.realpath(folder);
    if (!(await fs.stat(canonical, { bigint: true })).isDirectory())
      throw Object.assign(new Error(), { code: "ENOTDIR" });
    const contains = (parent: string, child: string) => {
      const relative = path.relative(parent, child);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    };
    const ancestors = async (start: string) => {
      const identities = [];
      for (let current = start; ; current = path.dirname(current)) {
        const identity = await fs
          .stat(current, { bigint: true })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" || error.code === "ENOTDIR")
              return undefined;
            throw error;
          });
        if (identity) identities.push(identity);
        if (path.dirname(current) === current) break;
      }
      return identities;
    };
    const chosenParents = await ancestors(canonical);
    const chosen = chosenParents[0]!;
    const same = (a: typeof chosen, b: typeof chosen) =>
      a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
    for (const protectedPath of protectedDirectories) {
      const root = await fs
        .realpath(protectedPath)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR")
            return path.resolve(protectedPath);
          throw error;
        });
      const protectedParents = await ancestors(root);
      const rootIdentity = await fs
        .stat(root, { bigint: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR")
            return undefined;
          throw error;
        });
      if (
        contains(root, canonical) ||
        contains(canonical, root) ||
        (rootIdentity &&
          chosenParents.some((identity) => same(identity, rootIdentity))) ||
        protectedParents.some((identity) => same(chosen, identity))
      )
        throw new Error(
          "Ajour's data and install folders and their parents cannot be repository folders.",
        );
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR")
      throw Object.assign(
        new Error("This repository folder is no longer available."),
        { code: "folder_unavailable" },
      );
    if (code === "EACCES" || code === "EPERM")
      throw Object.assign(
        new Error("This repository folder cannot be accessed."),
        { code: "folder_access_denied" },
      );
    if (code)
      throw Object.assign(
        new Error("Could not access this repository folder."),
        { code: "folder_access_failed" },
      );
    throw error;
  }
  return canonical;
}
