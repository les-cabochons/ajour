import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import type { WorkItemFactories } from "@/domain/backlog/work-item-transitions";
import { saveTimer } from "@/domain/time/timer-transitions";

/**
 * Settle, snooze and their counterparts, from "Backlog sidebar" in
 * agents/ux-spec.md. Terms follow agents/GLOSSARY.md.
 */

/**
 * Settles a backlog item. A manual item becomes archived. A synced item becomes
 * settled and remembers its source state and priority, so a later sync can tell
 * when someone changed it in the source.
 *
 * Active subitems without their own priority follow their parent. Subitems with
 * their own priority keep their own state. A running entry on a settled item is
 * stopped and saved first.
 */
export function settleBacklogItem(
  state: LocalAppState,
  workItemId: string,
  factories: WorkItemFactories,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target || target.status !== "active") {
    return state;
  }

  const now = factories.now();
  const carriedIds = new Set(
    getDirectChildWorkItems(target, state.workItems)
      .filter(
        (child) => child.status === "active" && child.priority === undefined,
      )
      .map((child) => child._id),
  );
  const settledIds = new Set([workItemId, ...carriedIds]);
  const saved = state.timers
    .filter((timer) => timer.workItemId && settledIds.has(timer.workItemId))
    .reduce(
      (current, timer) => saveTimer(current, timer._id, factories),
      state,
    );
  const settle = (workItem: LocalWorkItem): LocalWorkItem =>
    target.source === "manual"
      ? { ...workItem, status: "archived", archivedAt: now }
      : {
          ...workItem,
          status: "settled",
          settledAt: now,
          settledSourceStatusKey: workItem.sourceStatusKey,
          settledImportedPriority: workItem.importedPriority,
        };

  return {
    ...saved,
    workItems: saved.workItems.map((workItem) => {
      if (workItem._id === workItemId) {
        return settle(workItem);
      }

      return carriedIds.has(workItem._id)
        ? { ...settle(workItem), settledWithParentId: workItemId }
        : workItem;
    }),
  };
}

/** Puts the item and the subitems its settle carried back on the user's plate. */
function reactivate(
  state: LocalAppState,
  workItemId: string,
  from: LocalWorkItem["status"],
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target || target.status !== from) {
    return state;
  }

  return {
    ...state,
    workItems: state.workItems.map((workItem) =>
      workItem._id === workItemId ||
      (workItem.settledWithParentId === workItemId && workItem.status === from)
        ? {
            ...workItem,
            status: "active",
            settledAt: undefined,
            settledWithParentId: undefined,
            settledSourceStatusKey: undefined,
            settledImportedPriority: undefined,
            archivedAt: undefined,
            archivedByMissingSync: false,
          }
        : workItem,
    ),
  };
}

/** Unsettle: a settled item goes back to active. It is local, with no write. */
export function unsettleBacklogItem(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  return reactivate(state, workItemId, "settled");
}

/** Restore: an archived item goes back to active. */
export function restoreBacklogItem(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  return reactivate(state, workItemId, "archived");
}

function updateOne(
  state: LocalAppState,
  workItemId: string,
  update: (workItem: LocalWorkItem) => LocalWorkItem,
): LocalAppState {
  return {
    ...state,
    workItems: state.workItems.map((workItem) =>
      workItem._id === workItemId ? update(workItem) : workItem,
    ),
  };
}

/** Hides an active item from the sidebar until `until`. It stays active. */
export function snoozeBacklogItem(
  state: LocalAppState,
  workItemId: string,
  until: number,
): LocalAppState {
  return updateOne(state, workItemId, (workItem) =>
    workItem.status === "active"
      ? { ...workItem, snoozedUntil: until, returnedAt: undefined }
      : workItem,
  );
}

/** Ends a snooze early. The item goes back to the list without the Returned dot. */
export function unsnoozeBacklogItem(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  return updateOne(state, workItemId, (workItem) =>
    workItem.snoozedUntil === undefined
      ? workItem
      : { ...workItem, snoozedUntil: undefined },
  );
}

/**
 * Clears the Returned mark once the user opens the item. A snooze that has not
 * ended yet stays.
 */
export function markBacklogItemOpened(
  state: LocalAppState,
  workItemId: string,
  now: number,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target || !isBacklogItemReturned(target, now)) {
    return state;
  }

  return updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    returnedAt: undefined,
    snoozedUntil: undefined,
  }));
}

/** Whether an active item is hidden by a snooze that has not ended at `now`. */
export function isBacklogItemSnoozed(workItem: LocalWorkItem, now: number) {
  return (
    workItem.status === "active" &&
    workItem.snoozedUntil !== undefined &&
    workItem.snoozedUntil > now
  );
}

/**
 * Whether an active item came back on its own and the user has not opened it
 * since: its snooze ended, or a sync brought it back after it was settled.
 */
export function isBacklogItemReturned(workItem: LocalWorkItem, now: number) {
  return (
    workItem.status === "active" &&
    (workItem.returnedAt !== undefined ||
      (workItem.snoozedUntil !== undefined && workItem.snoozedUntil <= now))
  );
}

/**
 * The active backlog items the sidebar lists, in the Backlog page's order.
 *
 * Top-level items show unless snoozed. A subitem shows only when it has its own
 * priority. In custom order it sits right below its parent, or in its parent's
 * place when the parent is not listed. In priority order it mixes with
 * top-level items by priority. A missing priority sorts as the largest value,
 * as on the Backlog page.
 */
export function selectSidebarBacklogItems(
  state: LocalAppState,
  now: number,
): LocalWorkItem[] {
  const indexById = new Map(
    state.workItems.map((workItem, index) => [workItem._id, index]),
  );
  const indexByLookupKey = new Map(
    state.workItems.flatMap((workItem, index) =>
      getWorkItemLookupKeys(workItem).map((key) => [key, index] as const),
    ),
  );
  const listed = state.workItems.filter(
    (workItem) =>
      workItem.status === "active" &&
      !isBacklogItemSnoozed(workItem, now) &&
      (!isSubtaskWorkItem(workItem) || workItem.priority !== undefined),
  );
  const ownIndex = (workItem: LocalWorkItem) => indexById.get(workItem._id)!;

  if (state.backlogSortMode === "custom") {
    // A subitem is anchored to its parent's place, right after the parent.
    const anchor = (workItem: LocalWorkItem) => {
      const parentKey = getWorkItemParentKey(workItem);
      const parentIndex = parentKey
        ? indexByLookupKey.get(parentKey)
        : undefined;
      return parentIndex ?? ownIndex(workItem);
    };
    const depth = (workItem: LocalWorkItem) =>
      isSubtaskWorkItem(workItem) ? 1 : 0;

    return [...listed].sort(
      (left, right) =>
        anchor(left) - anchor(right) ||
        depth(left) - depth(right) ||
        ownIndex(left) - ownIndex(right),
    );
  }

  // Like the Backlog page: a missing priority sorts as the largest value.
  const direction = state.backlogSortMode === "priority_desc" ? -1 : 1;
  const priority = (workItem: LocalWorkItem) =>
    workItem.priority ?? Number.MAX_SAFE_INTEGER;
  return [...listed].sort(
    (left, right) =>
      (priority(left) - priority(right)) * direction ||
      ownIndex(left) - ownIndex(right),
  );
}
