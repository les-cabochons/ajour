import { useEffect, useState } from "react";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import {
  DEFAULT_WORKTREE_START_IN,
  startInOf,
  type WorktreeStartIn,
} from "@ajour/shared/worktrees";
import type { FolderStartOptions } from "@/domain/handoffs/start-in";
import {
  getProjectStartIn,
  listItemWorktrees,
  listRepositoryBranches,
  listRepositoryFolders,
} from "./app-api";

/**
 * What the window needs to show and choose where a hand off starts (#861):
 * the project's Start in, and for each repository folder its branches and
 * the item's worktrees still on disk. Read from the local API each time a
 * surface opens, since branches and worktrees change outside Ajour.
 */
export interface StartOptions {
  /**
   * Where a hand off of the project starts when nothing else says: the
   * project's own choice (#864), else what Settings › Worktrees says.
   */
  startIn: WorktreeStartIn;
  folders: FolderStartOptions[];
}

/**
 * Reads the start options of an item for the given repository folders. A
 * read that fails doesn't fail the whole: the setting falls back to a fresh
 * install's, the item to no worktree, and a folder to no branch list, so
 * the surface still opens and the local API decides at the start.
 */
export async function loadStartOptions(
  projectId: string,
  workItemId: string,
  folders: readonly RepositoryFolder[],
): Promise<StartOptions> {
  const [settings, worktrees, branches] = await Promise.all([
    getProjectStartIn(projectId).catch(() => undefined),
    folders.length
      ? listItemWorktrees(projectId, workItemId).catch(() => [])
      : [],
    Promise.all(
      folders.map((folder) =>
        listRepositoryBranches(projectId, folder.id).catch(() => undefined),
      ),
    ),
  ]);
  return {
    startIn: settings ? startInOf(settings) : DEFAULT_WORKTREE_START_IN,
    folders: folders.map((folder, index) => ({
      folder,
      ...(branches[index] ? { branches: branches[index] } : {}),
      worktrees: worktrees.filter(
        (worktree) => worktree.repositoryFolderId === folder.id,
      ),
    })),
  };
}

/** A project's repository folders with their start options, once read. */
export interface ProjectStartOptions {
  projectId: string;
  workItemId: string;
  folders: RepositoryFolder[];
  /** Undefined until the options of the folders answered. */
  options?: StartOptions;
}

/**
 * The repository folders of an item's project, then their start options,
 * read each time `open` turns true, and again when `reloadKey` changes,
 * such as after the user added a folder. `allFolders` reads the options of
 * every folder, for a surface that lists each one's choices. Without it
 * only a project with one folder gets its branches and worktrees, since
 * several ask which folder first; the Start in setting is read either way.
 * Undefined until the folders answered. A failed read stays undefined.
 */
export function useProjectStartOptions(
  projectId: string | undefined,
  workItemId: string,
  open: boolean,
  { allFolders = false, reloadKey = "" } = {},
): ProjectStartOptions | undefined {
  const [found, setFound] = useState<ProjectStartOptions>();
  useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    void listRepositoryFolders(projectId)
      .then(async (folders) => {
        if (!live) return;
        setFound({ projectId, workItemId, folders });
        const options = await loadStartOptions(
          projectId,
          workItemId,
          allFolders || folders.length === 1 ? folders : [],
        );
        if (live) setFound({ projectId, workItemId, folders, options });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, projectId, workItemId, allFolders, reloadKey]);
  return found &&
    found.projectId === projectId &&
    found.workItemId === workItemId
    ? found
    : undefined;
}
