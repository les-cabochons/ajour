import {
  BUILT_IN_PROJECT_DATA_SHAPE_ID,
  type ActivityBlockRecord,
  type BrowserActivityBucket,
  type CaptureSettings,
  type TeamSettings,
} from "@ajour/shared";
import { todayIsoDate } from "@/lib/utils";
import {
  changePullRequest,
  normalizePullRequests,
  reattachPullRequests,
  reconcilePullRequests,
  type PullRequestCommand,
} from "@/domain/pull-requests/pull-request-lifecycle";
import type { CodeHostSyncResult } from "@ajour/shared";
import type {
  ConnectorImportCandidate,
  ConnectorDoneWorkItem,
  ConnectorSyncWorkItemUpdate,
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
  type CloseSubitemsOptions,
  type MoveBacklogItemOptions,
  changeBacklogItemSourceState as applyChangeBacklogItemSourceState,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  applySettleRule,
  askSettleRule,
  normalizeSettleRules,
} from "@/domain/backlog/settle-rules";
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
  applyConnectorSyncWorkItemUpdates as applyConnectorWorkItemUpdates,
  archiveDoneConnectorWorkItems,
  importConnectorWorkItems as applyConnectorWorkItemImport,
} from "@/domain/backlog/work-item-connector";
import { type ProjectTaskImportResult } from "@/domain/projects/task-import";
import {
  deleteTimesheetEntries as applyDeleteTimesheetEntries,
  deleteTimesheetEntry as applyDeleteTimesheetEntry,
  duplicateTimesheetEntry as applyDuplicateTimesheetEntry,
  markTimesheetEntriesCommitted as applyMarkTimesheetEntriesCommitted,
  markTimesheetEntryNotCommitted as applyMarkTimesheetEntryNotCommitted,
  moveTimesheetEntry as applyMoveTimesheetEntry,
  normalizeTimesheetEntry,
  pasteTimesheetEntries as applyPasteTimesheetEntries,
  type PastedTimesheetEntry,
  reorderTimesheetEntries as applyReorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry as applyUpdateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { normalizeTimesheetTombstones } from "@/domain/time/timesheet-commit";
import {
  captureUndo,
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
  importProjectTasks as applyProjectTaskImport,
  importProjectWorkbookRows as applyProjectWorkbookImport,
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
  setProjectTaskPinnedSlot as applySetProjectTaskPinnedSlot,
  setProjectTaskStatus,
  updateProject as applyUpdateProject,
  updateProjectTask as applyUpdateProjectTask,
  type ProjectTaskPatch,
} from "@/domain/projects/project-transitions";
import { normalizeTeamConnections } from "@/domain/projects/team-link";
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
const STATE_CHANGE_EVENT = "ajour-local-state";
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
    timesheetImportDrafts: [],
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
    // Connector plugins map priority values to levels now.
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
      timesheetImportDrafts: arrayOrDefault(
        persistedState.timesheetImportDrafts,
        defaults.timesheetImportDrafts,
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

function shouldBootstrapFromDesktopState(
  currentState: Partial<LocalAppState> | undefined,
  bootstrapState: Partial<LocalAppState> | null | undefined,
) {
  if (!bootstrapState || currentState?.desktopBootstrapAppliedAt) {
    return false;
  }

  const bootstrapTimesheetCount = bootstrapState.timesheetEntries?.length ?? 0;
  const currentTimesheetCount = currentState?.timesheetEntries?.length ?? 0;
  if (currentTimesheetCount === 0 && bootstrapTimesheetCount > 0) {
    return true;
  }

  const currentHasDefaultProjects = hasOnlyDefaultProjects(
    currentState?.projects,
  );
  const bootstrapHasCustomProjects =
    Array.isArray(bootstrapState.projects) &&
    bootstrapState.projects.length > 0 &&
    !hasOnlyDefaultProjects(bootstrapState.projects);
  return currentHasDefaultProjects && bootstrapHasCustomProjects;
}

function mergeDesktopBootstrapState(
  currentState: Partial<LocalAppState> | undefined,
  bootstrapState: Partial<LocalAppState>,
) {
  const nextState = {
    ...(currentState ?? {}),
  };

  if ((bootstrapState.timesheetEntries?.length ?? 0) > 0) {
    nextState.timesheetEntries = mergeBootstrapTimesheetEntries(
      nextState.timesheetEntries,
      bootstrapState.timesheetEntries,
    );
  }
  if (
    (nextState.timers?.length ?? 0) === 0 &&
    (bootstrapState.timers?.length ?? 0) > 0
  ) {
    nextState.timers = bootstrapState.timers;
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
  const bootstrapState = window.ajourDesktop?.bootstrapLocalState;
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return normalizeState(bootstrapState ?? createDefaultState());
  }
  if (!stored) {
    return normalizeState(
      bootstrapState
        ? {
            ...bootstrapState,
            desktopBootstrapAppliedAt: Date.now(),
          }
        : createDefaultState(),
    );
  }

  let parsedState: Partial<LocalAppState>;
  try {
    parsedState = JSON.parse(stored) as Partial<LocalAppState>;
  } catch {
    return normalizeState(bootstrapState ?? createDefaultState());
  }

  if (shouldBootstrapFromDesktopState(parsedState, bootstrapState)) {
    const mergedState = normalizeState(
      mergeDesktopBootstrapState(parsedState, bootstrapState!),
    );
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedState));
    } catch {
      // Keep the complete merged state in memory when persistence is unavailable.
    }
    return mergedState;
  }
  try {
    const normalizedState = normalizeState(parsedState);
    if (containsRetiredOutlookState(parsedState)) {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) === stored) {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(normalizedState),
          );
        }
      } catch {
        // Keep the sanitized state in memory when persistence is unavailable.
      }
    }
    return normalizedState;
  } catch {
    return normalizeState(bootstrapState ?? createDefaultState());
  }
}

function readState(): LocalAppState {
  cachedState ??= loadState();
  return cachedState;
}

function refreshState(): LocalAppState {
  cachedState = loadState();
  return cachedState;
}

function writeState(state: LocalAppState) {
  const nextState = { ...state, updatedAt: Date.now() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  cachedState = nextState;
  window.dispatchEvent(new Event(STATE_CHANGE_EVENT));
}

function updateState(
  mutator: (state: LocalAppState) => LocalAppState,
): LocalAppState {
  const current = readState();
  const next = mutator(current);
  if (next !== current) {
    writeState(next);
  }
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
  if (state !== current) {
    writeState(state);
  }
  return result;
}

/**
 * The last undoable action. Only one action can be undone, so a new one
 * replaces it. It lives in memory: the Undo toast does not survive a reload.
 */
let lastUndo: { token: string; undo: LocalStateUndo } | undefined;

/**
 * Applies an undoable action and remembers what it changed. Returns the token
 * that Undo passes back, or null when the action changed nothing.
 */
function updateStateWithUndo(
  mutator: (state: LocalAppState) => LocalAppState,
): string | null {
  const current = readState();
  const next = mutator(current);
  if (next === current) {
    return null;
  }

  writeState(next);
  const undo = captureUndo(current, next);
  if (!undo) {
    return null;
  }

  const token = createId("undo");
  lastUndo = { token, undo };
  return token;
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
      refreshState();
      window.dispatchEvent(new Event(STATE_CHANGE_EVENT));
    }
  });
}

export const localStore = {
  subscribe(callback: () => void) {
    listenForOtherWindowWrites();
    window.addEventListener(STATE_CHANGE_EVENT, callback);
    return () => window.removeEventListener(STATE_CHANGE_EVENT, callback);
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
  removeConnectionPullRequests(pluginId: string, connectionId: string) {
    return updateState((state) => ({
      ...state,
      pullRequests: (state.pullRequests ?? []).filter(
        (item) =>
          item.pluginId !== pluginId || item.connectionId !== connectionId,
      ),
    }));
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
    return updateStateWithResult((state) => {
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
  },
  importProjectWorkbookRows(rows: ProjectTransferRow[]) {
    return updateStateWithResult<ProjectWorkbookImportResult>((state) => {
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
    });
  },
  importProjectDataShapeProjects(projects: ProjectDataShapeImportProject[]) {
    return updateStateWithResult<ProjectWorkbookImportResult>((state) => {
      const operation = applyProjectDataShapeImport(state.projects, projects, {
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
    });
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
    updateState((state) =>
      applyStartTimer(state, timer, todayIsoDate(), {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Saves the running entry's form. It keeps running. */
  editRunningEntry(timerId: string, edit: RunningEntryEdit) {
    updateState((state) =>
      applyEditRunningEntry(state, timerId, edit, { now: Date.now }),
    );
  },
  /** Discards the running entry. Returns an undo token, or null when nothing changed. */
  cancelTimer(timerId: string) {
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
    updateState((state) =>
      saveManualTimesheetEntry(state, values, {
        createId,
        now: Date.now,
      }),
    );
  },
  stageTimesheetImportRows(rows: TimesheetImportRow[]) {
    updateState((state) =>
      applyStageTimesheetImportRows(state, rows, {
        createId,
        now: Date.now,
      }),
    );
  },
  /** Dismisses one import draft. Returns an undo token, or null when nothing changed. */
  dismissTimesheetImportDraft(draftId: string) {
    return updateStateWithUndo((state) =>
      applyDismissTimesheetImportDraft(state, draftId),
    );
  },
  /** Dismisses every import draft. Returns an undo token, or null when there were none. */
  dismissAllTimesheetImportDrafts() {
    return updateStateWithUndo((state) =>
      applyClearTimesheetImportDrafts(state),
    );
  },
  commitTimesheetImportDraft(draftId: string) {
    updateState((state) =>
      applyCommitTimesheetImportDraft(state, draftId, {
        createId,
        now: Date.now,
      }),
    );
  },
  commitReadyTimesheetImportDrafts() {
    updateState((state) =>
      applyCommitReadyTimesheetImportDrafts(state, {
        createId,
        now: Date.now,
      }),
    );
  },
  addWorkItem(workItem: LocalWorkItemDraft) {
    return updateStateWithResult((state) =>
      applyAddWorkItem(state, workItem, {
        createId,
        now: Date.now,
      }),
    );
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
  importConnectorWorkItems(
    workItems: ConnectorImportCandidate[],
    options?: {
      archiveMissingFromConnectionId?: string;
    },
  ) {
    return updateStateWithResult((state) =>
      applyConnectorWorkItemImport(
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
      ),
    );
  },
  /** Archives the synced items a sync reports in a done category. */
  archiveDoneConnectorWorkItems(doneItems: ConnectorDoneWorkItem[]) {
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
      const result = archiveDoneConnectorWorkItems(mapped, doneItems, {
        createId,
        now: Date.now,
      });
      const next = applyWorkflowStateLifecycle(state, result.state, {
        createId,
        now: Date.now,
      });
      const newlyClosed = next.workItems.filter(
        (item) =>
          item.status === "archived" &&
          result.state.workItems.find((before) => before._id === item._id)
            ?.status !== "archived",
      ).length;
      return { state: next, result: result.archivedCount + newlyClosed };
    });
  },
  applyConnectorSyncWorkItemUpdates(updates: ConnectorSyncWorkItemUpdate[]) {
    if (updates.length === 0) {
      return;
    }

    updateState((state) =>
      applyConnectorWorkItemUpdates(state, updates, Date.now),
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
    updateState((state) => applyUpdateWorkItem(state, workItemId, patch));
  },
  updateWorkItemWithUndo(
    workItemId: string,
    patch: Parameters<typeof applyUpdateWorkItem>[2],
    orderedIds?: string[],
  ) {
    return updateStateWithUndo((state) => {
      const updated = applyUpdateWorkItem(state, workItemId, patch);
      return orderedIds ? applyReorderWorkItems(updated, orderedIds) : updated;
    });
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
    return updateStateWithUndo((state) =>
      applySettleBacklogItem(
        state,
        workItemId,
        { createId, now: Date.now },
        change,
        options,
      ),
    );
  },
  /**
   * Moves a backlog item to a workflow state. A done state closes it and
   * leaving one reopens it. Returns an undo token, or null when nothing changed.
   */
  moveWorkItemToState(
    workItemId: string,
    workflowStateId: string | undefined,
    options?: MoveBacklogItemOptions,
  ) {
    return updateStateWithUndo((state) =>
      applyMoveBacklogItemToState(
        state,
        workItemId,
        workflowStateId,
        { createId, now: Date.now },
        options,
      ),
    );
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
    updateState((state) =>
      applyUpdateTimesheetEntry(state, entryId, values, {
        createId,
        now: Date.now,
      }),
    );
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
   * Undoes the action that returned `token`, if it is still the last one.
   * Restored records keep their ids, values, committed copies and order.
   */
  undo(token: string): UndoResult {
    if (lastUndo?.token !== token) {
      return "expired";
    }

    const { undo } = lastUndo;
    lastUndo = undefined;
    return updateStateWithResult((state) => {
      const restored = restoreUndo(state, undo);
      return {
        ...restored,
        state: reconcileSourceWriteMappings(state, restored.state, {
          createId,
          now: Date.now,
        }),
      };
    });
  },
  /** Drops the undo for `token` once its toast closes. A newer undo is kept. */
  forgetUndo(token: string) {
    if (lastUndo?.token === token) {
      lastUndo = undefined;
    }
  },
  /**
   * Runs store commands as one undoable action, for callers such as agent
   * tools whose commands keep no undo of their own. The undo covers every
   * record the commands changed. Replaces the last undo, like any action.
   */
  runWithUndo<T>(run: () => T): { result: T; undoToken: string | null } {
    const before = readState();
    const result = run();
    const after = readState();
    if (after === before) return { result, undoToken: null };

    const undo = captureUndo(before, after);
    if (!undo) return { result, undoToken: null };
    const token = createId("undo");
    lastUndo = { token, undo };
    return { result, undoToken: token };
  },
  saveTimer(timerId: string) {
    updateState((state) =>
      applySaveTimer(state, timerId, { createId, now: Date.now }),
    );
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
   * Drops a committed entry's committed copy. See `markTimesheetEntryNotCommitted`.
   * Returns an undo token, or null when nothing changed.
   */
  markTimesheetEntryNotCommitted(entryId: string) {
    return updateStateWithUndo((state) =>
      applyMarkTimesheetEntryNotCommitted(state, entryId),
    );
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
    updateState((state) => ({
      ...state,
      userPreferences: {
        ...state.userPreferences,
        ...preferences,
      },
    }));
  },
};
