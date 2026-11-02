import { getBacklogItemActions } from "@/domain/actions/object-actions";

/**
 * What the comment editor does with the item once the comment is posted:
 * nothing more, settle it, or snooze it (#487). Its button runs the last one
 * used, and keys pick the others.
 */
export type CommentOutcome = "comment" | "settle" | "snooze";

/** The order of the editor's outcome menu. */
export const COMMENT_OUTCOMES: readonly CommentOutcome[] = [
  "settle",
  "snooze",
  "comment",
];

export function isCommentOutcome(value: unknown): value is CommentOutcome {
  return (
    typeof value === "string" &&
    (COMMENT_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * The outcome ⌘/Ctrl+Enter runs with these keys held: Shift settles, Alt
 * snoozes, and neither runs `saved`. Plain Comment has no key of its own.
 * Shift and Alt together run nothing, as the editor binds no such key.
 */
export function commentOutcomeForKeys(
  keys: { shift: boolean; alt: boolean },
  saved: CommentOutcome,
): CommentOutcome | undefined {
  if (keys.shift && keys.alt) return undefined;
  if (keys.shift) return "settle";
  if (keys.alt) return "snooze";
  return saved;
}

/** The fixed key of an outcome, if it has one, as a chord with ⌘/Ctrl. */
export function commentOutcomeKeys(
  outcome: CommentOutcome,
): { shift: boolean; alt: boolean } | undefined {
  if (outcome === "settle") return { shift: true, alt: false };
  if (outcome === "snooze") return { shift: false, alt: true };
  return undefined;
}

/**
 * The button's and the menu's label. Settle ends with "…" when it opens the
 * settle dialog, as Settle does in the action menus.
 */
export function commentOutcomeLabel(
  outcome: CommentOutcome,
  { settleOpensDialog }: { settleOpensDialog: boolean },
) {
  if (outcome === "settle") {
    return settleOpensDialog ? "Comment and settle…" : "Comment and settle";
  }
  if (outcome === "snooze") return "Comment and snooze…";
  return "Comment";
}

/**
 * Why the outcome can't run on the item now, or undefined when it can. The
 * item's action set decides, so the editor agrees with the action menus: a
 * settled item can't be snoozed, an archived one is restored first, and an
 * item whose menu offers Unsettle or Unsnooze instead can't take the
 * outcome again.
 */
export function commentOutcomeDisabledReason(
  item: Parameters<typeof getBacklogItemActions>[0],
  outcome: CommentOutcome,
  { isSnoozed }: { isSnoozed: boolean },
): string | undefined {
  if (outcome === "comment") return undefined;
  const action = getBacklogItemActions(item, {
    subitemCount: 0,
    isSubitem: false,
    isRunning: false,
    isSnoozed,
  }).find((candidate) => candidate.id === outcome);
  if (action) return action.disabledReason;
  // The set lists Restore, Unsettle or Unsnooze in its place.
  if (item.status === "archived") return "Restore the item first";
  if (item.status === "settled") return "The item is already settled";
  return "The item is already snoozed";
}
