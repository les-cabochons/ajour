import {
  estimateFieldsToPush,
  type HeldEstimates,
} from "@ajour/shared/connection-access";
import type {
  LocalAppState,
  LocalWorkItem,
  LocalWorkItemEstimateFieldKey,
  LocalWorkItemEstimateFieldState,
} from "@/domain/local-state";

/*
 * Held edits (#395): a change the connection refused because editing work
 * items was off stays on this computer, as the user left it, and goes only
 * once the user approves it in Sync review. Turning editing on is not that
 * approval. The item's own state holds its held changes: a settle or move
 * keeps its pending write, an estimate field and a description their local
 * value, each marked held. Comments wait in a device queue
 * (`lib/held-edits.ts`).
 */

export const ESTIMATE_FIELD_KEYS: readonly LocalWorkItemEstimateFieldKey[] = [
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
];

/** A held change kept on a backlog item. */
export type HeldItemEdit =
  | {
      kind: "settle";
      itemId: string;
      pluginId: string;
      connectionId: string;
      at: number;
    }
  | {
      kind: "estimate";
      itemId: string;
      pluginId: string;
      connectionId: string;
      field: LocalWorkItemEstimateFieldKey;
      at: number;
    }
  | {
      kind: "description";
      itemId: string;
      pluginId: string;
      connectionId: string;
      at: number;
    };

/** The held changes the backlog items keep, oldest first. */
export function heldItemEdits(
  workItems: readonly LocalWorkItem[],
): HeldItemEdit[] {
  const edits: HeldItemEdit[] = [];
  for (const item of workItems) {
    if (item.source === "manual" || !item.sourceConnectionId) continue;
    const owner = {
      itemId: item._id,
      pluginId: item.source,
      connectionId: item.sourceConnectionId,
    };
    const heldAt = item.pendingSourceWrite?.heldAt;
    if (heldAt !== undefined) {
      edits.push({ kind: "settle", ...owner, at: heldAt });
    }
    for (const field of ESTIMATE_FIELD_KEYS) {
      const held = item.estimateSync?.[field]?.held;
      if (held) edits.push({ kind: "estimate", ...owner, field, at: held.at });
    }
    const description = item.descriptionSync?.held;
    if (description) {
      edits.push({ kind: "description", ...owner, at: description.at });
    }
  }
  return edits.sort((left, right) => left.at - right.at);
}

function updateItem(
  state: LocalAppState,
  itemId: string,
  change: (item: LocalWorkItem) => LocalWorkItem,
): LocalAppState {
  let changed = false;
  const workItems = state.workItems.map((item) => {
    if (item._id !== itemId) return item;
    const next = change(item);
    changed ||= next !== item;
    return next;
  });
  return changed ? { ...state, workItems } : state;
}

/**
 * Holds the item's pending settle or move write. The first hold keeps its
 * time. The source refused the request, so none is on its way any more.
 */
export function holdSourceWrite(
  state: LocalAppState,
  itemId: string,
  now: number,
): LocalAppState {
  return updateItem(state, itemId, (item) => {
    if (
      !item.pendingSourceWrite ||
      item.pendingSourceWrite.heldAt !== undefined
    )
      return item;
    const { priorityInFlight: _refused, ...write } = item.pendingSourceWrite;
    return { ...item, pendingSourceWrite: { ...write, heldAt: now } };
  });
}

/** Lifts the hold of the item's write, which then goes as any pending write. */
export function releaseHeldSourceWrite(
  state: LocalAppState,
  itemId: string,
): LocalAppState {
  return updateItem(state, itemId, (item) => {
    if (item.pendingSourceWrite?.heldAt === undefined) return item;
    const { heldAt: _heldAt, ...write } = item.pendingSourceWrite;
    return { ...item, pendingSourceWrite: write };
  });
}

/** Whether the item's pending write waits for the user's approval. */
export function isSourceWriteHeld(
  item: Pick<LocalWorkItem, "pendingSourceWrite">,
) {
  return item.pendingSourceWrite?.heldAt !== undefined;
}

function isOfConnection(
  item: LocalWorkItem,
  pluginId: string,
  connectionId: string,
) {
  return (
    item.source === pluginId &&
    item.sourceConnectionId === connectionId &&
    typeof item.sourceId === "string"
  );
}

function withEstimateHold(
  item: LocalWorkItem,
  held: ReadonlySet<LocalWorkItemEstimateFieldKey>,
  now: number,
  keep: ReadonlySet<LocalWorkItemEstimateFieldKey> = new Set(),
): LocalWorkItem {
  let changed = false;
  const estimateSync = { ...item.estimateSync };
  for (const field of ESTIMATE_FIELD_KEYS) {
    const state: LocalWorkItemEstimateFieldState | undefined =
      estimateSync[field];
    if (held.has(field)) {
      if (state?.held) continue;
      estimateSync[field] = { ...state, held: { at: now } };
      changed = true;
    } else if (state?.held && !keep.has(field)) {
      const { held: _held, ...rest } = state;
      estimateSync[field] = rest;
      changed = true;
    }
  }
  return changed ? { ...item, estimateSync } : item;
}

/**
 * The connection's estimate holds after a sync: the fields the sync held,
 * plus any hold whose change still waits to upload. A field it uploaded, or
 * one that no longer differs from the source, isn't held any more.
 */
export function markHeldEstimates(
  state: LocalAppState,
  connection: { pluginId: string; connectionId: string },
  held: readonly HeldEstimates[],
  now: number,
): LocalAppState {
  const fieldsByItem = new Map(
    held.map((entry) => [entry.localWorkItemId, new Set(entry.fields)]),
  );
  let changed = false;
  const workItems = state.workItems.map((item) => {
    if (!isOfConnection(item, connection.pluginId, connection.connectionId)) {
      return item;
    }
    // A hold set after the sync's request was built (editing turned on
    // mid-sync) isn't in the answer's list, yet its change still waits for
    // review: only a field with nothing left to upload loses its hold.
    const next = withEstimateHold(
      item,
      fieldsByItem.get(item._id) ?? new Set(),
      now,
      new Set(estimateFieldsToPush(item)),
    );
    changed ||= next !== item;
    return next;
  });
  return changed ? { ...state, workItems } : state;
}

/**
 * Holds every estimate change the connection's items would upload now, as
 * editing turns on: changes made while it was off wait for review even when
 * no sync saw them yet.
 */
export function holdPendingEstimates(
  state: LocalAppState,
  connection: { pluginId: string; connectionId: string },
  now: number,
): LocalAppState {
  let changed = false;
  const workItems = state.workItems.map((item) => {
    if (!isOfConnection(item, connection.pluginId, connection.connectionId)) {
      return item;
    }
    const pending = new Set<LocalWorkItemEstimateFieldKey>([
      ...estimateFieldsToPush(item),
      ...ESTIMATE_FIELD_KEYS.filter(
        (field) => item.estimateSync?.[field]?.held,
      ),
    ]);
    const next = withEstimateHold(item, pending, now);
    changed ||= next !== item;
    return next;
  });
  return changed ? { ...state, workItems } : state;
}

/** Lifts the hold of one estimate field, so the next sync uploads it. */
export function releaseHeldEstimate(
  state: LocalAppState,
  itemId: string,
  field: LocalWorkItemEstimateFieldKey,
): LocalAppState {
  return updateItem(state, itemId, (item) => {
    const fieldState = item.estimateSync?.[field];
    if (!fieldState?.held) return item;
    const { held: _held, ...rest } = fieldState;
    return { ...item, estimateSync: { ...item.estimateSync, [field]: rest } };
  });
}

/**
 * Discard on a held estimate: the field takes the source's value from the
 * last sync, which both sides then agree on.
 */
export function discardHeldEstimate(
  state: LocalAppState,
  itemId: string,
  field: LocalWorkItemEstimateFieldKey,
): LocalAppState {
  return updateItem(state, itemId, (item) => {
    const fieldState = item.estimateSync?.[field];
    if (!fieldState?.held) return item;
    const value = fieldState.remoteValue ?? fieldState.baselineValue;
    const {
      held: _held,
      resolution: _resolution,
      conflict: _conflict,
      error: _error,
      ...rest
    } = fieldState;
    return {
      ...item,
      [field]: value,
      estimateSync: {
        ...item.estimateSync,
        [field]: { ...rest, baselineValue: value, remoteValue: value },
      },
    };
  });
}

/** The estimate fields the item keeps held, for the sync to leave alone. */
export function heldEstimateFields(item: LocalWorkItem) {
  return ESTIMATE_FIELD_KEYS.filter(
    (field) => item.estimateSync?.[field]?.held !== undefined,
  );
}
