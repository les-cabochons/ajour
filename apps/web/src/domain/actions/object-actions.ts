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
  | "mark-not-committed"
  | "delete"
  | "discard";

/** A committed entry is saved and matches its committed copy. */
export type TimeEntryActionState = "saved" | "committed" | "running";

export type CalendarSuggestionActionId =
  "add" | "choose-project" | "dismiss" | "hide-meeting" | "forget-meeting";

/**
 * Lists a calendar suggestion's actions: Add · Choose project… · Dismiss ·
 * Hide this meeting · Forget this meeting. The copy says meeting, never rule.
 */
export function getCalendarSuggestionActions(suggestion: {
  projectId?: string;
  seriesId?: string;
  ruleId?: string;
}): ObjectAction<CalendarSuggestionActionId>[] {
  const recurringReason = suggestion.seriesId
    ? undefined
    : "Only for recurring meetings";
  return [
    {
      id: "add",
      label: "Add",
      disabledReason: suggestion.projectId
        ? undefined
        : "Choose a project first",
    },
    { id: "choose-project", label: "Choose project…" },
    { id: "dismiss", label: "Dismiss" },
    {
      id: "hide-meeting",
      label: "Hide this meeting",
      disabledReason: recurringReason,
    },
    {
      id: "forget-meeting",
      label: "Forget this meeting",
      disabledReason:
        recurringReason ??
        (suggestion.ruleId ? undefined : "Nothing remembered yet"),
    },
  ];
}

export interface TimeEntryActionOptions {
  /** Set inside an editor, where Edit is the current mode. */
  isEditing?: boolean;
  /** Set inside an editor whose draft cannot be saved yet. */
  invalidDraftReason?: string;
  /**
   * Set when the entry's week is submitted. Edit still opens it, read-only,
   * Continue starts a new entry today, and Duplicate to… copies it to an open
   * week; the rest are disabled with this reason.
   */
  lockedReason?: string;
}

const STOP_RUNNING_FIRST = "Stop the running entry first";

/**
 * Lists a time entry's actions: Edit · Continue/Stop · Duplicate · Duplicate to… ·
 * Move to… · Mark as not committed · Delete/Discard. Only committed entries list
 * Mark as not committed.
 */
export function getTimeEntryActions(
  state: TimeEntryActionState,
  options: TimeEntryActionOptions = {},
): ObjectAction<TimeEntryActionId>[] {
  const isRunning = state === "running";
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
        },
    {
      id: "duplicate",
      label: "Duplicate",
      disabledReason: options.lockedReason ?? relocationReason,
    },
    {
      id: "duplicate-to",
      label: "Duplicate to…",
      disabledReason: relocationReason,
    },
    {
      id: "move-to",
      label: "Move to…",
      disabledReason: options.lockedReason ?? relocationReason,
    },
    ...(state === "committed"
      ? [
          {
            id: "mark-not-committed" as const,
            label: "Mark as not committed",
            disabledReason: options.lockedReason,
          },
        ]
      : []),
    isRunning
      ? { id: "discard", label: "Discard", destructive: true }
      : {
          id: "delete",
          label: "Delete",
          destructive: true,
          disabledReason: options.lockedReason,
        },
  ];
}

/** "1 entry" or "3 entries", for menus and toasts about several entries. */
export function formatEntryCount(count: number) {
  return count === 1 ? "1 entry" : `${count} entries`;
}

/** The actions that may apply to every selected entry. */
export const TIME_ENTRY_SELECTION_ACTION_IDS: ReadonlySet<TimeEntryActionId> =
  new Set([
    "duplicate",
    "duplicate-to",
    "move-to",
    "mark-not-committed",
    "delete",
  ]);

/**
 * Lists the actions of a selection of two or more entries, named with how many
 * entries each acts on: Duplicate 3 entries · Duplicate 3 entries to… · Move 3
 * entries to… · Mark 2 entries as not committed · Delete 3 entries. Edit,
 * Continue, Stop and Discard need one entry, so they are not listed. `saved`
 * counts the selected saved entries, without the running entry, which every
 * selection action skips; `committed` counts the committed ones among them.
 * `lockedReason` is set when the selection is on a submitted week: it disables
 * every action except Duplicate to….
 */
export function getTimeEntrySelectionActions({
  saved,
  committed,
  lockedReason,
}: {
  saved: number;
  committed: number;
  lockedReason?: string;
}): ObjectAction<TimeEntryActionId>[] {
  const entries = formatEntryCount(saved);
  const reason = saved === 0 ? STOP_RUNNING_FIRST : undefined;
  return [
    {
      id: "duplicate",
      label: `Duplicate ${entries}`,
      disabledReason: reason ?? lockedReason,
    },
    {
      id: "duplicate-to",
      label: `Duplicate ${entries} to…`,
      disabledReason: reason,
    },
    {
      id: "move-to",
      label: `Move ${entries} to…`,
      disabledReason: reason ?? lockedReason,
    },
    ...(committed > 0
      ? [
          {
            id: "mark-not-committed" as const,
            label: `Mark ${formatEntryCount(committed)} as not committed`,
            disabledReason: lockedReason,
          },
        ]
      : []),
    {
      id: "delete",
      label: `Delete ${entries}`,
      destructive: true,
      disabledReason: reason ?? lockedReason,
    },
  ];
}

/** Returns the action state shown for a time entry. */
export function getTimeEntryActionState(entry: {
  isRunning?: boolean;
  isCommitted?: boolean;
}): TimeEntryActionState {
  if (entry.isRunning) return "running";
  return entry.isCommitted ? "committed" : "saved";
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
  | "pin"
  | "unpin"
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
 * Pin/Unpin · Settle/Unsettle/Restore · Change source state… · Open in
 * source · Archive · Delete.
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
    pinnedAt?: number;
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
    item.pinnedAt !== undefined
      ? { id: "unpin", label: "Unpin" }
      : {
          id: "pin",
          label: "Pin",
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
