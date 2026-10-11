import {
  closeUndoToast,
  showToast,
  showUndoToast,
} from "@/components/ui/toast";
import { localStore } from "@/lib/local-store";

/**
 * Shows the Undo toast for a local state action. `token` is what the local
 * store returned for the action; null means the action changed nothing, so no
 * toast shows. `subject` names what the action changed, for the message shown
 * when Undo is refused because it changed again, such as "entry".
 */
export function offerUndo(
  token: string | null,
  { title, subject }: { title: string; subject: string },
) {
  if (!token) return;

  showUndoToast({
    title,
    onUndo: () => {
      if (localStore.undo(token) !== "restored") {
        showToast(`Can't undo. The ${subject} changed after that action.`);
      }
    },
    onClose: () => localStore.forgetUndo(token),
  });
}

/**
 * Ends Undo for an action that shows no toast. The store keeps only the last
 * action, so the toast of an earlier one closes too.
 */
export function skipUndo(token: string | null) {
  if (!token) return;

  localStore.forgetUndo(token);
  closeUndoToast();
}
