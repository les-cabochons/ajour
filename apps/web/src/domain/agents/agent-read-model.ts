import type {
  AgentChangeValues,
  AgentRunningTimer,
  AgentTimeEntry,
  AgentWorkItem,
  DataToolOutput,
  ReadToolInput,
} from "@ajour/shared/agent-tools";
import {
  isBacklogItemSnoozed,
  selectSidebarBacklogItems,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalTimesheetEntry,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  resolvePluginProperties,
  type ProjectPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import {
  describeTimesheetCommitValues,
  getTimesheetEntryChange,
  isTimesheetEntryCommitted,
  listWeekChanges,
  type TimesheetChange,
  type TimesheetCommitValues,
} from "@/domain/time/timesheet-commit";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  externalEntryId,
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
  "projectId" | "projectName" | "taskId" | "taskName"
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
  return {
    timerId: timer._id,
    date: timer.localDate,
    countedMinutes: Math.floor(
      (timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt)) /
        MINUTE,
    ),
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
    date: entry.localDate,
    state: state.timers.some((timer) => timer.entryId === entry._id)
      ? "running"
      : isTimesheetEntryCommitted(entry)
        ? "committed"
        : "saved",
    minutes: Math.round(entry.durationMs / MINUTE),
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.workItemId ? { workItemId: entry.workItemId } : {}),
    ...describeProjectTask(state, entry.projectId, entry.taskId),
  };
}

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY;
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
  return {
    entries: state.timesheetEntries
      .filter((entry) => entry.localDate >= from && entry.localDate <= to)
      .sort(
        (left, right) =>
          left.localDate.localeCompare(right.localDate) ||
          left.committedAt - right.committedAt,
      )
      .map((entry) => toAgentEntry(state, entry)),
    running:
      running && running.date >= from && running.date <= to ? running : null,
  };
}

export function listProjectsForAgent(
  state: LocalAppState,
): DataToolOutput<"list_projects"> {
  return {
    projects: state.projects
      .filter((project) => project.status === "active")
      .map((project) => ({
        projectId: project._id,
        name: getLocalProjectDisplayName(project),
        ...(project.code ? { code: project.code } : {}),
        tasks: project.tasks
          .filter((task) => task.status === "active")
          .map((task) => ({ taskId: task._id, name: task.name })),
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

/** Non-empty plugin property values of the project, or undefined when there are none. */
function resolveProjectProperties(
  state: LocalAppState,
  projectId: string | undefined,
  plugins: ProjectPropertyPlugin[],
) {
  const project = state.projects.find((item) => item._id === projectId);
  if (!project) return undefined;
  const byPlugin: Record<string, Record<string, string>> = {};
  for (const plugin of plugins) {
    const fields = Object.fromEntries(
      resolvePluginProperties(project, plugin)
        .filter((property) => property.value !== "")
        .map((property) => [property.field.id, property.value]),
    );
    if (Object.keys(fields).length > 0) byPlugin[plugin.pluginId] = fields;
  }
  return Object.keys(byPlugin).length > 0 ? byPlugin : undefined;
}

function toAgentChangeValues(
  state: LocalAppState,
  values: TimesheetCommitValues,
  plugins: ProjectPropertyPlugin[],
): AgentChangeValues {
  const projectProperties = resolveProjectProperties(
    state,
    values.projectId,
    plugins,
  );
  const note = values.note?.trim();
  return {
    date: values.localDate,
    ...describeTimesheetCommitValues(state.projects, values),
    ...(projectProperties ? { projectProperties } : {}),
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
    projectPropertyPlugins,
  }: {
    weekDates: string[];
    onlyChecked: boolean;
    /** Unchecked on the Commit page. Passed in to keep domain free of `lib/`. */
    uncheckedIds: ReadonlySet<string>;
    /** Active plugins that add project properties. Passed in to keep domain free of `lib/`. */
    projectPropertyPlugins: ProjectPropertyPlugin[];
  },
): DataToolOutput<"get_week_changes"> {
  const describe = (values: TimesheetCommitValues) =>
    toAgentChangeValues(state, values, projectPropertyPlugins);
  return {
    changes: listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      weekDates,
    })
      .filter((change) => !onlyChecked || !uncheckedIds.has(change.entryId))
      .map((change) => ({
        change: change.kind,
        entryId: change.entryId,
        externalId: externalEntryId(change.entryId),
        version: timesheetChangeVersion(change),
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
 * The change of `entryId` now: its deleted change when it has a tombstone,
 * else its entry's change. Null when the entry has nothing to commit, and
 * undefined when Ajour knows no entry or deleted entry with that ID.
 */
function findTimesheetChange(
  state: LocalAppState,
  entryId: string,
): TimesheetChange | null | undefined {
  const tombstone = state.timesheetTombstones.find(
    (candidate) => candidate.entryId === entryId,
  );
  if (tombstone) {
    return { kind: "deleted", entryId, committed: tombstone.commit };
  }
  const entry = state.timesheetEntries.find(
    (candidate) => candidate._id === entryId,
  );
  return entry ? (getTimesheetEntryChange(entry) ?? null) : undefined;
}

/**
 * Checks the changes an agent wants to mark as committed against Ajour now,
 * before anything is written. Refuses an unknown ID, then refuses every change
 * that is gone or whose version differs from the one get_week_changes gave,
 * so Ajour never commits values the external timesheet did not receive.
 */
export function checkChangeVersionsOrRefuse(
  state: LocalAppState,
  changes: readonly { entryId: string; version: string }[],
): void {
  const stale = new Set<string>();
  for (const { entryId, version } of changes) {
    const change = findTimesheetChange(state, entryId);
    if (change === undefined) {
      throw new AgentToolRefusal(
        `No entry or deleted entry has the id ${entryId}. Call get_week_changes.`,
      );
    }
    if (!change || timesheetChangeVersion(change) !== version) {
      stale.add(entryId);
    }
  }
  if (stale.size > 0) {
    throw new AgentToolRefusal(
      `${[...stale].join(", ")} changed since you read it. Call get_week_changes again and apply its current values.`,
    );
  }
}
