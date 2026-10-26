import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";

const REMOVED = { title: "Removed from favorites", subject: "project" };

/**
 * Stars a task or removes its star, from the task menu, the action sets or
 * the palette. Removing offers Undo: on the Favorites page the row leaves,
 * so its star can't be pressed again.
 */
export function setTaskFavorite(
  projectId: string,
  taskId: string,
  favorite: boolean,
) {
  offerUndo(
    localStore.setProjectTaskFavorite(projectId, taskId, favorite),
    REMOVED,
  );
}

/** Stars a project or removes its star, with Undo like `setTaskFavorite`. */
export function setProjectFavorite(projectId: string, favorite: boolean) {
  offerUndo(localStore.setProjectFavorite(projectId, favorite), REMOVED);
}
