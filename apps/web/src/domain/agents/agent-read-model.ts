import type {
  AgentChangeValues,
  AgentCommitsAs,
  AgentRunningTimer,
  AgentTimeEntry,
  AgentWorkItem,
  DataToolOutput,
  ReadToolInput,
} from "@ajour/shared/agent-tools";
import {
  entryShortId,
  matchesShortIdPrefix,
} from "@ajour/shared/entry-short-id";
import {
  isBacklogItemSnoozed,
  selectSidebarBacklogItems,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getLocalProjectDisplayName,
  PINNED_TASK_SLOTS,
  type LocalAppState,
  type LocalProject,
  type LocalProjectTask,
  type LocalTimesheetEntry,
  type LocalWorkItem,
} from "@/domain/local-state";
import { getCommitTarget } from "@/domain/projects/commit-target";
import {
  resolvePluginProperties,
  resolveTaskPluginProperties,
  type PropertyPlugins,
  type ResolvedPluginProperty,
} from "@/domain/projects/plugin-properties";
import {
  applyCommitTarget,
  describeTimesheetCommitValues,
  getTimesheetEntryChange,
  isTimesheetEntryCommitted,
  listWeekChanges,
  type TimesheetChange,
  type TimesheetCommitValues,
} from "@/domain/time/timesheet-commit";
import { getLockedWeek } from "@/domain/time/locked-weeks";
import { toDecimalHours } from "@/domain/time/duration";
import {
  buildCommitLines,
  getLineCommitTaskName,
  resolveCommitTaskName,
  resolveLineNameSource,
  summarizeWeek,
  type SubmitGroupBy,
} from "@/domain/time/timesheet-submission";
import {
  computeWeekPace,
  getDayTargetMs,
  getPaceTolerancePercent,
} from "@/domain/time/week-pace";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  externalEntryId,
  weekStatusVersion,
  timesheetChangeVersion,
} from "@/domain/agents/external-id";

/**
 * What the read tools return to agents: plain ids, names and minutes, shaped
 * from the local state. The renderer runs these; the API never sees the store.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MAX_RANGE_DAYS = 62;

type AgentProjectRef = Pick<
  AgentTimeEntry,
  "projectId" | "projectName" | "projectCode" | "taskId" | "taskName"
>;

function describeProjectTask(
  state: LocalAppState,
  projectId?: string,
  taskId?: string,
): AgentProjectRef {
  const project = state.projects.find((item) => item._id === projectId);
  const task = project?.tasks.find((item) => item._id === taskId);
  return {
    ...(projectId ? { projectId } : {}),
    ...(project ? { projectName: getLocalProjectDisplayName(project) } : {}),
    ...(project?.code?.trim() ? { projectCode: project.code.trim() } : {}),
    ...(taskId ? { taskId } : {}),
    ...(task ? { taskName: task.name } : {}),
  };
}

export function readRunningTimer(
  state: LocalAppState,
  now: number,
): AgentRunningTimer | null {
  const timer = state.timers[0];
  if (!timer) return null;
  const workItem = state.workItems.find(
    (item) => item._id === timer.workItemId,
  );
  const countedMs =
    timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt);
  return {
    timerId: timer._id,
    shortId: entryShortId(timer.entryId ?? timer._id),
    date: timer.localDate,
    countedMinutes: Math.floor(countedMs / MINUTE),
    countedSeconds: Math.floor(countedMs / 1000),
    runningSince: new Date(timer.startedAt).toISOString(),
    ...(timer.note ? { note: timer.note } : {}),
    ...(workItem
      ? { workItemId: workItem._id, workItemTitle: workItem.title }
      : {}),
    ...describeProjectTask(state, timer.projectId, timer.taskId),
  };
}

export function toAgentEntry(
  state: LocalAppState,
  entry: LocalTimesheetEntry,
): AgentTimeEntry {
  return {
    entryId: entry._id,
    shortId: entryShortId(entry._id),
    date: entry.localDate,
    state: state.timers.some((timer) => timer.entryId === entry._id)
      ? "running"
      : isTimesheetEntryCommitted(entry)
        ? "committed"
        : "saved",
    minutes: Math.round(entry.durationMs / MINUTE),
    savedAt: new Date(entry.usedAt ?? entry.committedAt).toISOString(),
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.workItemId ? { workItemId: entry.workItemId } : {}),
    ...describeProjectTask(state, entry.projectId, entry.taskId),
  };
}

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY;
}

/** Each date from `from` to `to`, both included. */
function datesBetween(from: string, to: string) {
  const first = dayNumber(from);
  return Array.from({ length: dayNumber(to) - first + 1 }, (_, index) =>
    new Date((first + index) * DAY).toISOString().slice(0, 10),
  );
}

/** Saved entries in the order the lists give them: oldest day first. */
function byDayThenSave(left: LocalTimesheetEntry, right: LocalTimesheetEntry) {
  return (
    left.localDate.localeCompare(right.localDate) ||
    left.committedAt - right.committedAt
  );
}

/** Entry classifications include archived projects and tasks, without plugin names. */
function entryCommitsAs(
  state: LocalAppState,
  entry: { projectId?: string; taskId?: string },
): Pick<AgentCommitsAs, "kind"> {
  const project = state.projects.find(
    (project) => project._id === entry.projectId,
  );
  const task = project?.tasks.find((task) => task._id === entry.taskId);
  const target = getCommitTarget(project, task);
  if (target === "local") return { kind: "local-only" };
  if (target === "waiting") return { kind: "not-known-yet" };
  return project && task
    ? describeCommitsAs(project, task, undefined, undefined)
    : { kind: "own" };
}

export function listTimeEntriesForAgent(
  state: LocalAppState,
  { from, to }: ReadToolInput<"list_time_entries">,
  now: number,
): DataToolOutput<"list_time_entries"> {
  const span = dayNumber(to) - dayNumber(from);
  if (span < 0) {
    throw new AgentToolRefusal("`from` must be on or before `to`.");
  }
  if (span > MAX_RANGE_DAYS) {
    throw new AgentToolRefusal(
      `Ask for at most ${MAX_RANGE_DAYS} days at a time.`,
    );
  }

  const running = readRunningTimer(state, now);
  const capacityTargets = state.userPreferences.weeklyCapacityTargets;
  return {
    entries: state.timesheetEntries
      .filter((entry) => entry.localDate >= from && entry.localDate <= to)
      .sort(byDayThenSave)
      .map((entry) => ({
        ...toAgentEntry(state, entry),
        commitsAs: entryCommitsAs(state, entry),
      })),
    running:
      running && running.date >= from && running.date <= to
        ? { ...running, commitsAs: entryCommitsAs(state, running) }
        : null,
    targets: datesBetween(from, to).map((date) => ({
      date,
      hours: toHours(getDayTargetMs(capacityTargets, date)),
    })),
  };
}

/**
 * Every saved entry whose short id starts with `idPrefix`, on any day, and
 * the running entry when its short id or its timer's does. A running entry
 * that continues a saved one shows the saved one's short id, but the
 * response also carries its `timerId`, so either prefix finds it.
 */
export function findEntriesForAgent(
  state: LocalAppState,
  { idPrefix }: ReadToolInput<"find_entries">,
  now: number,
): DataToolOutput<"find_entries"> {
  const timer = state.timers[0];
  const runningMatches =
    timer !== undefined &&
    [timer.entryId, timer._id].some(
      (id) => id !== undefined && matchesShortIdPrefix(id, idPrefix),
    );
  return {
    entries: state.timesheetEntries
      .filter((entry) => matchesShortIdPrefix(entry._id, idPrefix))
      .sort(byDayThenSave)
      .map((entry) => toAgentEntry(state, entry)),
    running: runningMatches ? readRunningTimer(state, now) : null,
  };
}

/**
 * The saved entry used most recently, on any day: the newest `usedAt`, or
 * its save when it was never used since. A saved entry the running entry
 * continues is the running one, so it is left out. What `last` names in the
 * terminal.
 */
export function getLastSavedEntryForAgent(
  state: LocalAppState,
): DataToolOutput<"get_last_saved_entry"> {
  const continued = new Set(state.timers.map((timer) => timer.entryId));
  let last: LocalTimesheetEntry | undefined;
  for (const entry of state.timesheetEntries) {
    if (continued.has(entry._id)) continue;
    if (!last || lastUsedAt(entry) > lastUsedAt(last)) last = entry;
  }
  return { entry: last ? toAgentEntry(state, last) : null };
}

function lastUsedAt(entry: LocalTimesheetEntry) {
  return entry.usedAt ?? entry.committedAt;
}

/**
 * Whether a plugin could map the task to another name: it holds a plugin
 * value that differs from its own name. Without the plugins' fields Ajour
 * cannot tell which value names it, so any such value counts.
 */
function couldBeMapped(task: LocalProjectTask) {
  return Object.values(task.pluginProperties ?? {}).some((values) =>
    Object.values(values).some(
      (value) => value.trim() !== "" && value !== task.name,
    ),
  );
}

/**
 * What the task's time commits as. Local only and Not known yet come from
 * commit-target.ts. The name comes from `resolveCommitTaskName` under the
 * Commit page's Names choice, so the page, `get_week_lines` and this agree.
 * Without the plugins (`undefined`), a task a plugin could map reads
 * `unknown` rather than a guess.
 */
function describeCommitsAs(
  project: LocalProject,
  task: LocalProjectTask,
  propertyPlugins: PropertyPlugins | undefined,
  namesPluginId: string | undefined,
): AgentCommitsAs {
  const target = getCommitTarget(project, task);
  if (target === "local") return { kind: "local-only" };
  if (target === "waiting") return { kind: "not-known-yet" };
  if (!propertyPlugins) {
    return couldBeMapped(task) ? { kind: "unknown" } : { kind: "own" };
  }
  const name = resolveCommitTaskName({
    task,
    plugins: propertyPlugins,
    namesPluginId,
  });
  return name !== task.name ? { kind: "task", name } : { kind: "own" };
}

/** The task's pinned slot as 1 to 10, keyboard order: key 0 is slot 10. */
function pinnedSlotNumber(task: LocalProjectTask) {
  const index = task.pinnedSlot
    ? PINNED_TASK_SLOTS.indexOf(task.pinnedSlot)
    : -1;
  return index >= 0 ? { pinnedSlot: index + 1 } : {};
}

export function listProjectsForAgent(
  state: LocalAppState,
  /**
   * Active plugins that add project or task properties, or `undefined` when
   * they could not be read in time. Passed in to keep domain free of `lib/`.
   */
  propertyPlugins: PropertyPlugins | undefined,
): DataToolOutput<"list_projects"> {
  const namesPluginId = propertyPlugins
    ? resolveLineNameSource(
        state.userPreferences.commitLinesNameSource,
        propertyPlugins,
      )
    : undefined;
  return {
    projects: state.projects
      .filter((project) => project.status === "active")
      .map((project) => ({
        projectId: project._id,
        name: getLocalProjectDisplayName(project),
        ...(project.code ? { code: project.code } : {}),
        fullName: project.name,
        displayName: getLocalProjectDisplayName(project),
        localOnly: project.localOnly === true,
        tasks: project.tasks
          .filter((task) => task.status === "active")
          .map((task) => ({
            taskId: task._id,
            name: task.name,
            ...pinnedSlotNumber(task),
            commitsAs: describeCommitsAs(
              project,
              task,
              propertyPlugins,
              namesPluginId,
            ),
          })),
      })),
  };
}

export function toAgentWorkItem(
  state: LocalAppState,
  item: LocalWorkItem,
  now: number,
): AgentWorkItem {
  const workflowState = state.workflowStates.find(
    (candidate) => candidate._id === item.workflowStateId,
  );
  return {
    workItemId: item._id,
    title: item.title,
    status: item.status,
    ...(workflowState
      ? {
          workflowState: workflowState.name,
          workflowStateId: workflowState._id,
        }
      : {}),
    priority: item.priority ?? null,
    ...(item.remainingEstimateHours !== undefined
      ? { remainingEstimateHours: item.remainingEstimateHours }
      : {}),
    ...(item.parentWorkItemId
      ? { parentWorkItemId: item.parentWorkItemId }
      : {}),
    source: item.source,
    ...(item.sourceProjectName
      ? { sourceProjectName: item.sourceProjectName }
      : {}),
    ...(isBacklogItemSnoozed(item, now) && item.snoozedUntil !== undefined
      ? { snoozedUntil: new Date(item.snoozedUntil).toISOString() }
      : {}),
    ...describeProjectTask(state, item.projectId, item.taskId),
  };
}

export function listWorkItemsForAgent(
  state: LocalAppState,
  input: ReadToolInput<"list_work_items">,
  now: number,
): DataToolOutput<"list_work_items"> {
  const base =
    input.filter === "sidebar"
      ? selectSidebarBacklogItems(state, now)
      : input.filter === "all"
        ? state.workItems
        : state.workItems.filter((item) => item.status === input.filter);
  const text = input.text?.trim().toLowerCase();

  const workItems = base
    .filter(
      (item) =>
        (input.workflowStateId === undefined ||
          item.workflowStateId === input.workflowStateId) &&
        (input.projectId === undefined || item.projectId === input.projectId) &&
        (!text || item.title.toLowerCase().includes(text)),
    )
    .slice(0, input.limit)
    .map((item) => toAgentWorkItem(state, item, now));
  return { workItems };
}

export function findWorkItemOrRefuse(state: LocalAppState, workItemId: string) {
  const item = state.workItems.find(
    (candidate) => candidate._id === workItemId,
  );
  if (!item) {
    throw new AgentToolRefusal(
      `No backlog item has the id ${workItemId}. Call list_work_items.`,
    );
  }
  return item;
}

export function getWorkItemForAgent(
  state: LocalAppState,
  workItemId: string,
  now: number,
): DataToolOutput<"get_work_item"> {
  const item = findWorkItemOrRefuse(state, workItemId);
  return {
    ...toAgentWorkItem(state, item, now),
    ...(item.description ? { description: item.description } : {}),
    ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
    subitems: state.workItems
      .filter((candidate) => candidate.parentWorkItemId === item._id)
      .map((candidate) => ({
        workItemId: candidate._id,
        title: candidate.title,
        status: candidate.status,
      })),
  };
}

const toHours = (durationMs: number) =>
  Math.round((durationMs / HOUR) * 100) / 100;

/**
 * Non-empty values by plugin ID then field ID, or undefined when there are
 * none.
 */
function nonEmptyProperties(
  byPlugin: readonly [
    pluginId: string,
    ResolvedPluginProperty<{ id: string }>[],
  ][],
) {
  const result: Record<string, Record<string, string>> = {};
  for (const [pluginId, properties] of byPlugin) {
    const fields = Object.fromEntries(
      properties
        .filter((property) => property.value !== "")
        .map((property) => [property.field.id, property.value]),
    );
    if (Object.keys(fields).length > 0) result[pluginId] = fields;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** The plugin property values of the project and of the task, defaults filled in. */
function resolveEntryProperties(
  state: LocalAppState,
  values: Pick<TimesheetCommitValues, "projectId" | "taskId">,
  plugins: PropertyPlugins,
) {
  const project = state.projects.find((item) => item._id === values.projectId);
  const task = project?.tasks.find((item) => item._id === values.taskId);
  const projectProperties = project
    ? nonEmptyProperties(
        plugins.projects.map((plugin) => [
          plugin.pluginId,
          resolvePluginProperties(project, plugin),
        ]),
      )
    : undefined;
  const taskProperties = task
    ? nonEmptyProperties(
        plugins.tasks.map((plugin) => [
          plugin.pluginId,
          resolveTaskPluginProperties(task, plugin),
        ]),
      )
    : undefined;
  return {
    ...(projectProperties ? { projectProperties } : {}),
    ...(taskProperties ? { taskProperties } : {}),
  };
}

/**
 * A change's version for agents: it covers the plugin properties of both
 * sides too, so remapping a task between get_week_changes and
 * mark_entries_committed makes Ajour refuse the mark. Without any, it is the
 * change's own version.
 */
function agentChangeVersion(
  state: LocalAppState,
  change: TimesheetChange,
  plugins: PropertyPlugins,
) {
  const sides = [
    change.kind === "deleted"
      ? {}
      : resolveEntryProperties(state, change.current, plugins),
    change.kind === "added"
      ? {}
      : resolveEntryProperties(state, change.committed, plugins),
  ];
  return timesheetChangeVersion(
    change,
    sides.some((side) => Object.keys(side).length > 0) ? sides : undefined,
  );
}

function toAgentChangeValues(
  state: LocalAppState,
  values: TimesheetCommitValues,
  plugins: PropertyPlugins,
): AgentChangeValues {
  const note = values.note?.trim();
  return {
    date: values.localDate,
    ...describeTimesheetCommitValues(state.projects, values),
    ...resolveEntryProperties(state, values, plugins),
    hours: toHours(values.durationMs),
    ...(note ? { note } : {}),
  };
}

/**
 * The week's changes since its last commit, as the Commit page lists them,
 * in decimal hours as Workday wants them. Each one has the entry's external
 * ID and the change's version. With `onlyChecked`, the changes the user
 * unchecked stay out.
 */
export function getWeekChangesForAgent(
  state: LocalAppState,
  {
    weekDates,
    onlyChecked,
    uncheckedIds,
    propertyPlugins,
  }: {
    weekDates: string[];
    onlyChecked: boolean;
    /** Unchecked on the Commit page. Passed in to keep domain free of `lib/`. */
    uncheckedIds: ReadonlySet<string>;
    /** Active plugins that add project or task properties. Passed in to keep domain free of `lib/`. */
    propertyPlugins: PropertyPlugins;
  },
): DataToolOutput<"get_week_changes"> {
  const describe = (values: TimesheetCommitValues) =>
    toAgentChangeValues(state, values, propertyPlugins);
  return {
    changes: listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      projects: state.projects,
      weekDates,
    })
      // A change on a Not known yet task waits for the user, so no agent
      // sends it under a temporary name.
      .filter((change) => change.kind === "deleted" || !change.waiting)
      .filter((change) => !onlyChecked || !uncheckedIds.has(change.entryId))
      .map((change) => ({
        change: change.kind,
        entryId: change.entryId,
        externalId: externalEntryId(change.entryId),
        version: agentChangeVersion(state, change, propertyPlugins),
        checked: !uncheckedIds.has(change.entryId),
        ...(change.kind === "deleted"
          ? {}
          : { current: describe(change.current) }),
        ...(change.kind === "added"
          ? {}
          : { committed: describe(change.committed) }),
      })),
  };
}

/**
 * The change of `entryId` now, as the week's changes list it: its deleted
 * change when it has a tombstone, else its entry's change, once local time is
 * left out. Null when the entry has nothing to commit, or only local time,
 * and undefined when Ajour knows no entry or deleted entry with that ID.
 */
function findTimesheetChange(
  state: LocalAppState,
  entryId: string,
): TimesheetChange | null | undefined {
  const tombstone = state.timesheetTombstones.find(
    (candidate) => candidate.entryId === entryId,
  );
  const entry = state.timesheetEntries.find(
    (candidate) => candidate._id === entryId,
  );
  const change: TimesheetChange | undefined = tombstone
    ? { kind: "deleted", entryId, committed: tombstone.commit }
    : entry && getTimesheetEntryChange(entry);
  if (!tombstone && !entry) return undefined;
  return (change && applyCommitTarget(change, state.projects)) ?? null;
}

/**
 * Checks the changes an agent wants to mark as committed against Ajour now,
 * before anything is written. Refuses an unknown ID, then refuses every change
 * that is gone or whose version differs from the one get_week_changes gave,
 * with the same property plugins, so Ajour never commits values the external
 * timesheet did not receive.
 */
export function checkChangeVersionsOrRefuse(
  state: LocalAppState,
  changes: readonly { entryId: string; version: string }[],
  propertyPlugins: PropertyPlugins,
): void {
  const stale = new Set<string>();
  for (const { entryId, version } of changes) {
    const change = findTimesheetChange(state, entryId);
    if (change === undefined) {
      throw new AgentToolRefusal(
        `No entry or deleted entry has the id ${entryId}. Call get_week_changes.`,
      );
    }
    if (change && change.kind !== "deleted" && change.waiting) {
      const { taskName } = describeProjectTask(
        state,
        change.current.projectId,
        change.current.taskId,
      );
      throw new AgentToolRefusal(
        `${entryId} is on ${taskName ? `"${taskName}", a task` : "a task"} that is Not known yet. Its time stays out of the commit until the user chooses what the task commits as.`,
      );
    }
    if (
      !change ||
      agentChangeVersion(state, change, propertyPlugins) !== version
    ) {
      stale.add(entryId);
    }
  }
  if (stale.size > 0) {
    throw new AgentToolRefusal(
      `${[...stale].join(", ")} changed since you read it. Call get_week_changes again and apply its current values.`,
    );
  }
}

/**
 * The week's submission status for agents: whether it is submitted, how many
 * changes wait, what the external timesheet holds per day and per entry from
 * the committed copies, and Ajour's pace check, in decimal hours. `version`
 * covers all of it but the pace; submit_week takes it back.
 */
export function getWeekStatusForAgent(
  state: LocalAppState,
  {
    weekDates,
    today,
    propertyPlugins,
  }: {
    weekDates: string[];
    today: string;
    /** Active plugins that add project or task properties. Passed in to keep domain free of `lib/`. */
    propertyPlugins: PropertyPlugins;
  },
): DataToolOutput<"get_week_status"> {
  const week = new Set(weekDates);
  // The committed copies of the week: saved entries, then deleted ones. A
  // copy of local time holds nothing in the external timesheet.
  const committed = [
    ...state.timesheetEntries.flatMap((entry) =>
      entry.commit ? [{ entryId: entry._id, commit: entry.commit }] : [],
    ),
    ...state.timesheetTombstones,
  ]
    .filter(({ commit }) => week.has(commit.localDate) && !commit.local)
    .sort((left, right) =>
      left.commit.localDate.localeCompare(right.commit.localDate),
    );
  const loggedMs = state.timesheetEntries
    .filter((entry) => week.has(entry.localDate))
    .reduce((total, entry) => total + entry.durationMs, 0);

  const weekOf = weekDates[0]!;
  const locked = getLockedWeek(state, weekOf) !== undefined;
  const uncommittedChanges = listWeekChanges({
    entries: state.timesheetEntries,
    tombstones: state.timesheetTombstones,
    projects: state.projects,
    weekDates,
  }).length;
  const committedEntries = committed.map(({ entryId, commit }) => ({
    entryId,
    externalId: externalEntryId(entryId),
    committed: toAgentChangeValues(state, commit, propertyPlugins),
  }));

  const committedMsByDay = weekDates.map((date) =>
    committed
      .filter(({ commit }) => commit.localDate === date)
      .reduce((total, { commit }) => total + commit.durationMs, 0),
  );

  return {
    weekOf,
    version: weekStatusVersion({
      weekOf,
      committedEntries,
      // Exact milliseconds: rounded hours hide a change of a few seconds.
      committedDurationsMs: committed.map(({ commit }) => commit.durationMs),
      committedMsByDay,
      uncommittedChanges,
      locked,
    }),
    locked,
    uncommittedChanges,
    committedHoursByDay: weekDates.map((date, index) => ({
      date,
      hours: toHours(committedMsByDay[index]!),
    })),
    committedEntries,
    pace: computeWeekPace({
      weekDates,
      today,
      capacityTargets: state.userPreferences.weeklyCapacityTargets,
      loggedMs,
      tolerancePercent: getPaceTolerancePercent(state.userPreferences),
    }),
  };
}

/**
 * Refuses submit_week when the week's status differs from the one the agent
 * read, so Ajour never locks committed values the agent did not check.
 */
export function checkWeekStatusVersionOrRefuse(
  state: LocalAppState,
  {
    weekDates,
    version,
    propertyPlugins,
  }: {
    weekDates: string[];
    version: string;
    propertyPlugins: PropertyPlugins;
  },
): void {
  // The version leaves the pace out, so any day reads the same one.
  const current = getWeekStatusForAgent(state, {
    weekDates,
    today: weekDates[0]!,
    propertyPlugins,
  }).version;
  if (current !== version) {
    throw new AgentToolRefusal(
      "The week changed since you read it. Call get_week_status again.",
    );
  }
}

/**
 * get_week_lines (#533): the week's lines as the Commit page builds them,
 * for the terminal to print as they are. Each line names its project by its
 * full name and its task by the name it commits as, in decimal hours rounded
 * as the page copies them. Local time, Not known yet time and the running
 * entry stay out of the lines, as on the page, and come beside them. A
 * submitted week reads the same, with `locked`.
 */
export function getWeekLinesForAgent(
  state: LocalAppState,
  {
    weekDates,
    groupBy,
    propertyPlugins,
    now,
    from,
    to,
  }: {
    weekDates: string[];
    groupBy: SubmitGroupBy;
    /** Active plugins that add project or task properties. Passed in to keep domain free of `lib/`. */
    propertyPlugins: PropertyPlugins;
    now: number;
    from?: string;
    to?: string;
  },
): DataToolOutput<"get_week_lines"> {
  const { projects } = state;
  const selectedDates = weekDates.filter(
    (date) =>
      (from === undefined || date >= from) && (to === undefined || date <= to),
  );
  const week = new Set(selectedDates);
  const weekEntries = state.timesheetEntries.filter((entry) =>
    week.has(entry.localDate),
  );
  const nameSource = resolveLineNameSource(
    state.userPreferences.commitLinesNameSource,
    propertyPlugins,
  );
  const sections = buildCommitLines({
    entries: weekEntries,
    groupBy,
    projects,
    weekDates: selectedDates,
  }).map((section) => ({
    ...(section.localDate ? { localDate: section.localDate } : {}),
    lines: section.lines.map((line) => {
      const taskName = getLineCommitTaskName(
        line,
        nameSource,
        projects,
        propertyPlugins,
      );
      return {
        ...(line.projectId ? { projectId: line.projectId } : {}),
        ...(line.projectName ? { projectName: line.projectName } : {}),
        ...(line.projectCode ? { projectCode: line.projectCode } : {}),
        ...(line.taskId ? { taskId: line.taskId } : {}),
        ...(taskName ? { taskName } : {}),
        hours: toDecimalHours(line.durationMs),
        comments: line.comments,
        entryIds: line.entryIds,
      };
    }),
  }));

  const summary = summarizeWeek({
    capacityTargets: state.userPreferences.weeklyCapacityTargets,
    weekDates: selectedDates,
    weekEntries,
    projects,
  });
  const waitingTasks = summary.warnings.flatMap((warning) =>
    warning.kind === "waiting-task" ? [warning] : [],
  );
  return {
    weekOf: weekDates[0]!,
    groupBy,
    locked: getLockedWeek(state, weekDates[0]!) !== undefined,
    sections,
    notSent: {
      hours: toDecimalHours(summary.local.durationMs),
      items: summary.local.items.map(({ durationMs, ...item }) => ({
        ...item,
        hours: toDecimalHours(durationMs),
      })),
    },
    waiting: {
      hours: toDecimalHours(
        waitingTasks.reduce((total, task) => total + task.durationMs, 0),
      ),
      tasks: waitingTasks.map((task) => ({
        projectId: task.projectId,
        taskId: task.taskId,
        taskName: task.taskName,
        hours: toDecimalHours(task.durationMs),
      })),
    },
    running: readUnsavedRunningTime(state, week, now),
  };
}

/**
 * The running entry in the week with the time it has not saved yet: when it
 * continues a saved entry, that entry's time is already in the lines.
 */
function readUnsavedRunningTime(
  state: LocalAppState,
  week: ReadonlySet<string>,
  now: number,
): DataToolOutput<"get_week_lines">["running"] {
  const timer = state.timers[0];
  if (!timer || !week.has(timer.localDate)) return null;
  const saved = timer.entryId
    ? state.timesheetEntries.find((entry) => entry._id === timer.entryId)
    : undefined;
  const countedMs =
    timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt);
  return {
    timerId: timer._id,
    date: timer.localDate,
    unsavedMinutes: Math.floor(
      Math.max(0, countedMs - (saved?.durationMs ?? 0)) / MINUTE,
    ),
    ...(saved ? { entryId: saved._id } : {}),
    ...describeProjectTask(state, timer.projectId, timer.taskId),
  };
}
