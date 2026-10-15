import type {
  AgentRunningTimer,
  AgentTimeEntry,
  AgentWorkItem,
  DataToolOutput,
  ReadToolInput,
} from "@ajour/shared/agent-tools";
import { getTimeEntryActionState } from "@/domain/actions/object-actions";
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
  groupSubmitLines,
  summarizeSubmitSelection,
  type SubmitGroupBy,
} from "@/domain/time/timesheet-submission";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import { submitLineId } from "@/domain/agents/submit-line-id";

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
      : getTimeEntryActionState(entry) === "submitted"
        ? "submitted"
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
    ...(item.note ? { note: item.note } : {}),
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

/** The Submit page's lines for a week, in decimal hours as Workday wants them. */
export function getSubmitLinesForAgent(
  state: LocalAppState,
  {
    weekDates,
    groupBy,
    onlyUnsubmitted,
  }: { weekDates: string[]; groupBy: SubmitGroupBy; onlyUnsubmitted: boolean },
): DataToolOutput<"get_submit_lines"> {
  const weekDateSet = new Set(weekDates);
  const weekEntries = state.timesheetEntries.filter((entry) =>
    weekDateSet.has(entry.localDate),
  );
  const sections = groupSubmitLines({
    entries: weekEntries,
    groupBy,
    onlyUnsubmitted,
    projects: state.projects,
    weekDates,
  });
  const summary = summarizeSubmitSelection({
    capacityTargets: state.userPreferences.weeklyCapacityTargets,
    selectedIds: new Set(
      weekEntries
        .filter((entry) => entry.submittedAt === undefined)
        .map((entry) => entry._id),
    ),
    weekDates,
    weekEntries,
  });

  return {
    sections: sections.map((section) => ({
      ...(section.localDate ? { date: section.localDate } : {}),
      lines: section.lines.map((line) => ({
        lineId: submitLineId(line.entryIds),
        ...(line.projectName ? { projectName: line.projectName } : {}),
        ...(line.projectCode ? { projectCode: line.projectCode } : {}),
        ...(line.taskName ? { taskName: line.taskName } : {}),
        hours: toHours(line.durationMs),
        comments: line.comments,
        entryIds: line.entryIds,
        unsubmittedEntryIds: line.unsubmittedEntryIds,
      })),
    })),
    summary: {
      totalHours: toHours(summary.totalMs),
      targetHours: toHours(summary.targetMs),
      warnings: summary.warnings,
    },
  };
}
