/**
 * What the command palette lists, as plain data. The palette component renders
 * these sections and runs each item's `command`; everything here is pure so the
 * listing and ranking rules stay testable. See "Command palette" in
 * agents/ux-spec.md.
 */
import { isBacklogItemSnoozed } from "@/domain/backlog/backlog-item-lifecycle";
import {
  getBacklogItemActions,
  getProjectActions,
  getTaskActions,
  getTimeEntryActionState,
  getTimeEntryActions,
  type BacklogItemActionId,
  type ObjectAction,
  type ProjectActionId,
  type TaskActionId,
  type TimeEntryActionId,
} from "@/domain/actions/object-actions";
import {
  getDirectChildWorkItems,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalProjectTask,
  type LocalTimer,
  type LocalTimesheetEntry,
  type LocalWorkItem,
} from "@/domain/local-state";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import type { FocusedObjectRef } from "@/lib/focused-object";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  TASK_ACTION_KEYS,
  TIME_ENTRY_ACTION_KEYS,
  type ActionKeys,
} from "@/lib/item-keys";
import {
  formatShortcutKeys,
  getShortcut,
  type ShortcutActionId,
  type ShortcutDefinition,
  type ShortcutPlatform,
} from "@/lib/shortcuts";

/** A list the palette shows: the main list, or the actions of one search result. */
export type PaletteView =
  | { kind: "root" }
  | { kind: "task"; projectId: string; taskId: string }
  | { kind: "backlog-item"; workItemId: string }
  | { kind: "create-task-in" };

/** What choosing an item does. The palette component runs it. */
export type PaletteCommand =
  | { kind: "shortcut"; shortcutId: ShortcutActionId }
  | { kind: "navigate"; to: string }
  | { kind: "show"; view: PaletteView }
  | { kind: "open-project"; projectId: string }
  | { kind: "open-archive" }
  | { kind: "create-project" }
  | { kind: "time-entry"; entryId: string; actionId: TimeEntryActionId }
  | { kind: "running-entry"; timerId: string; actionId: TimeEntryActionId }
  | {
      kind: "task";
      projectId: string;
      taskId: string;
      actionId: TaskActionId;
    }
  | { kind: "project"; projectId: string; actionId: ProjectActionId }
  | { kind: "backlog-item"; workItemId: string; actionId: BacklogItemActionId }
  /** Move up (-1) or Move down (1) on the focused sortable object. */
  | { kind: "reorder"; target: SortableObjectRef; step: -1 | 1 };

/** The focused objects that Move up and Move down apply to. */
export type SortableObjectRef = Extract<
  FocusedObjectRef,
  { kind: "time-entry" | "backlog-item" | "task" | "project" }
>;

export interface PaletteItem {
  /** Unique within the palette. The list uses it as the item's value. */
  id: string;
  label: string;
  /** Secondary text, such as the project a task belongs to. */
  detail?: string;
  /** The key labels of the item's shortcut, one per chord, such as ["G", "T"]. */
  keys?: string[];
  /** Present when the item is listed but unavailable, per the action model. */
  disabledReason?: string;
  /** A side effect worth knowing before choosing the item. */
  hint?: string;
  destructive?: boolean;
  command: PaletteCommand;
}

export interface PaletteSection {
  id: string;
  heading: string;
  items: PaletteItem[];
}

export interface PaletteInput {
  query: string;
  view: PaletteView;
  /** The object that had focus when the palette opened. */
  focused: FocusedObjectRef | null;
  projects: readonly LocalProject[];
  workItems: readonly LocalWorkItem[];
  timesheetEntries: readonly LocalTimesheetEntry[];
  timer: LocalTimer | null;
  today: string;
  /** Shortcuts with a mounted handler, in registry order. */
  shortcuts: readonly ShortcutDefinition[];
  /** The settings pages, in display order. */
  settingsPages: readonly { to: string; label: string }[];
  platform: ShortcutPlatform;
  /** Whether Settle on a backlog item opens the settle dialog. */
  settleOpensDialog?: (workItem: LocalWorkItem) => boolean;
}

/** Search results stop here; typing more narrows them. */
export const MAX_SEARCH_RESULTS = 20;

// Sections go to Navigation. The palette itself and Cmd+, (the same page as
// "Go to Settings") are left out.
const NAVIGATION_SHORTCUTS: readonly ShortcutActionId[] = [
  "go.time",
  "go.backlog",
  "go.projects",
  "go.settings",
];
// Pinned task digits need the pressed number; the palette reaches tasks by search.
const HIDDEN_SHORTCUTS: readonly ShortcutActionId[] = [
  "app.command-palette",
  "app.settings",
  "pinned.new-entry",
  "pinned.start",
];

// Primary text is the item's name; secondary text is its context, such as the
// project of a task. A name match always outranks a context match.
const PRIMARY_WEIGHTS = {
  exact: 100,
  prefix: 80,
  wordPrefix: 60,
  contains: 30,
};
const SECONDARY_WEIGHTS = {
  exact: 25,
  prefix: 20,
  wordPrefix: 15,
  contains: 5,
};
const ARCHIVED_PENALTY = 30;

const WORD_SEPARATORS = /[\s\-_/·.,:;#()[\]]+/;

/** Lowercases and drops accents, so "developpement" finds "Développement". */
export function normalizeSearchText(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function scoreToken(
  token: string,
  text: string,
  weights: typeof PRIMARY_WEIGHTS,
) {
  if (!text) return 0;
  if (text === token) return weights.exact;
  if (text.startsWith(token)) return weights.prefix;
  if (text.split(WORD_SEPARATORS).some((word) => word.startsWith(token))) {
    return weights.wordPrefix;
  }
  return text.includes(token) ? weights.contains : 0;
}

/**
 * Scores how well `query` matches an item named `primary` with context
 * `secondary`. Every word of the query must match the name or the context, in
 * any order, so "atlas dev" finds the Development task of Client Atlas. Returns
 * null when a word matches nothing, and 0 for an empty query.
 */
export function scoreMatch(
  query: string,
  primary: string,
  secondary: readonly (string | undefined)[] = [],
): number | null {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }

  const name = normalizeSearchText(primary);
  const context = secondary
    .filter((text): text is string => Boolean(text))
    .map(normalizeSearchText);
  let total = 0;
  for (const token of tokens) {
    const score = Math.max(
      scoreToken(token, name, PRIMARY_WEIGHTS),
      ...context.map((text) => scoreToken(token, text, SECONDARY_WEIGHTS)),
    );
    if (score === 0) {
      return null;
    }
    total += score;
  }

  return total;
}

interface RankCandidate {
  item: PaletteItem;
  primary: string;
  secondary?: readonly (string | undefined)[];
  penalty?: number;
}

/**
 * Keeps the candidates that match `query`, best first. Equal scores keep their
 * given order. An empty query keeps them all in order.
 */
function rank(query: string, candidates: readonly RankCandidate[]) {
  return candidates
    .flatMap((candidate, index) => {
      const score = scoreMatch(query, candidate.primary, candidate.secondary);
      return score === null
        ? []
        : [
            {
              item: candidate.item,
              index,
              score: score - (candidate.penalty ?? 0),
            },
          ];
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((ranked) => ranked.item);
}

/** Commands match on their label, plus their detail as context. */
function rankCommands(query: string, items: readonly PaletteItem[]) {
  return rank(
    query,
    items.map((item) => ({
      item,
      primary: item.label,
      secondary: [item.detail],
    })),
  );
}

function projectName(project: LocalProject) {
  return getLocalProjectDisplayName(project);
}

/** The label of Start entry on a task, such as "Start Development (Client Atlas)". */
export function formatStartTaskLabel(
  project: LocalProject,
  task: LocalProjectTask,
) {
  return `Start ${task.name} (${projectName(project)})`;
}

/**
 * Lists an action set. `keys` adds each action's key, for the focused object
 * only, where those keys work.
 */
function toItems<Id extends string>(
  prefix: string,
  actions: readonly ObjectAction<Id>[],
  toCommand: (actionId: Id) => PaletteCommand,
  keys?: { map: ActionKeys<Id>; platform: ShortcutPlatform },
): PaletteItem[] {
  return actions.map((action) => {
    const shortcutId = keys?.map[action.id];
    return {
      id: `${prefix}:${action.id}`,
      label: action.label,
      keys:
        shortcutId && keys
          ? formatShortcutKeys(getShortcut(shortcutId), keys.platform)
          : undefined,
      disabledReason: action.disabledReason,
      hint: action.hint,
      destructive: action.destructive,
      command: toCommand(action.id),
    };
  });
}

/**
 * Adds Move up and Move down to the focused object's actions, before the
 * destructive ones. They are listed only here and on the keyboard, never in
 * the "…" or right-click menus.
 */
function withReorderItems(
  section: PaletteSection,
  target: SortableObjectRef,
  platform: ShortcutPlatform,
  disabledReason?: string,
): PaletteSection {
  const reorderItems = (
    [
      ["item.move-up", -1],
      ["item.move-down", 1],
    ] as const
  ).map(([shortcutId, step]): PaletteItem => {
    const shortcut = getShortcut(shortcutId);
    return {
      id: `${section.id}:${shortcutId}`,
      label: shortcut.label,
      keys: formatShortcutKeys(shortcut, platform),
      disabledReason,
      command: { kind: "reorder", target, step },
    };
  });
  const firstDestructive = section.items.findIndex((item) => item.destructive);
  const insertAt =
    firstDestructive === -1 ? section.items.length : firstDestructive;

  return {
    ...section,
    items: [
      ...section.items.slice(0, insertAt),
      ...reorderItems,
      ...section.items.slice(insertAt),
    ],
  };
}

function findTask(
  projects: readonly LocalProject[],
  projectId: string,
  taskId: string,
) {
  const project = projects.find((item) => item._id === projectId);
  const task = project?.tasks.find((item) => item._id === taskId);
  return project && task ? { project, task } : null;
}

/** A task's actions. `keysPlatform` adds the keys, for the focused task. */
function taskSection(
  prefix: string,
  project: LocalProject,
  task: LocalProjectTask,
  keysPlatform?: ShortcutPlatform,
): PaletteSection {
  const items = toItems(
    prefix,
    getTaskActions(project, task),
    (actionId): PaletteCommand => ({
      kind: "task",
      projectId: project._id,
      taskId: task._id,
      actionId,
    }),
    keysPlatform
      ? { map: TASK_ACTION_KEYS, platform: keysPlatform }
      : undefined,
  ).map((item) =>
    item.command.kind === "task" && item.command.actionId === "start-entry"
      ? { ...item, label: formatStartTaskLabel(project, task) }
      : item,
  );

  return {
    id: prefix,
    heading: `${task.name} · ${projectName(project)}`,
    items,
  };
}

/** A backlog item's actions. `keysPlatform` adds the keys, for the focused item. */
function backlogItemSection(
  prefix: string,
  workItem: LocalWorkItem,
  workItems: readonly LocalWorkItem[],
  settleOpensDialog: PaletteInput["settleOpensDialog"],
  keysPlatform?: ShortcutPlatform,
): PaletteSection {
  const isSubitem = isSubtaskWorkItem(workItem);
  const actions = getBacklogItemActions(workItem, {
    isSubitem,
    isSnoozed: isBacklogItemSnoozed(workItem, Date.now()),
    subitemCount: isSubitem
      ? 0
      : getDirectChildWorkItems(workItem, [...workItems]).length,
    settleOpensDialog: settleOpensDialog?.(workItem),
  });

  return {
    id: prefix,
    heading: workItem.title,
    items: toItems(
      prefix,
      actions,
      (actionId) => ({
        kind: "backlog-item",
        workItemId: workItem._id,
        actionId,
      }),
      keysPlatform
        ? { map: BACKLOG_ITEM_ACTION_KEYS, platform: keysPlatform }
        : undefined,
    ),
  };
}

function projectSection(prefix: string, project: LocalProject): PaletteSection {
  return {
    id: prefix,
    heading: projectName(project),
    items: toItems(prefix, getProjectActions(project), (actionId) => ({
      kind: "project",
      projectId: project._id,
      actionId,
    })),
  };
}

/** Names an entry by its task and project, else its note. */
function describeEntry(
  entry: Pick<LocalTimesheetEntry, "projectId" | "taskId" | "note">,
  projects: readonly LocalProject[],
) {
  const project = projects.find((item) => item._id === entry.projectId);
  const task = project?.tasks.find((item) => item._id === entry.taskId);
  const name = [task?.name, project ? projectName(project) : undefined]
    .filter(Boolean)
    .join(" · ");
  return name || entry.note?.trim() || "Time entry";
}

/**
 * The focused object's action set with its keys, or null when the object no
 * longer exists. Sortable objects add Move up and Move down.
 */
function focusedSection(input: PaletteInput): PaletteSection | null {
  const { focused, platform, projects, timer } = input;
  const prefix = "focused";
  const keys = { map: TIME_ENTRY_ACTION_KEYS, platform };

  switch (focused?.kind) {
    case "time-entry": {
      if (focused.isRunning) {
        if (!timer) return null;
        return withReorderItems(
          {
            id: prefix,
            heading: `Running · ${describeEntry(timer, projects)}`,
            items: toItems(
              prefix,
              getTimeEntryActions("running"),
              (actionId) => ({
                kind: "running-entry",
                timerId: timer._id,
                actionId,
              }),
              keys,
            ),
          },
          focused,
          platform,
          "The running entry stays on top",
        );
      }

      const entry = input.timesheetEntries.find(
        (item) => item._id === focused.entryId,
      );
      if (!entry) return null;
      return withReorderItems(
        {
          id: prefix,
          heading: describeEntry(entry, projects),
          items: toItems(
            prefix,
            getTimeEntryActions(getTimeEntryActionState(entry), {
              isToday: entry.localDate === input.today,
            }),
            (actionId) => ({
              kind: "time-entry",
              entryId: entry._id,
              actionId,
            }),
            keys,
          ),
        },
        focused,
        platform,
      );
    }
    case "task": {
      const found = findTask(projects, focused.projectId, focused.taskId);
      if (!found) return null;
      const section = taskSection(prefix, found.project, found.task, platform);
      // Only active tasks of an active project have an order to change.
      return found.project.status === "active" && found.task.status === "active"
        ? withReorderItems(section, focused, platform)
        : section;
    }
    case "backlog-item": {
      const workItem = input.workItems.find(
        (item) => item._id === focused.workItemId,
      );
      if (!workItem) return null;
      const section = backlogItemSection(
        prefix,
        workItem,
        input.workItems,
        input.settleOpensDialog,
        platform,
      );
      // Subitems follow their parent; only top-level items are sortable.
      return isSubtaskWorkItem(workItem)
        ? section
        : withReorderItems(section, focused, platform);
    }
    case "project": {
      const project = projects.find((item) => item._id === focused.projectId);
      if (!project) return null;
      const section = projectSection(prefix, project);
      // Only active projects are in the sidebar's order.
      return project.status === "active"
        ? withReorderItems(section, focused, platform)
        : section;
    }
    default:
      return null;
  }
}

/**
 * Tasks, backlog items and projects matching the query, best first. Archived
 * tasks and backlog items stay out; archived projects rank lower but still open.
 */
export function buildSearchResults(
  input: Pick<PaletteInput, "query" | "projects" | "workItems">,
): PaletteItem[] {
  if (!normalizeSearchText(input.query)) {
    return [];
  }

  const candidates: RankCandidate[] = [];
  for (const project of input.projects) {
    if (project.status !== "active") continue;
    for (const task of project.tasks) {
      if (task.status !== "active") continue;
      candidates.push({
        item: {
          id: `task:${project._id}:${task._id}`,
          label: task.name,
          detail: projectName(project),
          command: {
            kind: "show",
            view: { kind: "task", projectId: project._id, taskId: task._id },
          },
        },
        primary: task.name,
        secondary: [projectName(project), project.name, project.code],
      });
    }
  }

  for (const workItem of input.workItems) {
    if (workItem.status !== "active") continue;
    const reference = parseWorkItemReference(workItem.sourceId);
    const project = input.projects.find(
      (item) => item._id === workItem.projectId,
    );
    candidates.push({
      item: {
        id: `backlog-item:${workItem._id}`,
        label: workItem.title,
        detail: [
          reference ? `#${reference}` : undefined,
          project ? projectName(project) : "Backlog",
        ]
          .filter(Boolean)
          .join(" · "),
        command: {
          kind: "show",
          view: { kind: "backlog-item", workItemId: workItem._id },
        },
      },
      primary: workItem.title,
      secondary: [reference, project ? projectName(project) : undefined],
    });
  }

  for (const project of input.projects) {
    const isArchived = project.status === "archived";
    candidates.push({
      item: {
        id: `project:${project._id}`,
        label: projectName(project),
        detail:
          [project.code, isArchived ? "Archived" : undefined]
            .filter(Boolean)
            .join(" · ") || undefined,
        command: { kind: "open-project", projectId: project._id },
      },
      primary: projectName(project),
      secondary: [project.name, project.code],
      penalty: isArchived ? ARCHIVED_PENALTY : 0,
    });
  }

  return rank(input.query, candidates).slice(0, MAX_SEARCH_RESULTS);
}

function shortcutItem(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
): PaletteItem {
  return {
    id: `shortcut:${shortcut.id}`,
    label: shortcut.label,
    keys: formatShortcutKeys(shortcut, platform),
    command: { kind: "shortcut", shortcutId: shortcut.id },
  };
}

function actionItems(input: PaletteInput): PaletteItem[] {
  const hasActiveProject = input.projects.some(
    (project) => project.status === "active",
  );

  return [
    ...input.shortcuts
      .filter(
        (shortcut) =>
          !NAVIGATION_SHORTCUTS.includes(shortcut.id) &&
          !HIDDEN_SHORTCUTS.includes(shortcut.id),
      )
      .map((shortcut) => shortcutItem(shortcut, input.platform)),
    {
      id: "create-project",
      label: "Create project",
      command: { kind: "create-project" },
    },
    {
      id: "create-task-in",
      label: "Create task in…",
      disabledReason: hasActiveProject ? undefined : "Create a project first",
      command: { kind: "show", view: { kind: "create-task-in" } },
    },
  ];
}

function navigationItems(input: PaletteInput): PaletteItem[] {
  return [
    ...input.shortcuts
      .filter((shortcut) => NAVIGATION_SHORTCUTS.includes(shortcut.id))
      .map((shortcut) => shortcutItem(shortcut, input.platform)),
    {
      id: "navigate:/projects/archive",
      label: "Archived projects",
      detail: "Projects",
      command: { kind: "open-archive" },
    },
    ...input.settingsPages.map((page) => ({
      id: `navigate:${page.to}`,
      label: page.label,
      detail: "Settings",
      command: { kind: "navigate" as const, to: page.to },
    })),
  ];
}

function createTaskInItems(input: PaletteInput) {
  return rank(
    input.query,
    input.projects
      .filter((project) => project.status === "active")
      .map((project) => ({
        item: {
          id: `create-task-in:${project._id}`,
          label: projectName(project),
          detail: project.code,
          command: {
            kind: "project" as const,
            projectId: project._id,
            actionId: "new-task" as const,
          },
        },
        primary: projectName(project),
        secondary: [project.name, project.code],
      })),
  );
}

function filterSection(
  query: string,
  section: PaletteSection | null,
): PaletteSection | null {
  if (!section) return null;
  return { ...section, items: rankCommands(query, section.items) };
}

/**
 * Builds the palette's sections for the current view and query. The main list
 * shows the focused object's actions, search results, actions and navigation.
 * A task, a backlog item and "Create task in…" open lists of their own.
 * Sections with no matching item are dropped.
 */
export function buildPaletteSections(input: PaletteInput): PaletteSection[] {
  const { query, view } = input;
  let sections: (PaletteSection | null)[];

  switch (view.kind) {
    case "task": {
      const found = findTask(input.projects, view.projectId, view.taskId);
      sections = [
        filterSection(
          query,
          found ? taskSection("task", found.project, found.task) : null,
        ),
      ];
      break;
    }
    case "backlog-item": {
      const workItem = input.workItems.find(
        (item) => item._id === view.workItemId,
      );
      sections = [
        filterSection(
          query,
          workItem
            ? backlogItemSection(
                "backlog-item",
                workItem,
                input.workItems,
                input.settleOpensDialog,
              )
            : null,
        ),
      ];
      break;
    }
    case "create-task-in":
      sections = [
        {
          id: "create-task-in",
          heading: "Create task in…",
          items: createTaskInItems(input),
        },
      ];
      break;
    case "root":
      sections = [
        filterSection(query, focusedSection(input)),
        { id: "results", heading: "Results", items: buildSearchResults(input) },
        {
          id: "actions",
          heading: "Actions",
          items: rankCommands(query, actionItems(input)),
        },
        {
          id: "navigation",
          heading: "Navigation",
          items: rankCommands(query, navigationItems(input)),
        },
      ];
      break;
  }

  return sections.filter(
    (section): section is PaletteSection =>
      section !== null && section.items.length > 0,
  );
}
