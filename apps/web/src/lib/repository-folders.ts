import { useEffect, useState } from "react";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import { listRepositoryFolders } from "@/lib/app-api";
export {
  listRepositoryFolders,
  removeRepositoryFolder,
  useRepositoryFolder,
} from "@/lib/app-api";

/** Local API records stay outside the synced renderer project state. */
export function useRepositoryFolders(projectId: string) {
  const [folders, setFolders] = useState<RepositoryFolder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const desktop = typeof window.ajourDesktop?.chooseFolder === "function";
  useEffect(() => {
    let current = true;
    setFolders([]);
    setError("");
    setBusy(desktop);
    if (desktop)
      void listRepositoryFolders(projectId)
        .then((value) => {
          if (current) setFolders(value);
        })
        .catch((error: unknown) => {
          if (current)
            setError(
              error instanceof Error
                ? error.message
                : "Could not load folders.",
            );
        })
        .finally(() => {
          if (current) setBusy(false);
        });
    return () => {
      current = false;
    };
  }, [projectId, desktop]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update folders.",
      );
    } finally {
      setBusy(false);
    }
  };
  const add = (onAdded?: (folder: RepositoryFolder) => void) =>
    run(async () => {
      const folder = await window.ajourDesktop?.chooseFolder?.(projectId);
      if (folder) {
        setFolders((current) =>
          current.some((saved) => saved.id === folder.id)
            ? current
            : [...current, folder],
        );
        onAdded?.(folder);
      }
    });
  return { folders, setFolders, error, busy, desktop, run, add };
}
