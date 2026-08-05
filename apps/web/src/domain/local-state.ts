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
} from "@timetracker/shared";
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
}

export type LocalWorkItemEstimateFieldKey =
  | "originalEstimateHours"
  | "remainingEstimateHours"
  | "completedEstimateHours";

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
}

export interface LocalTeam {
  _id: string;
  name: string;
  slug: string;
  settings: TeamSettings;
}

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

export interface LocalTimerDraft {
  localDate: string;
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

export interface UserPreferences {
  themeMode: ThemeMode;
  updateTrack: UpdateTrack;
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
  status: "active" | "archived";
  source: "manual" | ConnectorBacklogSource;
  sourceId?: string;
  sourceConnectionId?: string;
  sourceConnectionLabel?: string;
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
  createdAt: number;
  archivedAt?: number;
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
