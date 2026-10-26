/**
 * Files the local API saves whole or not at all: the state file and the
 * vault file. A save goes to a temp file beside the target, flushed to disk,
 * then renamed over it, so a crash before the rename leaves the last
 * complete file. Temp files an interrupted save left are deleted before the
 * next save.
 */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

/** The random part of a temp file's name, as `randomUUID` writes it. */
const TEMP_FILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Rename errors Windows gives for a moment while another process has the target open. */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 5;

/**
 * Renames `from` over `to`. On Windows a rename over a file another process
 * holds open, such as an antivirus scan, fails for a moment, so it is tried
 * again a few times before the error stands.
 */
async function renameOver(from: string, to: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (
        attempt >= RENAME_ATTEMPTS ||
        code === undefined ||
        !TRANSIENT_RENAME_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/**
 * Saves `text` to `filePath` whole or not at all, readable only by its
 * owner. Throws when the save failed; the file then holds what it held.
 */
export async function writeFileAtomically(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(tempPath, "w", 0o600);
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await chmod(tempPath, 0o600);
    await renameOver(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Deletes the temp files an interrupted save of `filePath` left beside it.
 * Only this file's own temp names match. Returns how many matched but
 * couldn't be deleted, so the caller's event can say so; a folder that
 * doesn't exist or can't be listed has nothing to clean.
 */
export async function removeOrphanedTempFiles(
  filePath: string,
): Promise<{ undeletable: number }> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let undeletable = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { undeletable };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const middle = entry.name.slice(prefix.length);
    if (!middle.endsWith(".tmp")) continue;
    if (!TEMP_FILE_ID.test(middle.slice(0, -".tmp".length))) continue;
    try {
      await rm(path.join(directory, entry.name), { force: true });
    } catch {
      undeletable += 1;
    }
  }
  return { undeletable };
}
