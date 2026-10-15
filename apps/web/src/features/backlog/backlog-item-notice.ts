import {
  isBacklogItemReturned,
  isBacklogItemSnoozed,
} from "@/domain/backlog/backlog-item-lifecycle";
import type { LocalWorkItem } from "@/domain/local-state";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";

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
    return workItem.returnedAt
      ? "Changed in the source since you settled it"
      : "Back from snooze";
  }
  return null;
}
