import {
  BUILT_IN_PROJECT_DATA_SHAPE_ID,
  type ActivityBlockRecord,
  type BrowserActivityBucket,
  type CaptureSettings,
  type TeamSettings,
} from "@ajour/shared";
import {
  descriptionHeld as applyDescriptionHeld,
  discardHeldDescription as applyDiscardHeldDescription,
  releaseHeldDescription as applyReleaseHeldDescription,
  takeSourceDescription,
} from "@/domain/backlog/description-sync";
import {
  discardHeldEstimate as applyDiscardHeldEstimate,
  holdPendingEstimates as applyHoldPendingEstimates,
  holdSourceWrite as applyHoldSourceWrite,
  markHeldEstimates as applyMarkHeldEstimates,
  releaseHeldEstimate as applyReleaseHeldEstimate,
  releaseHeldSourceWrite as applyReleaseHeldSourceWrite,
} from "@/domain/backlog/held-edits";
import type { HeldEstimates } from "@ajour/shared/connection-access";
import { todayIsoDate } from "@/lib/utils";
import { wideEvents } from "@/lib/wide-events";
import { recordsEqual } from "@/domain/records-equal";
import { StaleWindowError } from "@/lib/stale-window-error";
import {
  countOnStoreCommand,
  countStoreWrite,
  describeStoreCommand,
  instrumentStoreCommands,
  refuseStoreCommand,
  resolveCommandName,
  runStoreCommand,
  startStoreCommand,
  storeCommandUnit,
  type SpecName,
  type StoreCommandSpec,
  type StoreCommandTable,
  type StoreCommandUnit,
  UNDO_GROUP,
} from "@/lib/store-command-events";
import {
  countUndoChanges,
  describeBacklogImport,
  describeEntryCreate,
  describeEntryUpdate,
  describeImportDrafts,
  describeImportStage,
  describeMove,
  describeProjectImport,
  describeRunningEntryEdit,
  describeSettle,
  describeShare,
  describeSchemaTaskImport,
  describeSuggestionAdd,
  describeTaskImport,
  describeTimerDiscard,
  describeTimerStart,
  describeTimerStop,
  describeUserPreferences,
  describeWeekSubmit,
} from "@/lib/store-command-fields";
import {
  changePullRequest,
  normalizePullRequests,
  reattachPullRequests,
  reconcilePullRequests,
  type PullRequestCommand,
} from "@/domain/pull-requests/pull-request-lifecycle";
import type { CodeHostSyncResult } from "@ajour/shared";
import type {
  BacklogImportCandidate,
  BacklogDoneWorkItem,
  BacklogItemCommentFacts,
  BacklogPerson,
  BacklogSyncWorkItemUpdate,
  ProjectDataShapeImportProject,
} from "@ajour/shared";
import {
  addWorkflowState as applyAddWorkflowState,
  deleteWorkflowState as applyDeleteWorkflowState,
  moveWorkflowState as applyMoveWorkflowState,
  autoMapSourceStates,
  autoMapSourceStates as applyAutoMapSourceStates,
  setWorkflowStateWriteRule as applySetWorkflowStateWriteRule,
  type ReportedSourceState,
  normalizeWorkflowStates,
  reconcileImportedWorkflowStates,
  setWorkflowStateMapping as applyWorkflowStateMapping,
  updateWorkflowState as applyUpdateWorkflowState,
  type WorkflowStateMappingInput,
} from "@/domain/backlog/workflow-states";
import {
  archiveBacklogItem as applyArchiveBacklogItem,
  completeSourceWrite as applyCompleteSourceWrite,
  reconcileSourceWriteMappings,
  failSourceWrite as applyFailSourceWrite,
  markBacklogItemOpened as applyMarkBacklogItemOpened,
  restoreBacklogItem as applyRestoreBacklogItem,
  settleBacklogItem as applySettleBacklogItem,
  moveBacklogItemToState as applyMoveBacklogItemToState,
  applyWorkflowStateLifecycle,
  snoozeBacklogItem as applySnoozeBacklogItem,
  unsettleBacklogItem as applyUnsettleBacklogItem,
  unsnoozeBacklogItem as applyUnsnoozeBacklogItem,
  pinBacklogItem as applyPinBacklogItem,
  unpinBacklogItem as applyUnpinBacklogItem,
  type BacklogSettleChange,
  type ChangePriorityOptions,
  type CloseSubitemsOptions,
  type MoveBacklogItemOptions,
  changeBacklogItemSourceState as applyChangeBacklogItemSourceState,
  patchBacklogItem as applyPatchBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  applySettleRule,
  askSettleRule,
  normalizeSettleRules,
} from "@/domain/backlog/settle-rules";
import {
  applyDescriptionTimelogs,
  applyItemTimelog,
} from "@/domain/backlog/description-timelog";
import {
  acceptRemoteEstimateValue as applyAcceptRemoteEstimateValue,
  addWorkItem as applyAddWorkItem,
  deleteWorkItem as applyDeleteWorkItem,
  dismissEstimateIssue as applyDismissEstimateIssue,
  keepLocalEstimateConflict as applyKeepLocalEstimateConflict,
  normalizePersistedWorkItem,
  normalizeSourceWriteRecovery,
  reorderWorkItems as applyReorderWorkItems,
  setBacklogSortMode as applyBacklogSortMode,
  updateWorkItem as applyUpdateWorkItem,
} from "@/domain/backlog/work-item-transitions";
import {
  applyBacklogSyncWorkItemUpdates as applySyncedWorkItemUpdates,
  returnItemsWithNewComments as applyReturnItemsWithNewComments,
  archiveDoneSyncedWorkItems,
  importSyncedWorkItems as applySyncedWorkItemImport,
} from "@/domain/backlog/work-item-sync";
import { type ProjectTaskImportResult } from "@/domain/projects/task-import";
import {
  deleteTimesheetEntries as applyDeleteTimesheetEntries,
  deleteTimesheetEntry as applyDeleteTimesheetEntry,
  duplicateTimesheetEntry as applyDuplicateTimesheetEntry,
  markTimesheetEntriesCommitted as applyMarkTimesheetEntriesCommitted,
  markTimesheetEntriesNotCommitted as applyMarkTimesheetEntriesNotCommitted,
  moveTimesheetEntry as applyMoveTimesheetEntry,
  normalizeTimesheetEntry,
  pasteTimesheetEntries as applyPasteTimesheetEntries,
  type PastedTimesheetEntry,
  relocateTimesheetEntries as applyRelocateTimesheetEntries,
  dropTimesheetEntries as applyDropTimesheetEntries,
  reorderTimesheetEntries as applyReorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry as applyUpdateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { normalizeTimesheetTombstones } from "@/domain/time/timesheet-commit";
import {
  markCommitPrompted as applyMarkCommitPrompted,
  normalizeCommitPromptedWeeks,
} from "@/domain/time/week-target-prompt";
import {
  assertNoLockedWeekWrite,
  LockedWeekError,
  findLockedWeekWrite,
  isDateLocked,
  normalizeLockedWeeks,
  reopenWeek as applyReopenWeek,
  submitWeek as applySubmitWeek,
} from "@/domain/time/locked-weeks";
import {
  captureUndo,
  getUndoProjectIds,
  completeSourceWriteInUndo,
  restoreUndo,
  type LocalStateUndo,
  type LocalStateUndoResult,
} from "@/domain/local-state-undo";
import {
  clearTimesheetImportDrafts as applyClearTimesheetImportDrafts,
  commitReadyTimesheetImportDrafts as applyCommitReadyTimesheetImportDrafts,
  commitTimesheetImportDraft as applyCommitTimesheetImportDraft,
  dismissTimesheetImportDraft as applyDismissTimesheetImportDraft,
  stageTimesheetImportRows as applyStageTimesheetImportRows,
  type TimesheetImportRow,
} from "@/domain/time/timesheet-import";
import {
  acceptCalendarSuggestions as applyAcceptCalendarSuggestions,
  dismissCalendarSuggestions as applyDismissCalendarSuggestions,
  forgetCalendarEventRule as applyForgetCalendarEventRule,
  hideCalendarMeeting as applyHideCalendarMeeting,
  normalizeCalendarSuggestionSettings,
  pruneCalendarDecisions,
  removeCalendarConnectionData,
  type CalendarAcceptance,
  type CalendarSuggestion,
} from "@/domain/time/calendar-suggestions";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";
import {
  cancelTimer as applyCancelTimer,
  editRunningEntry as applyEditRunningEntry,
  normalizeTimer,
  continueTimesheetEntry as applyContinueTimesheetEntry,
  saveTimer as applySaveTimer,
  startTimer as applyStartTimer,
  type RunningEntryEdit,
} from "@/domain/time/timer-transitions";
import {
  buildSampleActivitySegment,
  commitActivityBlock as applyCommitActivityBlock,
  commitImportedBrowserDraft as applyCommitImportedBrowserDraft,
  dismissActivityBlock as applyDismissActivityBlock,
  dismissImportedBrowserDraft as applyDismissImportedBrowserDraft,
  importBrowserBuckets as applyImportBrowserBuckets,
  materializeTimeline,
  saveRuleFromBlock as applySaveRuleFromBlock,
  saveRuleFromImportedBrowserDraft as applySaveRuleFromImportedBrowserDraft,
  updateImportedBrowserDraft as applyUpdateImportedBrowserDraft,
  upsertEditedBlock as applyUpsertEditedBlock,
  type ImportedBrowserDraftPatch,
  type TimelineRuleSeed,
} from "@/domain/time/timeline-transitions";
import {
  importProjectDataShapeProjects as applyProjectDataShapeImport,
  importProjectDataShapeTasks as applyProjectDataShapeTaskImport,
  importProjectTasks as applyProjectTaskImport,
  importProjectWorkbookRows as applyProjectWorkbookImport,
  type ProjectTaskMergeResult,
  type ProjectTransferRow,
  type ProjectWorkbookImportResult,
} from "@/domain/projects/project-import";
import {
  addProject as applyAddProject,
  addProjectTask as applyAddProjectTask,
  createProject,
  createProjectTask,
  normalizeProject,
  reorderProjects as applyReorderProjects,
  reorderProjectTask as applyReorderProjectTask,
  setProjectFavorite as applySetProjectFavorite,
  setProjectTaskFavorite as applySetProjectTaskFavorite,
  setProjectTaskPinnedSlot as applySetProjectTaskPinnedSlot,
  setProjectTaskStatus,
  updateProject as applyUpdateProject,
  updateProjectTask as applyUpdateProjectTask,
  type ProjectTaskPatch,
} from "@/domain/projects/project-transitions";
import {
  normalizeTeamConnections,
  normalizeTeamPushHold,
} from "@/domain/projects/team-link";
import {
  applyTeamSync,
  disconnectTeam,
  resolveHeldArrival,
  shareProject,
  unshareProject,
  type HeldArrivalChoice,
  type TeamResolveResult,
  type TeamShareResult,
  type TeamSyncApplyResult,
  type TeamSyncState,
} from "@/domain/projects/team-sync";
import type { TeamProjectChange, TeamSyncResult } from "@ajour/shared";
import type { AjourCatalog, FieldsOf } from "@ajour/wide-events/catalog.ts";
import type {
  BacklogSortMode,
  ExtensionBridgeStatus,
  LocalAppState,
  LocalWorkflowStateMapping,
  LocalSettleRule,
  LocalWorkflowStateWriteRule,
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
  LocalTeam,
  LocalTimerDraft,
  LocalTimesheetEntry,
  LocalWorkItem,
  LocalWorkItemDraft,
  LocalWorkItemEstimateFieldConflict,
  LocalWorkItemEstimateFieldKey,
  PersistedLocalWorkItem,
  PinnedTaskSlot,
  ThemeMode,
  TimelineMutationResult,
  UserPreferences,
} from "@/domain/local-state";
import {
  getLocalProjectDisplayName,
  getWorkItemEstimateFieldState,
  hasWorkItemEstimateSyncIssue,
} from "@/domain/local-state";

export {
  getLocalProjectDisplayName,
  getWorkItemEstimateFieldState,
  hasWorkItemEstimateSyncIssue,
} from "@/domain/local-state";
export { StaleWindowError } from "@/lib/stale-window-error";
export type {
  BacklogSortMode,
  ExtensionBridgeStatus,
  ImportedBrowserDraft,
  LocalAppState,
  LocalWorkflowState,
  LocalWorkflowStateMapping,
  LocalWorkflowStateWriteRule,
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
  LocalTeam,
  LocalTimer,
  LocalTimerDraft,
  LocalTimesheetEntry,
  LocalTimesheetImportDraft,
  LocalWorkItem,
  LocalWorkItemDraft,
  LocalWorkItemEstimateFieldConflict,
  LocalWorkItemEstimateFieldError,
  LocalWorkItemEstimateFieldKey,
  LocalWorkItemEstimateFieldState,
  LocalWorkItemEstimateSyncState,
  ThemeMode,
  TimelineMutationResult,
  UserPreferences,
} from "@/domain/local-state";

const STORAGE_KEY = "ajour.local-state.v2";
/**
 * Changes with every write of STORAGE_KEY, so a window learns that another
 * one wrote by reading this short value instead of the whole state.
 */
const REVISION_KEY = "ajour.local-state.revision";
const STATE_CHANGE_EVENT = "ajour-local-state";

/**
 * What a state change event says. `local` is true for a write in this window
 * and false for one another window made, which this window only reloads.
 */
export interface LocalStateChange {
  local: boolean;
}

function announceStateChange(change: LocalStateChange) {
  window.dispatchEvent(
    new CustomEvent<LocalStateChange>(STATE_CHANGE_EVENT, { detail: change }),
  );
}
const RETIRED_AUTH_CACHE_PREFIX = "msal.";

const defaultCapture: CaptureSettings = {
  urlMode: "sanitized_path",
  titleMode: "normalized",
  blockedDomains: [],
  sensitiveDomains: [],
  maxPathSegments: 4,
};

const defaultTeamSettings: TeamSettings = {
  idleThresholdMs: 2 * 60 * 1000,
  mergeGapMs: 90 * 1000,
  microBlockThresholdMs: 3 * 60 * 1000,
  urlCaptureMode: "sanitized_path",
  titleCaptureMode: "normalized",
};

const defaultWorkspaceProjects: LocalProjectDraft[] = [
  { name: "Internal", color: "#1f7667", code: "INT" },
  { name: "Client Work", color: "#ec7a43", code: "CLT" },
];

const defaultUserPreferences: UserPreferences = {
  themeMode: "system",
  updateTrack: "stable",
  projectDataShapeId: BUILT_IN_PROJECT_DATA_SHAPE_ID,
  weeklyTimeViewStyle: "grid",
  hideNonWorkingDays: false,
  weeklyCapacityTargets: {
    monday: 8 * 60 * 60 * 1000,
    tuesday: 8 * 60 * 60 * 1000,
    wednesday: 8 * 60 * 60 * 1000,
    thursday: 8 * 60 * 60 * 1000,
    friday: 8 * 60 * 60 * 1000,
    saturday: 0,
    sunday: 0,
  },
  warnWhenOverCapacity: true,
  warnWhenSubmittingUnderCapacity: true,
  changesEndSnoozeEarly: false,
  closeParentSubitems: "ask",
  calendarSuggestions: normalizeCalendarSuggestionSettings(undefined),
};

function normalizeCapacityTarget(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

let cachedState: LocalAppState | undefined;
/** The revision of the stored state this window last read or wrote. */
let cachedRevision: string | null = null;

function arrayOrDefault<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createDefaultState(): LocalAppState {
  return ensureLocalWorkspace({
    user: {
      _id: "local_user",
      name: "Local User",
      email: "local-only@ajour.dev",
    },
    projects: [],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetTombstones: [],
    lockedWeeks: [],
    timesheetImportDrafts: [],
    commitPromptedWeeks: [],
    workItems: [],
    pullRequests: [],
    calendarDecisions: [],
    calendarEventRules: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
    backlogSortMode: "custom",
    capture: defaultCapture,
    userPreferences: defaultUserPreferences,
    updatedAt: Date.now(),
  });
}

function normalizeState(state: Partial<LocalAppState>): LocalAppState {
  const defaults = createDefaultState();
  const {
    activityLoggerEnabled: _removedActivityLoggerEnabled,
    outlookIntegration: _removedOutlookIntegration,
    outlookMeetingDrafts: _removedOutlookMeetingDrafts,
    // Plugins map priority values to levels now.
    priorityScales: _removedPriorityScales,
    priorityFormat: _removedPriorityFormat,
    // Workflow states were called backlog statuses before.
    backlogStatuses: legacyWorkflowStates,
    backlogStatusMappings: legacyWorkflowStateMappings,
    ...persistedState
  } = state as Partial<LocalAppState> & {
    activityLoggerEnabled?: boolean;
    outlookIntegration?: unknown;
    outlookMeetingDrafts?: unknown;
    priorityScales?: unknown;
    priorityFormat?: unknown;
    backlogStatuses?: LocalAppState["workflowStates"];
    backlogStatusMappings?: Array<
      Omit<LocalWorkflowStateMapping, "workflowStateId"> & {
        backlogStatusId?: string;
      }
    >;
  };
  const rawWorkItems = arrayOrDefault<PersistedLocalWorkItem>(
    persistedState.workItems,
    defaults.workItems,
  );
  const workItems = normalizeSourceWriteRecovery(
    rawWorkItems.map((workItem) =>
      normalizePersistedWorkItem(workItem, Date.now),
    ),
  );
  const workflowStates = normalizeWorkflowStates(
    arrayOrDefault(
      persistedState.workflowStates ?? legacyWorkflowStates,
      defaults.workflowStates,
    ),
    Date.now,
  );
  const workflowStateMappings = arrayOrDefault(
    persistedState.workflowStateMappings ??
      legacyWorkflowStateMappings?.map(({ backlogStatusId, ...mapping }) => ({
        ...mapping,
        workflowStateId: backlogStatusId ?? "",
      })),
    defaults.workflowStateMappings,
  ).filter((mapping): mapping is LocalWorkflowStateMapping =>
    Boolean(
      mapping?.source &&
      mapping.connectionId &&
      mapping.sourceStatusKey &&
      (mapping.workflowStateId === null ||
        typeof mapping.workflowStateId === "string"),
    ),
  );
  const persistedBacklogSortMode = persistedState.backlogSortMode as
    BacklogSortMode | "priority" | undefined;
  const knownSortModes: readonly string[] = [
    "custom",
    "priority_asc",
    "priority_desc",
    "created",
    "remaining",
    "title",
  ];
  const backlogSortMode: BacklogSortMode =
    persistedBacklogSortMode === "priority"
      ? "priority_asc"
      : persistedBacklogSortMode &&
          knownSortModes.includes(persistedBacklogSortMode)
        ? persistedBacklogSortMode
        : defaults.backlogSortMode;

  return ensureLocalWorkspace(
    reconcileImportedWorkflowStates({
      ...defaults,
      ...persistedState,
      user: {
        ...defaults.user,
        ...persistedState.user,
      },
      projects: arrayOrDefault(persistedState.projects, defaults.projects).map(
        (project) => normalizeProject(project, Date.now),
      ),
      rules: arrayOrDefault(persistedState.rules, defaults.rules),
      segments: arrayOrDefault(persistedState.segments, defaults.segments),
      dismissedSegmentIds: arrayOrDefault(
        persistedState.dismissedSegmentIds,
        defaults.dismissedSegmentIds,
      ),
      editedBlocks: arrayOrDefault(
        persistedState.editedBlocks,
        defaults.editedBlocks,
      ),
      importedBrowserDrafts: arrayOrDefault(
        persistedState.importedBrowserDrafts,
        defaults.importedBrowserDrafts,
      ),
      timers: arrayOrDefault(persistedState.timers, defaults.timers).map(
        (timer) => normalizeTimer(timer),
      ),
      timesheetEntries: arrayOrDefault(
        persistedState.timesheetEntries,
        defaults.timesheetEntries,
      ).map((entry) => normalizeTimesheetEntry(entry)),
      timesheetTombstones: normalizeTimesheetTombstones(
        persistedState.timesheetTombstones,
      ),
      lockedWeeks: normalizeLockedWeeks(persistedState.lockedWeeks),
      timesheetImportDrafts: arrayOrDefault(
        persistedState.timesheetImportDrafts,
        defaults.timesheetImportDrafts,
      ),
      commitPromptedWeeks: normalizeCommitPromptedWeeks(
        persistedState.commitPromptedWeeks,
      ),
      workItems,
      pullRequests: normalizePullRequests(persistedState.pullRequests),
      calendarDecisions: pruneCalendarDecisions(
        arrayOrDefault(
          persistedState.calendarDecisions,
          defaults.calendarDecisions ?? [],
        ).filter((decision) =>
          Boolean(
            decision?._id &&
            decision.pluginId &&
            decision.connectionId &&
            decision.occurrenceKey &&
            typeof decision.localDate === "string" &&
            (decision.decision === "added" ||
              decision.decision === "dismissed"),
          ),
        ),
        formatLocalDateFromTimestamp(Date.now()),
      ),
      calendarEventRules: arrayOrDefault(
        persistedState.calendarEventRules,
        defaults.calendarEventRules ?? [],
      ).filter((rule) =>
        Boolean(
          rule?._id &&
          rule.pluginId &&
          rule.connectionId &&
          rule.seriesId &&
          (rule.action === "hide" ||
            (rule.action === "assign" && rule.projectId)),
        ),
      ),
      workflowStates,
      workflowStateMappings,
      settleRules: normalizeSettleRules(persistedState.settleRules),
      teamConnections: normalizeTeamConnections(persistedState.teamConnections),
      teamPushHold: normalizeTeamPushHold(
        persistedState.teamPushHold,
        Date.now(),
      ),
      workflowStateWriteRules: arrayOrDefault(
        persistedState.workflowStateWriteRules,
        defaults.workflowStateWriteRules,
      ).filter((rule): rule is LocalWorkflowStateWriteRule =>
        Boolean(
          rule?.source &&
          rule.connectionId &&
          rule.workflowStateId &&
          (rule.write?.kind === "ask" ||
            rule.write?.kind === "none" ||
            (rule.write?.kind === "state" && rule.write.sourceStatusLabel)),
        ),
      ),
      backlogSortMode,
      capture: {
        ...defaults.capture,
        ...persistedState.capture,
        blockedDomains: arrayOrDefault(
          persistedState.capture?.blockedDomains,
          defaults.capture.blockedDomains,
        ),
        sensitiveDomains: arrayOrDefault(
          persistedState.capture?.sensitiveDomains,
          defaults.capture.sensitiveDomains,
        ),
        maxPathSegments:
          typeof persistedState.capture?.maxPathSegments === "number" &&
          Number.isFinite(persistedState.capture.maxPathSegments)
            ? persistedState.capture.maxPathSegments
            : defaults.capture.maxPathSegments,
      },
      userPreferences: {
        ...defaults.userPreferences,
        ...persistedState.userPreferences,
        changesEndSnoozeEarly:
          persistedState.userPreferences?.changesEndSnoozeEarly === true,
        hideNonWorkingDays:
          persistedState.userPreferences?.hideNonWorkingDays === true,
        updateTrack:
          persistedState.userPreferences?.updateTrack === "nightly"
            ? "nightly"
            : "stable",
        projectDataShapeId:
          typeof persistedState.userPreferences?.projectDataShapeId ===
            "string" &&
          persistedState.userPreferences.projectDataShapeId.trim().length > 0
            ? persistedState.userPreferences.projectDataShapeId
                .trim()
                .slice(0, 120)
            : defaults.userPreferences.projectDataShapeId,
        weeklyTimeViewStyle:
          persistedState.userPreferences?.weeklyTimeViewStyle === "days"
            ? "days"
            : "grid",
        timeView:
          persistedState.userPreferences?.timeView === "week" ? "week" : "day",
        weeklyCapacityTargets: {
          monday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.monday,
            defaults.userPreferences.weeklyCapacityTargets.monday,
          ),
          tuesday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.tuesday,
            defaults.userPreferences.weeklyCapacityTargets.tuesday,
          ),
          wednesday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.wednesday,
            defaults.userPreferences.weeklyCapacityTargets.wednesday,
          ),
          thursday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.thursday,
            defaults.userPreferences.weeklyCapacityTargets.thursday,
          ),
          friday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.friday,
            defaults.userPreferences.weeklyCapacityTargets.friday,
          ),
          saturday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.saturday,
            defaults.userPreferences.weeklyCapacityTargets.saturday,
          ),
          sunday: normalizeCapacityTarget(
            persistedState.userPreferences?.weeklyCapacityTargets?.sunday,
            defaults.userPreferences.weeklyCapacityTargets.sunday,
          ),
        },
        warnWhenOverCapacity:
          persistedState.userPreferences?.warnWhenOverCapacity !== false,
        warnWhenSubmittingUnderCapacity:
          persistedState.userPreferences?.warnWhenSubmittingUnderCapacity !==
          false,
        closeParentSubitems:
          persistedState.userPreferences?.closeParentSubitems === "include" ||
          persistedState.userPreferences?.closeParentSubitems === "leave"
            ? persistedState.userPreferences.closeParentSubitems
            : "ask",
        paceTolerancePercent:
          typeof persistedState.userPreferences?.paceTolerancePercent ===
            "number" &&
          Number.isFinite(persistedState.userPreferences.paceTolerancePercent)
            ? Math.min(
                100,
                Math.max(
                  0,
                  Math.round(
                    persistedState.userPreferences.paceTolerancePercent,
                  ),
                ),
              )
            : undefined,
        commitLinesNameSource:
          typeof persistedState.userPreferences?.commitLinesNameSource ===
            "string" &&
          persistedState.userPreferences.commitLinesNameSource.trim().length > 0
            ? persistedState.userPreferences.commitLinesNameSource
                .trim()
                .slice(0, 120)
            : undefined,
        calendarSuggestions: normalizeCalendarSuggestionSettings(
          persistedState.userPreferences?.calendarSuggestions,
        ),
      },
    }),
  );
}

function containsRetiredOutlookState(state: unknown) {
  if (typeof state !== "object" || state === null) {
    return false;
  }

  const legacyState = state as Partial<LocalAppState> & {
    outlookIntegration?: unknown;
    outlookMeetingDrafts?: unknown;
  };

  return (
    "outlookIntegration" in legacyState ||
    "outlookMeetingDrafts" in legacyState ||
    (Array.isArray(legacyState.workItems) &&
      legacyState.workItems.some((workItem) => workItem?.source === "outlook"))
  );
}

function ensureLocalWorkspace(state: LocalAppState): LocalAppState {
  if (state.team) {
    return {
      ...state,
      team: {
        ...state.team,
        settings: {
          ...defaultTeamSettings,
          ...state.team.settings,
        },
      },
    };
  }

  return {
    ...state,
    team: {
      _id: "local_team",
      name: "ajour",
      slug: "ajour",
      settings: defaultTeamSettings,
    },
    projects:
      state.projects.length > 0
        ? state.projects
        : defaultWorkspaceProjects.map((project) =>
            createProject(project, { createId, now: Date.now }),
          ),
  };
}

function hasOnlyDefaultProjects(projects: Partial<LocalProject>[] | undefined) {
  if (!projects || projects.length !== defaultWorkspaceProjects.length) {
    return false;
  }

  return projects.every((project, index) => {
    const defaults = defaultWorkspaceProjects[index];
    return (
      project?.name === defaults?.name &&
      project?.code === defaults?.code &&
      (project.tasks?.length ?? 0) === 0
    );
  });
}

function mergeBootstrapTimesheetEntries(
  currentEntries: LocalTimesheetEntry[] | undefined,
  bootstrapEntries: LocalTimesheetEntry[] | undefined,
) {
  const mergedEntries: LocalTimesheetEntry[] = [];
  const seenEntryIds = new Set<string>();

  for (const entry of [
    ...(currentEntries ?? []),
    ...(bootstrapEntries ?? []),
  ]) {
    if (!entry?._id || seenEntryIds.has(entry._id)) {
      continue;
    }

    seenEntryIds.add(entry._id);
    mergedEntries.push(entry);
  }

  return mergedEntries;
}

/** Why the desktop recovery file should merge into the stored state, or undefined. */
function shouldBootstrapFromDesktopState(
  currentState: Partial<LocalAppState> | undefined,
  bootstrapState: Partial<LocalAppState> | null | undefined,
): RecoveryFields["reason"] {
  if (!bootstrapState || currentState?.desktopBootstrapAppliedAt) {
    return undefined;
  }

  // Submitted weeks alone are worth recovering: they keep the week as sent.
  const currentWeeks = new Set(
    normalizeLockedWeeks(currentState?.lockedWeeks).map((week) => week.weekOf),
  );
  if (
    normalizeLockedWeeks(bootstrapState.lockedWeeks).some(
      (week) => !currentWeeks.has(week.weekOf),
    )
  ) {
    return "submitted_weeks";
  }

  const bootstrapTimesheetCount = bootstrapState.timesheetEntries?.length ?? 0;
  const currentTimesheetCount = currentState?.timesheetEntries?.length ?? 0;
  if (currentTimesheetCount === 0 && bootstrapTimesheetCount > 0) {
    return "no_entries";
  }

  const currentHasDefaultProjects = hasOnlyDefaultProjects(
    currentState?.projects,
  );
  const bootstrapHasCustomProjects =
    Array.isArray(bootstrapState.projects) &&
    bootstrapState.projects.length > 0 &&
    !hasOnlyDefaultProjects(bootstrapState.projects);
  return currentHasDefaultProjects && bootstrapHasCustomProjects
    ? "default_projects"
    : undefined;
}

type BootFields = FieldsOf<AjourCatalog, "app.boot">;
type RecoveryFields = NonNullable<BootFields["recovery"]>;

/**
 * What the last load of the local state did, for the `app.boot` event: its
 * path, the migrations it applied, its size and the desktop recovery.
 */
export interface LocalStateLoad {
  boot: NonNullable<BootFields["boot"]>;
  recovery: RecoveryFields;
}

let load: LocalStateLoad = freshLoad();

function freshLoad(): LocalStateLoad {
  return {
    boot: { load_path: "stored", migrations: [], persisted: true },
    recovery: { decision: "none" },
  };
}

/** Loads the local state, if it is not yet, and says how the load went. */
export function localStateLoad(): LocalStateLoad {
  readState();
  return load;
}

/** The migrations a stored state needs, from a closed set, by its retired keys. */
function storedMigrations(state: Record<string, unknown>) {
  const migrations: string[] = [];
  if ("backlogStatuses" in state || "backlogStatusMappings" in state)
    migrations.push("workflow_states_renamed");
  if ("priorityScales" in state || "priorityFormat" in state)
    migrations.push("retired_priority_scales");
  if ("activityLoggerEnabled" in state)
    migrations.push("retired_activity_logger");
  if (containsRetiredOutlookState(state)) migrations.push("retired_outlook");
  if (state.backlogSortMode === "priority")
    migrations.push("priority_sort_split");
  return migrations;
}

/** Counts, for the boot event, recovered records a submitted week kept out. */
function countLeftOut(
  count: number,
  field: "left_out_entry_count" | "left_out_running_entry_count",
) {
  if (count > 0) load.recovery[field] = (load.recovery[field] ?? 0) + count;
}

function mergeDesktopBootstrapState(
  currentState: Partial<LocalAppState> | undefined,
  bootstrapState: Partial<LocalAppState>,
) {
  const nextState = {
    ...(currentState ?? {}),
  };

  // A recovered entry must not land in a week this store submitted, so the
  // lock stays as the user left it. Recovered submitted weeks come along,
  // even with no entry to recover.
  const currentLocks = {
    lockedWeeks: normalizeLockedWeeks(nextState.lockedWeeks),
  };
  if ((bootstrapState.timesheetEntries?.length ?? 0) > 0) {
    const currentIds = new Set(
      (nextState.timesheetEntries ?? []).map((entry) => entry?._id),
    );
    const recovered = bootstrapState.timesheetEntries!.filter(
      (entry) =>
        currentIds.has(entry?._id) ||
        typeof entry?.localDate !== "string" ||
        !isDateLocked(currentLocks, entry.localDate),
    );
    countLeftOut(
      bootstrapState.timesheetEntries!.length - recovered.length,
      "left_out_entry_count",
    );
    nextState.timesheetEntries = mergeBootstrapTimesheetEntries(
      nextState.timesheetEntries,
      recovered,
    );
  }
  // A recovered lock on the week of this store's running entry would strand
  // it: it could never be saved there. Leave that week open.
  const runningDays = (nextState.timers ?? []).flatMap((timer) =>
    timer?._id && typeof timer.startedAt === "number"
      ? [normalizeTimer(timer).localDate]
      : [],
  );
  const recoveredLocks = normalizeLockedWeeks(
    bootstrapState.lockedWeeks,
  ).filter((week) => {
    if (isDateLocked(currentLocks, week.weekOf)) return true;
    const strands = runningDays.some((day) =>
      isDateLocked({ lockedWeeks: [week] }, day),
    );
    if (strands) {
      load.recovery.unsubmitted_week_count =
        (load.recovery.unsubmitted_week_count ?? 0) + 1;
    }
    return !strands;
  });
  const mergedLocks = {
    lockedWeeks: normalizeLockedWeeks([
      ...currentLocks.lockedWeeks,
      ...recoveredLocks,
    ]),
  };
  nextState.lockedWeeks = mergedLocks.lockedWeeks;
  if (
    (nextState.timers?.length ?? 0) === 0 &&
    (bootstrapState.timers?.length ?? 0) > 0
  ) {
    // A running entry in a submitted week could never be saved there.
    const recovered = bootstrapState.timers!.filter(
      (timer) =>
        !timer?._id ||
        typeof timer.startedAt !== "number" ||
        !isDateLocked(mergedLocks, normalizeTimer(timer).localDate),
    );
    countLeftOut(
      bootstrapState.timers!.length - recovered.length,
      "left_out_running_entry_count",
    );
    nextState.timers = recovered;
  }
  if (
    Array.isArray(bootstrapState.projects) &&
    bootstrapState.projects.length > 0
  ) {
    const currentProjects = nextState.projects ?? [];
    const currentProjectIds = new Set(
      currentProjects.map((project) => project._id),
    );
    nextState.projects = [
      ...bootstrapState.projects.filter(
        (project) => !currentProjectIds.has(project._id),
      ),
      ...currentProjects,
    ];
    nextState.team = nextState.team ?? bootstrapState.team;
  }
  if (
    (nextState.rules?.length ?? 0) === 0 &&
    (bootstrapState.rules?.length ?? 0) > 0
  ) {
    nextState.rules = bootstrapState.rules;
  }
  if (
    (nextState.segments?.length ?? 0) === 0 &&
    (bootstrapState.segments?.length ?? 0) > 0
  ) {
    nextState.segments = bootstrapState.segments;
  }
  if (
    (nextState.dismissedSegmentIds?.length ?? 0) === 0 &&
    (bootstrapState.dismissedSegmentIds?.length ?? 0) > 0
  ) {
    nextState.dismissedSegmentIds = bootstrapState.dismissedSegmentIds;
  }
  if (
    (nextState.editedBlocks?.length ?? 0) === 0 &&
    (bootstrapState.editedBlocks?.length ?? 0) > 0
  ) {
    nextState.editedBlocks = bootstrapState.editedBlocks;
  }
  if (
    (nextState.importedBrowserDrafts?.length ?? 0) === 0 &&
    (bootstrapState.importedBrowserDrafts?.length ?? 0) > 0
  ) {
    nextState.importedBrowserDrafts = bootstrapState.importedBrowserDrafts;
  }
  const nextUpdatedAt =
    typeof nextState.updatedAt === "number" &&
    Number.isFinite(nextState.updatedAt)
      ? nextState.updatedAt
      : 0;
  const bootstrapUpdatedAt =
    typeof bootstrapState.updatedAt === "number" &&
    Number.isFinite(bootstrapState.updatedAt)
      ? bootstrapState.updatedAt
      : 0;
  nextState.updatedAt = Math.max(nextUpdatedAt, bootstrapUpdatedAt, Date.now());
  nextState.desktopBootstrapAppliedAt = Date.now();

  return nextState;
}

function purgeRetiredAuthCache() {
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[storageName];
      const retiredKeys = Array.from({ length: storage.length }, (_, index) =>
        storage.key(index),
      ).filter(
        (key): key is string =>
          key?.toLowerCase().startsWith(RETIRED_AUTH_CACHE_PREFIX) === true,
      );

      for (const key of retiredKeys) {
        storage.removeItem(key);
      }
    } catch {
      // Browser storage can be unavailable under restrictive privacy settings.
    }
  }
}

function loadState(): LocalAppState {
  purgeRetiredAuthCache();
  load = freshLoad();
  return loadStoredState(window.ajourDesktop?.bootstrapLocalState);
}

/**
 * Whether storage still holds the state this window read, `stored` saved at
 * `revision`. Like the check in `writeState`, a matching hint answers without
 * a parse; a missing or different hint compares what storage holds.
 */
function storageStillHolds(stored: string, revision: unknown) {
  const hint = readRevisionHint();
  if (hint !== null && typeof revision === "string") return hint === revision;
  return window.localStorage.getItem(STORAGE_KEY) === stored;
}

/**
 * Reads the stored state, applies the desktop recovery file once, and saves
 * the result. `retryRecovery` is the recovery decision of a first read whose
 * save found storage changed: the merge runs again, once, on the fresh state.
 */
function loadStoredState(
  bootstrapState: Partial<LocalAppState> | null | undefined,
  retryRecovery?: boolean,
): LocalAppState {
  let stored: string | null;
  if (bootstrapState) load.recovery.decision = "used_whole";
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    load.boot.load_path = "storage_unavailable";
    load.boot.persisted = false;
    return normalizeState(bootstrapState ?? createDefaultState());
  }
  if (!stored) {
    load.boot.load_path = "empty";
    return normalizeState(
      bootstrapState
        ? {
            ...bootstrapState,
            desktopBootstrapAppliedAt: Date.now(),
          }
        : createDefaultState(),
    );
  }

  load.boot.state_bytes = stored.length * 2;
  let parsedState: Partial<LocalAppState>;
  try {
    parsedState = JSON.parse(stored) as Partial<LocalAppState>;
  } catch {
    load.boot.load_path = "unreadable";
    return normalizeState(bootstrapState ?? createDefaultState());
  }
  load.boot.load_path = "stored";
  load.boot.migrations =
    typeof parsedState === "object" && parsedState !== null
      ? storedMigrations(parsedState as Record<string, unknown>)
      : [];
  load.recovery.decision = bootstrapState ? "already_applied" : "none";

  if (bootstrapState && !parsedState.desktopBootstrapAppliedAt) {
    if (retryRecovery === undefined) {
      load.recovery.reason = shouldBootstrapFromDesktopState(
        parsedState,
        bootstrapState,
      );
    } else {
      load.recovery.retried = true;
    }
    const merge = retryRecovery ?? load.recovery.reason !== undefined;
    load.recovery.decision = merge ? "merged" : "nothing_to_merge";
    // With nothing to merge, the recovery still counts as applied, so a week
    // the user reopens later is not locked again by the same file on reload.
    const recovered = normalizeState(
      merge
        ? mergeDesktopBootstrapState(parsedState, bootstrapState)
        : { ...parsedState, desktopBootstrapAppliedAt: Date.now() },
    );
    try {
      // Another tab may have saved since this read: redo the recovery on
      // its state, once, instead of overwriting it.
      if (
        retryRecovery === undefined &&
        !storageStillHolds(stored, parsedState.revision)
      ) {
        return loadStoredState(bootstrapState, merge);
      }
      return persistState(recovered);
    } catch {
      // Keep the complete recovered state in memory when persistence is unavailable.
      load.boot.persisted = false;
      return recovered;
    }
  }
  try {
    const normalizedState = normalizeState(parsedState);
    if (containsRetiredOutlookState(parsedState)) {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) === stored) {
          return persistState(normalizedState);
        }
      } catch {
        // Keep the sanitized state in memory when persistence is unavailable.
        load.boot.persisted = false;
      }
    }
    return normalizedState;
  } catch {
    return normalizeState(bootstrapState ?? createDefaultState());
  }
}

function readState(): LocalAppState {
  if (!cachedState) refreshState();
  return cachedState!;
}

/**
 * Reloads the state from storage. Its revision is the one saved inside it,
 * never the hint key read apart, so a write from another window between the
 * two reads cannot pair an old state with a newer revision.
 */
function refreshState(): LocalAppState {
  cachedState = loadState();
  cachedRevision = cachedState.revision ?? null;
  return cachedState;
}

/** The revision hint key, or null when it is missing or unreadable. */
function readRevisionHint(): string | null {
  try {
    return window.localStorage.getItem(REVISION_KEY);
  } catch {
    return null;
  }
}

/**
 * Saves `state` with a new revision inside it, in one atomic write, then the
 * same revision under the hint key. When the hint cannot be written, it is
 * removed, so other windows reload and compare the revision inside the state
 * instead of trusting an old hint. Returns the saved state.
 */
function persistState<T extends Partial<LocalAppState>>(
  state: T,
): T & { revision: string } {
  const saved = { ...state, revision: createId("revision") };
  const serialized = JSON.stringify(saved);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  countStoreWrite(serialized.length * 2);
  try {
    window.localStorage.setItem(REVISION_KEY, saved.revision);
  } catch {
    try {
      window.localStorage.removeItem(REVISION_KEY);
    } catch {
      // Other windows reload either way: the hint is old or missing.
    }
    // Other windows now reload before each write instead of trusting the hint.
    countOnStoreCommand("store_revision_hint_failure_count");
  }
  return saved;
}

/**
 * Refuses a write made from a stale cache: another window wrote since this
 * window last read or wrote the state, and this window has not read its
 * storage event yet. Writing would erase that window's write, such as a lock.
 * It reads only the hint key when it matches, so a write in a single window
 * never parses the stored state. A missing or different hint reloads the
 * state and compares the revision inside it: the write goes on when its base
 * was current, and is refused otherwise. The reload keeps the cache current,
 * so the next try works.
 *
 * Known limit: two browser tabs of the web build that write within the same
 * moment can still overwrite each other: the check reads the hint, then
 * writes, and the browser gives no lock between tabs. The desktop app has one
 * window, so it is not affected.
 */
function assertFreshCache(cached: LocalAppState, next: LocalAppState) {
  const hint = readRevisionHint();
  if (hint !== null && hint === cachedRevision) return;

  const baseRevision = cachedRevision;
  const fresh = refreshState();
  if (cachedRevision === baseRevision) {
    // The base was current: keep the cached object, so its readers see no change.
    cachedState = cached;
    return;
  }

  storeCommandUnit()?.set({ store: { revision_changed: true } });
  announceStateChange({ local: false });
  // Judge what this write changes against the fresh locks.
  const weekOf = findLockedWeekWrite(
    { ...cached, lockedWeeks: fresh.lockedWeeks },
    { ...next, lockedWeeks: fresh.lockedWeeks },
  );
  throw weekOf ? new LockedWeekError(weekOf) : new StaleWindowError();
}

function writeState(state: LocalAppState) {
  // Every write passes here, Submit, Reopen and every Undo included, so these
  // checks keep a submitted week as it is, whatever command, Undo or agent
  // tool made the write.
  if (cachedState) {
    try {
      assertFreshCache(cachedState, state);
      assertNoLockedWeekWrite(cachedState, state);
    } catch (error) {
      // Recorded on the command's event before the error reaches the toast.
      if (error instanceof LockedWeekError) {
        refuseStoreCommand("locked_week");
      } else if (error instanceof StaleWindowError) {
        refuseStoreCommand("stale_window");
      }
      throw error;
    }
  }
  const nextState = persistState({ ...state, updatedAt: Date.now() });
  cachedRevision = nextState.revision;
  cachedState = nextState;
  announceStateChange({ local: true });
}

/** The part of the state the team sync rules read and write. */
function teamSyncStateOf(state: LocalAppState): TeamSyncState {
  return {
    projects: state.projects,
    teamConnections: state.teamConnections ?? {},
  };
}

function withTeamSyncState(
  state: LocalAppState,
  next: TeamSyncState,
): LocalAppState {
  return {
    ...state,
    projects: next.projects,
    teamConnections: next.teamConnections,
  };
}

/**
 * Whether `next` holds what `current` holds: every key the same value, or a
 * list with the same records in the same order. A transition that found
 * nothing to change, such as one on a record that doesn't exist, often
 * copies the state and its lists anyway; that copy is not a write.
 */
function holdsSameState(current: LocalAppState, next: LocalAppState) {
  if (current === next) return true;
  const before = current as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key];
    const right = after[key];
    if (left === right) continue;
    if (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((record, index) => record === right[index])
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function updateState(
  mutator: (state: LocalAppState) => LocalAppState,
): LocalAppState {
  const current = readState();
  const next = mutator(current);
  if (holdsSameState(current, next)) return current;
  writeState(next);
  return next;
}

function updateStateWithResult<T>(
  operation: (state: LocalAppState) => {
    state: LocalAppState;
    result: T;
  },
): T {
  const current = readState();
  const { state, result } = operation(current);
  if (!holdsSameState(current, state)) {
    writeState(state);
  }
  return result;
}

/**
 * The last undoable action. Only one action can be undone, so a new one
 * replaces it. It lives in memory: the Undo toast does not survive a reload.
 */
let lastUndo: { token: string; undo: LocalStateUndo } | undefined;

/** How many `runWithUndo` calls are running, one inside another. */
let undoGroupDepth = 0;

/**
 * Applies an undoable action and remembers what it changed. Returns the token
 * that Undo passes back, or null when the action changed nothing.
 */
function updateStateWithUndo(
  mutator: (state: LocalAppState) => LocalAppState,
): string | null {
  const current = readState();
  const next = mutator(current);
  if (holdsSameState(current, next)) {
    return null;
  }

  writeState(next);
  const undo = captureUndo(current, next);
  if (!undo) {
    return null;
  }

  const token = createId("undo");
  rememberUndo(token, undo);
  return token;
}

/**
 * Sets the project and task of each backlog item whose description timelog
 * the write changed. See domain/backlog/description-timelog.ts.
 */
function withDescriptionTimelogs(
  previous: LocalAppState,
  next: LocalAppState,
  mappedIds?: ReadonlySet<string>,
) {
  return applyDescriptionTimelogs(
    previous.workItems,
    next,
    { createId, now: Date.now },
    mappedIds,
  );
}

/** A step of a synced description, with the timelog of a text that changed. */
function changeSyncedDescription(
  state: LocalAppState,
  workItemId: string,
  change: (
    item: LocalWorkItem,
  ) => Pick<LocalWorkItem, "description" | "descriptionSync">,
) {
  const target = state.workItems.find((item) => item._id === workItemId);
  if (!target?.descriptionSync) return state;
  const next = {
    ...state,
    workItems: state.workItems.map((item) =>
      item._id === workItemId ? { ...item, ...change(item) } : item,
    ),
  };
  return withDescriptionTimelogs(state, next);
}

/**
 * Updates a backlog item, then applies its description's timelog if the
 * patch changed it, unless the patch sets the project or task itself.
 */
function updateWorkItemState(
  state: LocalAppState,
  workItemId: string,
  patch: Parameters<typeof applyUpdateWorkItem>[2],
) {
  return withDescriptionTimelogs(
    state,
    applyUpdateWorkItem(state, workItemId, patch),
    getMappedIds(workItemId, patch),
  );
}

/**
 * Whether an edit's priority goes to the source. Local-store knows no
 * plugins, so the caller says whether the item's plugin can write.
 */
interface PriorityWriteOptions {
  writesToSource?: boolean;
}

function priorityWrite(
  options: PriorityWriteOptions | undefined,
  undoWindow: boolean,
): ChangePriorityOptions {
  return {
    writesToSource: options?.writesToSource ?? false,
    now: Date.now(),
    undoWindow,
  };
}

/** The item, when the patch sets its project or task itself. */
function getMappedIds(
  workItemId: string,
  patch: Parameters<typeof applyUpdateWorkItem>[2],
) {
  return "projectId" in patch || "taskId" in patch
    ? new Set([workItemId])
    : undefined;
}

/** How long a team sync in another window waits for an open Undo, at most. */
const TEAM_PUSH_HOLD_MS = 60_000;

/**
 * Keeps the undo for `token`, and holds the shared projects it would restore
 * from team syncs in every window until its Undo window closes.
 */
function rememberUndo(token: string, undo: LocalStateUndo) {
  lastUndo = { token, undo };
  // Inside `runWithUndo`, the group's own capture counts the change, once.
  if (undoGroupDepth === 0) {
    countUndoChanges(undo);
    storeCommandUnit()?.set({ store: { undo_offered: true } });
  }
  const state = readState();
  const shared = new Set(
    state.projects
      .filter((project) => project.team)
      .map((project) => project._id),
  );
  const held = undo.projects
    .filter(
      (change) =>
        shared.has(change.key) ||
        change.before?.team !== undefined ||
        change.after?.team !== undefined,
    )
    .map((change) => change.key);
  if (held.length > 0) {
    writeState({
      ...state,
      teamPushHold: { projectIds: held, until: Date.now() + TEAM_PUSH_HOLD_MS },
    });
  } else if (state.teamPushHold) {
    writeState({ ...state, teamPushHold: undefined });
  }
}

/** The Undo window closed: team syncs no longer wait for its projects. */
function releaseTeamPushHold() {
  const state = readState();
  if (state.teamPushHold) writeState({ ...state, teamPushHold: undefined });
}

/**
 * `updateStateWithUndo` for an operation that also returns a result. The token
 * is null when the operation changed nothing.
 */
function updateStateWithUndoResult<T>(
  operation: (state: LocalAppState) => { state: LocalAppState; result: T },
): { undoToken: string | null; result: T } {
  let result!: T;
  const undoToken = updateStateWithUndo((state) => {
    const applied = operation(state);
    result = applied.result;
    return applied.state;
  });
  return { undoToken, result };
}

/** `expired` means a later action replaced this one, or its toast already closed. */
export type UndoResult = LocalStateUndoResult | "expired";

let otherWindowWritesListened = false;

/**
 * Picks up a write from another window of this origin. A write in this window
 * already cached its state in `writeState`, so it only announces the change.
 */
function listenForOtherWindowWrites() {
  if (otherWindowWritesListened) {
    return;
  }

  otherWindowWritesListened = true;
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      wideEvents.run(
        "local_state.reload",
        { kind: "job", trigger: "system" },
        (unit) => {
          const before = cachedRevision;
          refreshState();
          unit.set({
            local_state: {
              revision_changed: cachedRevision !== before,
              storage_cleared: event.key === null,
            },
          });
          announceStateChange({ local: false });
        },
      );
    }
  });
}

/** Runs a change of the timesheet import drafts and records what it did. */
function withDraftCounts<Result>(
  name: "timesheet_import.dismiss" | "timesheet_import.commit",
  change: () => Result,
): Result {
  const before = readState();
  const result = change();
  describeImportDrafts(name, before, readState());
  return result;
}

/**
 * The local store's reads and commands. A command that would change a
 * submitted week throws `LockedWeekError` and writes nothing.
 */
const store = {
  /**
   * Calls `callback` after each change, from this window or another. The
   * change says which, for listeners that act on their own window's writes.
   */
  subscribe(callback: (change: LocalStateChange) => void) {
    listenForOtherWindowWrites();
    const listener = (event?: Event) =>
      callback({
        local:
          (event as CustomEvent<LocalStateChange> | undefined)?.detail
            ?.local === true,
      });
    window.addEventListener(STATE_CHANGE_EVENT, listener);
    return () => window.removeEventListener(STATE_CHANGE_EVENT, listener);
  },
  snapshot: readState,
  syncPullRequests(
    source: {
      pluginId: string;
      pluginName: string;
      connectionId: string;
      connectionLabel: string;
    },
    result: CodeHostSyncResult,
    options: { reattachFrom?: string } = {},
  ) {
    return updateState((state) => ({
      ...state,
      pullRequests: reconcilePullRequests(
        options.reattachFrom
          ? reattachPullRequests(
              state.pullRequests ?? [],
              source.pluginId,
              options.reattachFrom,
              source,
            )
          : (state.pullRequests ?? []),
        source,
        result,
        {
          now: Date.now(),
          createId: () => createId("pull_request"),
          changesEndSnoozeEarly:
            state.userPreferences.changesEndSnoozeEarly === true,
        },
      ),
    }));
  },
  changePullRequest(id: string, command: PullRequestCommand) {
    return updateState((state) => ({
      ...state,
      pullRequests: (state.pullRequests ?? []).map((item) =>
        item._id === id ? changePullRequest(item, command, Date.now()) : item,
      ),
    }));
  },
  /**
   * Adds calendar suggestions as time entries in one action. Returns the new
   * entry ids, the number left alone, and an undo token, null when nothing
   * was added.
   */
  acceptCalendarSuggestions(acceptances: readonly CalendarAcceptance[]) {
    const before = readState();
    let result: ReturnType<typeof applyAcceptCalendarSuggestions>["result"] = {
      entryIds: [],
      skipped: acceptances.length,
    };
    const undoToken = updateStateWithUndo((state) => {
      const operation = applyAcceptCalendarSuggestions(state, acceptances, {
        createId,
        now: Date.now,
      });
      result = operation.result;
      return operation.state;
    });
    describeSuggestionAdd(before, readState(), result);
    return { ...result, undoToken };
  },
  /** Hides these occurrences. Returns an undo token. */
  dismissCalendarSuggestions(suggestions: readonly CalendarSuggestion[]) {
    return updateStateWithUndo((state) =>
      applyDismissCalendarSuggestions(state, suggestions, {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Hides every occurrence of the suggestion's meeting. Returns an undo token. */
  hideCalendarMeeting(suggestion: CalendarSuggestion) {
    return updateStateWithUndo((state) =>
      applyHideCalendarMeeting(state, suggestion, {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Removes a remembered or hidden meeting. Returns an undo token. */
  forgetCalendarEventRule(ruleId: string) {
    return updateStateWithUndo((state) =>
      applyForgetCalendarEventRule(state, ruleId),
    );
  },
  removeConnectionCalendarData(pluginId: string, connectionId: string) {
    return updateState((state) =>
      removeCalendarConnectionData(state, { pluginId, connectionId }),
    );
  },
  /**
   * The projects a pending Undo would restore, here or in another window. A
   * team sync waits for them.
   */
  pendingUndoProjectIds() {
    const ids = getUndoProjectIds(lastUndo?.undo);
    const hold = readState().teamPushHold;
    if (hold && hold.until > Date.now()) {
      for (const projectId of hold.projectIds) ids.add(projectId);
    }
    return ids;
  },
  /**
   * Applies one round of a team sync. It is not undoable: an Undo of an
   * earlier action that touched the same project is then refused as stale.
   * A refused result changes nothing.
   */
  applyTeamSyncRound(
    connectionId: string,
    pushed: readonly TeamProjectChange[],
    result: TeamSyncResult,
    identity: string,
  ): TeamSyncApplyResult {
    return updateStateWithResult<TeamSyncApplyResult>((state) => {
      const next = applyTeamSync(
        teamSyncStateOf(state),
        connectionId,
        pushed,
        result,
        { createId, now: Date.now },
      );
      if (next.result.kind === "rejected") {
        return { state, result: next.result };
      }
      const connection = next.teamConnections[connectionId];
      return {
        state: withTeamSyncState(state, {
          ...next,
          teamConnections: connection
            ? {
                ...next.teamConnections,
                [connectionId]: { ...connection, identity },
              }
            : next.teamConnections,
        }),
        result: next.result,
      };
    });
  },
  /**
   * Gives a local project to a team; the next sync sends it. Undo takes it
   * back, and the sync waits while the Undo window is open.
   */
  shareProjectWithTeam(
    connectionId: string,
    projectId: string,
  ): { result: TeamShareResult; undoToken: string | null } {
    let result: TeamShareResult = { kind: "missing" };
    const undoToken = updateStateWithUndo((state) => {
      const next = shareProject(
        teamSyncStateOf(state),
        connectionId,
        projectId,
      );
      result = next.result;
      return next.result.kind === "shared"
        ? withTeamSyncState(state, next)
        : state;
    });
    describeShare(projectId, connectionId, result);
    return { result, undoToken };
  },
  /**
   * Makes a shared project local on this machine only. The UI asks first and
   * offers no Undo: a sync meanwhile would skip the team's changes to it, and
   * restoring the link afterwards could not bring them back.
   */
  unshareProjectFromTeam(projectId: string) {
    updateState((state) =>
      withTeamSyncState(
        state,
        unshareProject(teamSyncStateOf(state), projectId),
      ),
    );
  },
  /** The user's answer for a held team project. It shows no Undo. */
  resolveTeamArrival(
    connectionId: string,
    remoteId: string,
    choice: HeldArrivalChoice,
  ): TeamResolveResult {
    return updateStateWithResult<TeamResolveResult>((state) => {
      const next = resolveHeldArrival(
        teamSyncStateOf(state),
        connectionId,
        remoteId,
        choice,
        { createId, now: Date.now },
      );
      return next.result.kind === "linked" || next.result.kind === "added"
        ? { state: withTeamSyncState(state, next), result: next.result }
        : { state, result: next.result };
    });
  },
  /** A removed team connection: its projects become local, with their entries. */
  removeConnectionTeamData(connectionId: string) {
    return updateState((state) => {
      if (
        !state.teamConnections?.[connectionId] &&
        !state.projects.some(
          (project) => project.team?.connectionId === connectionId,
        )
      ) {
        return state;
      }
      return withTeamSyncState(
        state,
        disconnectTeam(teamSyncStateOf(state), connectionId),
      );
    });
  },
  removeConnectionPullRequests(pluginId: string, connectionId: string) {
    return updateState((state) => {
      const pullRequests = (state.pullRequests ?? []).filter(
        (item) =>
          item.pluginId !== pluginId || item.connectionId !== connectionId,
      );
      // Nothing to remove writes nothing.
      return pullRequests.length === (state.pullRequests ?? []).length
        ? state
        : { ...state, pullRequests };
    });
  },
  createTeam(
    teamName: string,
    teamSlug: string,
    projects: LocalProjectDraft[],
  ) {
    updateState((state) => ({
      ...state,
      team: {
        _id: "local_team",
        name: teamName,
        slug: teamSlug,
        settings: defaultTeamSettings,
      },
      projects: projects.map((project) =>
        createProject(project, { createId, now: Date.now }),
      ),
    }));
  },
  addProject(project: LocalProjectDraft) {
    return updateStateWithResult((state) => {
      const operation = applyAddProject(state.projects, project, {
        createId,
        now: Date.now,
      });
      return {
        state: { ...state, projects: operation.projects },
        result: operation.result,
      };
    });
  },
  updateProject(projectId: string, patch: Partial<Omit<LocalProject, "_id">>) {
    updateState((state) => ({
      ...state,
      projects: applyUpdateProject(state.projects, projectId, patch),
    }));
  },
  /**
   * Updates a project like `updateProject`, for the in-place edits of the project
   * page. Returns an undo token, or null when nothing changed.
   */
  updateProjectWithUndo(
    projectId: string,
    patch: Partial<Omit<LocalProject, "_id">>,
  ) {
    return updateStateWithUndo((state) => ({
      ...state,
      projects: applyUpdateProject(state.projects, projectId, patch),
    }));
  },
  reorderProjects(orderedIds: string[]) {
    if (orderedIds.length < 2) {
      return;
    }

    updateState((state) => {
      const projects = applyReorderProjects(state.projects, orderedIds);

      return projects === state.projects ? state : { ...state, projects };
    });
  },
  /** Archives a project. Returns an undo token, or null when nothing changed. */
  archiveProject(projectId: string) {
    return updateStateWithUndo((state) => ({
      ...state,
      projects: applyUpdateProject(state.projects, projectId, {
        status: "archived",
      }),
    }));
  },
  unarchiveProject(projectId: string) {
    this.updateProject(projectId, { status: "active" });
  },
  addProjectTask(projectId: string, task: LocalProjectTaskDraft) {
    updateState((state) => ({
      ...state,
      projects: applyAddProjectTask(state.projects, projectId, task, {
        createId,
        now: Date.now,
      }),
    }));
  },
  reorderProjectTask(projectId: string, taskId: string, toIndex: number) {
    updateState((state) => ({
      ...state,
      projects: applyReorderProjectTask(
        state.projects,
        projectId,
        taskId,
        toIndex,
      ),
    }));
  },
  reorderTimesheetEntries(localDate: string, orderedIds: string[]) {
    if (orderedIds.length < 2) {
      return;
    }

    updateState((state) =>
      applyReorderTimesheetEntries(state, localDate, orderedIds),
    );
  },
  importProjectTasks(
    projectId: string,
    taskNames: string[],
  ): ProjectTaskImportResult {
    const imported = updateStateWithResult((state) => {
      const operation = applyProjectTaskImport(
        state.projects,
        projectId,
        taskNames,
        {
          createTask: (task) =>
            createProjectTask(task, { createId, now: Date.now }),
        },
      );
      return {
        state: {
          ...state,
          projects: operation.projects,
        },
        result: operation.result,
      };
    });
    describeTaskImport(projectId, imported);
    return imported;
  },
  importProjectWorkbookRows(rows: ProjectTransferRow[]) {
    const imported = updateStateWithResult<ProjectWorkbookImportResult>(
      (state) => {
        const operation = applyProjectWorkbookImport(state.projects, rows, {
          createProject: (project) =>
            createProject(project, { createId, now: Date.now }),
          createTask: (task) =>
            createProjectTask(task, { createId, now: Date.now }),
          now: Date.now,
        });

        return {
          state: {
            ...state,
            projects: operation.projects,
          },
          result: operation.result,
        };
      },
    );
    describeProjectImport(imported, {
      schema: "default",
      row_count: rows.length,
      project_count: new Set(rows.map((row) => row.project)).size,
      task_count: rows.length,
    });
    return imported;
  },
  importProjectDataShapeProjects(projects: ProjectDataShapeImportProject[]) {
    const schema = readState().userPreferences.projectDataShapeId;
    const imported = updateStateWithResult<ProjectWorkbookImportResult>(
      (state) => {
        const operation = applyProjectDataShapeImport(
          state.projects,
          projects,
          {
            createProject: (project) =>
              createProject(project, { createId, now: Date.now }),
            createTask: (task) =>
              createProjectTask(task, { createId, now: Date.now }),
            now: Date.now,
          },
        );

        return {
          state: {
            ...state,
            projects: operation.projects,
          },
          result: operation.result,
        };
      },
    );
    describeProjectImport(imported, {
      schema: schema === BUILT_IN_PROJECT_DATA_SHAPE_ID ? "default" : schema,
      project_count: projects.length,
      task_count: projects.reduce(
        (total, project) => total + project.tasks.length,
        0,
      ),
    });
    return imported;
  },
  /** Merges the one project a schema plugin read for Import tasks… into `projectId`. */
  importProjectDataShapeTasks(
    projectId: string,
    schema: string,
    projects: ProjectDataShapeImportProject[],
  ) {
    const imported = updateStateWithResult<ProjectTaskMergeResult>((state) => {
      const operation = applyProjectDataShapeTaskImport(
        state.projects,
        projectId,
        projects,
        {
          createTask: (task) =>
            createProjectTask(task, { createId, now: Date.now }),
          now: Date.now,
        },
      );
      return {
        state: { ...state, projects: operation.projects },
        result: operation.result,
      };
    });
    describeSchemaTaskImport(projectId, schema, imported);
    return imported;
  },
  renameProjectTask(projectId: string, taskId: string, name: string) {
    updateState((state) => ({
      ...state,
      projects: applyUpdateProjectTask(state.projects, projectId, taskId, {
        name,
      }),
    }));
  },
  updateProjectTask(
    projectId: string,
    taskId: string,
    patch: ProjectTaskPatch,
  ) {
    updateState((state) => ({
      ...state,
      projects: applyUpdateProjectTask(
        state.projects,
        projectId,
        taskId,
        patch,
      ),
    }));
  },
  /** Sets or clears a task's pinned slot. A slot another task holds moves to this one. */
  setProjectTaskPinnedSlot(
    projectId: string,
    taskId: string,
    slot: PinnedTaskSlot | undefined,
  ) {
    updateState((state) => ({
      ...state,
      projects: applySetProjectTaskPinnedSlot(
        state.projects,
        projectId,
        taskId,
        slot,
      ),
    }));
  },
  /**
   * Stars a task as a favorite, or removes its star. Removing returns an undo
   * token, since the row can leave the list it was removed from; starring
   * returns null, as starring again is its own undo.
   */
  setProjectTaskFavorite(projectId: string, taskId: string, favorite: boolean) {
    const star = (state: LocalAppState) => ({
      ...state,
      projects: applySetProjectTaskFavorite(
        state.projects,
        projectId,
        taskId,
        favorite ? Date.now() : undefined,
      ),
    });
    if (!favorite) return updateStateWithUndo(star);
    updateState(star);
    return null;
  },
  /**
   * Stars a project as a favorite, or removes its star. Its tasks keep
   * theirs. Removing returns an undo token, like `setProjectTaskFavorite`.
   */
  setProjectFavorite(projectId: string, favorite: boolean) {
    const star = (state: LocalAppState) => ({
      ...state,
      projects: applySetProjectFavorite(
        state.projects,
        projectId,
        favorite ? Date.now() : undefined,
      ),
    });
    if (!favorite) return updateStateWithUndo(star);
    updateState(star);
    return null;
  },

  /** Archives a task. Returns an undo token, or null when nothing changed. */
  archiveProjectTask(projectId: string, taskId: string) {
    return updateStateWithUndo((state) => ({
      ...state,
      projects: setProjectTaskStatus(
        state.projects,
        projectId,
        taskId,
        "archived",
        Date.now,
      ),
    }));
  },
  unarchiveProjectTask(projectId: string, taskId: string) {
    updateState((state) => ({
      ...state,
      projects: setProjectTaskStatus(
        state.projects,
        projectId,
        taskId,
        "active",
        Date.now,
      ),
    }));
  },
  addWorkflowState(name: string, color?: string) {
    return updateStateWithResult((state) => {
      return applyAddWorkflowState(state, name, color, {
        createId,
        now: Date.now,
      });
    });
  },
  updateWorkflowState(
    statusId: string,
    updates: string | { name: string; color?: string; done?: boolean },
  ) {
    updateState((state) =>
      applyWorkflowStateLifecycle(
        state,
        applyUpdateWorkflowState(state, statusId, updates),
        { createId, now: Date.now },
      ),
    );
  },
  /**
   * Deletes a workflow state with its source state mappings and clears it from work
   * items. Returns an undo token, or null when nothing changed.
   */
  deleteWorkflowState(statusId: string) {
    return updateStateWithUndo((state) =>
      applyDeleteWorkflowState(state, statusId),
    );
  },
  /** Maps new source states that match a workflow state or a done category. */
  autoMapSourceStates(reported: ReportedSourceState[]) {
    updateState((state) =>
      applyWorkflowStateLifecycle(
        state,
        applyAutoMapSourceStates(state, reported),
        { createId, now: Date.now },
      ),
    );
  },
  /** Sets or clears what moving an item into a workflow state writes. */
  setWorkflowStateWriteRule(
    rule: Parameters<typeof applySetWorkflowStateWriteRule>[1],
  ) {
    updateState((state) => applySetWorkflowStateWriteRule(state, rule));
  },
  /** Moves a workflow state one place up or down in the board order. */
  moveWorkflowState(workflowStateId: string, step: -1 | 1) {
    updateState((state) =>
      applyMoveWorkflowState(state, workflowStateId, step),
    );
  },
  /**
   * Maps a source state to a workflow state. Open items that land in a done
   * state close. Returns how many closed, with an undo token when any did.
   */
  setWorkflowStateMapping(mapping: WorkflowStateMappingInput) {
    let closedCount = 0;
    const token = updateStateWithUndo((state) => {
      const mapped = applyWorkflowStateMapping(state, mapping);
      const next = applyWorkflowStateLifecycle(state, mapped, {
        createId,
        now: Date.now,
      });
      closedCount = next.workItems.filter(
        (workItem, index) =>
          workItem.status === "archived" &&
          mapped.workItems[index]?.status !== "archived",
      ).length;
      return next;
    });
    return { closedCount, undoToken: closedCount > 0 ? token : null };
  },
  /** Starts a running entry today, saving the one already running (Start or Switch). */
  startTimer(timer: LocalTimerDraft) {
    const before = readState();
    const after = updateState((state) =>
      applyStartTimer(state, timer, todayIsoDate(), {
        createId,
        now: Date.now,
      }),
    );
    describeTimerStart(before, after);
  },
  /** Saves the running entry's form. It keeps running. */
  editRunningEntry(timerId: string, edit: RunningEntryEdit) {
    const timer = readState().timers.find((item) => item._id === timerId);
    const now = Date.now();
    updateState((state) =>
      applyEditRunningEntry(state, timerId, edit, { now: Date.now }),
    );
    describeRunningEntryEdit(timer, edit, now);
  },
  /** Discards the running entry. Returns an undo token, or null when nothing changed. */
  cancelTimer(timerId: string) {
    describeTimerDiscard(
      readState().timers.find((item) => item._id === timerId),
      Date.now(),
    );
    return updateStateWithUndo((state) => applyCancelTimer(state, timerId));
  },
  saveManualTimeEntry(values: {
    localDate: string;
    workItemId?: string;
    projectId?: string;
    taskId?: string;
    note?: string;
    durationMs: number;
  }) {
    const before = readState();
    const after = updateState((state) =>
      saveManualTimesheetEntry(state, values, {
        createId,
        now: Date.now,
      }),
    );
    describeEntryCreate(before, after);
  },
  stageTimesheetImportRows(rows: TimesheetImportRow[]) {
    const before = readState();
    const after = updateState((state) =>
      applyStageTimesheetImportRows(state, rows, {
        createId,
        now: Date.now,
      }),
    );
    describeImportStage(before, after, rows.length);
  },
  /** Dismisses one import draft. Returns an undo token, or null when nothing changed. */
  dismissTimesheetImportDraft(draftId: string) {
    return withDraftCounts("timesheet_import.dismiss", () =>
      updateStateWithUndo((state) =>
        applyDismissTimesheetImportDraft(state, draftId),
      ),
    );
  },
  /** Dismisses every import draft. Returns an undo token, or null when there were none. */
  dismissAllTimesheetImportDrafts() {
    return withDraftCounts("timesheet_import.dismiss", () =>
      updateStateWithUndo((state) => applyClearTimesheetImportDrafts(state)),
    );
  },
  commitTimesheetImportDraft(draftId: string) {
    withDraftCounts("timesheet_import.commit", () =>
      updateState((state) =>
        applyCommitTimesheetImportDraft(state, draftId, {
          createId,
          now: Date.now,
        }),
      ),
    );
  },
  commitReadyTimesheetImportDrafts() {
    withDraftCounts("timesheet_import.commit", () =>
      updateState((state) =>
        applyCommitReadyTimesheetImportDrafts(state, {
          createId,
          now: Date.now,
        }),
      ),
    );
  },
  addWorkItem(workItem: LocalWorkItemDraft) {
    return updateStateWithResult((state) => {
      const added = applyAddWorkItem(state, workItem, {
        createId,
        now: Date.now,
      });
      return { ...added, state: withDescriptionTimelogs(state, added.state) };
    });
  },
  addSubtask(
    parentWorkItemId: string,
    workItem: Omit<LocalWorkItemDraft, "parentWorkItemId">,
  ) {
    return this.addWorkItem({
      ...workItem,
      parentWorkItemId,
    });
  },
  /** Imports synced items. */
  importSyncedWorkItems(
    workItems: BacklogImportCandidate[],
    options?: {
      archiveMissingFromConnectionId?: string;
    },
  ) {
    const imported = updateStateWithResult((state) => {
      const imported = applySyncedWorkItemImport(
        applyWorkflowStateLifecycle(
          state,
          autoMapSourceStates(
            state,
            workItems.flatMap((workItem) =>
              workItem.state
                ? [
                    {
                      source: workItem.source,
                      connectionId: workItem.connectionId,
                      sourceProjectName: workItem.projectName,
                      label: workItem.state,
                      done: workItem.stateDone,
                    },
                  ]
                : [],
            ),
          ),
          { createId, now: Date.now },
        ),
        workItems,
        options,
        {
          createId,
          now: Date.now,
        },
      );
      // A new item whose description has a timelog arrives mapped.
      return {
        ...imported,
        state: withDescriptionTimelogs(state, imported.state),
      };
    });
    describeBacklogImport(workItems.length, imported);
    return imported;
  },
  /** Archives the synced items a sync reports in a done category. */
  archiveDoneSyncedWorkItems(doneItems: BacklogDoneWorkItem[]) {
    if (doneItems.length === 0) {
      return 0;
    }

    return updateStateWithResult((state) => {
      const mapped = autoMapSourceStates(
        state,
        doneItems.flatMap((doneItem) =>
          doneItem.state
            ? [
                {
                  source: doneItem.source,
                  connectionId: doneItem.connectionId,
                  label: doneItem.state,
                  done: true,
                },
              ]
            : [],
        ),
      );
      const result = archiveDoneSyncedWorkItems(mapped, doneItems, {
        createId,
        now: Date.now,
      });
      // A done item's description syncs too, and its timelog maps the item.
      const next = withDescriptionTimelogs(
        state,
        applyWorkflowStateLifecycle(state, result.state, {
          createId,
          now: Date.now,
        }),
      );
      const newlyClosed = next.workItems.filter(
        (item) =>
          item.status === "archived" &&
          result.state.workItems.find((before) => before._id === item._id)
            ?.status !== "archived",
      ).length;
      return { state: next, result: result.archivedCount + newlyClosed };
    });
  },
  /** Brings back settled items that someone else commented on (ADR 0008). */
  returnItemsWithNewComments(
    facts: BacklogItemCommentFacts[],
    viewer: BacklogPerson,
    sync: {
      settledSince: ReadonlyMap<string, number>;
      returnedBySync: ReadonlySet<string>;
    },
  ) {
    updateState((state) =>
      applyReturnItemsWithNewComments(state, facts, viewer, sync, Date.now),
    );
  },
  applyBacklogSyncWorkItemUpdates(updates: BacklogSyncWorkItemUpdate[]) {
    if (updates.length === 0) {
      return;
    }

    updateState((state) =>
      applySyncedWorkItemUpdates(state, updates, Date.now),
    );
  },
  keepLocalEstimateConflict(
    workItemId: string,
    fieldKey: LocalWorkItemEstimateFieldKey,
  ) {
    updateState((state) =>
      applyKeepLocalEstimateConflict(state, workItemId, fieldKey),
    );
  },
  /**
   * Resolves a description conflict with the source's text, which both sides
   * then agree on. Returns the Undo token.
   */
  takeSourceDescriptionWithUndo(workItemId: string) {
    return updateStateWithUndo((state) => {
      const target = state.workItems.find((item) => item._id === workItemId);
      if (!target?.descriptionSync?.conflict) return state;
      const next = {
        ...state,
        workItems: state.workItems.map((item) =>
          item._id === workItemId
            ? { ...item, ...takeSourceDescription(item) }
            : item,
        ),
      };
      return withDescriptionTimelogs(state, next);
    });
  },
  /**
   * Applies a step of a synced description's save to the item, without Undo:
   * a description written to its source stays written. A text that changed
   * applies its timelog, as any description edit does.
   */
  updateSyncedDescription(
    workItemId: string,
    change: (
      item: LocalWorkItem,
    ) => Pick<LocalWorkItem, "description" | "descriptionSync">,
  ) {
    updateState((state) => changeSyncedDescription(state, workItemId, change));
  },
  /**
   * Holds the item's description: its connection refused the save because
   * editing work items is off. The local text stays.
   */
  holdDescription(workItemId: string) {
    updateState((state) =>
      changeSyncedDescription(state, workItemId, (item) =>
        applyDescriptionHeld(item, Date.now()),
      ),
    );
  },
  /** The user approved sending the held description; the save sends it. */
  releaseHeldDescription(workItemId: string) {
    updateState((state) =>
      changeSyncedDescription(state, workItemId, applyReleaseHeldDescription),
    );
  },
  /** The user discarded the held description; the source's text comes back. */
  discardHeldDescription(workItemId: string) {
    updateState((state) =>
      changeSyncedDescription(state, workItemId, applyDiscardHeldDescription),
    );
  },
  acceptRemoteEstimateValue(
    workItemId: string,
    fieldKey: LocalWorkItemEstimateFieldKey,
  ) {
    updateState((state) =>
      applyAcceptRemoteEstimateValue(state, workItemId, fieldKey),
    );
  },
  dismissEstimateIssue(
    workItemId: string,
    fieldKey: LocalWorkItemEstimateFieldKey,
  ) {
    updateState((state) =>
      applyDismissEstimateIssue(state, workItemId, fieldKey),
    );
  },
  reorderWorkItems(orderedIds: string[]) {
    if (orderedIds.length < 2) {
      return;
    }

    updateState((state) => applyReorderWorkItems(state, orderedIds));
  },
  reorderWorkItemsWithUndo(orderedIds: string[]) {
    return updateStateWithUndo((state) =>
      applyReorderWorkItems(state, orderedIds),
    );
  },
  setBacklogSortMode(mode: BacklogSortMode) {
    updateState((state) => applyBacklogSortMode(state, mode));
  },
  updateWorkItem(
    workItemId: string,
    patch: Partial<Omit<LocalWorkItem, "_id" | "createdAt" | "source">>,
  ) {
    updateState((state) => updateWorkItemState(state, workItemId, patch));
  },
  /**
   * Updates a backlog item. A description whose timelog changed also sets the
   * item's project and task, in the same Undo. A new priority level is
   * written to the source after the Undo window when `writesToSource`; a
   * refused one changes nothing, the order included. Returns an undo token,
   * or null when nothing changed.
   */
  updateWorkItemWithUndo(
    workItemId: string,
    patch: Parameters<typeof applyUpdateWorkItem>[2],
    orderedIds?: string[],
    options?: PriorityWriteOptions,
  ) {
    return updateStateWithUndo((state) => {
      const patched = applyPatchBacklogItem(
        state,
        workItemId,
        patch,
        priorityWrite(options, true),
      );
      if (patched === state) return state;
      const updated = withDescriptionTimelogs(
        state,
        patched,
        getMappedIds(workItemId, patch),
      );
      return orderedIds ? applyReorderWorkItems(updated, orderedIds) : updated;
    });
  },
  /**
   * Saves the backlog editor's changes, which have no Undo, so a new priority
   * level may go to the source at once when `writesToSource`. What the
   * description's timelog then sets or creates gets its own Undo, which keeps
   * the saved text; the token is null when the timelog changed nothing.
   */
  saveWorkItemEdits(
    workItemId: string,
    patch: Parameters<typeof applyUpdateWorkItem>[2],
    options?: PriorityWriteOptions,
  ): string | null {
    const before = readState();
    updateState((state) =>
      applyPatchBacklogItem(
        state,
        workItemId,
        patch,
        priorityWrite(options, false),
      ),
    );
    return updateStateWithUndo((state) =>
      withDescriptionTimelogs(before, state, getMappedIds(workItemId, patch)),
    );
  },
  /**
   * Saves an item's description text, which has no Undo, and leaves what its
   * timelog sets to `applyWorkItemEditsSince`. Returns the state before.
   */
  saveWorkItemDescriptionText(
    workItemId: string,
    description: string | undefined,
  ): LocalAppState {
    const before = readState();
    updateState((state) =>
      applyUpdateWorkItem(state, workItemId, { description }),
    );
    return before;
  },
  /**
   * Updates a backlog item and applies the timelogs of the descriptions saved
   * since `before`, under one Undo. A new priority level is written to the
   * source after the Undo window when `writesToSource`. Returns an undo
   * token, or null when nothing changed.
   */
  applyWorkItemEditsSince(
    workItemId: string,
    patch: Parameters<typeof applyUpdateWorkItem>[2],
    before: LocalAppState,
    options?: PriorityWriteOptions,
  ): string | null {
    return updateStateWithUndo((state) =>
      withDescriptionTimelogs(
        before,
        Object.keys(patch).length > 0
          ? applyPatchBacklogItem(
              state,
              workItemId,
              patch,
              priorityWrite(options, true),
            )
          : state,
        getMappedIds(workItemId, patch),
      ),
    );
  },
  /**
   * Creates the backlog editor's new item, which has no Undo, then applies
   * its description's timelog and, for an item made in a done state, closes
   * it, under one Undo. Undo leaves the item and its description, and takes
   * back what the timelog set and created and the close. The token is null
   * when neither happened.
   */
  saveNewWorkItem(draft: LocalWorkItemDraft, closeIn?: string) {
    const factories = { createId, now: Date.now };
    const current = readState();
    const added = applyAddWorkItem(current, draft, factories);
    writeState(added.state);
    const workItemId = added.result;
    const undoToken = updateStateWithUndo((state) => {
      // Compared with the state before the item existed, so it reads as new.
      const mapped = withDescriptionTimelogs(current, state);
      return closeIn
        ? applyMoveBacklogItemToState(mapped, workItemId, closeIn, factories, {
            includeSubitems: false,
            sourceWrites: {},
          })
        : mapped;
    });
    return { workItemId, undoToken };
  },
  /**
   * Sets the item's project and task from its description's timelog, creating
   * or restoring the project and the task it needs, in a shared project too.
   * Returns an undo token, or null when nothing changed.
   */
  applyTimelogWithUndo(workItemId: string) {
    return updateStateWithUndo((state) =>
      applyItemTimelog(state, workItemId, {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Restores an archived backlog item, with the subitems its settle carried. */
  restoreWorkItem(workItemId: string) {
    updateState((state) => applyRestoreBacklogItem(state, workItemId));
  },
  /**
   * Settles a backlog item: a manual item is archived, a synced item becomes
   * settled. `change` records a pending write to the source. Stops and saves
   * its running entry. Returns an undo token, or null when nothing changed.
   */
  settleWorkItem(
    workItemId: string,
    change?: BacklogSettleChange,
    options?: CloseSubitemsOptions,
  ) {
    const before = readState();
    const token = updateStateWithUndo((state) =>
      applySettleBacklogItem(
        state,
        workItemId,
        { createId, now: Date.now },
        change,
        options,
      ),
    );
    describeSettle(before, readState(), workItemId, change, options);
    return token;
  },
  /**
   * Moves a backlog item to a workflow state. A done state closes it and
   * leaving one reopens it. `edits` are the backlog editor's other changes,
   * saved first and kept by Undo; their priority goes to the source when
   * `editsWriteToSource`, with the move's state when it writes one. What the
   * description's timelog then sets or creates shares the move's Undo.
   * Returns an undo token, or null when nothing changed.
   */
  moveWorkItemToState(
    workItemId: string,
    workflowStateId: string | undefined,
    options?: MoveBacklogItemOptions & {
      edits?: Parameters<typeof applyUpdateWorkItem>[2];
      editsWriteToSource?: boolean;
    },
  ) {
    const { edits, editsWriteToSource, ...moveOptions } = options ?? {};
    const before = readState();
    if (edits) {
      updateState((state) =>
        applyPatchBacklogItem(
          state,
          workItemId,
          edits,
          priorityWrite({ writesToSource: editsWriteToSource }, false),
        ),
      );
    }
    const moved = updateStateWithUndo((state) =>
      applyMoveBacklogItemToState(
        edits
          ? withDescriptionTimelogs(
              before,
              state,
              getMappedIds(workItemId, edits),
            )
          : state,
        workItemId,
        workflowStateId,
        { createId, now: Date.now },
        moveOptions,
      ),
    );
    describeMove(before, readState(), workItemId, moveOptions, moved !== null);
    return moved;
  },
  /**
   * Writes another source state of the item's workflow state, after the Undo
   * window. Returns an undo token, or null when nothing changed.
   */
  changeWorkItemSourceState(workItemId: string, sourceStatusLabel: string) {
    return updateStateWithUndo((state) =>
      applyChangeBacklogItemSourceState(
        state,
        workItemId,
        sourceStatusLabel,
        Date.now(),
      ),
    );
  },
  /** The settle's write reached the source. */
  completeSourceWrite(
    workItemId: string,
    sentItems?: readonly LocalWorkItem[],
  ) {
    updateState((state) => {
      const acknowledged = applyCompleteSourceWrite(
        state,
        workItemId,
        sentItems,
      );
      const next = reconcileSourceWriteMappings(state, acknowledged, {
        createId,
        now: Date.now,
      });
      if (sentItems && lastUndo) {
        lastUndo.undo = completeSourceWriteInUndo(
          lastUndo.undo,
          state,
          workItemId,
          sentItems,
        );
      }
      return next;
    });
  },
  /** Restores failed-write values and applies deferred workflow mappings. */
  failSourceWrite(workItemId: string) {
    updateState((state) =>
      reconcileSourceWriteMappings(
        state,
        applyFailSourceWrite(state, workItemId),
        { createId, now: Date.now },
      ),
    );
  },
  /**
   * Holds the item's pending write: its connection refused it because
   * editing work items is off. The item stays as the user left it.
   */
  holdSourceWrite(workItemId: string) {
    updateState((state) => applyHoldSourceWrite(state, workItemId, Date.now()));
  },
  /** The user approved the held write; it goes as any pending write. */
  releaseHeldSourceWrite(workItemId: string) {
    updateState((state) => applyReleaseHeldSourceWrite(state, workItemId));
  },
  /**
   * The user discarded the held write: nothing is sent, and the item goes
   * back to where it was, as after a write that failed.
   */
  discardHeldSourceWrite(workItemId: string) {
    updateState((state) => {
      const item = state.workItems.find(
        (candidate) => candidate._id === workItemId,
      );
      if (item?.pendingSourceWrite?.heldAt === undefined) return state;
      return reconcileSourceWriteMappings(
        state,
        applyFailSourceWrite(state, workItemId),
        { createId, now: Date.now },
      );
    });
  },
  /** Marks exactly the estimate fields a sync of the connection held. */
  markHeldEstimates(
    connection: { pluginId: string; connectionId: string },
    held: readonly HeldEstimates[],
  ) {
    updateState((state) =>
      applyMarkHeldEstimates(state, connection, held, Date.now()),
    );
  },
  /** Holds every estimate change of the connection, as editing turns on. */
  holdPendingEstimates(connection: { pluginId: string; connectionId: string }) {
    updateState((state) =>
      applyHoldPendingEstimates(state, connection, Date.now()),
    );
  },
  /** The user approved a held estimate; the next sync uploads it. */
  releaseHeldEstimate(
    workItemId: string,
    fieldKey: LocalWorkItemEstimateFieldKey,
  ) {
    updateState((state) =>
      applyReleaseHeldEstimate(state, workItemId, fieldKey),
    );
  },
  /** The user discarded a held estimate; the source's value comes back. */
  discardHeldEstimate(
    workItemId: string,
    fieldKey: LocalWorkItemEstimateFieldKey,
  ) {
    updateState((state) =>
      applyDiscardHeldEstimate(state, workItemId, fieldKey),
    );
  },
  /** Applies a fixed change when items of the rule's source project settle. */
  applySettleRule(rule: LocalSettleRule) {
    updateState((state) => applySettleRule(state, rule));
  },
  /** Puts a source project back to Ask, the settle dialog. */
  askSettleRule(
    key: Pick<LocalSettleRule, "source" | "connectionId" | "sourceProjectName">,
  ) {
    updateState((state) => askSettleRule(state, key));
  },
  /** Puts a settled backlog item back to active. Local, with no write. */
  unsettleWorkItem(workItemId: string) {
    updateState((state) => applyUnsettleBacklogItem(state, workItemId));
  },
  /** Snoozes a backlog item until `until`. Returns an undo token, or null when nothing changed. */
  snoozeWorkItem(workItemId: string, until: number) {
    return updateStateWithUndo((state) =>
      applySnoozeBacklogItem(state, workItemId, until),
    );
  },
  unsnoozeWorkItem(workItemId: string) {
    updateState((state) => applyUnsnoozeBacklogItem(state, workItemId));
  },
  /** Pins an item to the top of the sidebar list. Unpin is its own undo. */
  pinWorkItem(workItemId: string) {
    updateState((state) => applyPinBacklogItem(state, workItemId, Date.now()));
  },
  unpinWorkItem(workItemId: string) {
    updateState((state) => applyUnpinBacklogItem(state, workItemId));
  },
  /** Clears the item's Returned mark when the user opens it. */
  markWorkItemOpened(workItemId: string) {
    updateState((state) =>
      applyMarkBacklogItemOpened(state, workItemId, Date.now()),
    );
  },
  /** Archives a backlog item. Returns an undo token, or null when nothing changed. */
  archiveWorkItem(workItemId: string) {
    return updateStateWithUndo((state) =>
      applyArchiveBacklogItem(state, workItemId, { createId, now: Date.now }),
    );
  },
  /**
   * Deletes a backlog item and its subitems. Returns an undo token, or null
   * when nothing changed.
   */
  deleteWorkItem(workItemId: string) {
    return updateStateWithUndo((state) =>
      applyDeleteWorkItem(state, workItemId),
    );
  },
  updateTimesheetEntry(
    entryId: string,
    values: {
      projectId?: string;
      taskId?: string;
      note?: string;
      durationMs: number;
    },
  ) {
    const entry = readState().timesheetEntries.find(
      (item) => item._id === entryId,
    );
    updateState((state) =>
      applyUpdateTimesheetEntry(state, entryId, values, {
        createId,
        now: Date.now,
      }),
    );
    describeEntryUpdate(entry, values);
  },
  /** Deletes an entry. Returns an undo token, or null when nothing changed. */
  deleteTimesheetEntry(entryId: string) {
    return updateStateWithUndo((state) =>
      applyDeleteTimesheetEntry(state, entryId),
    );
  },
  /** Deletes several entries with one undo token, or null when nothing changed. */
  deleteTimesheetEntries(entryIds: readonly string[]) {
    return updateStateWithUndo((state) =>
      applyDeleteTimesheetEntries(state, entryIds),
    );
  },
  /** Copies an entry to a day. Returns an undo token that removes the copy. */
  duplicateTimesheetEntry(
    entryId: string,
    values: {
      localDate: string;
      projectId?: string;
      taskId?: string;
      note?: string;
      durationMs: number;
    },
  ) {
    return updateStateWithUndo((state) =>
      applyDuplicateTimesheetEntry(state, entryId, values, {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Moves an entry to a day. Returns an undo token, or null when nothing changed. */
  moveTimesheetEntry(
    entryId: string,
    values: {
      localDate: string;
      projectId?: string;
      taskId?: string;
      note?: string;
      durationMs: number;
    },
  ) {
    return updateStateWithUndo((state) =>
      applyMoveTimesheetEntry(state, entryId, values, {
        createId,
        now: Date.now,
      }),
    );
  },
  /**
   * Pastes copied entries as new entries, or moves cut ones, in one change.
   * Returns an undo token, or null when nothing changed.
   */
  pasteTimesheetEntries(
    entries: readonly PastedTimesheetEntry[],
    mode: "copy" | "cut",
  ) {
    return updateStateWithUndo((state) =>
      applyPasteTimesheetEntries(state, entries, mode, {
        createId,
        now: Date.now,
      }),
    );
  },
  /**
   * Copies or moves several entries in one change, as `pasteTimesheetEntries`
   * does, and returns the entries that landed with the undo token: the copies
   * for `copy`, the moved entries for `cut`. Duplicate, Duplicate to… and
   * Move to… on a selection use it.
   */
  relocateTimesheetEntries(
    entries: readonly PastedTimesheetEntry[],
    mode: "copy" | "cut",
  ) {
    const { undoToken, result } = updateStateWithUndoResult((state) => {
      const relocated = applyRelocateTimesheetEntries(state, entries, mode, {
        createId,
        now: Date.now,
      });
      return { state: relocated.state, result: relocated.entryIds };
    });
    return { undoToken, entryIds: result };
  },
  /**
   * Drops dragged entries as one block on a day; see `dropTimesheetEntries`.
   * A move to another day returns an undo token and the entries that changed
   * day. A reorder within one day has no undo, like `reorderTimesheetEntries`,
   * and returns a null token.
   */
  dropTimesheetEntries(
    entryIds: readonly string[],
    localDate: string,
    targetIndex: number,
  ) {
    const factories = { createId, now: Date.now };
    const changesDay = entryIds.some((entryId) => {
      const entry = readState().timesheetEntries.find(
        (item) => item._id === entryId,
      );
      return entry !== undefined && entry.localDate !== localDate;
    });
    const drop = (state: LocalAppState) =>
      applyDropTimesheetEntries(
        state,
        { entryIds, localDate, targetIndex },
        factories,
      );
    if (!changesDay) {
      updateState((state) => drop(state).state);
      return { undoToken: null, movedIds: [] as string[] };
    }

    const { undoToken, result } = updateStateWithUndoResult((state) => {
      const dropped = drop(state);
      return { state: dropped.state, result: dropped.movedIds };
    });
    return { undoToken, movedIds: result };
  },
  /**
   * Undoes the action that returned `token`, if it is still the last one.
   * Restored records keep their ids, values, committed copies and order.
   */
  undo(token: string): UndoResult {
    if (lastUndo?.token !== token) {
      describeStoreCommand("undo.restore", { undo: { result: "expired" } });
      refuseStoreCommand("expired");
      return "expired";
    }

    const kept = lastUndo;
    const { undo } = kept;
    lastUndo = undefined;
    try {
      releaseTeamPushHold();
      const result = updateStateWithResult((state) => {
        const restored = restoreUndo(state, undo);
        if (restored.result === "stale") {
          refuseStoreCommand(restored.staleReason);
        }
        return {
          result: restored.result,
          state: reconcileSourceWriteMappings(state, restored.state, {
            createId,
            now: Date.now,
          }),
        };
      });
      if (result === "restored") countUndoChanges(undo);
      describeStoreCommand("undo.restore", { undo: { result } });
      return result;
    } catch (error) {
      // Another window wrote first. The refusal reloaded this window, so keep
      // the undo: a retry runs it against the fresh state, which says "stale"
      // only when the undo itself no longer applies.
      if (error instanceof StaleWindowError) lastUndo ??= kept;
      throw error;
    }
  },
  /** Drops the undo for `token` once its toast closes. A newer undo is kept. */
  forgetUndo(token: string) {
    if (lastUndo?.token === token) {
      lastUndo = undefined;
      releaseTeamPushHold();
    }
  },
  /**
   * Runs store commands as one undoable action, for callers such as agent
   * tools whose commands keep no undo of their own. The undo covers every
   * record the commands changed. Replaces the last undo, like any action.
   */
  runWithUndo<T>(run: () => T): { result: T; undoToken: string | null } {
    const before = readState();
    undoGroupDepth += 1;
    let result: T;
    try {
      result = run();
    } finally {
      undoGroupDepth -= 1;
    }
    const after = readState();
    if (after === before) return { result, undoToken: null };

    const undo = captureUndo(before, after);
    if (!undo) return { result, undoToken: null };
    const token = createId("undo");
    rememberUndo(token, undo);
    return { result, undoToken: token };
  },
  saveTimer(timerId: string) {
    const before = readState();
    const after = updateState((state) =>
      applySaveTimer(state, timerId, { createId, now: Date.now }),
    );
    describeTimerStop(before, after, timerId);
  },
  /**
   * Remembers that Ajour asked to commit the week of `weekOf`, so it never asks
   * again. Undo leaves it. See `domain/time/week-target-prompt.ts`.
   */
  markCommitPrompted(weekOf: string) {
    updateState((state) => applyMarkCommitPrompted(state, weekOf));
  },
  /**
   * Commits the changes of `entryIds`. See `markTimesheetEntriesCommitted`.
   * Returns an undo token, or null when nothing changed.
   */
  markTimesheetEntriesCommitted(entryIds: readonly string[]) {
    return updateStateWithUndo((state) =>
      applyMarkTimesheetEntriesCommitted(state, entryIds, Date.now),
    );
  },
  /**
   * Marks committed entries as not committed, so the Commit page lists them as
   * updated. See `markTimesheetEntryNotCommitted`. Returns an undo token, or null
   * when nothing changed.
   */
  markTimesheetEntriesNotCommitted(entryIds: readonly string[]) {
    return updateStateWithUndo((state) =>
      applyMarkTimesheetEntriesNotCommitted(state, entryIds),
    );
  },
  /**
   * Submits the week that holds `weekOf`: locks it. See `submitWeek`. Returns
   * the result with an undo token, null when Ajour refused.
   */
  submitWeek(weekOf: string) {
    const submitted = updateStateWithUndoResult((state) =>
      applySubmitWeek(state, weekOf, Date.now),
    );
    describeWeekSubmit(weekOf, submitted.result);
    return submitted;
  },
  /** Reopens a submitted week. Returns an undo token, or null when it was not submitted. */
  reopenWeek(weekOf: string) {
    return updateStateWithUndo((state) => applyReopenWeek(state, weekOf));
  },
  continueTimesheetEntry(entryId: string) {
    updateState((state) =>
      applyContinueTimesheetEntry(state, entryId, todayIsoDate(), {
        createId,
        now: Date.now,
      }),
    );
  },
  addSampleActivity(url: string, title: string) {
    updateState((state) => ({
      ...state,
      segments: [
        ...state.segments,
        buildSampleActivitySegment(state, url, title, {
          createId,
          now: Date.now,
        }),
      ],
    }));
  },
  importBrowserBuckets(buckets: BrowserActivityBucket[]) {
    updateState((state) =>
      applyImportBrowserBuckets(
        state,
        buckets,
        {
          mergeGapMs: defaultTeamSettings.mergeGapMs,
          microBlockThresholdMs: defaultTeamSettings.microBlockThresholdMs,
        },
        Date.now,
      ),
    );
  },
  setExtensionBridgeStatus(status: ExtensionBridgeStatus) {
    updateState((state) => ({
      ...state,
      extensionBridgeStatus: status,
    }));
  },
  getTimeline(
    localDate: string,
  ): TimelineMutationResult & { status: "local"; localDate: string } {
    return materializeTimeline(readState(), localDate, {
      mergeGapMs: defaultTeamSettings.mergeGapMs,
      microBlockThresholdMs: defaultTeamSettings.microBlockThresholdMs,
    });
  },
  upsertEditedBlock(block: ActivityBlockRecord) {
    updateState((state) => applyUpsertEditedBlock(state, block));
  },
  updateImportedBrowserDraft(
    draftId: string,
    patch: ImportedBrowserDraftPatch,
  ) {
    updateState((state) =>
      applyUpdateImportedBrowserDraft(state, draftId, patch),
    );
  },
  dismissBlock(block: ActivityBlockRecord) {
    updateState((state) => applyDismissActivityBlock(state, block));
  },
  dismissImportedBrowserDraft(draftId: string) {
    updateState((state) => applyDismissImportedBrowserDraft(state, draftId));
  },
  commitBlock(block: ActivityBlockRecord) {
    updateState((state) =>
      applyCommitActivityBlock(state, block, {
        createId,
        now: Date.now,
      }),
    );
  },
  commitImportedBrowserDraft(draftId: string) {
    updateState((state) =>
      applyCommitImportedBrowserDraft(state, draftId, {
        createId,
        now: Date.now,
      }),
    );
  },
  saveRuleFromBlock(block: TimelineRuleSeed) {
    updateState((state) =>
      applySaveRuleFromBlock(state, block, {
        createId,
        now: Date.now,
      }),
    );
  },
  saveRuleFromImportedBrowserDraft(draftId: string) {
    updateState((state) =>
      applySaveRuleFromImportedBrowserDraft(state, draftId, {
        createId,
        now: Date.now,
      }),
    );
  },
  setUserPreferences(preferences: Partial<UserPreferences>) {
    const before = readState().userPreferences;
    const after = updateState((state) => {
      const userPreferences = { ...state.userPreferences, ...preferences };
      return recordsEqual(userPreferences, state.userPreferences)
        ? state
        : { ...state, userPreferences };
    }).userPreferences;
    describeUserPreferences(before, after);
  },
};

/** A pull request change's event, by its type. */
export const PULL_REQUEST_COMMANDS = {
  open: "pull_request.open",
  settle: "pull_request.settle",
  unsettle: "pull_request.unsettle",
  snooze: "pull_request.snooze",
  unsnooze: "pull_request.unsnooze",
} as const satisfies Record<PullRequestCommand["type"], string>;

/** A backlog item command whose first argument is the item's ID. */
function backlogItemCommand<
  Name extends
    | "backlog_item.apply_timelog"
    | "backlog_item.restore"
    | "backlog_item.change_source_state"
    | "backlog_item.complete_source_write"
    | "backlog_item.fail_source_write"
    | "backlog_item.unsettle"
    | "backlog_item.snooze"
    | "backlog_item.unsnooze"
    | "backlog_item.pin"
    | "backlog_item.unpin"
    | "backlog_item.open"
    | "backlog_item.archive"
    | "backlog_item.delete"
    | "backlog_item.resolve_description"
    | "backlog_item.save_description",
>(name: Name) {
  return {
    name,
    fields: {
      backlog_item: {
        id: ([workItemId]: readonly [string, ...unknown[]]) => workItemId,
      },
    },
  };
}

/** A command whose first argument is a project ID. */
const projectIdFirst = {
  project: { id: ([projectId]: readonly [string, ...unknown[]]) => projectId },
};

/** A command whose first two arguments are a project ID and a task ID. */
const taskIdsFirst = {
  project: { id: ([projectId]: readonly [string, ...unknown[]]) => projectId },
  task: {
    id: ([, taskId]: readonly [string, string, ...unknown[]]) => taskId,
  },
};

/** The store's reads: they change nothing, so they emit no event. */
type StoreRead =
  "subscribe" | "snapshot" | "pendingUndoProjectIds" | "getTimeline";

/**
 * Each store command's wide event name, and how it reads its fields: from
 * its arguments before it runs (`fields`), and from its result after
 * (`resultFields`). Every command but the reads has a name, so a new command
 * without one fails to compile, and a field the catalog doesn't declare for
 * that name fails too. Commands whose fields need the state before and
 * after describe themselves through `lib/store-command-fields.ts`. The
 * catalog audit (`lib/wide-events-audit.test.ts`) runs every entry. See
 * docs/logging-strategy.md.
 */
export const STORE_COMMANDS = {
  syncPullRequests: {
    name: "pull_request.apply_sync",
    trigger: "system",
    fields: {
      plugin: { id: ([source]) => source.pluginId },
      connection: { id: ([source]) => source.connectionId },
      pull_request: {
        received_count: ([, result]) => result.pullRequests.length,
      },
    },
  },
  changePullRequest: {
    pick: (_id, command) => PULL_REQUEST_COMMANDS[command.type],
    fallback: "pull_request.change",
    fields: { pull_request: { id: ([id]) => id } },
  },
  acceptCalendarSuggestions: "suggestion.add",
  dismissCalendarSuggestions: {
    name: "suggestion.dismiss",
    fields: { suggestion: { count: ([suggestions]) => suggestions.length } },
  },
  hideCalendarMeeting: "event_rule.hide",
  forgetCalendarEventRule: {
    name: "event_rule.forget",
    fields: { event_rule: { id: ([ruleId]) => ruleId } },
  },
  removeConnectionCalendarData: "connection.delete",
  applyTeamSyncRound: {
    name: "team.apply_sync",
    trigger: "system",
    fields: { connection: { id: ([connectionId]) => connectionId } },
    resultFields: { team_sync: { result: (result) => result.kind } },
  },
  shareProjectWithTeam: "project.share",
  unshareProjectFromTeam: { name: "project.unshare", fields: projectIdFirst },
  resolveTeamArrival: {
    name: "team.resolve_arrival",
    fields: {
      connection: { id: ([connectionId]) => connectionId },
      team: {
        choice: ([, , choice]) =>
          choice.kind === "link" ? "link" : "add_separately",
      },
    },
    resultFields: { team: { result: (result) => result.kind } },
  },
  removeConnectionTeamData: "connection.delete",
  removeConnectionPullRequests: "connection.delete",
  createTeam: "team.create",
  addProject: {
    name: "project.create",
    resultFields: { project: { id: (projectId) => projectId } },
  },
  updateProject: {
    name: "project.update",
    fields: {
      project: {
        id: ([projectId]) => projectId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  updateProjectWithUndo: {
    name: "project.update",
    fields: {
      project: {
        id: ([projectId]) => projectId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  reorderProjects: {
    name: "project.reorder",
    fields: { project: { count: ([orderedIds]) => orderedIds.length } },
  },
  archiveProject: { name: "project.archive", fields: projectIdFirst },
  unarchiveProject: { name: "project.restore", fields: projectIdFirst },
  addProjectTask: { name: "task.create", fields: projectIdFirst },
  reorderProjectTask: { name: "task.reorder", fields: taskIdsFirst },
  reorderTimesheetEntries: {
    name: "time_entry.reorder",
    fields: {
      time_entry: {
        count: ([, orderedIds]) => orderedIds.length,
        to_day: ([localDate]) => localDate,
      },
    },
  },
  importProjectTasks: "task.import",
  importProjectWorkbookRows: "project.import",
  importProjectDataShapeProjects: "project.import",
  importProjectDataShapeTasks: "task.import",
  renameProjectTask: {
    name: "task.update",
    fields: {
      ...taskIdsFirst,
      task: { ...taskIdsFirst.task, changed_fields: () => ["name"] },
    },
  },
  updateProjectTask: {
    name: "task.update",
    fields: {
      ...taskIdsFirst,
      task: {
        ...taskIdsFirst.task,
        changed_fields: ([, , patch]) => Object.keys(patch),
      },
    },
  },
  setProjectTaskPinnedSlot: {
    name: "task.pin",
    fields: {
      ...taskIdsFirst,
      task: { ...taskIdsFirst.task, pinned_slot: ([, , slot]) => slot ?? null },
    },
  },
  setProjectTaskFavorite: {
    name: "task.favorite",
    fields: {
      ...taskIdsFirst,
      task: { ...taskIdsFirst.task, favorite: ([, , favorite]) => favorite },
    },
  },
  setProjectFavorite: {
    name: "project.favorite",
    fields: {
      project: {
        ...projectIdFirst.project,
        favorite: ([, favorite]) => favorite,
      },
    },
  },
  archiveProjectTask: { name: "task.archive", fields: taskIdsFirst },
  unarchiveProjectTask: { name: "task.restore", fields: taskIdsFirst },
  addWorkflowState: {
    name: "workflow_state.create",
    resultFields: { workflow_state: { id: (statusId) => statusId } },
  },
  updateWorkflowState: {
    name: "workflow_state.update",
    fields: {
      workflow_state: {
        id: ([statusId]) => statusId,
        done: ([, updates]) =>
          typeof updates === "object" ? updates.done : undefined,
      },
    },
  },
  deleteWorkflowState: {
    name: "workflow_state.delete",
    fields: { workflow_state: { id: ([statusId]) => statusId } },
  },
  autoMapSourceStates: { name: "workflow_state.auto_map", trigger: "system" },
  setWorkflowStateWriteRule: {
    name: "workflow_state.set_write_rule",
    fields: {
      workflow_state: {
        id: ([rule]) => rule.workflowStateId,
        write_rule: ([rule]) => rule.write?.kind ?? "cleared",
      },
    },
  },
  moveWorkflowState: {
    name: "workflow_state.move",
    fields: { workflow_state: { id: ([workflowStateId]) => workflowStateId } },
  },
  setWorkflowStateMapping: {
    name: "workflow_state.map",
    fields: {
      workflow_state: {
        id: ([mapping]) => mapping.workflowStateId ?? undefined,
      },
    },
    resultFields: {
      workflow_state: { closed_count: (result) => result.closedCount },
    },
  },
  startTimer: "time_entry.start",
  editRunningEntry: "time_entry.update",
  cancelTimer: "time_entry.discard",
  saveManualTimeEntry: "time_entry.create",
  stageTimesheetImportRows: "timesheet_import.stage",
  dismissTimesheetImportDraft: "timesheet_import.dismiss",
  dismissAllTimesheetImportDrafts: "timesheet_import.dismiss",
  commitTimesheetImportDraft: "timesheet_import.commit",
  commitReadyTimesheetImportDrafts: "timesheet_import.commit",
  addWorkItem: {
    name: "backlog_item.create",
    fields: {
      backlog_item: { parent_id: ([draft]) => draft.parentWorkItemId },
    },
    resultFields: { backlog_item: { id: (workItemId) => workItemId } },
  },
  addSubtask: {
    name: "backlog_item.create",
    fields: { backlog_item: { parent_id: ([parentId]) => parentId } },
    resultFields: { backlog_item: { id: (workItemId) => workItemId } },
  },
  importSyncedWorkItems: "backlog_import.commit",
  archiveDoneSyncedWorkItems: {
    name: "backlog.archive_done",
    trigger: "system",
    fields: {
      backlog_import: { candidate_count: ([doneItems]) => doneItems.length },
    },
    resultFields: {
      backlog_import: { archived_count: (archived) => archived },
    },
  },
  returnItemsWithNewComments: {
    name: "backlog_item.return",
    trigger: "system",
  },
  applyBacklogSyncWorkItemUpdates: {
    name: "backlog.apply_updates",
    trigger: "system",
    fields: {
      backlog_import: { candidate_count: ([updates]) => updates.length },
    },
  },
  keepLocalEstimateConflict: {
    name: "backlog_item.resolve_estimate",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        estimate_resolution: () => "keep_local",
      },
    },
  },
  takeSourceDescriptionWithUndo: backlogItemCommand(
    "backlog_item.resolve_description",
  ),
  updateSyncedDescription: backlogItemCommand("backlog_item.save_description"),
  acceptRemoteEstimateValue: {
    name: "backlog_item.resolve_estimate",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        estimate_resolution: () => "accept_source",
      },
    },
  },
  dismissEstimateIssue: {
    name: "backlog_item.resolve_estimate",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        estimate_resolution: () => "dismiss",
      },
    },
  },
  reorderWorkItems: {
    name: "backlog_item.reorder",
    fields: { backlog_item: { count: ([orderedIds]) => orderedIds.length } },
  },
  reorderWorkItemsWithUndo: {
    name: "backlog_item.reorder",
    fields: { backlog_item: { count: ([orderedIds]) => orderedIds.length } },
  },
  setBacklogSortMode: {
    name: "backlog.sort",
    fields: { backlog: { sort_mode: ([mode]) => mode } },
  },
  updateWorkItem: {
    name: "backlog_item.update",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  updateWorkItemWithUndo: {
    name: "backlog_item.update",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  saveWorkItemEdits: {
    name: "backlog_item.update",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  saveWorkItemDescriptionText: {
    name: "backlog_item.update",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        changed_fields: () => ["description"],
      },
    },
  },
  applyWorkItemEditsSince: {
    name: "backlog_item.update",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        changed_fields: ([, patch]) => Object.keys(patch),
      },
    },
  },
  saveNewWorkItem: {
    name: "backlog_item.create",
    fields: {
      backlog_item: {
        parent_id: ([draft]) => draft.parentWorkItemId,
        closed: ([, closeIn]) => closeIn !== undefined,
      },
    },
    resultFields: { backlog_item: { id: (result) => result.workItemId } },
  },
  applyTimelogWithUndo: backlogItemCommand("backlog_item.apply_timelog"),
  restoreWorkItem: backlogItemCommand("backlog_item.restore"),
  settleWorkItem: "backlog_item.settle",
  moveWorkItemToState: "backlog_item.move",
  changeWorkItemSourceState: backlogItemCommand(
    "backlog_item.change_source_state",
  ),
  completeSourceWrite: {
    ...backlogItemCommand("backlog_item.complete_source_write"),
    trigger: "system",
  },
  failSourceWrite: {
    ...backlogItemCommand("backlog_item.fail_source_write"),
    trigger: "system",
  },
  holdSourceWrite: {
    name: "backlog_item.hold_edit",
    trigger: "system",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "settle",
      },
    },
  },
  markHeldEstimates: {
    name: "backlog_item.hold_edit",
    trigger: "system",
    fields: {
      backlog_item: {
        count: ([, held]) => held.length,
        held_edit: () => "estimate",
      },
    },
  },
  holdPendingEstimates: {
    name: "backlog_item.hold_edit",
    fields: { backlog_item: { held_edit: () => "estimate" } },
  },
  releaseHeldSourceWrite: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "settle",
        held_decision: () => "send",
      },
    },
  },
  holdDescription: {
    name: "backlog_item.hold_edit",
    trigger: "system",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "description",
      },
    },
  },
  discardHeldSourceWrite: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "settle",
        held_decision: () => "discard",
      },
    },
  },
  releaseHeldDescription: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "description",
        held_decision: () => "send",
      },
    },
  },
  discardHeldDescription: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "description",
        held_decision: () => "discard",
      },
    },
  },
  releaseHeldEstimate: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "estimate",
        held_decision: () => "send",
      },
    },
  },
  discardHeldEstimate: {
    name: "backlog_item.review_held_edit",
    fields: {
      backlog_item: {
        id: ([workItemId]) => workItemId,
        held_edit: () => "estimate",
        held_decision: () => "discard",
      },
    },
  },
  applySettleRule: {
    name: "settle_rule.set",
    fields: { settle_rule: { mode: () => "apply" } },
  },
  askSettleRule: {
    name: "settle_rule.set",
    fields: { settle_rule: { mode: () => "ask" } },
  },
  unsettleWorkItem: backlogItemCommand("backlog_item.unsettle"),
  snoozeWorkItem: backlogItemCommand("backlog_item.snooze"),
  unsnoozeWorkItem: backlogItemCommand("backlog_item.unsnooze"),
  pinWorkItem: backlogItemCommand("backlog_item.pin"),
  unpinWorkItem: backlogItemCommand("backlog_item.unpin"),
  markWorkItemOpened: backlogItemCommand("backlog_item.open"),
  archiveWorkItem: backlogItemCommand("backlog_item.archive"),
  deleteWorkItem: backlogItemCommand("backlog_item.delete"),
  updateTimesheetEntry: "time_entry.update",
  deleteTimesheetEntry: {
    name: "time_entry.delete",
    fields: { time_entry: { count: () => 1 } },
  },
  deleteTimesheetEntries: {
    name: "time_entry.delete",
    fields: { time_entry: { count: ([entryIds]) => entryIds.length } },
  },
  duplicateTimesheetEntry: {
    name: "time_entry.duplicate",
    fields: {
      time_entry: {
        count: () => 1,
        mode: () => "copy",
        to_day: ([, values]) => values.localDate,
      },
    },
  },
  moveTimesheetEntry: {
    name: "time_entry.move",
    fields: {
      time_entry: {
        count: () => 1,
        mode: () => "cut",
        to_day: ([, values]) => values.localDate,
      },
    },
  },
  pasteTimesheetEntries: {
    name: "time_entry.paste",
    fields: {
      time_entry: {
        count: ([entries]) => entries.length,
        mode: ([, mode]) => mode,
      },
    },
  },
  relocateTimesheetEntries: {
    pick: (_entries, mode) =>
      mode === "copy" ? "time_entry.duplicate" : "time_entry.move",
    fallback: "time_entry.move",
    fields: {
      time_entry: {
        count: ([entries]) => entries.length,
        mode: ([, mode]) => mode,
      },
    },
  },
  dropTimesheetEntries: {
    name: "time_entry.drop",
    fields: {
      time_entry: {
        count: ([entryIds]) => entryIds.length,
        to_day: ([, localDate]) => localDate,
      },
    },
  },
  undo: "undo.restore",
  forgetUndo: { name: "undo.expire", trigger: "system" },
  // Only agent tools group their writes under one Undo today.
  runWithUndo: { name: UNDO_GROUP, trigger: "agent" },
  saveTimer: "time_entry.stop",
  markCommitPrompted: {
    name: "week.prompt_commit",
    fields: { week: { week_of: ([weekOf]) => weekOf } },
  },
  markTimesheetEntriesCommitted: {
    name: "time_entry.commit",
    fields: { time_entry: { count: ([entryIds]) => entryIds.length } },
  },
  markTimesheetEntriesNotCommitted: {
    name: "time_entry.uncommit",
    fields: { time_entry: { count: ([entryIds]) => entryIds.length } },
  },
  submitWeek: "week.submit",
  reopenWeek: {
    name: "week.reopen",
    fields: { week: { week_of: ([weekOf]) => weekOf } },
  },
  continueTimesheetEntry: {
    name: "time_entry.continue",
    fields: { time_entry: { id: ([entryId]) => entryId } },
  },
  addSampleActivity: "timeline.import",
  importBrowserBuckets: "timeline.import",
  setExtensionBridgeStatus: { name: "timeline.update", trigger: "system" },
  upsertEditedBlock: "timeline.update",
  updateImportedBrowserDraft: "timeline.update",
  dismissBlock: "timeline.dismiss",
  dismissImportedBrowserDraft: "timeline.dismiss",
  commitBlock: "timeline.commit",
  commitImportedBrowserDraft: "timeline.commit",
  saveRuleFromBlock: "timeline.save_rule",
  saveRuleFromImportedBrowserDraft: "timeline.save_rule",
  setUserPreferences: "preferences.update",
} satisfies StoreCommandTable<typeof store, StoreRead>;

/**
 * The local store. Each command emits one wide event, named from
 * `STORE_COMMANDS`; a command run inside another unit folds into it.
 */
export const localStore = instrumentStoreCommands(store, STORE_COMMANDS);

type Store = typeof store;
type StoreCommandKey = keyof typeof STORE_COMMANDS;
/** The event names a store command can take. */
type CommandNameOf<Key extends StoreCommandKey> = SpecName<
  (typeof STORE_COMMANDS)[Key]
>;
type CommandOf<Key extends StoreCommandKey> = Store[Key] extends (
  ...args: infer Args
) => infer Result
  ? { args: Args; result: Result }
  : never;
type AnySpec = StoreCommandSpec<(...args: never[]) => unknown>;

/**
 * Runs the store command `key` with `args`, and lets the code around it add
 * what only it knows to the command's event, such as where the entry form
 * sits. `extend` runs inside the event, after the command. Because the
 * command is the one named, its own fields always land on that event.
 */
export function runStoreCommandWith<Key extends StoreCommandKey>(
  key: Key,
  args: CommandOf<Key>["args"],
  extend: (
    unit: StoreCommandUnit<CommandNameOf<Key>>,
    result: CommandOf<Key>["result"],
  ) => void,
): CommandOf<Key>["result"] {
  const spec = STORE_COMMANDS[key] as AnySpec;
  const command = localStore[key] as unknown as (
    ...args: CommandOf<Key>["args"]
  ) => CommandOf<Key>["result"];
  return runStoreCommand(
    resolveCommandName(spec, args) as CommandNameOf<Key>,
    (unit) => {
      const result = command.apply(localStore, args);
      extend(unit, result);
      return result;
    },
    (typeof spec === "object" && spec.trigger) || "user",
  );
}

/**
 * Opens the event of the store command `key` for a workflow that awaits
 * before it runs it, such as a move that asks about subitems first. The
 * workflow runs the command inside the handle's `enter`, never
 * `unit.enter()`: only the writes made inside `enter` count as the
 * command's own, so a command run through `unit.enter()` would report a
 * real write as `noop`. It calls `finish` once in every path.
 */
export function startStoreCommandFor<Key extends StoreCommandKey>(key: Key) {
  const spec = STORE_COMMANDS[key] as AnySpec;
  return startStoreCommand(
    resolveCommandName(spec, []) as CommandNameOf<Key>,
    (typeof spec === "object" && spec.trigger) || "user",
  );
}
