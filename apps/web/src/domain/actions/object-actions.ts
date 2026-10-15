/**
 * Action sets for user-facing objects, from the action model in agents/ux-spec.md.
 *
 * Every surface (right-click menu, "…" menu, editors) renders the same list in the
 * same order. Kind decides which actions are listed. State decides which are enabled:
 * a disabled action stays listed with a short reason instead of disappearing.
 */
export interface ObjectAction<Id extends string = string> {
  id: Id;
  label: string;
  /** Destructive actions come last and use the destructive style. */
  destructive?: boolean;
  /** Present when the action is listed but unavailable in the current state. */
  disabledReason?: string;
  /** A side effect worth knowing before choosing the action. */
  hint?: string;
}

export type TimeEntryActionId =
  | "edit"
  | "continue"
  | "stop"
  | "duplicate"
  | "duplicate-to"
  | "move-to"
  | "delete"
  | "discard";

export type TimeEntryActionState = "saved" | "submitted" | "running";

export interface TimeEntryActionOptions {
  /** Whether the entry is on today's date. Continue resumes only today's entries. */
  isToday?: boolean;
  /** Set inside an editor, where Edit is the current mode. */
  isEditing?: boolean;
  /** Set inside an editor whose draft cannot be saved yet. */
  invalidDraftReason?: string;
}

const STOP_RUNNING_FIRST = "Stop the running entry first";
const MARKS_NOT_SUBMITTED = "Marks it as not submitted";

/** Lists a time entry's actions: Edit · Continue/Stop · Duplicate · Duplicate to… · Move to… · Delete/Discard. */
export function getTimeEntryActions(
  state: TimeEntryActionState,
  options: TimeEntryActionOptions = {},
): ObjectAction<TimeEntryActionId>[] {
  const isRunning = state === "running";
  const isSubmitted = state === "submitted";
  const relocationReason = isRunning
    ? STOP_RUNNING_FIRST
    : options.invalidDraftReason;

  return [
    {
      id: "edit",
      label: "Edit",
      disabledReason: options.isEditing ? "Already editing" : undefined,
    },
    isRunning
      ? { id: "stop", label: "Stop" }
      : {
          id: "continue",
          label: "Continue",
          // Editors save the draft before continuing, so an invalid draft blocks it.
          disabledReason: options.invalidDraftReason,
          // Continuing today's entry adds time to it; another day's entry starts a new one.
          hint:
            isSubmitted && options.isToday ? MARKS_NOT_SUBMITTED : undefined,
        },
    { id: "duplicate", label: "Duplicate", disabledReason: relocationReason },
    {
      id: "duplicate-to",
      label: "Duplicate to…",
      disabledReason: relocationReason,
    },
    {
      id: "move-to",
      label: "Move to…",
      disabledReason: relocationReason,
      hint: isSubmitted ? MARKS_NOT_SUBMITTED : undefined,
    },
    isRunning
      ? { id: "discard", label: "Discard", destructive: true }
      : { id: "delete", label: "Delete", destructive: true },
  ];
}

/** Returns the action state shown for a time entry. */
export function getTimeEntryActionState(entry: {
  submittedAt?: number;
  isRunning?: boolean;
}): TimeEntryActionState {
  if (entry.isRunning) {
    return "running";
  }

  return entry.submittedAt ? "submitted" : "saved";
}

type ArchiveStatus = "active" | "archived";

export type ProjectActionId = "edit" | "new-task" | "archive" | "restore";

const RESTORE_PROJECT_FIRST = "Restore the project first";
const RESTORE_TASK_FIRST = "Restore the task first";
const RESTORE_ITEM_FIRST = "Restore the item first";

/** Lists a project's actions: Edit · New task · Archive/Restore. Projects have no Delete. */
export function getProjectActions(project: {
  status: ArchiveStatus;
}): ObjectAction<ProjectActionId>[] {
  const isArchived = project.status === "archived";
  const reason = isArchived ? RESTORE_PROJECT_FIRST : undefined;

  return [
    { id: "edit", label: "Edit", disabledReason: reason },
    { id: "new-task", label: "New task", disabledReason: reason },
    isArchived
      ? { id: "restore", label: "Restore" }
      : { id: "archive", label: "Archive", destructive: true },
  ];
}

export type TaskActionId =
  | "start-entry"
  | "new-entry"
  | "edit"
  | "assign-shortcut"
  | "archive"
  | "restore";

/**
 * Lists a task's actions:
 * Start entry · New entry… · Edit · Assign shortcut… · Archive/Restore.
 * An archived project blocks every action, including Restore of the task.
 */
export function getTaskActions(
  project: { status: ArchiveStatus },
  task: { status: ArchiveStatus },
): ObjectAction<TaskActionId>[] {
  const projectReason =
    project.status === "archived" ? RESTORE_PROJECT_FIRST : undefined;
  const isTaskArchived = task.status === "archived";
  const workReason =
    projectReason ?? (isTaskArchived ? RESTORE_TASK_FIRST : undefined);

  return [
    { id: "start-entry", label: "Start entry", disabledReason: workReason },
    { id: "new-entry", label: "New entry…", disabledReason: workReason },
    { id: "edit", label: "Edit", disabledReason: workReason },
    {
      id: "assign-shortcut",
      label: "Assign shortcut…",
      disabledReason: workReason,
    },
    isTaskArchived
      ? { id: "restore", label: "Restore", disabledReason: projectReason }
      : {
          id: "archive",
          label: "Archive",
          destructive: true,
          disabledReason: projectReason,
        },
  ];
}

export type BacklogItemActionId =
  | "start-entry"
  | "stop-entry"
  | "new-entry"
  | "edit"
  | "add-subitem"
  | "snooze"
  | "unsnooze"
  | "settle"
  | "unsettle"
  | "restore"
  | "change-source-state"
  | "open-in-source"
  | "archive"
  | "delete";

export interface BacklogItemActionOptions {
  /** Subitems removed together with the item, stated in the Delete label. */
  subitemCount: number;
  isSubitem: boolean;
  /** Whether this item owns the running entry. */
  isRunning: boolean;
  /** Whether a snooze hides the item right now. */
  isSnoozed?: boolean;
  /** Set inside an editor, where Edit is the current mode. */
  isEditing?: boolean;
  /** Whether Settle opens the settle dialog, so its label ends with "…". */
  settleOpensDialog?: boolean;
  sourceName?: string;
  /**
   * Other source states of the item's workflow state it can write. Change
   * source state… is listed only when there are some.
   */
  otherSourceStateCount?: number;
}

function formatDeleteLabel(subitemCount: number) {
  if (subitemCount <= 0) {
    return "Delete";
  }

  return `Delete (and ${subitemCount} ${subitemCount === 1 ? "subitem" : "subitems"})`;
}

/**
 * Lists a backlog item's actions:
 * Start entry/Stop · New entry… · Edit · Add subitem · Snooze…/Unsnooze ·
 * Settle/Unsettle/Restore · Change source state… · Open in source · Archive ·
 * Delete.
 *
 * Open in source is listed only when a connector provided the item's URL.
 * Archive is listed only for synced items: it archives in Ajour and leaves the
 * source as it is. A manual item archives through Settle.
 */
export function getBacklogItemActions(
  item: {
    status: "active" | "settled" | "archived";
    source: string;
    sourceUrl?: string;
  },
  options: BacklogItemActionOptions,
): ObjectAction<BacklogItemActionId>[] {
  const isArchived = item.status === "archived";
  const isSettled = item.status === "settled";
  const archivedReason = isArchived ? RESTORE_ITEM_FIRST : undefined;
  const actions: ObjectAction<BacklogItemActionId>[] = [
    // Stop takes Start entry's slot while the item's entry runs.
    options.isRunning
      ? { id: "stop-entry", label: "Stop" }
      : {
          id: "start-entry",
          label: "Start entry",
          disabledReason: archivedReason,
        },
    { id: "new-entry", label: "New entry…", disabledReason: archivedReason },
    {
      id: "edit",
      label: "Edit",
      disabledReason:
        archivedReason ?? (options.isEditing ? "Already editing" : undefined),
    },
    {
      id: "add-subitem",
      label: "Add subitem",
      disabledReason: options.isSubitem
        ? "Subitems can't have subitems"
        : archivedReason,
    },
    options.isSnoozed
      ? { id: "unsnooze", label: "Unsnooze" }
      : {
          id: "snooze",
          label: "Snooze…",
          disabledReason:
            archivedReason ??
            (isSettled ? "Unsettle the item first" : undefined),
        },
    isArchived
      ? { id: "restore", label: "Restore" }
      : isSettled
        ? { id: "unsettle", label: "Unsettle" }
        : {
            id: "settle",
            label: options.settleOpensDialog ? "Settle…" : "Settle",
          },
  ];

  if ((options.otherSourceStateCount ?? 0) > 0) {
    actions.push({
      id: "change-source-state",
      label: "Change source state…",
      disabledReason: archivedReason,
    });
  }

  if (item.sourceUrl) {
    const sourceName =
      options.sourceName ??
      (item.source === "azure_devops"
        ? "Azure DevOps"
        : item.source === "jira"
          ? "Jira"
          : "source");
    actions.push({
      id: "open-in-source",
      label: `Open in ${sourceName}`,
      hint: "Ctrl-click or Cmd-click",
    });
  }

  if (item.source !== "manual") {
    actions.push({
      id: "archive",
      label: "Archive",
      destructive: true,
      disabledReason: isArchived ? "The item is archived" : undefined,
    });
  }

  actions.push({
    id: "delete",
    label: formatDeleteLabel(options.subitemCount),
    destructive: true,
  });

  return actions;
}
