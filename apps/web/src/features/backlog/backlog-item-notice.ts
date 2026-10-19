import {
  isBacklogItemReturned,
  isBacklogItemSnoozed,
} from "@/domain/backlog/backlog-item-lifecycle";
import type { LocalWorkItem } from "@/domain/local-state";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";

/** Who brought the item back by commenting, when the latest return was theirs. */
export function returnedByCommentAuthor(workItem: LocalWorkItem) {
  const returned = workItem.returnedByComment;
  return returned && returned.at === workItem.returnedAt
    ? returned.author
    : undefined;
}

/**
 * The line under the title on the item page and in the peek when the item is
 * off the list or came back: snoozed, settled, archived or returned. Null for
 * an item on the list.
 */
export function getBacklogItemNotice(workItem: LocalWorkItem, now: number) {
  if (isBacklogItemSnoozed(workItem, now)) {
    return `Snoozed until ${formatSnoozeTime(workItem.snoozedUntil!, now)}`;
  }
  if (workItem.status === "settled") {
    const settled = workItem.settledAt
      ? `Settled ${formatSnoozeTime(workItem.settledAt, now).replace(
          /^(Today|Tomorrow)/,
          (word) => word.toLowerCase(),
        )}`
      : "Settled";
    return workItem.sourceStatusLabel
      ? `${settled} · waiting in "${workItem.sourceStatusLabel}"`
      : settled;
  }
  if (workItem.status === "archived") {
    return "Archived";
  }
  if (isBacklogItemReturned(workItem, now)) {
    const commenter = returnedByCommentAuthor(workItem);
    if (commenter) return `${commenter} commented since you settled it`;
    return workItem.returnedAt
      ? "Changed in the source since you settled it"
      : "Back from snooze";
  }
  return null;
}

/** Why an item came back, kept for the visit that clears its Returned mark. */
export interface BacklogItemReturnNotice {
  itemId: string;
  text: string;
}

/** Read before opening the item clears its Returned mark. */
export function captureReturnNotice(
  workItem: LocalWorkItem,
  now: number,
): BacklogItemReturnNotice | null {
  if (!isBacklogItemReturned(workItem, now)) return null;
  const text = getBacklogItemNotice(workItem, now);
  return text ? { itemId: workItem._id, text } : null;
}

/** The item's notice, or why it came back while the visit lasts. */
export function getVisitNotice(
  workItem: LocalWorkItem,
  now: number,
  returned: BacklogItemReturnNotice | null,
) {
  return (
    getBacklogItemNotice(workItem, now) ??
    (returned?.itemId === workItem._id && workItem.status === "active"
      ? returned.text
      : null)
  );
}
