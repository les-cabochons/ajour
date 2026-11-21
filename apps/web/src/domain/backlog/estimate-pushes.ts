import { estimateFieldsToPush } from "@ajour/shared/connection-access";
import type { LocalWorkItem } from "@/domain/local-state";

/*
 * A synced item's estimate change goes to its source soon after it is made,
 * not at the next scheduled sync. These rules say which store changes
 * start that upload; `features/backlog/estimate-pushes.ts` times and sends
 * it.
 */

/**
 * What a synced item has to upload of its estimates, one entry per field:
 * its value, and whether Keep mine chose it over the source's. A held field
 * waits for review in Sync review, so it is left out. A manual item has
 * nothing to upload.
 */
function estimateChanges(item: LocalWorkItem): string[] {
  if (item.source === "manual" || !item.sourceId || !item.sourceConnectionId) {
    return [];
  }
  return estimateFieldsToPush(item)
    .filter((field) => !item.estimateSync?.[field]?.held)
    .map(
      (field) =>
        `${field}=${item[field] ?? ""}${
          item.estimateSync?.[field]?.resolution === "keep_local" ? ":mine" : ""
        }`,
    );
}

/** Whether the item still has an estimate change its source hasn't taken. */
export function hasEstimateChangeToPush(item: LocalWorkItem) {
  return estimateChanges(item).length > 0;
}

/**
 * The synced items that gained an estimate change to upload between two
 * states of the store: a new value, a value typed again, Keep mine on a
 * conflict, or a held change released. A change that only went away, such
 * as one a sync uploaded, an Undo took back or a conflict kept, is not
 * new, so a sync's own answer never starts another upload.
 */
export function itemsWithNewEstimateChanges(
  before: readonly LocalWorkItem[],
  after: readonly LocalWorkItem[],
): string[] {
  const previous = new Map(before.map((item) => [item._id, item]));
  return after.flatMap((item) => {
    const earlier = previous.get(item._id);
    // An unchanged item record has the same changes.
    if (earlier === item) return [];
    const known = new Set(earlier ? estimateChanges(earlier) : []);
    return estimateChanges(item).some((change) => !known.has(change))
      ? [item._id]
      : [];
  });
}
