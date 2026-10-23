import {
  closeUndoToast,
  showToast,
  showUndoToast,
} from "@/components/ui/toast";
import { localStore } from "@/lib/local-store";
import { withEventAttribution } from "@/lib/wide-events";

/**
 * Shows the Undo toast for a local state action. `token` is what the local
 * store returned for the action; null means the action changed nothing, so no
 * toast shows. `subject` names what the action changed, for the message shown
 * when Undo is refused because it changed again, such as "entry".
 *
 * `onWindowClosed` runs once the action can no longer be undone, whether or
 * not it was. A settle sends its write to the source from there (ADR 0001).
 */
export function offerUndo(
  token: string | null,
  {
    title,
    subject,
    onWindowClosed,
  }: { title: string; subject: string; onWindowClosed?: () => void },
) {
  if (!token) return;

  showUndoToast({
    title,
    onUndo: () => {
      const result = localStore.undo(token);
      if (result !== "restored") {
        showToast(`Can't undo. The ${subject} changed after that action.`);
      }
    },
    onClose: () => {
      localStore.forgetUndo(token);
      onWindowClosed?.();
    },
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
