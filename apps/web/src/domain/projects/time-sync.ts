import {
  isCapabilitySwitchedOn,
  TIME_SYNC_MAX_CHANGES,
  type PluginsOverview,
  type TimeSyncChange,
  type TimeSyncChangeResult,
  type TimeSyncEntryValues,
  type TimeSyncRemoteEntry,
  type TimeSyncRequest,
  type TimeSyncResult,
  timeSyncEntryValuesSchema,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalProject,
  LocalProjectTask,
  LocalSyncedCopy,
  LocalTimer,
  LocalTimeSync,
  LocalTimeSyncHold,
  LocalTimeSyncRefusal,
  LocalTimesheetEntry,
  TimeSyncHoldReason,
} from "@/domain/local-state";
import { getCommitTarget } from "@/domain/projects/commit-target";
import { recordsEqual } from "@/domain/records-equal";
import type { PropertyPlugins } from "@/domain/projects/plugin-properties";
import { createProjectTask } from "@/domain/projects/project-transitions";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";
import {
  addLocalDays,
  getWeekOf,
  isValidLocalDate,
} from "@/domain/time/local-date";
import { isDateLocked } from "@/domain/time/locked-weeks";
import { saveTimer, startTimer } from "@/domain/time/timer-transitions";
import {
  deleteTimesheetEntry,
  entrySyncKey,
  moveTimesheetEntry,
  saveManualTimesheetEntry,
  updateTimesheetEntry,
  type TimesheetEntryFactories,
  type TimesheetEntryState,
} from "@/domain/time/timesheet-entry";
import {
  resolveCommitTaskName,
  resolveLineNameSource,
} from "@/domain/time/timesheet-submission";

/*
 * The time sync rules (#692 to #696, ADR 0018). A time sync keeps
 * a live copy of the user's time entries in another system. This module
 * decides which saved entries and which running entry take part, builds a
 * round's changes from the synced copies, and applies the round's answer:
 * to the copies, and to the entries, with what changed in the other
 * system's window, a running entry started there included. It changes
 * entries only through the entry and running entry transitions. A round is
 * not a commit, and it is not part of Undo.
 *
 * A round never writes to a submitted week. It puts back an edit or a
 * delete made there, and holds an entry logged there, or a running entry
 * started there, until the week is reopened.
 */

export type TimeSyncState = TimesheetEntryState &
  Pick<LocalAppState, "lockedWeeks"> & {
    timeSyncs: Record<string, LocalTimeSync>;
  };

/** The part of the local state the time sync rules read and write. */
export function timeSyncStateOf(
  state: TimesheetEntryState & Pick<LocalAppState, "lockedWeeks" | "timeSyncs">,
): TimeSyncState {
  return {
    projects: state.projects,
    timesheetEntries: state.timesheetEntries,
    timesheetTombstones: state.timesheetTombstones,
    timers: state.timers,
    workItems: state.workItems,
    lockedWeeks: state.lockedWeeks,
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

/**
 * An entry shorter than this stays local, so a mis-click never leaves Ajour.
 * A running entry waits until it has run this long.
 */
export const TIME_SYNC_MIN_DURATION_MS = 30_000;

/** The window lists the current week and this many weeks before it. */
const WINDOW_WEEKS_BEFORE = 4;

const MINUTE_MS = 60_000;
/** The longest task name the contract takes. */
const TASK_NAME_MAX_LENGTH = 240;

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
      held: [],
      puttingBack: [],
    },
  };
}

/**
 * Drops a connection's time sync: its copies, refusals, held entries and
 * status. The other system keeps its entries.
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

/**
 * Whether two counting-since instants agree. Both sides compare in whole
 * minutes, so a count corrected by a few seconds, or stored without its
 * seconds, is no change.
 */
function sameCountingSince(
  left: string | undefined,
  right: string | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(Date.parse(left) - Date.parse(right)) < MINUTE_MS;
}

/**
 * Whether two sets of entry values agree, field by field. Two running
 * entries compare when their count started, not their minutes, which grow
 * as time passes; so a running entry is not sent again every round.
 */
export function sameEntryValues(
  left: TimeSyncEntryValues,
  right: TimeSyncEntryValues,
) {
  return (
    left.localDate === right.localDate &&
    left.running === right.running &&
    (left.running || left.minutes === right.minutes) &&
    sameCountingSince(left.countingSince, right.countingSince) &&
    left.projectRemoteId === right.projectRemoteId &&
    left.taskName === right.taskName &&
    left.taskRemoteId === right.taskRemoteId
  );
}

/**
 * What a saved or running entry is, for the rules: its day, work and
 * counted time, and when its count would have started from zero when it
 * runs.
 */
interface SyncSource {
  localDate: string;
  projectId?: string;
  taskId?: string;
  durationMs: number;
  /** Only for the running entry, in epoch milliseconds. */
  countingSince?: number;
  /** Only for a saved entry a time sync took from there. */
  timeSyncRemoteId?: string;
}

/**
 * A running entry as the rules read it at `now`. One taken from there, or
 * one that continues an entry taken from there, keeps its remote id, so
 * Ajour's values go to it.
 */
function runningSourceOf(
  timer: LocalTimer,
  now: number,
  resumed: LocalTimesheetEntry | undefined,
): SyncSource {
  const timeSyncRemoteId = timer.timeSyncRemoteId ?? resumed?.timeSyncRemoteId;
  return {
    ...(timeSyncRemoteId ? { timeSyncRemoteId } : {}),
    localDate: timer.localDate,
    projectId: timer.projectId,
    taskId: timer.taskId,
    durationMs:
      timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt),
    countingSince: timer.startedAt - timer.accumulatedDurationMs,
  };
}

/**
 * Reads what entries send for one connection's time sync, against the
 * projects and the running entries. Built again once a round adds a task.
 */
function createValuesReader(
  projectList: readonly LocalProject[],
  timers: readonly LocalTimer[],
  connection: TimeSyncConnectionRef,
  record: Pick<LocalTimeSync, "startWeek" | "copies">,
  context: TimeSyncContext,
) {
  const projects = new Map(
    projectList.map((project) => [project._id, project]),
  );
  const namesPluginId = resolveLineNameSource(
    context.namesSource,
    context.plugins,
  );

  /** Whether the project is managed by this connection's project source. */
  const isManagedHere = (project: LocalProject) =>
    project.source?.pluginId === connection.pluginId &&
    project.source.connectionId === connection.connectionId;

  /** The sync keys of the running entries. */
  const runningKeys = new Set(timers.map(entrySyncKey));
  /**
   * Whether the other system shows a running entry that no longer runs in
   * Ajour, such as the first entry of a switch. A running entry then takes
   * over from it at once, in the same round as its stop, instead of after
   * 30 seconds.
   */
  const takesOver = Object.entries(record.copies).some(
    ([syncKey, copy]) => copy.agreed.running && !runningKeys.has(syncKey),
  );

  /**
   * The name the task goes under: the commit name the Commit page uses, or
   * a Not known yet task's own name. Empty for a blank name.
   */
  const sentTaskName = (project: LocalProject, task: LocalProjectTask) =>
    (getCommitTarget(project, task) === "waiting"
      ? task.name
      : resolveCommitTaskName({
          task,
          plugins: context.plugins,
          namesPluginId,
        })
    )
      .trim()
      .slice(0, TASK_NAME_MAX_LENGTH);

  /**
   * What the entry sends, or undefined when it doesn't take part: its
   * project is managed by this connection, neither the project nor the task
   * is Local only, its day is from the start week and not after today, and
   * it lasts at least 30 seconds. A running entry the other system doesn't
   * show yet waits until it has run 30 seconds, unless it takes over from
   * one shown running there; once shown, it stays until it stops. The note
   * never leaves Ajour.
   */
  const valuesOf = (
    entry: SyncSource,
    shown: boolean,
  ): TimeSyncEntryValues | undefined => {
    const project = entry.projectId ? projects.get(entry.projectId) : undefined;
    if (!project?.source || !isManagedHere(project)) return undefined;
    const task = entry.taskId
      ? project.tasks.find((candidate) => candidate._id === entry.taskId)
      : undefined;
    if (!task) return undefined;
    if (getCommitTarget(project, task) === "local") return undefined;
    if (entry.localDate < record.startWeek || entry.localDate > context.today) {
      return undefined;
    }
    const running = entry.countingSince !== undefined;
    if (
      entry.durationMs < TIME_SYNC_MIN_DURATION_MS &&
      !(running && (shown || takesOver))
    ) {
      return undefined;
    }
    const taskName = sentTaskName(project, task);
    if (!taskName) return undefined;
    return {
      localDate: entry.localDate,
      minutes: wholeMinutes(entry.durationMs),
      running,
      ...(running
        ? { countingSince: new Date(entry.countingSince!).toISOString() }
        : {}),
      projectRemoteId: project.source.remoteId,
      taskName,
      ...(task.source ? { taskRemoteId: task.source.remoteId } : {}),
    };
  };

  return { isManagedHere, sentTaskName, valuesOf };
}

/**
 * To the nearest whole minute, and never 0: a time sync takes 1 to 1,440
 * minutes, and the 30 second floor rounds to 1.
 */
function wholeMinutes(durationMs: number) {
  return Math.max(1, Math.round(durationMs / MINUTE_MS));
}

/**
 * Reads the saved and running entries of one connection's time sync against
 * the state, with the running entries counted up to `now`.
 */
function createReader(
  state: Pick<TimeSyncState, "projects" | "timers" | "timesheetEntries">,
  connection: TimeSyncConnectionRef,
  record: Pick<LocalTimeSync, "startWeek" | "copies">,
  context: TimeSyncContext,
  now: number,
) {
  const { valuesOf } = createValuesReader(
    state.projects,
    state.timers,
    connection,
    record,
    context,
  );

  const savedById = new Map(
    state.timesheetEntries.map((entry) => [entry._id, entry]),
  );
  /**
   * The entry under each sync key. A running entry that resumed today's
   * entry shares its key, and counts for it until it stops.
   */
  const entries = new Map<string, SyncSource>([
    ...state.timesheetEntries.map(
      (entry) => [entrySyncKey(entry), entry] as const,
    ),
    ...state.timers.map(
      (timer) =>
        [
          entrySyncKey(timer),
          runningSourceOf(
            timer,
            now,
            timer.entryId ? savedById.get(timer.entryId) : undefined,
          ),
        ] as const,
    ),
  ]);

  /**
   * The change one sync key needs against its synced copy, refused or not:
   * an upsert when the entry takes part and differs from the copy, a delete
   * when a copy exists and the entry is gone or no longer takes part.
   */
  const changeFor = (syncKey: string): TimeSyncChange | undefined => {
    const entry = entries.get(syncKey);
    const copy = Object.hasOwn(record.copies, syncKey)
      ? record.copies[syncKey]
      : undefined;
    const values = entry ? valuesOf(entry, copy !== undefined) : undefined;
    const known = copy ? { remoteId: copy.remoteId, agreed: copy.agreed } : {};
    if (values) {
      // An entry taken from there, whose copy went with Time entries off,
      // still names its remote entry, so Ajour's values go to it. It takes
      // part, so its project is this connection's, and so is the id.
      const remote =
        !copy && entry?.timeSyncRemoteId
          ? { remoteId: entry.timeSyncRemoteId }
          : {};
      return copy && sameEntryValues(copy.agreed, values)
        ? undefined
        : { kind: "upsert", syncKey, ...known, ...remote, values };
    }
    return copy ? { kind: "delete", syncKey, ...known } : undefined;
  };

  /** Every sync key a change may be for: the entries, and the copies of entries now gone. */
  const syncKeys = () =>
    new Set([...entries.keys(), ...Object.keys(record.copies)]);

  return { changeFor, syncKeys };
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

/**
 * Sends a running entry after the other changes of its day, so a switch
 * stops the first entry before the second starts.
 */
function runsLast(change: TimeSyncChange) {
  return change.kind === "upsert" && change.values.running ? 1 : 0;
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
  /**
   * The agreed values of each copied entry that differed from its copy at
   * planning, sent or not, by sync key. While the copy still agrees on these
   * values, that difference is no newer than `plannedAt`, which a conflict
   * reads when the copy has no `changedAt` yet. Once they change, such as
   * when the change synced, a difference left is newer than the plan.
   */
  changedAtPlanning: Record<string, TimeSyncEntryValues>;
}

/**
 * The next round of a connection at `now`, or undefined when it has no time
 * sync. It sends what differs from the synced copies, at most 20 changes in
 * day order with the running entry last, skipping a change the other system
 * already refused. The window is the current week and the 4 before it,
 * never before the start week.
 */
export function planTimeSyncRound(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  context: TimeSyncContext,
  now: number,
): TimeSyncPlan | undefined {
  const record = recordOf(state.timeSyncs, connection);
  if (!record) return undefined;
  const reader = createReader(state, connection, record, context, now);
  const pending = [...reader.syncKeys()].flatMap((syncKey) => {
    const change = reader.changeFor(syncKey);
    return change ? [change] : [];
  });
  const changes = pending
    .filter(
      (change) =>
        !isRefused(
          Object.hasOwn(record.refusals, change.syncKey)
            ? record.refusals[change.syncKey]
            : undefined,
          change,
        ),
    )
    .sort(
      (left, right) =>
        dayOf(left).localeCompare(dayOf(right)) ||
        runsLast(left) - runsLast(right) ||
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
    changedAtPlanning: Object.fromEntries(
      pending.flatMap((change) =>
        Object.hasOwn(record.copies, change.syncKey)
          ? [[change.syncKey, record.copies[change.syncKey]!.agreed]]
          : [],
      ),
    ),
  };
}

/**
 * When Ajour first saw a copied entry differ from its copy, as a round knows
 * it: at planning while the copy still agrees on the values the plan saw it
 * differ from, else now, since the difference is against values agreed
 * after the plan.
 */
function firstSeenAt(
  plan: Pick<TimeSyncPlan, "plannedAt" | "changedAtPlanning">,
  syncKey: string,
  agreed: TimeSyncEntryValues,
  now: number,
) {
  const plannedAgainst = Object.hasOwn(plan.changedAtPlanning, syncKey)
    ? plan.changedAtPlanning[syncKey]
    : undefined;
  return plannedAgainst && sameEntryValues(plannedAgainst, agreed)
    ? plan.plannedAt
    : now;
}

/**
 * Notes when Ajour first saw each copied entry differ from its copy, as
 * `firstSeenAt` says, and clears that time once they agree. Drops a refusal
 * whose entry changed since, so the next round sends the new values, and a
 * put-back that has no upsert left to send, such as one the other system
 * already refused.
 */
function noteLocalChanges(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  record: LocalTimeSync,
  context: TimeSyncContext,
  plan: Pick<TimeSyncPlan, "plannedAt" | "changedAtPlanning">,
  now: number,
): LocalTimeSync {
  const reader = createReader(
    state,
    connection,
    record,
    context,
    plan.plannedAt,
  );
  let copies = record.copies;
  for (const [syncKey, copy] of Object.entries(record.copies)) {
    const changed = reader.changeFor(syncKey) !== undefined;
    if (changed && copy.changedAt === undefined) {
      copies = {
        ...copies,
        [syncKey]: {
          ...copy,
          changedAt: firstSeenAt(plan, syncKey, copy.agreed, now),
        },
      };
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
  const puttingBack = record.puttingBack.filter((syncKey) => {
    const change = reader.changeFor(syncKey);
    return (
      change?.kind === "upsert" &&
      !isRefused(
        Object.hasOwn(refusals, syncKey) ? refusals[syncKey] : undefined,
        change,
      )
    );
  });
  const samePutBacks = puttingBack.length === record.puttingBack.length;
  return copies === record.copies &&
    refusals === record.refusals &&
    samePutBacks
    ? record
    : {
        ...record,
        copies,
        refusals,
        puttingBack: samePutBacks ? record.puttingBack : puttingBack,
      };
}

/** What applying a round's answer did, for its event and the status line. */
export type TimeSyncRoundResult =
  | {
      kind: "applied";
      /** Changes the other system took, besides the put-backs. */
      synced: number;
      /**
       * Upserts that sent Ajour's values back over an edit or a delete
       * there in a submitted week.
       */
      putBack: number;
      refused: number;
      failed: number;
      /** Changes left for the next round. */
      waiting: number;
      /** Entries Ajour took from the other system: added, edited or deleted. */
      received: number;
      /** Entries of the other system Ajour holds after the round. */
      held: number;
    }
  /** Time entries went off, or off and on, while the round ran. */
  | { kind: "discarded" };

/** The values of a remote entry, as Ajour compares and sends them. */
function remoteValuesOf(remote: TimeSyncRemoteEntry): TimeSyncEntryValues {
  const { remoteId: _id, clientRef: _ref, updatedAt: _at, ...values } = remote;
  return values;
}

/**
 * Whether the other system's entry holds what both sides agreed on, for
 * what Ajour takes from it: the day, the whole minutes, the project, and
 * the task's name as task names compare. A task id it doesn't keep, or a
 * name in another case, is not a change.
 */
function sameAsAgreed(
  agreed: TimeSyncEntryValues,
  remote: TimeSyncRemoteEntry,
) {
  return (
    agreed.localDate === remote.localDate &&
    agreed.minutes === remote.minutes &&
    agreed.projectRemoteId === remote.projectRemoteId &&
    normalizeTaskImportName(agreed.taskName) ===
      normalizeTaskImportName(remote.taskName)
  );
}

/** The task of a list that wins a match: an active one first. */
function firstActive(tasks: readonly LocalProjectTask[]) {
  return tasks.find((task) => task.status === "active") ?? tasks[0];
}

/** Where a remote entry lands in Ajour, or why Ajour holds it. */
type Placement =
  | {
      kind: "placed";
      /** The projects, with the task Ajour added for it, if any. */
      projects: LocalProject[];
      projectId: string;
      taskId: string;
    }
  | { kind: "held"; reason: TimeSyncHoldReason };

/**
 * Places a remote entry: its project by its remote id among the projects
 * this connection manages, its task by the name it commits as, then by its
 * own name, compared as the project source compares task names, an active
 * task first. With no match, a new task of that name, Not known yet, so its
 * time waits for the user to pick what it commits as. A project this
 * connection doesn't manage, or a Local only project or task, holds it.
 */
function placeRemoteEntry(
  projects: LocalProject[],
  remote: TimeSyncRemoteEntry,
  reader: ReturnType<typeof createValuesReader>,
  factories: TimesheetEntryFactories,
): Placement {
  const project = projects.find(
    (candidate) =>
      reader.isManagedHere(candidate) &&
      candidate.source?.remoteId === remote.projectRemoteId,
  );
  if (!project) return { kind: "held", reason: "unmanagedProject" };
  if (project.localOnly) return { kind: "held", reason: "localOnlyProject" };
  const key = normalizeTaskImportName(remote.taskName);
  const task =
    firstActive(
      project.tasks.filter(
        (candidate) =>
          normalizeTaskImportName(reader.sentTaskName(project, candidate)) ===
          key,
      ),
    ) ??
    firstActive(
      project.tasks.filter(
        (candidate) => normalizeTaskImportName(candidate.name) === key,
      ),
    );
  if (task) {
    return getCommitTarget(project, task) === "local"
      ? { kind: "held", reason: "localOnlyTask" }
      : { kind: "placed", projects, projectId: project._id, taskId: task._id };
  }
  const created = createProjectTask(
    { name: formatTaskImportName(remote.taskName), commitAs: "waiting" },
    factories,
  );
  return {
    kind: "placed",
    projects: projects.map((candidate) =>
      candidate === project
        ? { ...candidate, tasks: [...candidate.tasks, created] }
        : candidate,
    ),
    projectId: project._id,
    taskId: created._id,
  };
}

function holdOf(
  remote: TimeSyncRemoteEntry,
  reason: TimeSyncHoldReason,
): LocalTimeSyncHold {
  return {
    remoteId: remote.remoteId,
    localDate: remote.localDate,
    minutes: remote.minutes,
    projectRemoteId: remote.projectRemoteId,
    taskName: remote.taskName,
    reason,
  };
}

/** What a round took from the listing. */
interface TakenListing {
  state: TimeSyncState;
  copies: Record<string, LocalSyncedCopy>;
  held: LocalTimeSyncHold[];
  /** The record's put-backs, with those this listing calls for. */
  puttingBack: string[];
  received: number;
}

/**
 * Takes what changed in the other system's window into Ajour, through the
 * entry and running entry transitions, and keeps the synced copies in line:
 *
 * - A copy whose remote entry is missing, while its day is in the window,
 *   was deleted there: the entry is deleted, even when Ajour changed it, so
 *   a delete wins over an edit. Gone on both sides, the copy just goes.
 * - A copy whose remote entry changed since the last round, and holds other
 *   values than agreed, was edited there. When Ajour changed it too, the
 *   later of `changedAt` and the remote `updatedAt` wins, and a delete in
 *   Ajour wins over the edit.
 * - The copy of Ajour's running entry, agreed running, whose remote entry
 *   shows stopped, was stopped there: Ajour stops it with the minutes there,
 *   under the same rules when Ajour changed it too (#695).
 * - A listed entry with neither a copy nor a client reference was logged
 *   elsewhere: Ajour adds it. One with a client reference is Ajour's own,
 *   such as one a send whose answer was lost made, and the next send
 *   adopts it.
 * - Such an entry still running there was started in another tool: it
 *   becomes the running entry, as `takeRunning` says (#695).
 *
 * A submitted week stays as the user committed it (#696). An edit there
 * to one of its entries, or one that moves an entry into it, is put back:
 * the copy takes the values the other system holds now, so the next round
 * sends Ajour's over them. A delete there drops the copy, so the next
 * round creates the entry again. A new entry there, running or not, is
 * held until the week is reopened, when the round that lists it next
 * takes it.
 *
 * A copy whose change this round failed or was refused is left as it is,
 * since the change is sent again, and a copy whose refusal stands is never
 * read as deleted there. The copy of the running entry while it runs on
 * both sides or while a Continue shares today's entry's copy (#693), a
 * saved entry that runs again there, and a remote entry that can't take
 * part yet, such as one dated after today, are left for a later round. A
 * taken entry's copy agrees on Ajour's values for it, so nothing is sent
 * back.
 */
function takeListing(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  record: LocalTimeSync,
  plan: TimeSyncPlan,
  answer: TimeSyncResult,
  outcomes: ReadonlyMap<string, TimeSyncChangeResult>,
  context: TimeSyncContext,
  factories: TimesheetEntryFactories,
): TakenListing {
  const { from, to } = plan.request;
  const now = factories.now();
  const inWindow = (localDate: string) => localDate >= from && localDate <= to;
  /**
   * Whether an entry on the day could take part in Ajour: from the start
   * week, and not after today. `locked` checks its week apart.
   */
  const takesPart = (localDate: string) =>
    localDate >= record.startWeek && localDate <= context.today;
  /** Whether the remote entry could take part in Ajour as a saved entry. */
  const canTake = (remote: TimeSyncRemoteEntry) =>
    !remote.running && remote.minutes >= 1 && takesPart(remote.localDate);
  /** Whether the day is in a submitted week, which a round never writes. */
  const locked = (localDate: string) => isDateLocked(state, localDate);
  const reader = createReader(state, connection, record, context, now);
  /** The saved entries by sync key. */
  const saved = new Map(
    state.timesheetEntries.map((entry) => [entrySyncKey(entry), entry]),
  );
  /** The running entries by sync key. */
  const timers = new Map(
    state.timers.map((timer) => [entrySyncKey(timer), timer]),
  );
  const listed = new Map(
    answer.entries.map((entry) => [entry.remoteId, entry]),
  );
  let current = state;
  let values = createValuesReader(
    state.projects,
    state.timers,
    connection,
    record,
    context,
  );
  const copies = { ...record.copies };
  const held: LocalTimeSyncHold[] = [];
  const puttingBack = new Set(record.puttingBack);
  let received = 0;

  /** The copy of a taken entry: Ajour's values for it, so nothing goes back. */
  const copyOf = (
    entryId: string,
    remote: TimeSyncRemoteEntry,
  ): LocalSyncedCopy => {
    const entry = current.timesheetEntries.find((item) => item._id === entryId);
    return {
      remoteId: remote.remoteId,
      agreed: (entry && values.valuesOf(entry, true)) ?? remoteValuesOf(remote),
      remoteUpdatedAt: remote.updatedAt,
    };
  };

  /** Moves to a placement's projects, and reads values against them. */
  const placeIn = (placement: Extract<Placement, { kind: "placed" }>) => {
    if (placement.projects !== current.projects) {
      current = { ...current, projects: placement.projects };
      values = createValuesReader(
        current.projects,
        current.timers,
        connection,
        record,
        context,
      );
    }
  };

  /**
   * Where the values there put a copied entry: its own project and task when
   * neither side moved them, else the ones the remote entry names.
   */
  const placementOf = (
    copy: LocalSyncedCopy,
    place: { projectId?: string; taskId?: string },
    remote: TimeSyncRemoteEntry,
    local: TimeSyncChange | undefined,
  ): Placement => {
    const keepsPlace =
      !local &&
      remote.projectRemoteId === copy.agreed.projectRemoteId &&
      normalizeTaskImportName(remote.taskName) ===
        normalizeTaskImportName(copy.agreed.taskName);
    return keepsPlace
      ? {
          kind: "placed",
          projects: current.projects,
          projectId: place.projectId!,
          taskId: place.taskId!,
        }
      : placeRemoteEntry(current.projects, remote, values, factories);
  };

  /**
   * Takes the values there into a copied saved entry: its project and task,
   * kept when neither side moved them, its day and its whole minutes, which
   * keep the entry's seconds when they agree. A project or task Ajour holds
   * leaves the entry as it is. Returns whether the entry changed.
   */
  const takeValues = (
    syncKey: string,
    copy: LocalSyncedCopy,
    entry: LocalTimesheetEntry,
    remote: TimeSyncRemoteEntry,
    local: TimeSyncChange | undefined,
  ) => {
    const placement = placementOf(copy, entry, remote, local);
    if (placement.kind === "held") {
      held.push(holdOf(remote, placement.reason));
      return false;
    }
    placeIn(placement);
    const edit = {
      projectId: placement.projectId,
      taskId: placement.taskId,
      durationMs:
        wholeMinutes(entry.durationMs) === remote.minutes
          ? entry.durationMs
          : remote.minutes * MINUTE_MS,
    };
    const changed =
      edit.projectId !== entry.projectId ||
      edit.taskId !== entry.taskId ||
      edit.durationMs !== entry.durationMs ||
      remote.localDate !== entry.localDate;
    if (changed) {
      current =
        remote.localDate === entry.localDate
          ? updateTimesheetEntry(current, entry._id, edit, factories)
          : moveTimesheetEntry(
              current,
              entry._id,
              { ...edit, localDate: remote.localDate, note: entry.note },
              factories,
            );
    }
    copies[syncKey] = copyOf(entry._id, remote);
    return changed;
  };

  /**
   * Takes a stop there of Ajour's running entry (#695): Ajour stops it once
   * its count reached the minutes there, then takes the values there as for
   * an edit. When Ajour changed it too, the later change wins, and a delete
   * in Ajour, such as a move to a Local only task, wins over the stop. A
   * stop that also moved it to a project or task Ajour holds is held.
   */
  const takeStop = (
    syncKey: string,
    copy: LocalSyncedCopy,
    timer: LocalTimer,
    remote: TimeSyncRemoteEntry,
  ) => {
    const local = reader.changeFor(syncKey);
    if (local?.kind === "delete") return;
    const localAt =
      copy.changedAt ?? firstSeenAt(plan, syncKey, copy.agreed, now);
    if (local && localAt >= Date.parse(remote.updatedAt)) {
      copies[syncKey] = { ...copy, remoteUpdatedAt: remote.updatedAt };
      return;
    }
    // A submitted week never changes: the stop waits for Ajour's own.
    if (
      !takesPart(remote.localDate) ||
      locked(remote.localDate) ||
      locked(timer.localDate)
    ) {
      return;
    }
    // A project or task Ajour holds leaves it running, as it leaves a saved
    // entry as it is, so its stop never goes back over the move there.
    const placement = placementOf(copy, timer, remote, local);
    if (placement.kind === "held") {
      held.push(holdOf(remote, placement.reason));
      return;
    }
    // Never before it started, nor after now.
    const countingSince = timer.startedAt - timer.accumulatedDurationMs;
    const stoppedAt = Math.min(
      now,
      Math.max(timer.startedAt, countingSince + remote.minutes * MINUTE_MS),
    );
    current = saveTimer(current, timer._id, {
      ...factories,
      now: () => stoppedAt,
    });
    const entry = current.timesheetEntries.find(
      (item) => entrySyncKey(item) === syncKey,
    );
    if (entry) takeValues(syncKey, copy, entry, remote, local);
    received += 1;
  };

  for (const [syncKey, copy] of Object.entries(record.copies)) {
    const outcome = outcomes.get(syncKey);
    if (outcome?.status === "failed" || outcome?.status === "refused") {
      continue;
    }
    const remote = listed.get(copy.remoteId);
    const timer = timers.get(syncKey);
    if (timer) {
      // The running entry, as #693 sends it: only a stop there is taken.
      if (
        remote &&
        copy.agreed.running &&
        !remote.running &&
        remote.updatedAt !== copy.remoteUpdatedAt
      ) {
        takeStop(syncKey, copy, timer, remote);
      }
      continue;
    }
    const entry = saved.get(syncKey);
    const local = reader.changeFor(syncKey);
    const deletedHere = !entry || local?.kind === "delete";
    if (!remote) {
      // Outside the window, a missing entry is only not listed.
      if (!inWindow(copy.agreed.localDate)) continue;
      if (deletedHere) {
        delete copies[syncKey];
        continue;
      }
      // A refused change keeps the entry, as the refusal stands: the other
      // system may have dropped it on the way, such as Continue's restart.
      if (Object.hasOwn(record.refusals, syncKey)) continue;
      if (locked(entry.localDate)) {
        // The next round creates it again. Not when this round just sent
        // it: an entry the other system took but doesn't list yet is not a
        // delete there, or every round would create it again.
        if (outcome?.status !== "synced") {
          delete copies[syncKey];
          puttingBack.add(syncKey);
        }
        continue;
      }
      current = deleteTimesheetEntry(current, entry._id);
      delete copies[syncKey];
      received += 1;
      continue;
    }
    if (remote.running || remote.updatedAt === copy.remoteUpdatedAt) continue;
    if (sameAsAgreed(copy.agreed, remote)) {
      copies[syncKey] = { ...copy, remoteUpdatedAt: remote.updatedAt };
      continue;
    }
    // Ajour deleted it, or it stopped taking part: the delete wins.
    if (deletedHere) continue;
    if (locked(entry.localDate) || locked(remote.localDate)) {
      // Put back. When this round just sent the entry, a listing with the
      // values the plugin answered it stored is how it stores Ajour's, not
      // an edit there: they count as agreed, or every round would send them
      // again. Other values are an edit made there since, put back as well.
      const answered = outcome?.status === "synced" ? outcome.entry : undefined;
      if (answered && sameAsAgreed(remoteValuesOf(answered), remote)) {
        copies[syncKey] = { ...copy, remoteUpdatedAt: remote.updatedAt };
      } else {
        copies[syncKey] = {
          remoteId: copy.remoteId,
          agreed: remoteValuesOf(remote),
          remoteUpdatedAt: remote.updatedAt,
        };
        puttingBack.add(syncKey);
      }
      continue;
    }
    // Both changed: Ajour's change wins when it is the later one.
    const localAt =
      copy.changedAt ?? firstSeenAt(plan, syncKey, copy.agreed, now);
    if (local && localAt >= Date.parse(remote.updatedAt)) {
      copies[syncKey] = { ...copy, remoteUpdatedAt: remote.updatedAt };
      continue;
    }
    if (!canTake(remote)) continue;
    if (takeValues(syncKey, copy, entry, remote, local)) received += 1;
  }

  // Remote ids are this connection's: another system may use the same.
  const managedHere = new Set(
    current.projects
      .filter((project) => values.isManagedHere(project))
      .map((project) => project._id),
  );
  const known = new Set([
    ...Object.values(copies).map((copy) => copy.remoteId),
    // Taken before, by a time sync since turned off and on.
    ...[...current.timesheetEntries, ...current.timers].flatMap((item) =>
      item.timeSyncRemoteId && item.projectId && managedHere.has(item.projectId)
        ? [item.timeSyncRemoteId]
        : [],
    ),
  ]);
  // A delete synced this round, should the listing still show it.
  for (const change of plan.request.changes) {
    if (change.kind === "delete" && change.remoteId) known.add(change.remoteId);
  }

  /**
   * The running entry started in another tool that Ajour may take. The
   * other system keeps one running entry per person: should it list more,
   * the one that started last.
   */
  const startedElsewhere = answer.entries
    .filter(
      (remote) =>
        remote.running &&
        !known.has(remote.remoteId) &&
        remote.clientRef === undefined,
    )
    .reduce<TimeSyncRemoteEntry | undefined>(
      (latest, remote) =>
        latest &&
        Date.parse(latest.countingSince!) >= Date.parse(remote.countingSince!)
          ? latest
          : remote,
      undefined,
    );

  /**
   * Takes a running entry started in another tool (#695). Its project and
   * task are found as for an entry logged there, and held the same way, and
   * so is one in a submitted week (#696). One that started before today is
   * held too, since Ajour's running entry is always on today: once it stops
   * there, Ajour takes it as a saved entry. Otherwise it becomes the
   * running entry through Start, counting from its start, and Ajour's
   * running entry is saved at that instant, as in a switch. Ajour's running
   * entry stays when it started later: it is the newer one, and the other
   * system stops this one once it shows Ajour's.
   */
  const takeRunning = (remote: TimeSyncRemoteEntry) => {
    if (!takesPart(remote.localDate)) return;
    const placement = placeRemoteEntry(
      current.projects,
      remote,
      values,
      factories,
    );
    if (placement.kind === "held") {
      held.push(holdOf(remote, placement.reason));
      return;
    }
    if (locked(remote.localDate)) {
      held.push(holdOf(remote, "submittedWeek"));
      return;
    }
    if (remote.localDate < context.today) {
      held.push(holdOf(remote, "startedBeforeToday"));
      return;
    }
    const startedAt = Math.min(now, Date.parse(remote.countingSince!));
    if (
      remote !== startedElsewhere ||
      current.timers.some((timer) => timer.startedAt > startedAt)
    ) {
      return;
    }
    placeIn(placement);
    current = startTimer(
      current,
      {
        projectId: placement.projectId,
        taskId: placement.taskId,
        timeSyncRemoteId: remote.remoteId,
      },
      context.today,
      { ...factories, now: () => startedAt },
    );
    const [timer] = current.timers;
    if (timer?.timeSyncRemoteId !== remote.remoteId) return;
    copies[entrySyncKey(timer)] = {
      remoteId: remote.remoteId,
      agreed:
        values.valuesOf(runningSourceOf(timer, now, undefined), true) ??
        remoteValuesOf(remote),
      remoteUpdatedAt: remote.updatedAt,
    };
    received += 1;
  };

  for (const remote of answer.entries) {
    if (
      known.has(remote.remoteId) ||
      remote.clientRef !== undefined ||
      !inWindow(remote.localDate)
    ) {
      continue;
    }
    known.add(remote.remoteId);
    if (remote.running) {
      takeRunning(remote);
      continue;
    }
    if (!canTake(remote)) continue;
    const placement = placeRemoteEntry(
      current.projects,
      remote,
      values,
      factories,
    );
    if (placement.kind === "held") {
      held.push(holdOf(remote, placement.reason));
      continue;
    }
    // Its project and task would take it, so the week is why it waits.
    // Ajour adds no task for it until then.
    if (locked(remote.localDate)) {
      held.push(holdOf(remote, "submittedWeek"));
      continue;
    }
    placeIn(placement);
    current = saveManualTimesheetEntry(
      current,
      {
        localDate: remote.localDate,
        projectId: placement.projectId,
        taskId: placement.taskId,
        durationMs: remote.minutes * MINUTE_MS,
      },
      factories,
    );
    // It keeps the remote id beyond its copy.
    const created = {
      ...current.timesheetEntries.at(-1)!,
      timeSyncRemoteId: remote.remoteId,
    };
    current = {
      ...current,
      timesheetEntries: [...current.timesheetEntries.slice(0, -1), created],
    };
    copies[entrySyncKey(created)] = copyOf(created._id, remote);
    received += 1;
  }

  held.sort(
    (left, right) =>
      left.localDate.localeCompare(right.localDate) ||
      left.remoteId.localeCompare(right.remoteId),
  );
  return {
    state: current,
    copies,
    held,
    puttingBack: [...puttingBack].sort(),
    received,
  };
}

/**
 * Applies a round's answer. A synced change updates its copy, or drops it
 * for a delete, and an upsert that puts an entry back counts as put back,
 * not sent. A refused one keeps its message and is not sent again until
 * the entry changes. A failed one changes nothing and is sent again next
 * round. Then Ajour takes what changed in the listing, as `takeListing`
 * says, and holds what it can't take. It returns the state the round leaves.
 */
export function applyTimeSyncRound(
  state: TimeSyncState,
  plan: TimeSyncPlan,
  answer: TimeSyncResult,
  context: TimeSyncContext,
  factories: TimesheetEntryFactories,
): { state: TimeSyncState; result: TimeSyncRoundResult } {
  const record = recordOf(state.timeSyncs, plan.connection);
  if (!record || record.startedAt !== plan.startedAt) {
    return { state, result: { kind: "discarded" } };
  }
  const now = factories.now();
  const sent = new Map(
    plan.request.changes.map((change) => [change.syncKey, change]),
  );
  const copies: Record<string, LocalSyncedCopy> = { ...record.copies };
  const refusals: Record<string, LocalTimeSyncRefusal> = {
    ...record.refusals,
  };
  const outcomes = new Map<string, TimeSyncChangeResult>();
  const counts = { synced: 0, putBack: 0, refused: 0, failed: 0 };
  /** The put-backs still to send: a failed one goes again. */
  const puttingBack = new Set(record.puttingBack);
  let failedMessage: string | undefined;
  for (const outcome of answer.results) {
    const change = sent.get(outcome.syncKey);
    if (!change) continue;
    const { syncKey } = outcome;
    outcomes.set(syncKey, outcome);
    if (outcome.status === "failed") {
      counts.failed += 1;
      failedMessage ??= outcome.message;
      continue;
    }
    // Sent, or refused for good: either way it is no longer to put back.
    const putBack = puttingBack.delete(syncKey) && change.kind === "upsert";
    if (outcome.status === "refused") {
      counts.refused += 1;
      refusals[syncKey] = {
        message: outcome.message,
        change: change.kind === "delete" ? "delete" : change.values,
        at: now,
      };
      continue;
    }
    if (putBack) {
      counts.putBack += 1;
    } else {
      counts.synced += 1;
    }
    delete refusals[syncKey];
    if (change.kind === "delete") {
      delete copies[syncKey];
    } else if (outcome.entry) {
      // The values sent are what both sides agreed on. Should the other
      // system store them otherwise, its listing shows it with the same
      // `updatedAt`, which is no change to take.
      copies[syncKey] = {
        remoteId: outcome.entry.remoteId,
        agreed: change.values,
        remoteUpdatedAt: outcome.entry.updatedAt,
      };
    }
  }
  const taken = takeListing(
    state,
    plan.connection,
    { ...record, copies, refusals, puttingBack: [...puttingBack] },
    plan,
    answer,
    outcomes,
    context,
    factories,
  );
  const { error: _cleared, ...rest } = record;
  const next = noteLocalChanges(
    taken.state,
    plan.connection,
    {
      ...rest,
      copies: taken.copies,
      refusals,
      held: taken.held,
      puttingBack: taken.puttingBack,
      lastRound: {
        at: now,
        ...counts,
        received: taken.received,
        ...(failedMessage ? { failedMessage } : {}),
      },
    },
    context,
    plan,
    now,
  );
  const result = {
    kind: "applied" as const,
    ...counts,
    waiting: plan.waiting,
    received: taken.received,
    held: taken.held.length,
  };
  // A round that brought nothing new keeps the record, so the poll writes
  // nothing: the status line doesn't show when the round ran.
  const withoutRoundTime = (candidate: LocalTimeSync) => ({
    ...candidate,
    lastRound: candidate.lastRound && { ...candidate.lastRound, at: 0 },
  });
  if (
    taken.state === state &&
    recordsEqual(withoutRoundTime(record), withoutRoundTime(next))
  ) {
    return { state, result };
  }
  return {
    state: {
      ...taken.state,
      timeSyncs: { ...state.timeSyncs, [plan.connection.connectionId]: next },
    },
    result,
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
 * round that got as far as its plan notes the local changes it saw, unless
 * Time entries went off and on since, and then it keeps nothing.
 */
export function failTimeSyncRound(
  state: TimeSyncState,
  connection: TimeSyncConnectionRef,
  message: string,
  now: number,
  planned?: PlannedTimeSyncRound,
): Record<string, LocalTimeSync> {
  const record = recordOf(state.timeSyncs, connection);
  // A round planned for a time sync since stopped fails into nothing.
  if (!record || (planned && planned.plan.startedAt !== record.startedAt)) {
    return state.timeSyncs;
  }
  const failed = { ...record, error: { at: now, message } };
  return {
    ...state.timeSyncs,
    [connection.connectionId]: planned
      ? noteLocalChanges(
          state,
          connection,
          failed,
          planned.context,
          planned.plan,
          now,
        )
      : failed,
  };
}

/** What a connection's row says about its time sync. */
export interface TimeSyncStatus {
  /** Such as "Time entries · 2 sent · 1 put back · 1 received · 1 held" or "Time entries · up to date". */
  summary: string;
  /** Why the last round failed, until a round goes through. */
  error?: string;
  /** The messages of the refusals that stand, each once, then the last round's failure. */
  notes: string[];
}

/**
 * The status line of a connection's time sync: what the last round sent,
 * put back and received, the entries held and the refusals that stand, and
 * the last round's failure. Nothing before the first round.
 */
export function describeTimeSyncStatus(
  record: LocalTimeSync | undefined,
): TimeSyncStatus | undefined {
  if (!record) return undefined;
  const refusals = Object.values(record.refusals);
  const messages = new Set(refusals.map((refusal) => refusal.message));
  if (record.error) {
    return {
      summary: "Time entries · Last sync failed",
      error: record.error.message,
      notes: [...messages],
    };
  }
  const round = record.lastRound;
  if (!round) return undefined;
  if (round.failedMessage) messages.add(round.failedMessage);
  const parts = [
    round.synced ? `${round.synced} sent` : undefined,
    round.putBack ? `${round.putBack} put back` : undefined,
    round.received ? `${round.received} received` : undefined,
    record.held.length ? `${record.held.length} held` : undefined,
    refusals.length ? `${refusals.length} refused` : undefined,
    round.failed ? `${round.failed} failed` : undefined,
  ].filter((part) => part !== undefined);
  return {
    summary: ["Time entries", ...(parts.length ? parts : ["up to date"])].join(
      " · ",
    ),
    notes: [...messages],
  };
}

/** Why Ajour holds an entry, as Sync review says it. */
export function describeTimeSyncHoldReason(reason: TimeSyncHoldReason) {
  switch (reason) {
    case "unmanagedProject":
      return "The connection doesn't manage this project.";
    case "localOnlyProject":
      return "The project is Local only here.";
    case "localOnlyTask":
      return "The task is Local only here.";
    case "submittedWeek":
      return "The week is submitted. Reopen it to take this entry.";
    case "startedBeforeToday":
      return "It has run there since before today. Ajour takes it once it stops.";
  }
}

const HOLD_REASONS: readonly TimeSyncHoldReason[] = [
  "unmanagedProject",
  "localOnlyProject",
  "localOnlyTask",
  "submittedWeek",
  "startedBeforeToday",
];

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

function normalizeHold(value: unknown): LocalTimeSyncHold | undefined {
  const hold = asRecord(value);
  if (
    !hold ||
    !nonEmptyString(hold.remoteId) ||
    typeof hold.localDate !== "string" ||
    !isValidLocalDate(hold.localDate) ||
    !finiteNumber(hold.minutes) ||
    !nonEmptyString(hold.projectRemoteId) ||
    !nonEmptyString(hold.taskName) ||
    !HOLD_REASONS.includes(hold.reason as TimeSyncHoldReason)
  ) {
    return undefined;
  }
  return {
    remoteId: hold.remoteId,
    localDate: hold.localDate,
    minutes: hold.minutes,
    projectRemoteId: hold.projectRemoteId,
    taskName: hold.taskName,
    reason: hold.reason as TimeSyncHoldReason,
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
      held: Array.isArray(record.held)
        ? record.held.flatMap((hold) => normalizeHold(hold) ?? [])
        : [],
      // A record stored before #696 puts nothing back.
      puttingBack: Array.isArray(record.puttingBack)
        ? [...new Set(record.puttingBack.filter(nonEmptyString))].sort()
        : [],
      ...(lastRound &&
      finiteNumber(lastRound.at) &&
      finiteNumber(lastRound.synced) &&
      finiteNumber(lastRound.refused) &&
      finiteNumber(lastRound.failed)
        ? {
            lastRound: {
              at: lastRound.at,
              synced: lastRound.synced,
              // A round stored before #696 put nothing back.
              putBack: finiteNumber(lastRound.putBack) ? lastRound.putBack : 0,
              // A round stored before #694 received nothing.
              received: finiteNumber(lastRound.received)
                ? lastRound.received
                : 0,
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
