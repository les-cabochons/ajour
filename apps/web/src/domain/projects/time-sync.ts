import {
  isCapabilitySwitchedOn,
  TIME_SYNC_MAX_CHANGES,
  type PluginsOverview,
  type TimeSyncChange,
  type TimeSyncEntryValues,
  type TimeSyncRequest,
  type TimeSyncResult,
  timeSyncEntryValuesSchema,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalProject,
  LocalSyncedCopy,
  LocalTimeSync,
  LocalTimeSyncRefusal,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import { getCommitTarget } from "@/domain/projects/commit-target";
import type { PropertyPlugins } from "@/domain/projects/plugin-properties";
import {
  addLocalDays,
  getWeekOf,
  isValidLocalDate,
} from "@/domain/time/local-date";
import {
  resolveCommitTaskName,
  resolveLineNameSource,
} from "@/domain/time/timesheet-submission";

/*
 * The time sync rules (#692, ADR 0018). A time sync keeps a live copy of
 * the user's time entries in another system. This module decides which
 * saved entries take part, builds a round's changes from the synced copies,
 * and applies the round's answer to them. It never changes an entry: a
 * round is not a commit, and it is not part of Undo.
 *
 * Saved entries only, for now: the running entry is #693, and taking the
 * other system's changes into Ajour is #694. Each round still lists the
 * remote window; Ajour keeps only `updatedAt` from it, for the entries it
 * holds a synced copy of.
 */

export type TimeSyncState = Pick<
  LocalAppState,
  "projects" | "timesheetEntries"
> & {
  timeSyncs: Record<string, LocalTimeSync>;
};

/** The part of the local state the time sync rules read and write. */
export function timeSyncStateOf(
  state: Pick<LocalAppState, "projects" | "timesheetEntries" | "timeSyncs">,
): TimeSyncState {
  return {
    projects: state.projects,
    timesheetEntries: state.timesheetEntries,
    timeSyncs: state.timeSyncs ?? {},
  };
}

/** The connection a round runs for. */
export interface TimeSyncConnectionRef {
  pluginId: string;
  connectionId: string;
}

/** What a round reads besides the state. */
export interface TimeSyncContext {
  /** Today, `YYYY-MM-DD`, in the user's time zone. */
  today: string;
  /** The user's IANA time zone, sent with the round. */
  timeZone: string;
  /** The active plugins that name tasks, as the Commit page reads them. */
  plugins: PropertyPlugins;
  /** The Commit page's saved Names choice (`commitLinesNameSource`). */
  namesSource: string | undefined;
}

/** An entry shorter than this stays local, so a mis-click never leaves Ajour. */
export const TIME_SYNC_MIN_DURATION_MS = 30_000;

/** The window lists the current week and this many weeks before it. */
const WINDOW_WEEKS_BEFORE = 4;

const MINUTE_MS = 60_000;
/** The longest task name the contract takes. */
const TASK_NAME_MAX_LENGTH = 240;

/**
 * The sync key of a saved entry: the one rule. The other system keeps it as
 * its client reference, so it must outlive Time entries going off and on.
 * It is the entry's id. #693 lets a running entry hand its key to the entry
 * it saves as, so both share one.
 */
export function entrySyncKey(entry: Pick<LocalTimesheetEntry, "_id">) {
  return entry._id;
}

function recordOf(
  timeSyncs: Record<string, LocalTimeSync>,
  connection: TimeSyncConnectionRef,
) {
  const record = Object.hasOwn(timeSyncs, connection.connectionId)
    ? timeSyncs[connection.connectionId]
    : undefined;
  return record?.pluginId === connection.pluginId ? record : undefined;
}

/**
 * Starts the time sync of a connection whose Time entries just went on: the
 * start week is this week, and no copy exists yet. A connection that has one
 * keeps it.
 */
export function startTimeSync(
  timeSyncs: Record<string, LocalTimeSync>,
  connection: TimeSyncConnectionRef,
  today: string,
  now: number,
): Record<string, LocalTimeSync> {
  if (recordOf(timeSyncs, connection)) return timeSyncs;
  return {
    ...timeSyncs,
    [connection.connectionId]: {
      pluginId: connection.pluginId,
      startWeek: getWeekOf(today),
      startedAt: now,
      copies: {},
      refusals: {},
    },
  };
}

/**
 * Drops a connection's time sync: its copies, refusals and status. The other
 * system keeps its entries.
 */
export function stopTimeSync(
  timeSyncs: Record<string, LocalTimeSync>,
  connectionId: string,
): Record<string, LocalTimeSync> {
  if (!Object.hasOwn(timeSyncs, connectionId)) return timeSyncs;
  const { [connectionId]: _stopped, ...rest } = timeSyncs;
  return rest;
}

/**
 * Starts and stops time syncs to match the plugins overview. A connection
 * with Time entries switched on starts one; its plugin being off pauses the
 * rounds and keeps it. One whose plugin the overview lists without the
 * connection, or with Time entries switched off, stops. A plugin the
 * overview doesn't list keeps its time syncs, since a plugin that is still
 * loading looks the same.
 */
export function reconcileTimeSyncs(
  timeSyncs: Record<string, LocalTimeSync>,
  overview: Pick<PluginsOverview, "connectionGroups">,
  today: string,
  now: number,
): Record<string, LocalTimeSync> {
  let next = timeSyncs;
  for (const group of overview.connectionGroups) {
    const switchedOn = isCapabilitySwitchedOn(group, "timeSync");
    for (const connection of group.connections) {
      if (switchedOn) {
        next = startTimeSync(
          next,
          { pluginId: group.plugin.id, connectionId: connection.id },
          today,
          now,
        );
      }
    }
    for (const [connectionId, record] of Object.entries(next)) {
      if (
        record.pluginId === group.plugin.id &&
        (!switchedOn ||
          !group.connections.some((entry) => entry.id === connectionId))
      ) {
        next = stopTimeSync(next, connectionId);
      }
    }
  }
  return next;
}

/** Whether two sets of entry values agree, field by field. */
export function sameEntryValues(
  left: TimeSyncEntryValues,
  right: TimeSyncEntryValues,
) {
  return (
    left.localDate === right.localDate &&
    left.minutes === right.minutes &&
    left.running === right.running &&
    left.countingSince === right.countingSince &&
    left.projectRemoteId === right.projectRemoteId &&
    left.taskName === right.taskName &&
    left.taskRemoteId === right.taskRemoteId
  );
}

/** Reads the entries of one connection's time sync against the state. */
function createReader(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  record: LocalTimeSync,
  context: TimeSyncContext,
) {
  const projects = new Map(
    state.projects.map((project) => [project._id, project]),
  );
  const namesPluginId = resolveLineNameSource(
    context.namesSource,
    context.plugins,
  );

  /** Whether the project is managed by this connection's project source. */
  const isManagedHere = (project: LocalProject) =>
    project.source?.pluginId === connection.pluginId &&
    project.source.connectionId === connection.connectionId;

  /**
   * What the entry sends, or undefined when it doesn't take part: its
   * project is managed by this connection, neither the project nor the task
   * is Local only, its day is from the start week and not after today, and
   * it lasts at least 30 seconds. The task name is the commit name the
   * Commit page uses; a Not known yet task sends its own name. The note
   * never leaves Ajour.
   */
  const valuesOf = (
    entry: LocalTimesheetEntry,
  ): TimeSyncEntryValues | undefined => {
    const project = entry.projectId ? projects.get(entry.projectId) : undefined;
    if (!project?.source || !isManagedHere(project)) return undefined;
    const task = entry.taskId
      ? project.tasks.find((candidate) => candidate._id === entry.taskId)
      : undefined;
    if (!task) return undefined;
    const target = getCommitTarget(project, task);
    if (target === "local") return undefined;
    if (entry.localDate < record.startWeek || entry.localDate > context.today) {
      return undefined;
    }
    if (entry.durationMs < TIME_SYNC_MIN_DURATION_MS) return undefined;
    const taskName = (
      target === "waiting"
        ? task.name
        : resolveCommitTaskName({
            task,
            plugins: context.plugins,
            namesPluginId,
          })
    )
      .trim()
      .slice(0, TASK_NAME_MAX_LENGTH);
    if (!taskName) return undefined;
    return {
      localDate: entry.localDate,
      minutes: Math.round(entry.durationMs / MINUTE_MS),
      running: false,
      projectRemoteId: project.source.remoteId,
      taskName,
      ...(task.source ? { taskRemoteId: task.source.remoteId } : {}),
    };
  };

  const entries = new Map(
    state.timesheetEntries.map((entry) => [entrySyncKey(entry), entry]),
  );

  /**
   * The change one sync key needs against its synced copy, refused or not:
   * an upsert when the entry takes part and differs from the copy, a delete
   * when a copy exists and the entry is gone or no longer takes part.
   */
  const changeFor = (syncKey: string): TimeSyncChange | undefined => {
    const entry = entries.get(syncKey);
    const values = entry ? valuesOf(entry) : undefined;
    const copy = Object.hasOwn(record.copies, syncKey)
      ? record.copies[syncKey]
      : undefined;
    const known = copy ? { remoteId: copy.remoteId, agreed: copy.agreed } : {};
    if (values) {
      return copy && sameEntryValues(copy.agreed, values)
        ? undefined
        : { kind: "upsert", syncKey, ...known, values };
    }
    return copy ? { kind: "delete", syncKey, ...known } : undefined;
  };

  /** Every sync key a change may be for: the entries, and the copies of entries now gone. */
  const syncKeys = () =>
    new Set([...entries.keys(), ...Object.keys(record.copies)]);

  return { entries, changeFor, syncKeys };
}

/** Whether the other system already refused this very change. */
function isRefused(
  refusal: LocalTimeSyncRefusal | undefined,
  change: TimeSyncChange,
) {
  if (!refusal) return false;
  if (refusal.change === "delete") return change.kind === "delete";
  return (
    change.kind === "upsert" && sameEntryValues(refusal.change, change.values)
  );
}

/** The day a change is about, to send changes in day order. */
function dayOf(change: TimeSyncChange) {
  return change.kind === "upsert"
    ? change.values.localDate
    : (change.agreed?.localDate ?? "");
}

/** One round to send: its request, and what waits for the next one. */
export interface TimeSyncPlan {
  connection: TimeSyncConnectionRef;
  /** The time sync it was planned for: an answer for another applies nothing. */
  startedAt: number;
  /** When the round was planned: the first time Ajour saw a local change. */
  plannedAt: number;
  request: TimeSyncRequest;
  /** Changes beyond this round's limit, for the next round. */
  waiting: number;
}

/**
 * The next round of a connection, or undefined when it has no time sync.
 * It sends what differs from the synced copies, at most 20 changes in day
 * order, skipping a change the other system already refused. The window is
 * the current week and the 4 before it, never before the start week.
 */
export function planTimeSyncRound(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  context: TimeSyncContext,
  now: number,
): TimeSyncPlan | undefined {
  const record = recordOf(state.timeSyncs, connection);
  if (!record) return undefined;
  const reader = createReader(state, connection, record, context);
  const changes = [...reader.syncKeys()]
    .flatMap((syncKey) => {
      const change = reader.changeFor(syncKey);
      return change &&
        !isRefused(
          Object.hasOwn(record.refusals, syncKey)
            ? record.refusals[syncKey]
            : undefined,
          change,
        )
        ? [change]
        : [];
    })
    .sort(
      (left, right) =>
        dayOf(left).localeCompare(dayOf(right)) ||
        left.syncKey.localeCompare(right.syncKey),
    );
  const currentWeek = getWeekOf(context.today);
  const earliest = addLocalDays(currentWeek, -7 * WINDOW_WEEKS_BEFORE);
  const to = addLocalDays(currentWeek, 6);
  const from = record.startWeek > earliest ? record.startWeek : earliest;
  return {
    connection,
    startedAt: record.startedAt,
    plannedAt: now,
    request: {
      // A start week after this week only follows a clock set back.
      from: from <= to ? from : currentWeek,
      to,
      timeZone: context.timeZone,
      changes: changes.slice(0, TIME_SYNC_MAX_CHANGES),
    },
    waiting: Math.max(0, changes.length - TIME_SYNC_MAX_CHANGES),
  };
}

/**
 * Notes when Ajour first saw each copied entry differ from its copy, and
 * clears that time once they agree. Drops a refusal whose entry changed
 * since, so the next round sends the new values.
 */
function noteLocalChanges(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  record: LocalTimeSync,
  context: TimeSyncContext,
  seenAt: number,
): LocalTimeSync {
  const reader = createReader(state, connection, record, context);
  let copies = record.copies;
  for (const [syncKey, copy] of Object.entries(record.copies)) {
    const changed = reader.changeFor(syncKey) !== undefined;
    if (changed && copy.changedAt === undefined) {
      copies = { ...copies, [syncKey]: { ...copy, changedAt: seenAt } };
    } else if (!changed && copy.changedAt !== undefined) {
      const { changedAt: _agreed, ...rest } = copy;
      copies = { ...copies, [syncKey]: rest };
    }
  }
  let refusals = record.refusals;
  for (const [syncKey, refusal] of Object.entries(record.refusals)) {
    const change = reader.changeFor(syncKey);
    if (!change || !isRefused(refusal, change)) {
      const { [syncKey]: _moot, ...rest } = refusals;
      refusals = rest;
    }
  }
  return copies === record.copies && refusals === record.refusals
    ? record
    : { ...record, copies, refusals };
}

/** What applying a round's answer did, for its event and the status line. */
export type TimeSyncRoundResult =
  | {
      kind: "applied";
      /** Changes the other system took. */
      synced: number;
      refused: number;
      failed: number;
      /** Changes left for the next round. */
      waiting: number;
    }
  /** Time entries went off, or off and on, while the round ran. */
  | { kind: "discarded" };

/**
 * Applies a round's answer. A synced change updates its copy, or drops it
 * for a delete. A refused one keeps its message and is not sent again until
 * the entry changes. A failed one changes nothing and is sent again next
 * round. From the listing, a copy takes only the remote `updatedAt`.
 */
export function applyTimeSyncRound(
  state: TimeSyncState,
  plan: TimeSyncPlan,
  answer: TimeSyncResult,
  context: TimeSyncContext,
  now: number,
): { timeSyncs: Record<string, LocalTimeSync>; result: TimeSyncRoundResult } {
  const record = recordOf(state.timeSyncs, plan.connection);
  if (!record || record.startedAt !== plan.startedAt) {
    return { timeSyncs: state.timeSyncs, result: { kind: "discarded" } };
  }
  const sent = new Map(
    plan.request.changes.map((change) => [change.syncKey, change]),
  );
  const copies: Record<string, LocalSyncedCopy> = { ...record.copies };
  const refusals: Record<string, LocalTimeSyncRefusal> = {
    ...record.refusals,
  };
  const counts = { synced: 0, refused: 0, failed: 0 };
  let failedMessage: string | undefined;
  for (const outcome of answer.results) {
    const change = sent.get(outcome.syncKey);
    if (!change) continue;
    const { syncKey } = outcome;
    if (outcome.status === "failed") {
      counts.failed += 1;
      failedMessage ??= outcome.message;
      continue;
    }
    if (outcome.status === "refused") {
      counts.refused += 1;
      refusals[syncKey] = {
        message: outcome.message,
        change: change.kind === "delete" ? "delete" : change.values,
        at: now,
      };
      continue;
    }
    counts.synced += 1;
    delete refusals[syncKey];
    if (change.kind === "delete") {
      delete copies[syncKey];
    } else if (outcome.entry) {
      // The values sent are what both sides agreed on. Should the other
      // system store them otherwise, its listing shows it, and taking its
      // changes (#694) brings Ajour in line instead of sending forever.
      copies[syncKey] = {
        remoteId: outcome.entry.remoteId,
        agreed: change.values,
        remoteUpdatedAt: outcome.entry.updatedAt,
      };
    }
  }
  const listed = new Map(
    answer.entries.map((entry) => [entry.remoteId, entry.updatedAt]),
  );
  for (const [syncKey, copy] of Object.entries(copies)) {
    const updatedAt = listed.get(copy.remoteId);
    if (updatedAt !== undefined && updatedAt !== copy.remoteUpdatedAt) {
      copies[syncKey] = { ...copy, remoteUpdatedAt: updatedAt };
    }
  }
  const { error: _cleared, ...rest } = record;
  const next = noteLocalChanges(
    state,
    plan.connection,
    {
      ...rest,
      copies,
      refusals,
      lastRound: {
        at: now,
        ...counts,
        ...(failedMessage ? { failedMessage } : {}),
      },
    },
    context,
    plan.plannedAt,
  );
  return {
    timeSyncs: { ...state.timeSyncs, [plan.connection.connectionId]: next },
    result: { kind: "applied", ...counts, waiting: plan.waiting },
  };
}

/** A round planned before it failed, so Ajour notes what it saw. */
export interface PlannedTimeSyncRound {
  plan: TimeSyncPlan;
  context: TimeSyncContext;
}

/**
 * A round that failed as a whole changes nothing: its changes wait for the
 * next one. The connection keeps the error until a round goes through. A
 * round that got as far as its plan notes the local changes it saw.
 */
export function failTimeSyncRound(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  message: string,
  now: number,
  planned?: PlannedTimeSyncRound,
): Record<string, LocalTimeSync> {
  const record = recordOf(state.timeSyncs, connection);
  if (!record) return state.timeSyncs;
  const failed = { ...record, error: { at: now, message } };
  return {
    ...state.timeSyncs,
    [connection.connectionId]:
      planned && planned.plan.startedAt === record.startedAt
        ? noteLocalChanges(
            state,
            connection,
            failed,
            planned.context,
            planned.plan.plannedAt,
          )
        : failed,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeValues(value: unknown): TimeSyncEntryValues | undefined {
  return timeSyncEntryValuesSchema.safeParse(value).data;
}

function normalizeCopy(value: unknown): LocalSyncedCopy | undefined {
  const copy = asRecord(value);
  const agreed = normalizeValues(copy?.agreed);
  if (
    !copy ||
    !agreed ||
    !nonEmptyString(copy.remoteId) ||
    !nonEmptyString(copy.remoteUpdatedAt)
  ) {
    return undefined;
  }
  return {
    remoteId: copy.remoteId,
    agreed,
    remoteUpdatedAt: copy.remoteUpdatedAt,
    ...(finiteNumber(copy.changedAt) ? { changedAt: copy.changedAt } : {}),
  };
}

function normalizeRefusal(value: unknown): LocalTimeSyncRefusal | undefined {
  const refusal = asRecord(value);
  const change =
    refusal?.change === "delete" ? "delete" : normalizeValues(refusal?.change);
  if (
    !refusal ||
    !change ||
    !nonEmptyString(refusal.message) ||
    !finiteNumber(refusal.at)
  ) {
    return undefined;
  }
  return { message: refusal.message, change, at: refusal.at };
}

/** The records of `value` that `normalize` keeps, by key. */
function normalizeRecords<T>(
  value: unknown,
  normalize: (candidate: unknown) => T | undefined,
): Record<string, T> {
  const records: Record<string, T> = {};
  for (const [key, candidate] of Object.entries(asRecord(value) ?? {})) {
    const record = normalize(candidate);
    if (nonEmptyString(key) && record) records[key] = record;
  }
  return records;
}

/**
 * Reads stored time syncs back. A record whose shape is wrong is dropped,
 * and the next round starts it again this week; a copy or refusal whose
 * shape is wrong is dropped alone, and its entry is sent again. A state
 * saved before time syncs reads as none.
 */
export function normalizeTimeSyncs(
  value: unknown,
): Record<string, LocalTimeSync> {
  return normalizeRecords(value, (candidate): LocalTimeSync | undefined => {
    const record = asRecord(candidate);
    if (
      !record ||
      !nonEmptyString(record.pluginId) ||
      typeof record.startWeek !== "string" ||
      !isValidLocalDate(record.startWeek) ||
      !finiteNumber(record.startedAt)
    ) {
      return undefined;
    }
    const lastRound = asRecord(record.lastRound);
    const error = asRecord(record.error);
    return {
      pluginId: record.pluginId,
      startWeek: getWeekOf(record.startWeek),
      startedAt: record.startedAt,
      copies: normalizeRecords(record.copies, normalizeCopy),
      refusals: normalizeRecords(record.refusals, normalizeRefusal),
      ...(lastRound &&
      finiteNumber(lastRound.at) &&
      finiteNumber(lastRound.synced) &&
      finiteNumber(lastRound.refused) &&
      finiteNumber(lastRound.failed)
        ? {
            lastRound: {
              at: lastRound.at,
              synced: lastRound.synced,
              refused: lastRound.refused,
              failed: lastRound.failed,
              ...(nonEmptyString(lastRound.failedMessage)
                ? { failedMessage: lastRound.failedMessage }
                : {}),
            },
          }
        : {}),
      ...(error && finiteNumber(error.at) && nonEmptyString(error.message)
        ? { error: { at: error.at, message: error.message } }
        : {}),
    };
  });
}
