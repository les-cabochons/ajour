import {
  closeUndoToast,
  setUndoShortcutFallback,
  showToast,
  showUndoToast,
} from "@/components/ui/toast";
import { undoRefusalMessage } from "@/features/feedback/undo-refusal";
import { localStore, type UndoResult } from "@/lib/local-store";

/** What an undoable action's toast said, for Cmd+Z once that toast closed. */
interface UndoLabel {
  title: string;
  subject: string;
}

/**
 * The actions offered to the user, by undo token. The store keeps the undo
 * itself; tokens it no longer keeps are pruned whenever one is added.
 */
const offered = new Map<string, UndoLabel>();

function rememberLabel(token: string, label: UndoLabel) {
  const kept = new Set(localStore.keptUndoTokens());
  for (const key of offered.keys()) {
    if (!kept.has(key)) offered.delete(key);
  }
  offered.set(token, label);
}

function refuseUndo(result: UndoResult, subject: string) {
  showToast(undoRefusalMessage(result, subject));
}

/**
 * Shows the Undo toast for a local state action. `token` is what the local
 * store returned for the action; null means the action changed nothing, so no
 * toast shows. `subject` names what the action changed, for the message shown
 * when Undo is refused because it changed again, such as "entry".
 *
 * Once the toast closes, Cmd+Z can still undo the action, newest first,
 * unless `onWindowClosed` is given.
 *
 * `onWindowClosed` runs once the action can no longer be undone from its
 * toast, whether or not it was. A settle sends its write to the source from
 * there (ADR 0001), so its action is then no longer undoable.
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

  rememberLabel(token, { title, subject });
  showUndoToast({
    title,
    onUndo: () => {
      const result = localStore.undo(token);
      if (result !== "restored") refuseUndo(result, subject);
    },
    onClose: () => {
      localStore.closeUndoWindow(token, { keep: !onWindowClosed });
      onWindowClosed?.();
    },
  });
}

/**
 * Keeps an action undoable from Cmd+Z without showing its toast, for an
 * action that a later one's toast follows at once, such as a new backlog
 * item whose description then sets its project.
 */
export function keepUndo(
  token: string | null,
  { title, subject }: { title: string; subject: string },
) {
  if (!token) return;

  rememberLabel(token, { title, subject });
  localStore.closeUndoWindow(token);
}

/**
 * Ends Undo for an action that shows no toast. A toast still showing for an
 * earlier action closes too: a change without Undo came after it.
 */
export function skipUndo(token: string | null) {
  if (!token) return;

  localStore.forgetUndo(token);
  closeUndoToast();
}

/**
 * Cmd+Z with no Undo toast showing: undoes the newest action still kept,
 * and says what it undid, since its toast is gone. Returns false when
 * there is nothing left to undo.
 */
export function undoLatestKept() {
  const token = localStore
    .keptUndoTokens()
    .find((candidate) => offered.has(candidate));
  if (!token) return false;

  const label = offered.get(token)!;
  offered.delete(token);
  const result = localStore.undo(token);
  if (result === "restored") showToast(`Undone: ${label.title}`);
  else refuseUndo(result, label.subject);
  return true;
}

setUndoShortcutFallback(undoLatestKept);
