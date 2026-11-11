import type { UndoResult } from "@/lib/local-store";

/** Why an Undo that did not restore was refused, for a toast or an agent. */
export function undoRefusalMessage(result: UndoResult, subject: string) {
  return result === "has_dependents"
    ? `Can't undo. Something added since depends on the ${subject}.`
    : `Can't undo. The ${subject} changed after that action.`;
}
