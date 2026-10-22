import type { AjourCatalog, CounterName } from "@ajour/wide-events/catalog.ts";
import type {
  BacklogSettleChange,
  CloseSubitemsOptions,
  MoveBacklogItemOptions,
} from "@/domain/backlog/backlog-item-lifecycle";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimesheetEntry,
  UserPreferences,
} from "@/domain/local-state";
import type { LocalStateUndo } from "@/domain/local-state-undo";
import type { ProjectWorkbookImportResult } from "@/domain/projects/project-import";
import type { ProjectTaskImportResult } from "@/domain/projects/task-import";
import type { TeamShareResult } from "@/domain/projects/team-sync";
import type { CalendarAcceptResult } from "@/domain/time/calendar-suggestions";
import type { SubmitWeekResult } from "@/domain/time/locked-weeks";
import { describePreferenceChange } from "@/lib/preference-events";
import {
  countOnStoreCommand,
  describeStoreCommand,
} from "@/lib/store-command-events";

/*
 * The fields each store command adds to its wide event, read from the state
 * before and after it. The local store calls these; it keeps no event logic
 * of its own. No field holds content (ADR 0011): records are named by
 * Ajour's IDs, and an edit by the keys it changed, never their values.
 */

/** The counter of each local state list that Undo records. */
const UNDO_COUNTERS = {
  projects: "changed_project_count",
  timesheetEntries: "changed_time_entry_count",
  timesheetTombstones: "changed_tombstone_count",
  lockedWeeks: "changed_submitted_week_count",
  timers: "changed_running_entry_count",
  timesheetImportDrafts: "changed_import_draft_count",
  workItems: "changed_backlog_item_count",
  workflowStates: "changed_workflow_state_count",
  workflowStateMappings: "changed_source_state_mapping_count",
  workflowStateWriteRules: "changed_write_rule_count",
  calendarDecisions: "changed_calendar_decision_count",
  calendarEventRules: "changed_event_rule_count",
} as const satisfies Record<
  Exclude<keyof LocalStateUndo, "workItemOrder">,
  CounterName<AjourCatalog>
>;

/** Counts, on the active command, the records an action changed or an Undo restored. */
export function countUndoChanges(undo: LocalStateUndo) {
  for (const [collection, counter] of Object.entries(UNDO_COUNTERS) as [
    keyof typeof UNDO_COUNTERS,
    CounterName<AjourCatalog>,
  ][]) {
    countOnStoreCommand(counter, undo[collection].length);
  }
  if (undo.workItemOrder) countOnStoreCommand("changed_backlog_order_count");
}

/** Which fields of a time entry an edit changed, by key, never by value. */
function changedEntryFields(
  entry: Pick<LocalTimesheetEntry, "projectId" | "taskId" | "note"> & {
    durationMs?: number;
    accumulatedDurationMs?: number;
  },
  values: {
    projectId?: string;
    taskId?: string;
    note?: string;
    durationMs?: number;
  },
) {
  const changed: string[] = [];
  if ("projectId" in values && values.projectId !== entry.projectId)
    changed.push("project");
  if ("taskId" in values && values.taskId !== entry.taskId)
    changed.push("task");
  if ("note" in values && values.note !== entry.note) changed.push("note");
  if (
    values.durationMs !== undefined &&
    values.durationMs !== (entry.durationMs ?? entry.accumulatedDurationMs)
  )
    changed.push("duration");
  return changed;
}

/** How many backlog items besides `workItemId` a command changed. */
function otherItemsChanged(
  before: LocalAppState,
  after: LocalAppState,
  workItemId: string,
) {
  if (before === after) return 0;
  const previous = new Map(before.workItems.map((item) => [item._id, item]));
  return after.workItems.filter(
    (item) => item._id !== workItemId && previous.get(item._id) !== item,
  ).length;
}

/** The time a running entry has counted at `now`. */
function countedMs(timer: LocalTimer, now: number) {
  return timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt);
}

export function describeTimerStart(
  before: LocalAppState,
  after: LocalAppState,
) {
  const started = after.timers[0];
  if (after === before || !started) return;
  describeStoreCommand("time_entry.start", {
    time_entry: {
      id: started._id,
      entry_id: started.entryId,
      project_id: started.projectId,
      task_id: started.taskId,
      backlog_item_id: started.workItemId,
      replaced_running: before.timers.length > 0,
      counted_ms: started.accumulatedDurationMs,
    },
  });
}

export function describeRunningEntryEdit(
  timer: LocalTimer | undefined,
  edit: {
    projectId?: string;
    taskId?: string;
    note?: string;
    countedDurationMs?: number;
  },
  now: number,
) {
  if (!timer) return;
  const before = countedMs(timer, now);
  describeStoreCommand("time_entry.update", {
    time_entry: {
      id: timer._id,
      running: true,
      changed_fields: changedEntryFields(timer, {
        ...edit,
        durationMs: edit.countedDurationMs,
      }),
      duration_before_ms: before,
      duration_after_ms: edit.countedDurationMs ?? before,
    },
  });
}

export function describeTimerDiscard(
  timer: LocalTimer | undefined,
  now: number,
) {
  if (!timer) return;
  describeStoreCommand("time_entry.discard", {
    time_entry: { id: timer._id, duration_ms: countedMs(timer, now) },
  });
}

export function describeTimerStop(
  before: LocalAppState,
  after: LocalAppState,
  timerId: string,
) {
  const timer = before.timers.find((item) => item._id === timerId);
  const entry = timer?.entryId
    ? after.timesheetEntries.find((item) => item._id === timer.entryId)
    : after.timesheetEntries.at(-1);
  if (after === before || !entry) return;
  describeStoreCommand("time_entry.stop", {
    time_entry: { id: entry._id, duration_ms: entry.durationMs },
  });
}

export function describeEntryCreate(
  before: LocalAppState,
  after: LocalAppState,
) {
  const entry = after.timesheetEntries.at(-1);
  if (after === before || !entry) return;
  describeStoreCommand("time_entry.create", {
    time_entry: {
      id: entry._id,
      project_id: entry.projectId,
      task_id: entry.taskId,
      backlog_item_id: entry.workItemId,
      day: entry.localDate,
      duration_ms: entry.durationMs,
    },
  });
}

export function describeEntryUpdate(
  entry: LocalTimesheetEntry | undefined,
  values: {
    projectId?: string;
    taskId?: string;
    note?: string;
    durationMs: number;
  },
) {
  if (!entry) return;
  describeStoreCommand("time_entry.update", {
    time_entry: {
      id: entry._id,
      running: false,
      changed_fields: changedEntryFields(entry, values),
      duration_before_ms: entry.durationMs,
      duration_after_ms: values.durationMs,
    },
  });
}

export function describeImportStage(
  before: LocalAppState,
  after: LocalAppState,
  rowCount: number,
) {
  const staged = after.timesheetImportDrafts.filter(
    (draft) => !before.timesheetImportDrafts.includes(draft),
  );
  describeStoreCommand("timesheet_import.stage", {
    timesheet_import: {
      row_count: rowCount,
      conflict_count: staged.filter((draft) => draft.potentialConflict).length,
    },
  });
}

/** What a dismiss or a commit of timesheet import drafts did. */
export function describeImportDrafts(
  name: "timesheet_import.dismiss" | "timesheet_import.commit",
  before: LocalAppState,
  after: LocalAppState,
) {
  const remaining = after.timesheetImportDrafts;
  const removed = before.timesheetImportDrafts.filter(
    (draft) => !remaining.includes(draft),
  ).length;
  describeStoreCommand(name, {
    timesheet_import:
      name === "timesheet_import.commit"
        ? {
            committed_count: removed,
            conflict_count: remaining.filter((draft) => draft.potentialConflict)
              .length,
          }
        : { dismissed_count: removed },
  });
}

export function describeTaskImport(
  projectId: string,
  result: ProjectTaskImportResult,
) {
  describeStoreCommand("task.import", {
    project: { id: projectId },
    task_import: {
      imported_count: result.importedCount,
      duplicate_count: result.duplicateCount,
      blank_count: result.blankCount,
      header_count: result.headerCount,
    },
  });
}

export function describeProjectImport(
  result: ProjectWorkbookImportResult,
  counts: {
    schema: string;
    row_count?: number;
    project_count: number;
    task_count: number;
  },
) {
  describeStoreCommand("project.import", {
    project_import: {
      ...counts,
      created_project_count: result.createdProjectCount,
      merged_project_count: result.mergedProjectCount,
      added_task_count: result.addedTaskCount,
      updated_task_count: result.updatedTaskCount,
    },
  });
}

export function describeBacklogImport(
  candidateCount: number,
  result: {
    importedCount: number;
    updatedCount: number;
    archivedCount?: number;
  },
) {
  describeStoreCommand("backlog_import.commit", {
    backlog_import: {
      candidate_count: candidateCount,
      imported_count: result.importedCount,
      updated_count: result.updatedCount,
      archived_count: result.archivedCount,
    },
  });
}

export function describeSuggestionAdd(
  before: LocalAppState,
  after: LocalAppState,
  result: CalendarAcceptResult,
) {
  const entryIds = new Set(result.entryIds);
  const added = after.timesheetEntries.filter((entry) =>
    entryIds.has(entry._id),
  );
  describeStoreCommand("suggestion.add", {
    suggestion: {
      count: result.entryIds.length,
      skipped_count: result.skipped,
      remembered_series_count: (after.calendarEventRules ?? []).filter(
        (rule) =>
          rule.action === "assign" &&
          !(before.calendarEventRules ?? []).includes(rule),
      ).length,
      project_ids: [
        ...new Set(
          added.flatMap(({ projectId }) => (projectId ? [projectId] : [])),
        ),
      ],
      task_ids: [
        ...new Set(added.flatMap(({ taskId }) => (taskId ? [taskId] : []))),
      ],
    },
  });
}

const SHARE_RESULTS = {
  shared: "shared",
  missing: "missing",
  alreadyShared: "already_shared",
  sameNameShared: "same_name_shared",
  sameNameHeld: "same_name_held",
  notSynced: "not_synced",
} as const satisfies Record<TeamShareResult["kind"], string>;

export function describeShare(
  projectId: string,
  connectionId: string,
  result: TeamShareResult,
) {
  describeStoreCommand("project.share", {
    project: { id: projectId },
    connection: { id: connectionId },
    share: { result: SHARE_RESULTS[result.kind] },
  });
}

export function describeSettle(
  before: LocalAppState,
  after: LocalAppState,
  workItemId: string,
  change: BacklogSettleChange | undefined,
  options: CloseSubitemsOptions | undefined,
) {
  const settled = after.workItems.find((item) => item._id === workItemId);
  describeStoreCommand("backlog_item.settle", {
    backlog_item: {
      id: workItemId,
      state_changed: change?.state !== undefined,
      priority_changed: change?.priority !== undefined,
      subitems_included: options?.includeSubitems === true,
      subitem_count: otherItemsChanged(before, after, workItemId),
      settle_id: settled?.settleId,
      archived: settled?.status === "archived",
    },
  });
}

export function describeMove(
  before: LocalAppState,
  after: LocalAppState,
  workItemId: string,
  options: MoveBacklogItemOptions,
  moved: boolean,
) {
  const item = before.workItems.find(
    (candidate) => candidate._id === workItemId,
  );
  const now = after.workItems.find((candidate) => candidate._id === workItemId);
  describeStoreCommand("backlog_item.move", {
    backlog_item: {
      id: workItemId,
      workflow_state_from: item?.workflowStateId,
      workflow_state_to: now?.workflowStateId,
      closed: item?.status !== "archived" && now?.status === "archived",
      reopened: item?.status === "archived" && now?.status !== "archived",
      subitems_included: options.includeSubitems === true,
      subitem_count: otherItemsChanged(before, after, workItemId),
      source_writes_queued: Object.keys(options.sourceWrites ?? {}).length,
      result: moved ? "moved" : "unchanged",
    },
  });
}

const SUBMIT_REFUSALS = {
  "already-submitted": "already_submitted",
  "uncommitted-changes": "uncommitted_changes",
  "running-entry": "running_entry",
} as const;

export function describeWeekSubmit(weekOf: string, result: SubmitWeekResult) {
  describeStoreCommand("week.submit", {
    week: result.ok
      ? { week_of: result.weekOf, result: "submitted" }
      : {
          week_of: weekOf,
          result: SUBMIT_REFUSALS[result.kind],
          uncommitted_count:
            result.kind === "uncommitted-changes" ? result.count : undefined,
        },
  });
}

/** The user preferences whose string values are enums, so an event may hold them. */
const USER_PREFERENCE_ENUMS = [
  "themeMode",
  "updateTrack",
  "weeklyTimeViewStyle",
  "timeView",
  "closeParentSubitems",
  "projectDataShapeId",
] as const satisfies readonly (keyof UserPreferences)[];

export function describeUserPreferences(
  before: UserPreferences,
  after: UserPreferences,
) {
  describeStoreCommand("preferences.update", {
    preferences: {
      scope: "user",
      setting: "user_preferences",
      ...describePreferenceChange(before, after, USER_PREFERENCE_ENUMS),
    },
  });
}

/** What removing a connection's data took out of the local state, per kind. */
export function describeConnectionDelete(
  before: LocalAppState,
  after: LocalAppState,
  pluginId: string,
  connectionId: string,
) {
  const removed = (
    list: readonly unknown[] = [],
    next: readonly unknown[] = [],
  ) => Math.max(0, list.length - next.length);
  describeStoreCommand("connection.delete", {
    plugin: { id: pluginId },
    connection: { id: connectionId },
    removed: {
      pull_request_count: removed(before.pullRequests, after.pullRequests),
      calendar_decision_count: removed(
        before.calendarDecisions,
        after.calendarDecisions,
      ),
      event_rule_count: removed(
        before.calendarEventRules,
        after.calendarEventRules,
      ),
      team_project_count:
        before.projects.filter(
          (project) => project.team?.connectionId === connectionId,
        ).length -
        after.projects.filter(
          (project) => project.team?.connectionId === connectionId,
        ).length,
    },
  });
}
