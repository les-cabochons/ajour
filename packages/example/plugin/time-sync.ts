// The example planner's time sync: an in-memory remote that answers
// `syncTimeEntries` rounds, so Ajour's own tests have a time sync to talk
// to. Erasable TypeScript only, with explicit .ts imports.
import type {
  TimeSyncChange,
  TimeSyncChangeResult,
  TimeSyncEntryValues,
  TimeSyncRemoteEntry,
  TimeSyncRequest,
  TimeSyncResult,
} from "../../plugin-sdk/index.ts";

/** The longest entry the example planner takes, as a real system might refuse. */
const MAX_MINUTES = 24 * 60;

/** One connection's remote: its entries by remote id, and the next id to give. */
interface Remote {
  entries: Map<string, TimeSyncRemoteEntry>;
  nextId: number;
}

/*
 * The remotes live on `globalThis`, one per connection, so they outlive one
 * operation in the in-process runtime of Ajour's tests, where every round
 * imports this plugin again. In Ajour's sandboxed renderer each operation
 * runs in a new worker, so a remote there starts empty every round.
 */
const REMOTES: unique symbol = Symbol.for("ajour.example-planner.time-sync");

function remoteOf(connectionId: string): Remote {
  const holder = globalThis as { [REMOTES]?: Map<string, Remote> };
  const remotes = (holder[REMOTES] ??= new Map());
  let remote = remotes.get(connectionId);
  if (!remote) {
    remote = { entries: new Map(), nextId: 1 };
    remotes.set(connectionId, remote);
  }
  return remote;
}

/** The entry a change names: by remote id, else by the client reference it was created with. */
function findEntry(remote: Remote, change: TimeSyncChange) {
  if (change.remoteId && remote.entries.has(change.remoteId)) {
    return remote.entries.get(change.remoteId);
  }
  return [...remote.entries.values()].find(
    (entry) => entry.clientRef === change.syncKey,
  );
}

function stored(
  remoteId: string,
  clientRef: string | undefined,
  values: TimeSyncEntryValues,
): TimeSyncRemoteEntry {
  return {
    remoteId,
    ...(clientRef ? { clientRef } : {}),
    localDate: values.localDate,
    minutes: values.minutes,
    running: values.running,
    ...(values.running ? { countingSince: values.countingSince } : {}),
    projectRemoteId: values.projectRemoteId,
    taskName: values.taskName,
    ...(values.taskRemoteId ? { taskRemoteId: values.taskRemoteId } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function apply(remote: Remote, change: TimeSyncChange): TimeSyncChangeResult {
  const existing = findEntry(remote, change);
  if (change.kind === "delete") {
    if (existing) remote.entries.delete(existing.remoteId);
    return { syncKey: change.syncKey, status: "synced" };
  }
  if (change.values.minutes > MAX_MINUTES) {
    return {
      syncKey: change.syncKey,
      status: "refused",
      message: "The example planner refuses an entry over 24 hours.",
    };
  }
  // A create whose answer was lost comes again with the same client
  // reference: the entry it made is adopted, not made twice.
  const remoteId = existing?.remoteId ?? `example-${remote.nextId++}`;
  const entry = stored(
    remoteId,
    existing ? existing.clientRef : change.syncKey,
    change.values,
  );
  remote.entries.set(remoteId, entry);
  return { syncKey: change.syncKey, status: "synced", entry };
}

/** Applies the changes in order, then lists the window by day. */
export function runRound(
  connectionId: string,
  request: TimeSyncRequest,
): TimeSyncResult {
  const remote = remoteOf(connectionId);
  const results = request.changes.map((change) => apply(remote, change));
  const entries = [...remote.entries.values()]
    .filter(
      (entry) =>
        entry.localDate >= request.from && entry.localDate <= request.to,
    )
    .sort(
      (a, b) =>
        a.localDate.localeCompare(b.localDate) ||
        a.remoteId.localeCompare(b.remoteId),
    );
  return { results, entries };
}

/*
 * Another tool's hand on the remote, for Ajour's tests: an entry logged,
 * edited or deleted there, or a timer started there, as a planning tool
 * would. Ajour takes these changes on its next round. Each one stamps
 * `updatedAt` now.
 */

/** Logs an entry as another tool would: without a client reference. */
export function logElsewhere(
  connectionId: string,
  values: Omit<TimeSyncEntryValues, "running" | "countingSince">,
): TimeSyncRemoteEntry {
  const remote = remoteOf(connectionId);
  const entry = stored(`example-${remote.nextId++}`, undefined, {
    ...values,
    running: false,
  });
  remote.entries.set(entry.remoteId, entry);
  return entry;
}

/** Edits an entry as another tool would, keeping what it doesn't name. */
export function editElsewhere(
  connectionId: string,
  remoteId: string,
  values: Partial<Omit<TimeSyncEntryValues, "running" | "countingSince">>,
): TimeSyncRemoteEntry {
  const remote = remoteOf(connectionId);
  const existing = remote.entries.get(remoteId);
  if (!existing) throw new Error(`The remote has no entry ${remoteId}.`);
  const entry = stored(remoteId, existing.clientRef, {
    ...existing,
    ...values,
  });
  remote.entries.set(remoteId, entry);
  return entry;
}

/** Deletes an entry as another tool would. */
export function deleteElsewhere(connectionId: string, remoteId: string) {
  remoteOf(connectionId).entries.delete(remoteId);
}

/**
 * Starts a timer as another tool would, counting from `countingSince`. The
 * planner keeps one running entry per person, as a real system does, so the
 * entry running there stops at that instant, with its whole minutes.
 */
export function startElsewhere(
  connectionId: string,
  values: Omit<TimeSyncEntryValues, "minutes" | "running" | "countingSince"> & {
    countingSince: string;
  },
): TimeSyncRemoteEntry {
  const remote = remoteOf(connectionId);
  const startedAt = Date.parse(values.countingSince);
  for (const entry of remote.entries.values()) {
    if (!entry.running || !entry.countingSince) continue;
    const minutes = Math.round(
      (startedAt - Date.parse(entry.countingSince)) / 60_000,
    );
    remote.entries.set(
      entry.remoteId,
      stored(entry.remoteId, entry.clientRef, {
        ...entry,
        running: false,
        minutes: Math.max(0, minutes),
      }),
    );
  }
  const entry = stored(`example-${remote.nextId++}`, undefined, {
    ...values,
    minutes: 0,
    running: true,
  });
  remote.entries.set(entry.remoteId, entry);
  return entry;
}
