import {
  BUILT_IN_PROJECT_DATA_SHAPE_ID,
  type ActivityBlockRecord,
  type BrowserActivityBucket,
  type CaptureSettings,
  type TeamSettings,
} from "@timetracker/shared";
import type {
  ConnectorImportCandidate,
  ConnectorSyncWorkItemUpdate,
  ProjectDataShapeImportProject,
} from "@timetracker/shared";
import {
  addBacklogStatus as applyAddBacklogStatus,
  deleteBacklogStatus as applyDeleteBacklogStatus,
  normalizeBacklogStatuses,
  reconcileImportedBacklogStatuses,
  setBacklogStatusMapping as applyBacklogStatusMapping,
  updateBacklogStatus as applyUpdateBacklogStatus,
  type BacklogStatusMappingInput,
} from "@/domain/backlog/backlog-status";
import {
  acceptRemoteEstimateValue as applyAcceptRemoteEstimateValue,
  addWorkItem as applyAddWorkItem,
  deleteWorkItem as applyDeleteWorkItem,
  dismissEstimateIssue as applyDismissEstimateIssue,
  keepLocalEstimateConflict as applyKeepLocalEstimateConflict,
  normalizePersistedWorkItem,
  reorderWorkItems as applyReorderWorkItems,
  setBacklogSortMode as applyBacklogSortMode,
  setWorkItemStatus as applyWorkItemStatus,
  updateWorkItem as applyUpdateWorkItem,
} from "@/domain/backlog/work-item-transitions";
import {
  applyConnectorSyncWorkItemUpdates as applyConnectorWorkItemUpdates,
  importConnectorWorkItems as applyConnectorWorkItemImport,
} from "@/domain/backlog/work-item-connector";
import {
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";
import {
  deleteTimesheetEntry as applyDeleteTimesheetEntry,
  markTimesheetEntriesSubmitted as applyMarkTimesheetEntriesSubmitted,
  normalizeTimesheetEntry,
  reorderTimesheetEntries as applyReorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry as applyUpdateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import {
  clearTimesheetImportDrafts as applyClearTimesheetImportDrafts,
  commitReadyTimesheetImportDrafts as applyCommitReadyTimesheetImportDrafts,
  commitTimesheetImportDraft as applyCommitTimesheetImportDraft,
  dismissTimesheetImportDraft as applyDismissTimesheetImportDraft,
  stageTimesheetImportRows as applyStageTimesheetImportRows,
  type TimesheetImportRow,
} from "@/domain/time/timesheet-import";
import {
  cancelTimer as applyCancelTimer,
  normalizeTimer,
  restartTimesheetEntry as applyRestartTimesheetEntry,
  saveTimer as applySaveTimer,
  startTimer as applyStartTimer,
  startTimerWithEntry as applyStartTimerWithEntry,
  updateTimer as applyUpdateTimer,
  type StartTimerWithEntryValues,
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
  setProjectTaskStatus,
  updateProject as applyUpdateProject,
  updateProjectTask as applyUpdateProjectTask,
} from "@/domain/projects/project-transitions";
import type {
  BacklogSortMode,
  ExtensionBridgeStatus,
  LocalAppState,
  LocalBacklogStatusMapping,
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalTeam,
  LocalTimer,
  LocalTimerDraft,
  LocalTimesheetEntry,
  LocalWorkItem,
  LocalWorkItemDraft,
  LocalWorkItemEstimateFieldConflict,
  LocalWorkItemEstimateFieldKey,
  PersistedLocalWorkItem,
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
  LocalBacklogStatus,
  LocalBacklogStatusMapping,
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

const STORAGE_KEY = "timetracker.local-state.v2";
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
};

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
      email: "local-only@timetracker.dev",
    },
    projects: [],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    workItems: [],
    backlogStatuses: [],
    backlogStatusMappings: [],
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
    ...persistedState
  } = state as Partial<LocalAppState> & {
    activityLoggerEnabled?: boolean;
    outlookIntegration?: unknown;
    outlookMeetingDrafts?: unknown;
  };
  const rawWorkItems = arrayOrDefault<PersistedLocalWorkItem>(
    persistedState.workItems,
    defaults.workItems,
  );
  const workItems = rawWorkItems.map((workItem) =>
    normalizePersistedWorkItem(workItem, Date.now),
  );
  const backlogStatuses = normalizeBacklogStatuses(
    arrayOrDefault(persistedState.backlogStatuses, defaults.backlogStatuses),
    Date.now,
  );
  const backlogStatusMappings = arrayOrDefault(
    persistedState.backlogStatusMappings,
    defaults.backlogStatusMappings,
  ).filter((mapping): mapping is LocalBacklogStatusMapping =>
    Boolean(
      mapping?.source &&
      mapping.connectionId &&
      mapping.sourceStatusKey &&
      mapping.backlogStatusId,
    ),
  );
  const persistedBacklogSortMode = persistedState.backlogSortMode as
    | BacklogSortMode
    | "priority"
    | undefined;
  const backlogSortMode =
    persistedBacklogSortMode === "priority"
      ? "priority_asc"
      : (persistedBacklogSortMode ?? defaults.backlogSortMode);

  return ensureLocalWorkspace(
    reconcileImportedBacklogStatuses({
      ...defaults,
      ...persistedState,
      user: {
        ...defaults.user,
        ...persistedState.user,
      },
      projects: arrayOrDefault(
        persistedState.projects,
        defaults.projects,
      ).map((project) => normalizeProject(project, Date.now)),
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
      timers: arrayOrDefault(persistedState.timers, defaults.timers).map((timer) =>
        normalizeTimer(timer),
      ),
      timesheetEntries: arrayOrDefault(
        persistedState.timesheetEntries,
        defaults.timesheetEntries,
      ).map((entry) => normalizeTimesheetEntry(entry)),
      timesheetImportDrafts: arrayOrDefault(
        persistedState.timesheetImportDrafts,
        defaults.timesheetImportDrafts,
      ),
      workItems,
      backlogStatuses,
      backlogStatusMappings,
      backlogSortMode,
      capture: {
        ...defaults.capture,
        ...persistedState.capture,
        blockedDomains:
          arrayOrDefault(
            persistedState.capture?.blockedDomains,
            defaults.capture.blockedDomains,
          ),
        sensitiveDomains:
          arrayOrDefault(
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
      name: "harday",
      slug: "harday",
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
      const retiredKeys = Array.from(
        { length: storage.length },
        (_, index) => storage.key(index),
      ).filter(
        (key): key is string =>
          key?.toLowerCase().startsWith(RETIRED_AUTH_CACHE_PREFIX) ===
          true,
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
  const bootstrapState = window.timetrackerDesktop?.bootstrapLocalState;
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
  window.dispatchEvent(new Event("timetracker-local-state"));
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

export const localStore = {
  subscribe(callback: () => void) {
    const notify = () => {
      refreshState();
      callback();
    };
    const notifyStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        notify();
      }
    };

    window.addEventListener("timetracker-local-state", notify);
    window.addEventListener("storage", notifyStorage);
    return () => {
      window.removeEventListener("timetracker-local-state", notify);
      window.removeEventListener("storage", notifyStorage);
    };
  },
  snapshot: readState,
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
  reorderProjects(orderedIds: string[]) {
    if (orderedIds.length < 2) {
      return;
    }

    updateState((state) => {
      const projects = applyReorderProjects(state.projects, orderedIds);

      return projects === state.projects ? state : { ...state, projects };
    });
  },
  archiveProject(projectId: string) {
    this.updateProject(projectId, { status: "archived" });
  },
  unarchiveProject(projectId: string) {
    this.updateProject(projectId, { status: "active" });
  },
  addProjectTask(projectId: string, name: string) {
    updateState((state) => ({
      ...state,
      projects: applyAddProjectTask(state.projects, projectId, name, {
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
    patch: Partial<
      Pick<LocalProjectTask, "name" | "billable" | "budgetMs" | "adjustmentMs">
    >,
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
  archiveProjectTask(projectId: string, taskId: string) {
    updateState((state) => ({
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
  addBacklogStatus(name: string, color?: string) {
    return updateStateWithResult((state) => {
      return applyAddBacklogStatus(state, name, color, {
        createId,
        now: Date.now,
      });
    });
  },
  updateBacklogStatus(
    statusId: string,
    updates: string | { name: string; color?: string },
  ) {
    updateState((state) =>
      applyUpdateBacklogStatus(state, statusId, updates),
    );
  },
  deleteBacklogStatus(statusId: string) {
    updateState((state) => applyDeleteBacklogStatus(state, statusId));
  },
  setBacklogStatusMapping(mapping: BacklogStatusMappingInput) {
    updateState((state) => applyBacklogStatusMapping(state, mapping));
  },
  startTimer(timer: LocalTimerDraft) {
    updateState((state) =>
      applyStartTimer(state, timer, { createId, now: Date.now }),
    );
  },
  startTimerWithEntry(values: StartTimerWithEntryValues) {
    updateState((state) =>
      applyStartTimerWithEntry(state, values, {
        createId,
        now: Date.now,
      }),
    );
  },
  updateTimer(
    timerId: string,
    patch: Partial<Omit<LocalTimer, "_id" | "startedAt">>,
  ) {
    updateState((state) => applyUpdateTimer(state, timerId, patch));
  },
  cancelTimer(timerId: string) {
    updateState((state) => applyCancelTimer(state, timerId));
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
  clearTimesheetImportDrafts() {
    updateState((state) => applyClearTimesheetImportDrafts(state));
  },
  dismissTimesheetImportDraft(draftId: string) {
    updateState((state) =>
      applyDismissTimesheetImportDraft(state, draftId),
    );
  },
  dismissAllTimesheetImportDrafts() {
    this.clearTimesheetImportDrafts();
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
  importConnectorWorkItems(
    workItems: ConnectorImportCandidate[],
    options?: { archiveMissingFromConnectionId?: string },
  ) {
    return updateStateWithResult((state) =>
      applyConnectorWorkItemImport(state, workItems, options, {
        createId,
        now: Date.now,
      }),
    );
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
  setBacklogSortMode(mode: BacklogSortMode) {
    updateState((state) => applyBacklogSortMode(state, mode));
  },
  updateWorkItem(
    workItemId: string,
    patch: Partial<Omit<LocalWorkItem, "_id" | "createdAt" | "source">>,
  ) {
    updateState((state) => applyUpdateWorkItem(state, workItemId, patch));
  },
  setWorkItemStatus(workItemId: string, status: LocalWorkItem["status"]) {
    updateState((state) =>
      applyWorkItemStatus(state, workItemId, status, Date.now),
    );
  },
  restoreWorkItem(workItemId: string) {
    this.setWorkItemStatus(workItemId, "active");
  },
  archiveWorkItem(workItemId: string) {
    this.setWorkItemStatus(workItemId, "archived");
  },
  deleteWorkItem(workItemId: string) {
    updateState((state) => applyDeleteWorkItem(state, workItemId));
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
  deleteTimesheetEntry(entryId: string) {
    updateState((state) => applyDeleteTimesheetEntry(state, entryId));
  },
  saveTimer(timerId: string) {
    updateState((state) =>
      applySaveTimer(state, timerId, { createId, now: Date.now }),
    );
  },
  markTimesheetEntriesSubmitted(entryIds: string[]) {
    if (entryIds.length === 0) {
      return;
    }

    updateState((state) =>
      applyMarkTimesheetEntriesSubmitted(state, entryIds, Date.now),
    );
  },
  restartTimesheetEntry(entryId: string) {
    updateState((state) =>
      applyRestartTimesheetEntry(state, entryId, {
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
    updateState((state) =>
      applyDismissImportedBrowserDraft(state, draftId),
    );
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
