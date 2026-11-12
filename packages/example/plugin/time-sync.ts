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
