import type {
  ActivityBlockRecord,
  ActivitySegmentRecord,
  AssignmentSource,
  BucketEvidenceItem,
  CaptureSettings,
  BacklogSource,
  ImportedDraftStatus,
  RuleRecord,
  TeamProject,
  TeamProjectFields,
  TeamSettings,
  TeamTaskFields,
} from "@ajour/shared";
import type { PriorityLevel } from "@/domain/backlog/priority";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

export interface LocalProject {
  _id: string;
  name: string;
  displayName?: string;
  code?: string;
  /**
   * Overrides of plugin project properties, keyed by plugin ID then field
   * ID. A missing value means the field's default. See plugin-properties.ts.
   */
  pluginProperties?: Record<string, Record<string, string>>;
  color: string;
  icon: LocalProjectIcon;
  status: "active" | "archived";
  tasks: LocalProjectTask[];
  /** Present on a shared project: the team it belongs to. See team-sync.ts. */
  team?: LocalProjectTeamLink;
}

/**
 * A shared project's link to its team connection. A project the team has not
 * assigned an ID yet is new to the team; once it has one, `synced` holds its
 * team-owned fields as last synced, and a field that differs is a local change.
 */
export type LocalProjectTeamLink =
  | { connectionId: string; remoteId?: undefined; synced?: undefined }
  | { connectionId: string; remoteId: string; synced: TeamProjectFields };

/**
 * A task of a shared project that the team knows. A task of a shared project
 * without one is new to the team.
 */
export interface LocalTaskTeamLink {
  remoteId: string;
  synced: TeamTaskFields;
}

/** What a team connection keeps between syncs. */
export interface LocalTeamConnection {
  /** Where the next sync starts. Absent before the first one. */
  cursor?: string;
  /**
   * The team the links and cursor belong to, from the connection's settings.
   * When the connection names another team, they no longer apply.
   */
  identity?: string;
  /** Team projects the user unshared on this machine. Ajour ignores them. */
  unsharedRemoteIds: string[];
  /**
   * Projects unshared before the team gave them an ID. A round may still be
   * on its way, so the ID it brings joins `unsharedRemoteIds`.
   */
  unsharedLocalIds: string[];
  /**
   * Team projects that arrived while a local project has their name. Each
   * waits for the user to link it to a local project or add it separately,
   * and later syncs keep it current meanwhile.
   */
  heldArrivals: TeamProject[];
}

export interface LocalProjectTask {
  _id: string;
  name: string;
  status: "active" | "archived";
  createdAt: number;
  archivedAt?: number;
  billable?: boolean;
  budgetMs?: number;
  adjustmentMs?: number;
  /** The number key that opens or starts this pinned task. One task holds a slot at most. */
  pinnedSlot?: PinnedTaskSlot;
  team?: LocalTaskTeamLink;
}

/** The ten pinned task slots, in keyboard order: 1 to 9, then 0. */
export const PINNED_TASK_SLOTS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
] as const;

export type PinnedTaskSlot = (typeof PINNED_TASK_SLOTS)[number];

export function isPinnedTaskSlot(value: unknown): value is PinnedTaskSlot {
  return (
    typeof value === "string" &&
    (PINNED_TASK_SLOTS as readonly string[]).includes(value)
  );
}

export type LocalWorkItemEstimateFieldKey =
  "originalEstimateHours" | "remainingEstimateHours" | "completedEstimateHours";

export interface LocalWorkItemEstimateFieldConflict {
  detectedAt: number;
  localValue?: number;
  remoteValue?: number;
  baselineValue?: number;
}

export interface LocalWorkItemEstimateFieldError {
  detectedAt: number;
  message: string;
}

export interface LocalWorkItemEstimateFieldState {
  baselineValue?: number;
  remoteValue?: number;
  resolution?: "keep_local";
  conflict?: LocalWorkItemEstimateFieldConflict;
  error?: LocalWorkItemEstimateFieldError;
}

export interface LocalWorkItemEstimateSyncState {
  originalEstimateHours?: LocalWorkItemEstimateFieldState;
  remainingEstimateHours?: LocalWorkItemEstimateFieldState;
  completedEstimateHours?: LocalWorkItemEstimateFieldState;
}

export interface LocalProjectDraft {
  name: string;
  displayName?: string;
  code?: string;
  color: string;
  icon?: LocalProjectIcon;
  status?: "active" | "archived";
  tasks?: LocalProjectTaskDraft[];
}

export interface LocalProjectTaskDraft {
  name: string;
  status?: "active" | "archived";
  billable?: boolean;
  budgetMs?: number;
  adjustmentMs?: number;
  /** Only `addProjectTask` reads it, so the slot stays unique. */
  pinnedSlot?: PinnedTaskSlot;
}

export interface LocalTeam {
  _id: string;
  name: string;
  slug: string;
  settings: TeamSettings;
}

/**
 * The running entry. Its counted time is `accumulatedDurationMs` plus the time since
 * `startedAt`. `entryId` links the saved entry it resumed, if any.
 */
export interface LocalTimer {
  _id: string;
  startedAt: number;
  localDate: string;
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  accumulatedDurationMs: number;
  entryId?: string;
}

/** What starting a running entry needs. It has no date: a running entry always starts today. */
export interface LocalTimerDraft {
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  accumulatedDurationMs?: number;
  entryId?: string;
}

/**
 * An entry as it was last committed: the copy the external timesheet holds.
 * See docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */
export interface LocalTimesheetEntryCommit {
  /** When the copy was saved. */
  at: number;
  localDate: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
  /**
   * Set when the user marked the entry as not committed because the external
   * timesheet changed since. The copy still finds the external entry, but the
   * entry shows as updated until the next commit saves a fresh copy.
   */
  stale?: true;
}

/**
 * A committed entry the user deleted since. It stays until the deletion is
 * committed, so the external timesheet can delete its copy too.
 */
export interface LocalTimesheetTombstone {
  entryId: string;
  commit: LocalTimesheetEntryCommit;
}

export interface LocalTimesheetEntry {
  _id: string;
  localDate: string;
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  label: string;
  note?: string;
  durationMs: number;
  sourceBlockIds: string[];
  /**
   * When the entry was saved, such as from a running entry. The Day view
   * orders entries by it. Unrelated to `commit`.
   */
  committedAt: number;
  /** The entry as it was last committed. Undefined until its first commit. */
  commit?: LocalTimesheetEntryCommit;
}

export interface LocalTimesheetImportDraft {
  _id: string;
  localDate: string;
  projectName: string;
  taskName: string;
  note?: string;
  durationMs: number;
  potentialConflict: boolean;
  conflictEntryIds: string[];
  importedAt: number;
}

/**
 * What the user decided about one calendar event occurrence (ADR 0005). Ajour
 * keeps no title or time span here: the occurrence key and its day are enough
 * to hide it on the next fetch.
 */
export interface LocalCalendarDecision {
  _id: string;
  pluginId: string;
  connectionId: string;
  /** `calendarOccurrenceKey` of the event: its id and start. */
  occurrenceKey: string;
  /** The occurrence's day, which retention counts from. */
  localDate: string;
  decision: "added" | "dismissed";
  /** The entry an added occurrence became. Deleting it suggests the event again. */
  entryId?: string;
  decidedAt: number;
}

/**
 * An event rule: what Ajour remembers about one recurring calendar event. The
 * UI says "remembered meeting" and "hidden meeting", never rule.
 */
export interface LocalCalendarEventRule {
  _id: string;
  pluginId: string;
  connectionId: string;
  seriesId: string;
  /** The event's title when the rule was made, so Settings can name it. */
  label: string;
  action: "assign" | "hide";
  projectId?: string;
  taskId?: string;
  createdAt: number;
}

/** Which calendar events the Time view suggests, and how often it refreshes. */
export interface CalendarSuggestionSettings {
  hideAllDay: boolean;
  hideDeclined: boolean;
  /** Events marked free, such as reminders. */
  hideFree: boolean;
  /** Events the user has not answered. Unknown replies are not hidden. */
  hideUnanswered: boolean;
  /** Shorter events are hidden. 0 hides none. */
  minimumMinutes: number;
  refreshMinutes: number;
}

/** The Backlog page's ordering, which the sidebar shares. */
export type BacklogSortMode =
  | "custom"
  | "priority_asc"
  | "priority_desc"
  | "created"
  | "remaining"
  | "title";

export type ThemeMode = "system" | "dark" | "light";
export type UpdateTrack = "stable" | "nightly";
export type WeeklyTimeViewStyle = "grid" | "days";
/** The Time page's view: one day, or the week as a Grid or Days columns. */
export type TimeView = "day" | "week";

export interface WeeklyCapacityTargets {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

/** What closing or settling a parent does with its open subitems. */
export type CloseParentSubitems = "ask" | "include" | "leave";

export interface UserPreferences {
  themeMode: ThemeMode;
  updateTrack: UpdateTrack;
  projectDataShapeId: string;
  weeklyTimeViewStyle: WeeklyTimeViewStyle;
  /** The view the user last picked. A Time link without a view opens it. Default "day". */
  timeView?: TimeView;
  weeklyCapacityTargets: WeeklyCapacityTargets;
  /** Hide zero-capacity days in the Time page's day strip and Week layouts. */
  hideNonWorkingDays?: boolean;
  warnWhenOverCapacity: boolean;
  warnWhenSubmittingUnderCapacity: boolean;
  changesEndSnoozeEarly?: boolean;
  closeParentSubitems: CloseParentSubitems;
  /** How far the week may run ahead of or behind its targets before an agent asks. Default 20. */
  paceTolerancePercent?: number;
  /**
   * Whose project names the Commit page's lines show: "ajour" or a plugin ID.
   * Undefined, or a plugin that is not active, shows Ajour's names.
   */
  commitLinesNameSource?: string;
  calendarSuggestions?: CalendarSuggestionSettings;
}

/** One step of the user's workflow. The workflow's order is the array order. */
export interface LocalWorkflowState {
  _id: string;
  name: string;
  color: string;
  /** Moving an item into a done state closes it: it becomes archived. */
  done?: boolean;
  createdAt: number;
}

/**
 * Maps one source state to a workflow state. A mapping without a source
 * project applies to every source project of the connection that has none of
 * its own.
 */
export interface LocalWorkflowStateMapping {
  source: BacklogSource;
  connectionId: string;
  sourceProjectName?: string;
  sourceStatusKey: string;
  /** The source state as the tool names it, which a write sends back. */
  sourceStatusLabel?: string;
  workflowStateId: string | null;
}

/** What moving a synced item into a workflow state writes to its source. */
export type LocalWorkflowStateWrite =
  | { kind: "state"; sourceStatusLabel: string }
  | { kind: "ask" }
  | { kind: "none" };

/**
 * The write for one workflow state of a source project, or of every source
 * project of the connection when `sourceProjectName` is missing. Without a
 * rule, a move writes the first source state mapped to the workflow state.
 */
export interface LocalWorkflowStateWriteRule {
  source: BacklogSource;
  connectionId: string;
  sourceProjectName?: string;
  workflowStateId: string;
  write: LocalWorkflowStateWrite;
}

export interface LocalWorkItem {
  _id: string;
  title: string;
  /**
   * Active items are on the user's plate. Settled items wait on someone else
   * (synced items only). Archived items are done. See agents/GLOSSARY.md.
   */
  status: "active" | "settled" | "archived";
  source: "manual" | BacklogSource;
  sourceId?: string;
  sourceConnectionId?: string;
  sourceConnectionLabel?: string;
  /** Link to the item in its source tool, when the plugin provides one. `sourceId` is an opaque identity, not a URL. */
  sourceUrl?: string;
  sourceProjectName?: string;
  sourceWorkItemType?: string;
  hierarchyLevel?: 0 | 1;
  parentWorkItemId?: string;
  parentSourceId?: string;
  /** Ajour's level. A synced item follows its source value until the user sets one. */
  priority?: PriorityLevel;
  /** The level the source reports. The plugin maps its own values to levels. */
  importedPriority?: PriorityLevel;
  workflowStateId?: string;
  importedWorkflowStateId?: string;
  sourceStatusKey?: string;
  sourceStatusLabel?: string;
  projectId?: string;
  taskId?: string;
  inheritsParentMapping?: boolean;
  /** Markdown that explains the item. A synced item's comes from its source tool. */
  description?: string;
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  remainingEstimateOverrunHours?: number;
  completedEstimateHours?: number;
  estimateSync?: LocalWorkItemEstimateSyncState;
  keepWhenMissingFromSync?: boolean;
  archivedByMissingSync?: boolean;
  /**
   * Hides the item from the sidebar until this time. Once the time has passed,
   * the item is returned until the user opens it or ends the snooze.
   */
  snoozedUntil?: number;
  /** Set when a sync brings a settled item back. Cleared when the user opens it. */
  returnedAt?: number;
  /**
   * Set when a comment brought the item back, with the same `at` as
   * `returnedAt`, so its notice can name the person. Never the comment text.
   */
  returnedByComment?: { author: string; at: number };
  /**
   * When the user pinned the item to the top of the sidebar list. Local: a
   * sync keeps it and never writes it to the source.
   */
  pinnedAt?: number;
  settledAt?: number;
  /**
   * The parent whose settle or close carried this subitem along, so they come
   * back together.
   */
  settledWithParentId?: string;
  /** The workflow state the item had before it moved into a done state. */
  workflowStateIdBeforeClose?: string;
  /** The source state key when the item was archived, to notice a reopen in the source. */
  archivedSourceStatusKey?: string;
  /** The source state key when the item was settled, to notice changes made in the source since. */
  settledSourceStatusKey?: string;
  /** The imported priority when the item was settled, to notice changes made in the source since. */
  settledImportedPriority?: PriorityLevel;
  /**
   * A settle's change waiting to be written to the source tool. It is sent when
   * the Undo toast closes, or at the next launch. See ADR 0001.
   */
  pendingSourceWrite?: LocalPendingSourceWrite;
  createdAt: number;
  archivedAt?: number;
}

/**
 * How settling applies a fixed change to the items of one source project,
 * without the settle dialog. Only Apply rules are stored: Ask is the default.
 */
export interface LocalSettleRule {
  source: string;
  connectionId: string;
  sourceProjectName: string;
  state?: { name: string; done: boolean };
  priority?: PriorityLevel;
}

export type LocalWorkItemMoveSnapshot = Pick<
  LocalWorkItem,
  | "status"
  | "workflowStateId"
  | "workflowStateIdBeforeClose"
  | "archivedAt"
  | "archivedByMissingSync"
  | "archivedSourceStatusKey"
  | "settledAt"
  | "settledWithParentId"
  | "settledSourceStatusKey"
  | "settledImportedPriority"
  | "returnedAt"
  | "snoozedUntil"
>;

/** Only the fields the settle changed. */
export interface LocalPendingSourceWrite {
  readyAt?: number;
  state?: string;
  priority?: PriorityLevel;
  /** The item's source values before the settle, put back if the write fails. */
  previous: {
    sourceStatusKey?: string;
    sourceStatusLabel?: string;
    importedPriority?: PriorityLevel;
    priority?: PriorityLevel;
    /** Set by a move, which a failed write undoes. */
    workflowStateId?: string;
    importedWorkflowStateId?: string;
    /** A drag's changed order. Restore it only while that order is unchanged. */
    workItemOrder?: { before: string[]; after: string[] };
    carriedChildren?: Array<{
      id: string;
      before: LocalWorkItemMoveSnapshot;
      after: LocalWorkItemMoveSnapshot;
    }>;
    lifecycle?: Pick<
      LocalWorkItem,
      | "status"
      | "settledAt"
      | "archivedAt"
      | "archivedByMissingSync"
      | "archivedSourceStatusKey"
      | "settledSourceStatusKey"
      | "settledImportedPriority"
      | "workflowStateIdBeforeClose"
      | "settledWithParentId"
      | "returnedAt"
      | "snoozedUntil"
    >;
  };
}

export type PersistedLocalWorkItem = Omit<
  LocalWorkItem,
  | "status"
  | "archivedAt"
  | "priority"
  | "importedPriority"
  | "settledImportedPriority"
  | "pendingSourceWrite"
> & {
  /** Any whole number before priority had levels. */
  priority?: number;
  /** A raw source value before plugins sent levels. */
  importedPriority?: number;
  settledImportedPriority?: number;
  pendingSourceWrite?: Omit<
    LocalPendingSourceWrite,
    "priority" | "previous"
  > & {
    priority?: number;
    previous: Omit<
      LocalPendingSourceWrite["previous"],
      "priority" | "importedPriority"
    > & {
      priority?: number;
      importedPriority?: number;
    };
  };
  status?: LocalWorkItem["status"] | "open" | "done";
  archivedAt?: number;
  completedAt?: number;
  /** Workflow states were called backlog statuses before. */
  backlogStatusId?: string;
  importedBacklogStatusId?: string;
  /** The description was called the note before. */
  note?: string;
};

export interface LocalWorkItemDraft {
  title: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  inheritsParentMapping?: boolean;
  parentWorkItemId?: string;
  priority?: PriorityLevel;
  workflowStateId?: string;
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  completedEstimateHours?: number;
}

export interface ImportedBrowserDraft {
  _id: string;
  bucketKey: string;
  localDate: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  dominantDomain: string;
  dominantPathname: string;
  dominantTitle: string;
  dominantLabel: string;
  dominantSubtitle: string;
  dominantFingerprint: string;
  evidence: BucketEvidenceItem[];
  dismissed: boolean;
  status: ImportedDraftStatus;
  projectId?: string;
  note?: string;
  importedAt: number;
  source: "extension_bridge";
  confidence: number;
  isMixed: boolean;
  assignmentSource: AssignmentSource;
  explanation?: string;
  manuallyEdited: boolean;
}

export interface ExtensionBridgeStatus {
  available: boolean;
  paused: boolean;
  segmentCount?: number;
  lastReadAt?: number;
  lastError?: string;
}

export interface LocalAppState {
  user: {
    _id: string;
    name: string;
    email: string;
  };
  team?: LocalTeam;
  projects: LocalProject[];
  rules: RuleRecord[];
  segments: ActivitySegmentRecord[];
  dismissedSegmentIds: string[];
  editedBlocks: ActivityBlockRecord[];
  importedBrowserDrafts: ImportedBrowserDraft[];
  timers: LocalTimer[];
  timesheetEntries: LocalTimesheetEntry[];
  /** Committed entries deleted since. See `LocalTimesheetTombstone`. */
  timesheetTombstones: LocalTimesheetTombstone[];
  timesheetImportDrafts: LocalTimesheetImportDraft[];
  workItems: LocalWorkItem[];
  pullRequests?: LocalPullRequest[];
  /** Decisions about calendar event occurrences. See ADR 0005. */
  calendarDecisions?: LocalCalendarDecision[];
  /** Remembered and hidden meetings. */
  calendarEventRules?: LocalCalendarEventRule[];
  workflowStates: LocalWorkflowState[];
  workflowStateMappings: LocalWorkflowStateMapping[];
  workflowStateWriteRules: LocalWorkflowStateWriteRule[];
  backlogSortMode: BacklogSortMode;
  /** Apply rules by source project. A source project without one asks. */
  settleRules?: LocalSettleRule[];
  /** Sync state by team connection ID. */
  teamConnections?: Record<string, LocalTeamConnection>;
  /**
   * Shared projects the last action changed while its Undo is open, so a team
   * sync in any window waits for them. The acting window clears it when the
   * Undo window closes; `until` covers a window that closes first.
   */
  teamPushHold?: { projectIds: string[]; until: number };
  capture: CaptureSettings;
  lastExtensionImportAt?: number;
  extensionBridgeStatus?: ExtensionBridgeStatus;
  userPreferences: UserPreferences;
  desktopBootstrapAppliedAt?: number;
  updatedAt: number;
}

export interface TimelineMutationResult {
  blocks: ActivityBlockRecord[];
  browserDrafts: ImportedBrowserDraft[];
  trackedMs: number;
  committedMs: number;
  extensionBridgeStatus?: ExtensionBridgeStatus;
}

/** Pending source moves protect the item and any children reopened with it. */
export function getPendingSourceWriteItemIds(
  state: Pick<LocalAppState, "workItems">,
) {
  const ids = new Set<string>();
  for (const item of state.workItems) {
    if (!item.pendingSourceWrite) continue;
    ids.add(item._id);
    for (const child of item.pendingSourceWrite.previous.carriedChildren ??
      []) {
      ids.add(child.id);
    }
  }
  return ids;
}

export function getWorkItemEstimateFieldState(
  workItem: LocalWorkItem,
  fieldKey: LocalWorkItemEstimateFieldKey,
) {
  return workItem.estimateSync?.[fieldKey];
}

export function hasWorkItemEstimateSyncIssue(workItem: LocalWorkItem) {
  return (
    [
      "originalEstimateHours",
      "remainingEstimateHours",
      "completedEstimateHours",
    ] as const
  ).some((fieldKey) => {
    const fieldState = getWorkItemEstimateFieldState(workItem, fieldKey);
    return Boolean(fieldState?.conflict || fieldState?.error);
  });
}

export function getLocalProjectDisplayName(
  project: Pick<LocalProject, "name" | "displayName">,
) {
  return project.displayName?.trim() || project.name;
}
