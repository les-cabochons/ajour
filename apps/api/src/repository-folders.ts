import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AppApiStorage } from "./storage.ts";

/** Host-owned folder ids are the only paths the process broker accepts. */
export class FolderResolver {
  private readonly storage: AppApiStorage;
  private readonly protectedFolders: { userData: string; install: string };
  constructor(
    storage: AppApiStorage,
    protectedFolders: { userData: string; install: string },
  ) {
    this.storage = storage;
    this.protectedFolders = protectedFolders;
  }

  private async checked(folder: string): Promise<string> {
    if (!path.isAbsolute(folder)) throw new Error("Choose an absolute folder.");
    const canonical = await realpath(folder);
    if (!(await stat(canonical)).isDirectory())
      throw new Error("Choose a folder.");
    for (const protectedPath of Object.values(this.protectedFolders)) {
      // Missing protection roots are still compared lexically, never ignored.
      const root = await realpath(protectedPath).catch(() =>
        path.resolve(protectedPath),
      );
      const relative = path.relative(root, canonical);
      if (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      ) {
        throw new Error(
          "Ajour's data and install folders cannot be repository folders.",
        );
      }
    }
    return canonical;
  }

  async addFromChooser(projectId: string, chosenPath: string) {
    if (!projectId.trim() || projectId.length > 200)
      throw new Error("Choose a project.");
    const canonical = await this.checked(chosenPath);
    return this.storage.addRepositoryFolder(
      projectId,
      canonical,
      path.basename(canonical) || canonical,
    );
  }

  async resolve(id: string, projectId?: string): Promise<string> {
    const folder = (await this.storage.listRepositoryFolders(projectId)).find(
      (folder) => folder.id === id,
    );
    if (!folder)
      throw new Error("This repository folder is no longer available.");
    // Recheck junctions and symlinks at use, not just when the user chooses.
    return this.checked(folder.path);
  }
}
