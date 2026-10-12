import type {
  ActivityBlockRecord,
  ActivitySegmentRecord,
  AssignmentSource,
  BucketEvidenceItem,
  CaptureSettings,
  ConnectorBacklogSource,
  ImportedDraftStatus,
  RuleRecord,
  TeamSettings,
} from "@ajour/shared";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";

export interface LocalProject {
  _id: string;
  name: string;
  displayName?: string;
  code?: string;
  color: string;
  icon: LocalProjectIcon;
  status: "active" | "archived";
  tasks: LocalProjectTask[];
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
  committedAt: number;
  submittedAt?: number;
  submittedFingerprint?: string;
  /**
   * When an edit returns a submitted entry to saved, this keeps the time it
   * was submitted, so the submit page can count entries changed since then.
   * Cleared when the entry is marked as submitted again.
   */
  previousSubmittedAt?: number;
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

export type BacklogSortMode = "custom" | "priority_asc" | "priority_desc";

export type ThemeMode = "system" | "dark" | "light";
export type UpdateTrack = "stable" | "nightly";
export type WeeklyTimeViewStyle = "grid" | "days";

export interface WeeklyCapacityTargets {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

export interface UserPreferences {
  themeMode: ThemeMode;
  updateTrack: UpdateTrack;
  projectDataShapeId: string;
  weeklyTimeViewStyle: WeeklyTimeViewStyle;
  weeklyCapacityTargets: WeeklyCapacityTargets;
  warnWhenOverCapacity: boolean;
  warnWhenSubmittingUnderCapacity: boolean;
}

export interface LocalBacklogStatus {
  _id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface LocalBacklogStatusMapping {
  source: ConnectorBacklogSource;
  connectionId: string;
  sourceStatusKey: string;
  backlogStatusId: string;
}

export interface LocalWorkItem {
  _id: string;
  title: string;
  /**
   * Active items are on the user's plate. Settled items wait on someone else
   * (synced items only). Archived items are done. See agents/GLOSSARY.md.
   */
  status: "active" | "settled" | "archived";
  source: "manual" | ConnectorBacklogSource;
  sourceId?: string;
  sourceConnectionId?: string;
  sourceConnectionLabel?: string;
  /** Link to the item in its source tool, when the connector provides one. `sourceId` is an opaque identity, not a URL. */
  sourceUrl?: string;
  sourceProjectName?: string;
  sourceWorkItemType?: string;
  hierarchyLevel?: 0 | 1;
  parentWorkItemId?: string;
  parentSourceId?: string;
  priority?: number;
  importedPriority?: number;
  backlogStatusId?: string;
  importedBacklogStatusId?: string;
  sourceStatusKey?: string;
  sourceStatusLabel?: string;
  projectId?: string;
  taskId?: string;
  inheritsParentMapping?: boolean;
  note?: string;
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
  settledAt?: number;
  /** The parent whose settle carried this subitem along, so they come back together. */
  settledWithParentId?: string;
  /** The source state key when the item was settled, to notice changes made in the source since. */
  settledSourceStatusKey?: string;
  /** The imported priority when the item was settled, to notice changes made in the source since. */
  settledImportedPriority?: number;
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
  priority?: number;
}

/** Only the fields the settle changed. */
export interface LocalPendingSourceWrite {
  state?: string;
  priority?: number;
  /** The item's source values before the settle, put back if the write fails. */
  previous: {
    sourceStatusKey?: string;
    sourceStatusLabel?: string;
    importedPriority?: number;
    priority?: number;
  };
}

export type PersistedLocalWorkItem = Omit<
  LocalWorkItem,
  "status" | "archivedAt"
> & {
  status?: LocalWorkItem["status"] | "open" | "done";
  archivedAt?: number;
  completedAt?: number;
};

export interface LocalWorkItemDraft {
  title: string;
  note?: string;
  projectId?: string;
  taskId?: string;
  inheritsParentMapping?: boolean;
  parentWorkItemId?: string;
  priority?: number;
  backlogStatusId?: string;
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
  timesheetImportDrafts: LocalTimesheetImportDraft[];
  workItems: LocalWorkItem[];
  backlogStatuses: LocalBacklogStatus[];
  backlogStatusMappings: LocalBacklogStatusMapping[];
  backlogSortMode: BacklogSortMode;
  /** Apply rules by source project. A source project without one asks. */
  settleRules?: LocalSettleRule[];
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
