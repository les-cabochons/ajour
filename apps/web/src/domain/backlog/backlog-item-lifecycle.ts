import { normalizeConnectorStatusKey } from "@ajour/shared";
import type {
  LocalAppState,
  LocalPendingSourceWrite,
  LocalWorkItem,
  LocalWorkItemMoveSnapshot,
} from "@/domain/local-state";
import { getPendingSourceWriteItemIds } from "@/domain/local-state";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  reorderWorkItems,
  type WorkItemFactories,
} from "@/domain/backlog/work-item-transitions";
import {
  findMappedWorkflowStateId,
  getFirstDoneWorkflowState,
  isDoneWorkflowState,
  syncImportedWorkflowState,
} from "@/domain/backlog/workflow-states";
import {
  getPriorityLevel,
  getWorkItemPriorityRanges,
  type PriorityRanges,
} from "@/domain/backlog/priority";
import { orderBacklogItems } from "@/domain/backlog/backlog-view";
import { saveTimer } from "@/domain/time/timer-transitions";

/**
 * Settle, snooze and their counterparts, from "Backlog sidebar" in
 * agents/ux-spec.md. Terms follow agents/GLOSSARY.md.
 */

/** Whether a settle or close also takes the parent's open subitems. */
export interface CloseSubitemsOptions {
  includeSubitems?: boolean;
}

export interface MoveBacklogItemOptions extends CloseSubitemsOptions {
  orderedIds?: string[];
  /**
   * The source state to write for each moved item, by item id. The item shows
   * it at once, and the write is sent after the Undo window (ADR 0001).
   */
  sourceWrites?: Readonly<Record<string, string>>;
}

function moveSnapshot(item: LocalWorkItem): LocalWorkItemMoveSnapshot {
  return {
    status: item.status,
    workflowStateId: item.workflowStateId,
    workflowStateIdBeforeClose: item.workflowStateIdBeforeClose,
    archivedAt: item.archivedAt,
    archivedByMissingSync: item.archivedByMissingSync,
    archivedSourceStatusKey: item.archivedSourceStatusKey,
    settledAt: item.settledAt,
    settledWithParentId: item.settledWithParentId,
    settledSourceStatusKey: item.settledSourceStatusKey,
    settledImportedPriority: item.settledImportedPriority,
    returnedAt: item.returnedAt,
    snoozedUntil: item.snoozedUntil,
  };
}

function moveLifecycleSnapshot(item: LocalWorkItem) {
  const { workflowStateId: _workflowStateId, ...lifecycle } =
    moveSnapshot(item);
  return lifecycle;
}

/**
 * Records a source state write on a moved item: the item shows the new source
 * state and its mapping at once, and keeps what it had before, so a failed
 * write puts it back. A write still waiting keeps its first `previous`.
 */
function withMoveSourceWrite(
  state: LocalAppState,
  workItem: LocalWorkItem,
  sourceStatusLabel: string | undefined,
  now?: number,
): LocalWorkItem {
  const sourceStatusKey = sourceStatusLabel
    ? normalizeConnectorStatusKey(sourceStatusLabel)
    : undefined;
  if (
    !sourceStatusLabel ||
    workItem.source === "manual" ||
    sourceStatusKey === workItem.sourceStatusKey
  ) {
    return workItem;
  }

  return {
    ...workItem,
    sourceStatusKey,
    sourceStatusLabel,
    importedWorkflowStateId: findMappedWorkflowStateId(
      state.workflowStateMappings,
      workItem.source,
      workItem.sourceConnectionId,
      sourceStatusKey,
      workItem.sourceProjectName,
    ),
    pendingSourceWrite: {
      readyAt: now === undefined ? undefined : now + 8000,
      state: sourceStatusLabel,
      priority: workItem.pendingSourceWrite?.priority,
      previous: workItem.pendingSourceWrite?.previous ?? {
        sourceStatusKey: workItem.sourceStatusKey,
        sourceStatusLabel: workItem.sourceStatusLabel,
        importedPriority: workItem.importedPriority,
        priority: workItem.priority,
        workflowStateId: workItem.workflowStateId,
        importedWorkflowStateId: workItem.importedWorkflowStateId,
        lifecycle: moveLifecycleSnapshot(workItem),
      },
    },
  };
}

/**
 * Change source state: writes another source state that maps to the same
 * workflow state. The item stays where it is.
 */
export function changeBacklogItemSourceState(
  state: LocalAppState,
  workItemId: string,
  sourceStatusLabel: string,
  now?: number,
): LocalAppState {
  return updateOne(state, workItemId, (workItem) => {
    const next = withMoveSourceWrite(state, workItem, sourceStatusLabel, now);
    return next === workItem
      ? workItem
      : { ...next, workflowStateId: workItem.workflowStateId };
  });
}

/**
 * The subitems a settle or close could take along: direct subitems that are
 * still active. Independently settled and archived subitems keep their state.
 */
export function getOpenSubitems(
  state: LocalAppState,
  workItemId: string,
  _for: "settle" | "close",
): LocalWorkItem[] {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target) return [];
  return getDirectChildWorkItems(target, state.workItems).filter(
    (child) => child.status === "active",
  );
}

/**
 * The done state an item closes into: the one its source state maps to, the
 * done state it is already in, or the workflow's first done state. Callers
 * that honor a mapping to a state that isn't done check that first.
 */
function getClosingWorkflowStateId(
  state: LocalAppState,
  workItem: LocalWorkItem,
) {
  const mapped = findMappedWorkflowStateId(
    state.workflowStateMappings,
    workItem.source,
    workItem.sourceConnectionId,
    workItem.sourceStatusKey,
    workItem.sourceProjectName,
  );
  if (isDoneWorkflowState(state.workflowStates, mapped)) return mapped;
  if (isDoneWorkflowState(state.workflowStates, workItem.workflowStateId)) {
    return workItem.workflowStateId;
  }
  return getFirstDoneWorkflowState(state.workflowStates)?._id;
}

/**
 * Archives an item into a done state. It remembers the state it left, so a
 * reopen puts it back, and its source state, so a sync can tell when someone
 * reopened it in the source.
 */
function closeWorkItem(
  workItem: LocalWorkItem,
  doneStateId: string | undefined,
  states: LocalAppState["workflowStates"],
  now: number,
): LocalWorkItem {
  return {
    ...workItem,
    status: "archived",
    archivedAt: now,
    archivedByMissingSync: false,
    archivedSourceStatusKey: workItem.sourceStatusKey,
    workflowStateId: doneStateId ?? workItem.workflowStateId,
    workflowStateIdBeforeClose: isDoneWorkflowState(
      states,
      workItem.workflowStateId,
    )
      ? workItem.workflowStateIdBeforeClose
      : workItem.workflowStateId,
    settledAt: undefined,
    settledSourceStatusKey: undefined,
    settledImportedPriority: undefined,
    snoozedUntil: undefined,
    returnedAt: undefined,
  };
}

/** Stops and saves the running entries on these items. */
function saveRunningEntries(
  state: LocalAppState,
  workItemIds: ReadonlySet<string>,
  factories: WorkItemFactories,
) {
  return state.timers
    .filter((timer) => timer.workItemId && workItemIds.has(timer.workItemId))
    .reduce(
      (current, timer) => saveTimer(current, timer._id, factories),
      state,
    );
}

/**
 * Applies the done rules after settings, mapping or connector changes. Every
 * open item in a done state closes, including items reactivated without a
 * workflow change, with its running entry saved.
 * Archived items keep their done state: a mapping edit never reopens history.
 */
export function applyWorkflowStateLifecycle(
  previous: LocalAppState,
  next: LocalAppState,
  factories: WorkItemFactories,
): LocalAppState {
  if (previous === next) return next;

  const previousById = new Map(
    previous.workItems.map((workItem) => [workItem._id, workItem]),
  );
  const closingIds = new Set(
    next.workItems
      .filter(
        (workItem) =>
          workItem.status !== "archived" &&
          isDoneWorkflowState(next.workflowStates, workItem.workflowStateId),
      )
      .map((workItem) => workItem._id),
  );
  if (closingIds.size === 0) return next;

  const now = factories.now();
  const saved = saveRunningEntries(next, closingIds, factories);
  return {
    ...saved,
    workItems: saved.workItems.map((workItem) => {
      if (!closingIds.has(workItem._id)) return workItem;
      const before = previousById.get(workItem._id);
      const previousStateId =
        before?.status === "archived"
          ? (before.workflowStateIdBeforeClose ??
            (before.archivedByMissingSync ? before.workflowStateId : undefined))
          : before?.workflowStateId;
      return {
        ...closeWorkItem(
          workItem,
          workItem.workflowStateId,
          next.workflowStates,
          now,
        ),
        workflowStateIdBeforeClose:
          isDoneWorkflowState(previous.workflowStates, previousStateId) ||
          isDoneWorkflowState(next.workflowStates, previousStateId)
            ? undefined
            : previousStateId,
      };
    }),
  };
}

/**
 * Moves a backlog item to a workflow state. Only done states change its
 * lifecycle: moving into one closes the item, archiving it with its running
 * entry stopped and saved, and moving out of one reopens it with the subitems
 * that closed with it. Moving between other states leaves an active or settled
 * item as it is.
 *
 * `includeSubitems` closes the parent's open subitems along with it.
 */
export function moveBacklogItemToState(
  state: LocalAppState,
  workItemId: string,
  workflowStateId: string | undefined,
  factories: WorkItemFactories,
  options: MoveBacklogItemOptions = {},
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  const destination = state.workflowStates.find(
    (candidate) => candidate._id === workflowStateId,
  );
  if (
    !target ||
    (workflowStateId !== undefined && !destination) ||
    target.workflowStateId === workflowStateId
  ) {
    return state;
  }

  const moved = moveWithoutWrites(
    state,
    workItemId,
    workflowStateId,
    factories,
    options,
  );
  const writes = options.sourceWrites ?? {};
  if (Object.keys(writes).length === 0)
    return options.orderedIds
      ? reorderWorkItems(moved, options.orderedIds)
      : moved;

  const writtenState = {
    ...moved,
    workItems: moved.workItems.map((workItem) => {
      const label = writes[workItem._id];
      if (!label) return workItem;
      const before = state.workItems.find(
        (candidate) => candidate._id === workItem._id,
      );
      const written = withMoveSourceWrite(
        state,
        workItem,
        label,
        factories.now(),
      );
      if (written === workItem || !written.pendingSourceWrite || !before) {
        return written;
      }
      const hasWorkflowRecovery =
        workItem.pendingSourceWrite &&
        (workItem.pendingSourceWrite.state !== undefined ||
          "workflowStateId" in workItem.pendingSourceWrite.previous);
      // A failed write goes back to where the item was before this move.
      return {
        ...written,
        archivedSourceStatusKey:
          written.status === "archived"
            ? written.sourceStatusKey
            : written.archivedSourceStatusKey,
        pendingSourceWrite: {
          ...written.pendingSourceWrite,
          previous: {
            ...written.pendingSourceWrite.previous,
            workflowStateId: hasWorkflowRecovery
              ? workItem.pendingSourceWrite!.previous.workflowStateId
              : before.workflowStateId,
            importedWorkflowStateId: hasWorkflowRecovery
              ? workItem.pendingSourceWrite!.previous.importedWorkflowStateId
              : before.importedWorkflowStateId,
            lifecycle:
              workItem.pendingSourceWrite?.previous.lifecycle ??
              moveLifecycleSnapshot(before),
            carriedChildren: state.workItems.flatMap((child) => {
              const item = moved.workItems.find(
                (item) => item._id === child._id,
              );
              const previous =
                before.pendingSourceWrite?.previous.carriedChildren?.find(
                  (record) => record.id === child._id,
                );
              if (
                !item ||
                (!previous &&
                  child.settledWithParentId !== workItem._id &&
                  item.settledWithParentId !== workItem._id)
              )
                return [];
              return [
                {
                  id: child._id,
                  before: previous?.before ?? moveSnapshot(child),
                  after: moveSnapshot(item),
                },
              ];
            }),
          },
        },
      };
    }),
  };
  // Children receive their own source writes in this same pass. Record their
  // final optimistic lifecycle, including the written archive source state.
  const recoveryState = {
    ...writtenState,
    workItems: writtenState.workItems.map((item) => {
      const write = item.pendingSourceWrite;
      if (!write?.previous.carriedChildren?.length) return item;
      return {
        ...item,
        pendingSourceWrite: {
          ...write,
          previous: {
            ...write.previous,
            carriedChildren: write.previous.carriedChildren.map((child) => {
              const current = writtenState.workItems.find(
                (item) => item._id === child.id,
              );
              return current
                ? { ...child, after: moveSnapshot(current) }
                : child;
            }),
          },
        },
      };
    }),
  };
  if (!options.orderedIds) return recoveryState;
  const reordered = reorderWorkItems(recoveryState, options.orderedIds);
  const pending = reordered.workItems.find(
    (item) => item._id === workItemId,
  )?.pendingSourceWrite;
  if (!pending) return reordered;
  // Coalesced moves keep the original order while retaining unrelated edits.
  const baseline = restoreSourceWriteOrder(
    state,
    target.pendingSourceWrite?.previous.workItemOrder,
  );
  const before = baseline.workItems.map((item) => item._id);
  const after = reordered.workItems.map((item) => item._id);
  const changedIds = new Set(before.filter((id, index) => after[index] !== id));
  return updateOne(reordered, workItemId, (item) => ({
    ...item,
    pendingSourceWrite: {
      ...pending,
      previous: {
        ...pending.previous,
        workItemOrder: changedIds.size
          ? {
              before: before.filter((id) => changedIds.has(id)),
              after: after.filter((id) => changedIds.has(id)),
            }
          : undefined,
      },
    },
  }));
}

/** Restores only the drag's changed slots, preserving new items and later edits. */
function restoreSourceWriteOrder(
  state: LocalAppState,
  order: LocalPendingSourceWrite["previous"]["workItemOrder"],
): LocalAppState {
  if (!order) return state;
  const affectedIds = new Set(order.after);
  const current = state.workItems
    .filter((item) => affectedIds.has(item._id))
    .map((item) => item._id);
  const existingIds = new Set(current);
  const expected = order.after.filter((id) => existingIds.has(id));
  if (current.some((id, index) => id !== expected[index])) return state;
  return reorderWorkItems(
    state,
    order.before.filter((id) => existingIds.has(id)),
  );
}

function moveWithoutWrites(
  state: LocalAppState,
  workItemId: string,
  workflowStateId: string | undefined,
  factories: WorkItemFactories,
  options: CloseSubitemsOptions,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  )!;
  const destination = state.workflowStates.find(
    (candidate) => candidate._id === workflowStateId,
  )!;

  if (destination?.done) {
    if (target.status === "archived") {
      return updateOne(state, workItemId, (workItem) => ({
        ...workItem,
        workflowStateId,
      }));
    }

    const carriedIds = new Set(
      options.includeSubitems
        ? getOpenSubitems(state, workItemId, "close").map((child) => child._id)
        : [],
    );
    const now = factories.now();
    const saved = saveRunningEntries(
      state,
      new Set([workItemId, ...carriedIds]),
      factories,
    );
    return {
      ...saved,
      workItems: saved.workItems.map((workItem) => {
        if (workItem._id === workItemId) {
          return closeWorkItem(
            workItem,
            workflowStateId,
            state.workflowStates,
            now,
          );
        }
        return carriedIds.has(workItem._id)
          ? {
              ...closeWorkItem(
                workItem,
                workflowStateId,
                state.workflowStates,
                now,
              ),
              settledWithParentId: workItemId,
            }
          : workItem;
      }),
    };
  }

  if (target.status === "archived") {
    const reopened = reactivate(state, workItemId, "archived");
    return updateOne(reopened, workItemId, (workItem) => ({
      ...workItem,
      workflowStateId,
      workflowStateIdBeforeClose: undefined,
    }));
  }

  return updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    workflowStateId,
  }));
}

/** What the settle dialog or a settle rule asks to change in the source. */
export interface BacklogSettleChange {
  state?: { name: string; done: boolean };
  priority?: number;
}

/** Only source state or imported priority changes can end a snooze early. */
export function sourceChangeSnooze(
  previous: LocalWorkItem,
  incoming: LocalWorkItem,
  enabled: boolean,
  now: number,
): Partial<Pick<LocalWorkItem, "snoozedUntil" | "returnedAt">> {
  if (
    !enabled ||
    previous.source === "manual" ||
    previous.status !== "active" ||
    previous.pendingSourceWrite ||
    (previous.snoozedUntil ?? 0) <= now ||
    (previous.sourceStatusKey === incoming.sourceStatusKey &&
      previous.importedPriority === incoming.importedPriority)
  )
    return {};
  return { snoozedUntil: undefined, returnedAt: now };
}

/** Keeps only the fields that differ from the item's source values. */
function getSourceWrite(
  workItem: LocalWorkItem,
  change: BacklogSettleChange | undefined,
): LocalPendingSourceWrite | undefined {
  if (!change || workItem.source === "manual") return undefined;

  const state =
    change.state &&
    normalizeConnectorStatusKey(change.state.name) !== workItem.sourceStatusKey
      ? change.state.name
      : undefined;
  const priority =
    change.priority !== undefined &&
    change.priority !== workItem.importedPriority
      ? change.priority
      : undefined;
  if (state === undefined && priority === undefined) return undefined;

  return {
    state,
    priority,
    previous: {
      sourceStatusKey: workItem.sourceStatusKey,
      sourceStatusLabel: workItem.sourceStatusLabel,
      importedPriority: workItem.importedPriority,
      priority: workItem.priority,
      ...(state !== undefined
        ? {
            workflowStateId: workItem.workflowStateId,
            importedWorkflowStateId: workItem.importedWorkflowStateId,
          }
        : {}),
    },
  };
}

function getSettleWorkflowStateId(
  state: LocalAppState,
  workItem: LocalWorkItem,
  change?: BacklogSettleChange,
) {
  return change?.state
    ? findMappedWorkflowStateId(
        state.workflowStateMappings,
        workItem.source,
        workItem.sourceConnectionId,
        normalizeConnectorStatusKey(change.state.name),
        workItem.sourceProjectName,
      )
    : undefined;
}

/** The dialog's archive warning follows the same mapping as the transition. */
export function settleArchivesWorkItem(
  state: LocalAppState,
  workItem: LocalWorkItem,
  change?: BacklogSettleChange,
) {
  return (
    workItem.source === "manual" ||
    isDoneWorkflowState(
      state.workflowStates,
      getSettleWorkflowStateId(state, workItem, change),
    )
  );
}

/**
 * Settles a backlog item. A manual item becomes archived. A synced item becomes
 * settled and remembers its source state and priority, so a later sync can tell
 * when someone changed it in the source.
 *
 * `change` sets a new state, priority or both in the source. Only the fields
 * that differ are kept, as a pending write that is sent after the Undo window.
 * The item shows the new values at once. A source state mapped to Done archives
 * the item instead.
 *
 * `includeSubitems` settles the parent's active subitems along with it, and
 * Undo or a reopen brings them back together. A running entry on a settled
 * item is stopped and saved first. An archived item moves into a done state.
 */
export function settleBacklogItem(
  state: LocalAppState,
  workItemId: string,
  factories: WorkItemFactories,
  change?: BacklogSettleChange,
  options: CloseSubitemsOptions = {},
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target || target.status !== "active") {
    return state;
  }

  const initialWrite = getSourceWrite(target, change);
  const sourceWrite = initialWrite
    ? { ...initialWrite, readyAt: factories.now() + 8000 }
    : undefined;
  const selectedWorkflowStateId = getSettleWorkflowStateId(
    state,
    target,
    change,
  );
  const archives = settleArchivesWorkItem(state, target, change);

  const now = factories.now();
  const carriedIds = new Set(
    options.includeSubitems
      ? getOpenSubitems(state, workItemId, "settle").map((child) => child._id)
      : [],
  );
  const saved = saveRunningEntries(
    state,
    new Set([workItemId, ...carriedIds]),
    factories,
  );
  // A snooze ends with the settle, so the item never comes back as returned.
  const settle = (workItem: LocalWorkItem): LocalWorkItem =>
    archives
      ? closeWorkItem(
          workItem,
          selectedWorkflowStateId ?? getClosingWorkflowStateId(state, workItem),
          state.workflowStates,
          now,
        )
      : {
          ...workItem,
          status: "settled",
          settledAt: now,
          settledSourceStatusKey: workItem.sourceStatusKey,
          settledImportedPriority: workItem.importedPriority,
          snoozedUntil: undefined,
          returnedAt: undefined,
        };

  return {
    ...saved,
    workItems: saved.workItems.map((workItem) => {
      if (workItem._id === workItemId) {
        const written = sourceWrite
          ? withSourceWrite(
              workItem,
              sourceWrite,
              getWorkItemPriorityRanges(state, workItem),
            )
          : workItem;
        return settle(
          sourceWrite?.state !== undefined
            ? {
                ...written,
                importedWorkflowStateId: selectedWorkflowStateId,
                workflowStateId: archives
                  ? written.workflowStateId
                  : selectedWorkflowStateId,
              }
            : written,
        );
      }

      return carriedIds.has(workItem._id)
        ? { ...settle(workItem), settledWithParentId: workItemId }
        : workItem;
    }),
  };
}

/** Shows the pending write's values on the item until the write is sent. */
function withSourceWrite(
  workItem: LocalWorkItem,
  sourceWrite: LocalPendingSourceWrite,
  priorityRanges: PriorityRanges,
): LocalWorkItem {
  const followsImportedPriority =
    workItem.priority ===
    getPriorityLevel(workItem.importedPriority, priorityRanges);
  return {
    ...workItem,
    pendingSourceWrite: sourceWrite,
    ...(sourceWrite.state !== undefined
      ? {
          sourceStatusKey: normalizeConnectorStatusKey(sourceWrite.state),
          sourceStatusLabel: sourceWrite.state,
        }
      : {}),
    ...(sourceWrite.priority !== undefined
      ? {
          importedPriority: sourceWrite.priority,
          priority: followsImportedPriority
            ? getPriorityLevel(sourceWrite.priority, priorityRanges)
            : workItem.priority,
        }
      : {}),
  };
}

/** Recovery can advance while the state, priority and Undo deadline stay fixed. */
export function hasSameSourceWriteRequest(
  left: LocalPendingSourceWrite | undefined,
  right: LocalPendingSourceWrite | undefined,
) {
  return (
    Boolean(left) === Boolean(right) &&
    left?.state === right?.state &&
    left?.priority === right?.priority &&
    left?.readyAt === right?.readyAt
  );
}

/**
 * Acknowledges the sent snapshot. A newer pending write keeps its displayed
 * values and deadline, but recovers to this successful snapshot if it fails.
 */
export function completeSourceWrite(
  state: LocalAppState,
  workItemId: string,
  sentItems?: readonly LocalWorkItem[],
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  const currentWrite = target?.pendingSourceWrite;
  if (!target || !currentWrite) {
    return state;
  }

  const sent = sentItems
    ? sentItems.find((item) => item._id === workItemId)
    : target;
  if (!sent?.pendingSourceWrite) return state;
  if (sent.pendingSourceWrite.state !== undefined) {
    // A child's accepted source state is now its recovery baseline, even if
    // the parent's independently dispatched write later fails.
    state = {
      ...state,
      workItems: state.workItems.map((parent) => {
        const write = parent.pendingSourceWrite;
        if (
          !write?.previous.carriedChildren?.some(
            (child) => child.id === workItemId,
          )
        )
          return parent;
        return {
          ...parent,
          pendingSourceWrite: {
            ...write,
            previous: {
              ...write.previous,
              carriedChildren: write.previous.carriedChildren.map((child) =>
                child.id === workItemId
                  ? {
                      ...child,
                      before: {
                        ...moveSnapshot(sent),
                        settledWithParentId: undefined,
                      },
                    }
                  : child,
              ),
            },
          },
        };
      }),
    };
  }
  if (!hasSameSourceWriteRequest(sent.pendingSourceWrite, currentWrite)) {
    const { workflowStateId, ...lifecycle } = moveSnapshot(sent);
    const carriedIds = new Set([
      ...(sent.pendingSourceWrite.previous.carriedChildren ?? []).map(
        (child) => child.id,
      ),
      ...(currentWrite.previous.carriedChildren ?? []).map((child) => child.id),
      ...(sentItems ?? [])
        .filter((child) => child.settledWithParentId === workItemId)
        .map((child) => child._id),
    ]);
    return updateOne(state, workItemId, (item) => ({
      ...item,
      pendingSourceWrite: {
        ...currentWrite,
        previous: {
          sourceStatusKey: sent.sourceStatusKey,
          sourceStatusLabel: sent.sourceStatusLabel,
          importedPriority: sent.importedPriority,
          priority: sent.priority,
          workflowStateId,
          importedWorkflowStateId: sent.importedWorkflowStateId,
          lifecycle,
          workItemOrder: currentWrite.previous.workItemOrder
            ? {
                before: (sentItems ?? []).flatMap((item) =>
                  currentWrite.previous.workItemOrder!.after.includes(item._id)
                    ? [item._id]
                    : [],
                ),
                after: currentWrite.previous.workItemOrder.after,
              }
            : undefined,
          carriedChildren: [...carriedIds].flatMap((id) => {
            const before = sentItems?.find((child) => child._id === id);
            const current = state.workItems.find((child) => child._id === id);
            if (!before || !current) return [];
            const after =
              currentWrite.previous.carriedChildren?.find(
                (child) => child.id === id,
              )?.after ?? moveSnapshot(current);
            return [{ id, before: moveSnapshot(before), after }];
          }),
        },
      },
    }));
  }

  return updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    pendingSourceWrite: undefined,
  }));
}

/**
 * Applies mapping changes deferred while a source write protected an item or
 * its carried children, after success or failure. Newer writes stay protected.
 */
export function reconcileSourceWriteMappings(
  previous: LocalAppState,
  next: LocalAppState,
  factories: WorkItemFactories,
): LocalAppState {
  if (previous === next) return next;
  const protectedIds = getPendingSourceWriteItemIds(next);
  const releasedIds = new Set(
    [...getPendingSourceWriteItemIds(previous)].filter(
      (id) => !protectedIds.has(id),
    ),
  );
  if (releasedIds.size === 0) return next;

  const replacementDoneId = getFirstDoneWorkflowState(next.workflowStates)?._id;
  const workItems = next.workItems.map((item) => {
    if (!releasedIds.has(item._id)) return item;
    const mapped = syncImportedWorkflowState(item, next.workflowStateMappings);
    // Missing-sync archives keep their open state. Explicit closes need a Done
    // state even if their recovery snapshot predates a workflow settings edit.
    return mapped.status === "archived" &&
      !mapped.archivedByMissingSync &&
      !isDoneWorkflowState(next.workflowStates, mapped.workflowStateId)
      ? { ...mapped, workflowStateId: replacementDoneId }
      : mapped;
  });
  const archivedIds = new Set(
    workItems
      .filter((item) => releasedIds.has(item._id) && item.status === "archived")
      .map((item) => item._id),
  );
  const saved = saveRunningEntries(
    { ...next, workItems },
    archivedIds,
    factories,
  );
  // A state's Done flag can change while the mapped IDs stay the same.
  return applyWorkflowStateLifecycle(next, saved, factories);
}

/** Restores the write's source values and saved lifecycle after failure. */
export function failSourceWrite(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  const sourceWrite = target?.pendingSourceWrite;
  if (!target || !sourceWrite) {
    return state;
  }

  const restored = updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    pendingSourceWrite: undefined,
    sourceStatusKey: sourceWrite.previous.sourceStatusKey,
    sourceStatusLabel: sourceWrite.previous.sourceStatusLabel,
    importedPriority: sourceWrite.previous.importedPriority,
    priority: sourceWrite.previous.priority,
  }));
  const returned =
    sourceWrite.previous.lifecycle &&
    sourceWrite.previous.lifecycle.status !== target.status
      ? reactivate(restored, workItemId, target.status)
      : restored;
  const reopened = sourceWrite.previous.lifecycle
    ? updateOne(returned, workItemId, (workItem) => ({
        ...workItem,
        ...sourceWrite.previous.lifecycle,
      }))
    : target.status === "active"
      ? restored
      : reactivate(restored, workItemId, target.status);
  // A move's write also puts the item back in the state it left.
  const recoveredFields =
    sourceWrite.state !== undefined || "workflowStateId" in sourceWrite.previous
      ? updateOne(reopened, workItemId, (workItem) => ({
          ...workItem,
          workflowStateId: sourceWrite.previous.workflowStateId,
          importedWorkflowStateId: sourceWrite.previous.importedWorkflowStateId,
          workflowStateIdBeforeClose:
            sourceWrite.previous.lifecycle?.workflowStateIdBeforeClose,
        }))
      : reopened;
  const recovered = restoreSourceWriteOrder(
    recoveredFields,
    sourceWrite.previous.workItemOrder,
  );
  const carried = sourceWrite.previous.carriedChildren ?? [];
  if (!carried.length) return recovered;
  return {
    ...recovered,
    workItems: recovered.workItems.map((item) => {
      const child = carried.find((child) => child.id === item._id);
      if (!child) return item;
      const current = state.workItems.find(
        (current) => current._id === item._id,
      )!;
      if (current.pendingSourceWrite?.state !== undefined) {
        return current.settledWithParentId === workItemId
          ? { ...current, settledWithParentId: undefined }
          : current;
      }
      if (
        !Object.entries(moveSnapshot(current)).every(
          ([key, value]) =>
            child.after[key as keyof LocalWorkItemMoveSnapshot] === value,
        )
      )
        return current;
      return { ...item, ...child.before };
    }),
  };
}

/**
 * Archives an item in Ajour without touching its source. A settled item takes
 * the subitems its settle carried, so Restore brings them back together.
 */
export function archiveBacklogItem(
  state: LocalAppState,
  workItemId: string,
  factories: WorkItemFactories,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target || target.status === "archived") {
    return state;
  }

  const now = factories.now();
  return {
    ...state,
    workItems: state.workItems.map((workItem) =>
      workItem._id === workItemId ||
      (workItem.settledWithParentId === workItemId &&
        workItem.status === "settled")
        ? closeWorkItem(
            workItem,
            getClosingWorkflowStateId(state, workItem),
            state.workflowStates,
            now,
          )
        : workItem,
    ),
  };
}

/**
 * Puts the item and the subitems its settle or close carried back on the
 * user's plate. An item leaving a done state goes back to the state it had
 * before.
 */
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
            archivedSourceStatusKey: undefined,
            ...(isDoneWorkflowState(
              state.workflowStates,
              workItem.workflowStateId,
            )
              ? {
                  workflowStateId: isDoneWorkflowState(
                    state.workflowStates,
                    workItem.workflowStateIdBeforeClose,
                  )
                    ? undefined
                    : workItem.workflowStateIdBeforeClose,
                  workflowStateIdBeforeClose: undefined,
                }
              : {}),
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

/** Pins an active item to the top of the sidebar list. */
export function pinBacklogItem(
  state: LocalAppState,
  workItemId: string,
  now: number,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (target?.status !== "active" || target.pinnedAt !== undefined) {
    return state;
  }
  return updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    pinnedAt: now,
  }));
}

export function unpinBacklogItem(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (target?.pinnedAt === undefined) {
    return state;
  }
  return updateOne(state, workItemId, (workItem) => ({
    ...workItem,
    pinnedAt: undefined,
  }));
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
 * as on the Backlog page. Pinned items come first, in that same order.
 */
export function selectSidebarBacklogItems(
  state: LocalAppState,
  now: number,
): LocalWorkItem[] {
  const ordered = orderSidebarBacklogItems(state, now);
  // Pinned items go first, keeping the list's order among themselves.
  return [
    ...ordered.filter((workItem) => workItem.pinnedAt !== undefined),
    ...ordered.filter((workItem) => workItem.pinnedAt === undefined),
  ];
}

/**
 * The item the sidebar and the timer dock offer as Up next: the first listed
 * item that is not pinned. Pinning keeps an item in view without making it
 * the next thing to start.
 */
export function selectUpNextBacklogItem(
  listed: readonly LocalWorkItem[],
): LocalWorkItem | undefined {
  return listed.find((workItem) => workItem.pinnedAt === undefined);
}

function orderSidebarBacklogItems(
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

  // Every other ordering sorts like the Backlog page.
  return orderBacklogItems(listed, state.workItems, state.backlogSortMode);
}
