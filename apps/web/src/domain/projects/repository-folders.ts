import type { RepositoryFolder } from "@ajour/shared/repository-folders";

/** Keep a live choice; otherwise prefer the last confirmed folder. */
export function repositoryFolderSelection(
  folders: readonly RepositoryFolder[],
  current: string,
): string {
  if (folders.some((folder) => folder.id === current)) return current;
  return (
    [...folders].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0]
      ?.id ?? ""
  );
}
