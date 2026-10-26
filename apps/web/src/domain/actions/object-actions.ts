/**
 * Action sets for user-facing objects, from the action model in docs/agents/ux-spec.md.
 *
 * Every surface (right-click menu, "…" menu, editors) renders the same list in the
 * same order. Kind decides which actions are listed. State decides which are enabled:
 * a disabled action stays listed with a short reason instead of disappearing.
 */
export interface ObjectAction<Id extends string = string> {
  id: Id;
  label: string;
  /**
   * The run of related actions this one belongs to. Menus draw a line where the
   * group changes (see `getObjectActionSections`).
   */
  group?: string;
  /** Destructive actions come last and use the destructive style. */
  destructive?: boolean;
  /** Set on the object's Cut, Copy and Paste, so menus show the system's keys. */
  clipboard?: ClipboardCommand;
  /** Present when the action is listed but unavailable in the current state. */
  disabledReason?: string;
  /**
   * Set with `disabledReason` when a submitted week disables the action. The
   * browser's menus and the command palette grey it but let it be chosen, and
   * choosing it, or pressing its key, shows the reason as a toast.
   */
  locked?: boolean;
  /** A side effect worth knowing before choosing the action. */
  hint?: string;
}

export type ClipboardCommand = "cut" | "copy" | "paste";

/**
 * Marks the actions that `lockedReason`, a submitted week's refusal, disables.
 * An action disabled for another reason, such as a running entry, keeps it.
 */
export function markLockedActions<Action extends ObjectAction>(
  actions: Action[],
  lockedReason: string | undefined,
): Action[] {
  if (!lockedReason) return actions;
  return actions.map((action) =>
    action.disabledReason === lockedReason
      ? { ...action, locked: true }
      : action,
  );
}

/**
 * Splits an action set into the sections a menu separates with a line. A
 * section starts where the group changes. The destructive actions at the end
 * (Delete, Discard, Archive) share one last section, whatever their groups.
 */
export function getObjectActionSections<Action extends ObjectAction>(
  actions: readonly Action[],
): Action[][] {
  const sections: Action[][] = [];
  for (const action of actions) {
    const section = sections.at(-1);
    const previous = section?.at(-1);
    const continuesSection =
      previous !== undefined &&
      (action.destructive
        ? previous.destructive
        : !previous.destructive && action.group === previous.group);
    if (section && continuesSection) {
      section.push(action);
    } else {
      sections.push([action]);
    }
  }
  return sections;
}

export type TimeEntryActionId =
  | "edit"
  | "continue"
  | "stop"
  | "cut"
  | "copy"
  | "paste"
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
 * Lists a calendar suggestion's actions: Add · Choose project… | Dismiss ·
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
      group: "add",
      disabledReason: suggestion.projectId
        ? undefined
        : "Choose a project first",
    },
    { id: "choose-project", label: "Choose project…", group: "add" },
    { id: "dismiss", label: "Dismiss", group: "hide" },
    {
      id: "hide-meeting",
      label: "Hide this meeting",
      group: "hide",
      disabledReason: recurringReason,
    },
    {
      id: "forget-meeting",
      label: "Forget this meeting",
      group: "hide",
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
 * Lists a time entry's actions: Edit · Continue/Stop | Duplicate · Duplicate to… ·
 * Move to… · Mark as not committed | Delete/Discard. Only committed entries list
 * Mark as not committed. Where entries can be selected, the menus add Cut · Copy
 * · Paste after Continue (`addTimeEntryClipboardActions`).
 */
export function getTimeEntryActions(
  state: TimeEntryActionState,
  options: TimeEntryActionOptions = {},
): ObjectAction<TimeEntryActionId>[] {
  const isRunning = state === "running";
  const relocationReason = isRunning
    ? STOP_RUNNING_FIRST
    : options.invalidDraftReason;

  const actions: ObjectAction<TimeEntryActionId>[] = [
    {
      id: "edit",
      label: "Edit",
      group: "open",
      disabledReason: options.isEditing ? "Already editing" : undefined,
    },
    isRunning
      ? { id: "stop", label: "Stop", group: "open" }
      : {
          id: "continue",
          label: "Continue",
          group: "open",
          // Editors save the draft before continuing, so an invalid draft blocks it.
          disabledReason: options.invalidDraftReason,
        },
    {
      id: "duplicate",
      label: "Duplicate",
      group: "place",
      disabledReason: options.lockedReason ?? relocationReason,
    },
    {
      id: "duplicate-to",
      label: "Duplicate to…",
      group: "place",
      disabledReason: relocationReason,
    },
    {
      id: "move-to",
      label: "Move to…",
      group: "place",
      disabledReason: options.lockedReason ?? relocationReason,
    },
    ...(state === "committed"
      ? [
          {
            id: "mark-not-committed" as const,
            label: "Mark as not committed",
            group: "place",
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
  return markLockedActions(actions, options.lockedReason);
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
 * entries to… · Mark 2 entries as not committed | Delete 3 entries. Edit,
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
  const actions: ObjectAction<TimeEntryActionId>[] = [
    {
      id: "duplicate",
      label: `Duplicate ${entries}`,
      group: "place",
      disabledReason: reason ?? lockedReason,
    },
    {
      id: "duplicate-to",
      label: `Duplicate ${entries} to…`,
      group: "place",
      disabledReason: reason,
    },
    {
      id: "move-to",
      label: `Move ${entries} to…`,
      group: "place",
      disabledReason: reason ?? lockedReason,
    },
    ...(committed > 0
      ? [
          {
            id: "mark-not-committed" as const,
            label: `Mark ${formatEntryCount(committed)} as not committed`,
            group: "place",
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
  return markLockedActions(actions, lockedReason);
}

/** The reason Paste is disabled until entries are copied or cut. */
export const PASTE_NEEDS_ENTRIES = "Copy or cut entries first";

/**
 * Adds Cut · Copy · Paste as their own group after the entry's first group (Edit
 * and Continue), or first on a selection's menu. `saved` counts the entries a cut
 * or copy takes, without the running entry, and `selected` the entries the menu
 * acts on: a selection of two or more names its count, as in "Copy 3 entries".
 * On a submitted week, `lockedReason` disables Cut, which moves the entries,
 * and `pasteLockedReason` disables Paste when it would land in one. Copy
 * changes nothing, so it stays.
 */
export function addTimeEntryClipboardActions(
  actions: readonly ObjectAction<TimeEntryActionId>[],
  {
    saved,
    selected,
    canPaste,
    lockedReason,
    pasteLockedReason,
  }: {
    saved: number;
    selected: number;
    canPaste: boolean;
    lockedReason?: string;
    pasteLockedReason?: string;
  },
): ObjectAction<TimeEntryActionId>[] {
  const count = selected >= 2 ? ` ${formatEntryCount(saved)}` : "";
  const reason = saved === 0 ? STOP_RUNNING_FIRST : undefined;
  const clipboardActions: ObjectAction<TimeEntryActionId>[] = [
    {
      id: "cut",
      label: `Cut${count}`,
      group: "clipboard",
      clipboard: "cut",
      disabledReason: reason ?? lockedReason,
    },
    {
      id: "copy",
      label: `Copy${count}`,
      group: "clipboard",
      clipboard: "copy",
      disabledReason: reason,
    },
    {
      id: "paste",
      label: "Paste",
      group: "clipboard",
      clipboard: "paste",
      disabledReason:
        pasteLockedReason ?? (canPaste ? undefined : PASTE_NEEDS_ENTRIES),
    },
  ];
  const at = actions.findIndex((action) => action.group !== "open");
  const index = at === -1 ? actions.length : at;
  return [
    ...actions.slice(0, index),
    ...markLockedActions(
      markLockedActions(clipboardActions, lockedReason),
      pasteLockedReason,
    ),
    ...actions.slice(index),
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

export type ProjectActionId =
  | "edit"
  | "new-task"
  | "favorite"
  | "unfavorite"
  | "archive"
  | "restore";

const RESTORE_PROJECT_FIRST = "Restore the project first";
const RESTORE_TASK_FIRST = "Restore the task first";
const RESTORE_ITEM_FIRST = "Restore the item first";

/** Add to favorites, or Remove from favorites once starred, in one slot. */
function favoriteAction(
  favoritedAt: number | undefined,
  group: string,
  disabledReason: string | undefined,
): ObjectAction<"favorite" | "unfavorite"> {
  return favoritedAt === undefined
    ? { id: "favorite", label: "Add to favorites", group, disabledReason }
    : {
        id: "unfavorite",
        label: "Remove from favorites",
        group,
        disabledReason,
      };
}

/**
 * Lists a project's actions: Edit · New task · Add to favorites/Remove from
 * favorites · Archive/Restore. Projects have no Delete.
 */
export function getProjectActions(project: {
  status: ArchiveStatus;
  favoritedAt?: number;
}): ObjectAction<ProjectActionId>[] {
  const isArchived = project.status === "archived";
  const reason = isArchived ? RESTORE_PROJECT_FIRST : undefined;

  return [
    { id: "edit", label: "Edit", group: "edit", disabledReason: reason },
    {
      id: "new-task",
      label: "New task",
      group: "edit",
      disabledReason: reason,
    },
    favoriteAction(project.favoritedAt, "edit", reason),
    isArchived
      ? { id: "restore", label: "Restore", group: "archive" }
      : { id: "archive", label: "Archive", destructive: true },
  ];
}

export type TaskActionId =
  | "start-entry"
  | "new-entry"
  | "edit"
  | "assign-shortcut"
  | "favorite"
  | "unfavorite"
  | "archive"
  | "restore";

/**
 * Lists a task's actions: Start entry · New entry… | Edit · Assign shortcut… ·
 * Add to favorites/Remove from favorites | Archive/Restore.
 * An archived project blocks every action, including Restore of the task.
 */
export function getTaskActions(
  project: { status: ArchiveStatus },
  task: { status: ArchiveStatus; favoritedAt?: number },
): ObjectAction<TaskActionId>[] {
  const projectReason =
    project.status === "archived" ? RESTORE_PROJECT_FIRST : undefined;
  const isTaskArchived = task.status === "archived";
  const workReason =
    projectReason ?? (isTaskArchived ? RESTORE_TASK_FIRST : undefined);

  return [
    {
      id: "start-entry",
      label: "Start entry",
      group: "track",
      disabledReason: workReason,
    },
    {
      id: "new-entry",
      label: "New entry…",
      group: "track",
      disabledReason: workReason,
    },
    { id: "edit", label: "Edit", group: "edit", disabledReason: workReason },
    {
      id: "assign-shortcut",
      label: "Assign shortcut…",
      group: "edit",
      disabledReason: workReason,
    },
    favoriteAction(task.favoritedAt, "edit", workReason),
    isTaskArchived
      ? {
          id: "restore",
          label: "Restore",
          group: "archive",
          disabledReason: projectReason,
        }
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
 * Start entry/Stop · New entry… | Edit · Add subitem | Snooze…/Unsnooze ·
 * Pin/Unpin · Settle/Unsettle/Restore | Change source state… · Open in
 * source | Archive · Delete.
 *
 * Open in source is listed only when a plugin provided the item's URL.
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
      ? { id: "stop-entry", label: "Stop", group: "track" }
      : {
          id: "start-entry",
          label: "Start entry",
          group: "track",
          disabledReason: archivedReason,
        },
    {
      id: "new-entry",
      label: "New entry…",
      group: "track",
      disabledReason: archivedReason,
    },
    {
      id: "edit",
      label: "Edit",
      group: "edit",
      disabledReason:
        archivedReason ?? (options.isEditing ? "Already editing" : undefined),
    },
    {
      id: "add-subitem",
      label: "Add subitem",
      group: "edit",
      disabledReason: options.isSubitem
        ? "Subitems can't have subitems"
        : archivedReason,
    },
    options.isSnoozed
      ? { id: "unsnooze", label: "Unsnooze", group: "triage" }
      : {
          id: "snooze",
          label: "Snooze…",
          group: "triage",
          disabledReason:
            archivedReason ??
            (isSettled ? "Unsettle the item first" : undefined),
        },
    item.pinnedAt !== undefined
      ? { id: "unpin", label: "Unpin", group: "triage" }
      : {
          id: "pin",
          label: "Pin",
          group: "triage",
          disabledReason:
            archivedReason ??
            (isSettled ? "Unsettle the item first" : undefined),
        },
    isArchived
      ? { id: "restore", label: "Restore", group: "triage" }
      : isSettled
        ? { id: "unsettle", label: "Unsettle", group: "triage" }
        : {
            id: "settle",
            label: options.settleOpensDialog ? "Settle…" : "Settle",
            group: "triage",
          },
  ];

  if ((options.otherSourceStateCount ?? 0) > 0) {
    actions.push({
      id: "change-source-state",
      label: "Change source state…",
      group: "source",
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
      group: "source",
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
