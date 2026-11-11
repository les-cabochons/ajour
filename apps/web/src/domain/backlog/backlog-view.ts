import {
  getPriorityLevelName,
  NO_PRIORITY_NAME,
  PRIORITY_LEVELS,
  type PriorityLevel,
} from "@/domain/backlog/priority";
import { isSubtaskWorkItem } from "@/domain/backlog/work-item-hierarchy";
import { isDoneWorkflowState } from "@/domain/backlog/workflow-states";
import {
  getLocalProjectDisplayName,
  type BacklogSortMode,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";

/**
 * What the Backlog page shows and how, from "Display" and "Filters" under
 * "Backlog" in docs/agents/ux-spec.md. The ordering is the persisted
 * `backlogSortMode`, which the sidebar shares; the rest is saved per device.
 */
export type BacklogLayout = "list" | "board";
export type BacklogGrouping = "state" | "priority" | "project" | "none";
export type BacklogSwimlanes = "none" | "project";
export type BacklogDoneWindow = "week" | "all" | "none";
export type BacklogProperty =
  "id" | "priority" | "project" | "estimate" | "sourceState";

export interface BacklogViewSettings {
  layout: BacklogLayout;
  grouping: BacklogGrouping;
  swimlanes: BacklogSwimlanes;
  doneWindow: BacklogDoneWindow;
  showSettled: boolean;
  showSubitems: boolean;
  properties: Record<BacklogProperty, boolean>;
}

export const DEFAULT_BACKLOG_VIEW_SETTINGS: BacklogViewSettings = {
  layout: "list",
  grouping: "state",
  swimlanes: "none",
  doneWindow: "week",
  showSettled: true,
  showSubitems: true,
  properties: {
    id: true,
    priority: true,
    project: true,
    estimate: true,
    sourceState: false,
  },
};

export const BACKLOG_ORDERINGS: readonly {
  value: BacklogSortMode;
  label: string;
}[] = [
  { value: "custom", label: "Custom" },
  { value: "priority_asc", label: "Priority" },
  { value: "created", label: "Created" },
  { value: "remaining", label: "Remaining estimate" },
  { value: "title", label: "Title" },
];

export type BacklogFilterField =
  | "state"
  | "priority"
  | "project"
  | "task"
  | "sourceProject"
  | "connection"
  | "type"
  | "hasEstimate"
  | "running";

/** One filter chip. Values are ids, "1" to "4" or "" for priority, and "yes" or "no" for flags. */
export interface BacklogFilter {
  field: BacklogFilterField;
  value: string;
}

/**
 * The State filter value that selects archived items, whatever their workflow
 * state, the done window or the reason they were archived. The colon keeps it
 * apart from workflow state ids.
 */
export const ARCHIVED_STATE_FILTER = ":archived";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BacklogViewContext {
  now: number;
  /** The item the running entry is on, if any. */
  runningWorkItemId?: string;
}

function hasEstimate(workItem: LocalWorkItem) {
  return (
    workItem.originalEstimateHours !== undefined ||
    workItem.remainingEstimateHours !== undefined ||
    workItem.completedEstimateHours !== undefined
  );
}

function matchesFilter(
  workItem: LocalWorkItem,
  filter: BacklogFilter,
  context: BacklogViewContext,
  workflowStateIds: ReadonlySet<string>,
  taskIdsByProject: ReadonlyMap<string, ReadonlySet<string>>,
) {
  switch (filter.field) {
    case "state":
      if (filter.value === ARCHIVED_STATE_FILTER)
        return workItem.status === "archived";
      return (
        (workItem.workflowStateId &&
        workflowStateIds.has(workItem.workflowStateId)
          ? workItem.workflowStateId
          : "") === filter.value
      );
    case "priority":
      return String(workItem.priority ?? "") === filter.value;
    case "project":
      return (
        (workItem.projectId && taskIdsByProject.has(workItem.projectId)
          ? workItem.projectId
          : "") === filter.value
      );
    case "task":
      return (
        (workItem.projectId &&
        workItem.taskId &&
        taskIdsByProject.get(workItem.projectId)?.has(workItem.taskId)
          ? workItem.taskId
          : "") === filter.value
      );
    case "sourceProject":
      return (workItem.sourceProjectName ?? "") === filter.value;
    case "connection":
      return (workItem.sourceConnectionId ?? "") === filter.value;
    case "type":
      return (workItem.sourceWorkItemType ?? "") === filter.value;
    case "hasEstimate":
      return hasEstimate(workItem) === (filter.value === "yes");
    case "running":
      return (
        (workItem._id === context.runningWorkItemId) ===
        (filter.value === "yes")
      );
  }
}

/** Whether the State filter asks for archived items, which makes the page the archive. */
export function showsArchiveFilter(filters: readonly BacklogFilter[]) {
  return filters.some(
    (filter) =>
      filter.field === "state" && filter.value === ARCHIVED_STATE_FILTER,
  );
}

/**
 * What a new item takes from the filters on, so it lands where the user is
 * looking: each of state, priority, project and task filtered to exactly one
 * value the item can start with. Values are the filter's, so "" means No
 * state, No priority or No project. A done state, the Archived state, an
 * archived project and a task outside the filtered project are left out, and
 * a task brings its project. Filters a new item can't take, such as Running,
 * are ignored; the item may still be hidden (`getFilterFieldsHiding`).
 */
export function getNewItemFilterPreset(
  state: Pick<LocalAppState, "workflowStates" | "projects">,
  filters: readonly BacklogFilter[],
): {
  workflowStateId?: string;
  priority?: string;
  projectId?: string;
  taskId?: string;
} {
  const only = (field: BacklogFilterField) => {
    const values = filters.filter((filter) => filter.field === field);
    return values.length === 1 ? values[0]!.value : undefined;
  };
  const preset: ReturnType<typeof getNewItemFilterPreset> = {};

  const stateId = only("state");
  if (
    stateId === "" ||
    (stateId !== undefined &&
      state.workflowStates.some((candidate) => candidate._id === stateId) &&
      !isDoneWorkflowState(state.workflowStates, stateId))
  ) {
    preset.workflowStateId = stateId;
  }

  const priority = only("priority");
  if (
    priority === "" ||
    PRIORITY_LEVELS.some(({ level }) => String(level) === priority)
  ) {
    preset.priority = priority;
  }

  const activeProjects = state.projects.filter(
    (project) => project.status === "active",
  );
  const projectId = only("project");
  if (
    projectId === "" ||
    activeProjects.some((project) => project._id === projectId)
  ) {
    preset.projectId = projectId;
  }

  const taskId = only("task");
  const taskProject = taskId
    ? activeProjects.find((project) =>
        project.tasks.some(
          (task) => task._id === taskId && task.status === "active",
        ),
      )
    : undefined;
  if (
    taskId &&
    taskProject &&
    (preset.projectId === undefined || preset.projectId === taskProject._id)
  ) {
    preset.projectId = taskProject._id;
    preset.taskId = taskId;
  }
  return preset;
}

/**
 * The filter fields that hide the item `itemId`, in the order they were
 * added, so a page can offer to remove just those. Each field's filters are
 * judged alone, so a display setting that hides the item (see
 * `getDisplaySettingsHiding`) never blames a filter that matches it. Empty
 * when the filters show it.
 */
export function getFilterFieldsHiding(
  state: Pick<LocalAppState, "workItems" | "workflowStates" | "projects">,
  filters: readonly BacklogFilter[],
  context: BacklogViewContext,
  itemId: string,
): BacklogFilterField[] {
  const workItem = state.workItems.find(
    (candidate) => candidate._id === itemId,
  );
  if (!workItem) return [];
  const workflowStateIds = new Set(
    state.workflowStates.map((workflowState) => workflowState._id),
  );
  const taskIdsByProject = new Map(
    state.projects.map((project) => [
      project._id,
      new Set(project.tasks.map((task) => task._id)),
    ]),
  );
  const fields = [...new Set(filters.map((filter) => filter.field))];
  return fields.filter(
    (field) =>
      !filters.some(
        (filter) =>
          filter.field === field &&
          matchesFilter(
            workItem,
            filter,
            context,
            workflowStateIds,
            taskIdsByProject,
          ),
      ),
  );
}

/**
 * The Display settings that hide `workItem` whatever the filters say: Show
 * subitems off hides a subitem, and Show settled off hides a settled item.
 * Turning them on shows the item.
 */
export function getDisplaySettingsHiding(
  settings: Pick<BacklogViewSettings, "showSubitems" | "showSettled">,
  workItem: LocalWorkItem,
): ("showSubitems" | "showSettled")[] {
  const hiding: ("showSubitems" | "showSettled")[] = [];
  if (!settings.showSubitems && isSubtaskWorkItem(workItem)) {
    hiding.push("showSubitems");
  }
  if (!settings.showSettled && workItem.status === "settled") {
    hiding.push("showSettled");
  }
  return hiding;
}

/**
 * The items the page shows. Archived items show only in a done state and
 * within the done window, unless the Archived state filter asks for all of
 * them; items archived for leaving the sync show only under that filter.
 * Filters of different fields must all match; filters of one field match any.
 */
export function selectBacklogViewItems(
  state: Pick<LocalAppState, "workItems" | "workflowStates" | "projects">,
  settings: BacklogViewSettings,
  filters: readonly BacklogFilter[],
  context: BacklogViewContext,
): LocalWorkItem[] {
  const workflowStateIds = new Set(
    state.workflowStates.map((state) => state._id),
  );
  const taskIdsByProject = new Map(
    state.projects.map((project) => [
      project._id,
      new Set(project.tasks.map((task) => task._id)),
    ]),
  );
  const filtersByField = new Map<BacklogFilterField, BacklogFilter[]>();
  for (const filter of filters) {
    filtersByField.set(filter.field, [
      ...(filtersByField.get(filter.field) ?? []),
      filter,
    ]);
  }

  const showsArchive = showsArchiveFilter(filters);

  return state.workItems.filter((workItem) => {
    if (workItem.status === "archived" && !showsArchive) {
      if (
        settings.doneWindow === "none" ||
        workItem.archivedByMissingSync ||
        !isDoneWorkflowState(state.workflowStates, workItem.workflowStateId)
      ) {
        return false;
      }
      if (
        settings.doneWindow === "week" &&
        (workItem.archivedAt ?? 0) < context.now - WEEK_MS
      ) {
        return false;
      }
    }
    if (!settings.showSettled && workItem.status === "settled") return false;
    if (!settings.showSubitems && isSubtaskWorkItem(workItem)) return false;

    for (const group of filtersByField.values()) {
      if (
        !group.some((filter) =>
          matchesFilter(
            workItem,
            filter,
            context,
            workflowStateIds,
            taskIdsByProject,
          ),
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Splits the shown items between the groups and the two shelves below them.
 * Settled items leave their group for the Settled shelf, latest settled
 * first, and archived items for the Done shelf, latest archived first, so the
 * groups hold only the work on the user's plate in every grouping. With
 * `doneInGroups`, as on the board grouped by state, archived items stay in
 * their done state's column instead and the Done shelf is empty. Under the
 * Archived state filter the page is the archive, so the groups keep every
 * item and both shelves are empty. "Shelves" under "Backlog" in
 * docs/agents/ux-spec.md.
 */
export function splitBacklogShelves(
  items: readonly LocalWorkItem[],
  filters: readonly BacklogFilter[],
  { doneInGroups = false }: { doneInGroups?: boolean } = {},
): {
  /** The items that stay in the groups and columns. */
  grouped: LocalWorkItem[];
  settled: LocalWorkItem[];
  done: LocalWorkItem[];
} {
  if (showsArchiveFilter(filters))
    return { grouped: [...items], settled: [], done: [] };
  const grouped: LocalWorkItem[] = [];
  const settled: LocalWorkItem[] = [];
  const done: LocalWorkItem[] = [];
  for (const workItem of items) {
    if (workItem.status === "archived")
      (doneInGroups ? grouped : done).push(workItem);
    else if (workItem.status === "settled") settled.push(workItem);
    else grouped.push(workItem);
  }
  // Array.prototype.sort is stable, so equal dates keep the page's order.
  settled.sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0));
  done.sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
  return { grouped, settled, done };
}

/** Orders items by the persisted ordering. Ties keep the custom order. */
export function orderBacklogItems(
  items: readonly LocalWorkItem[],
  allItems: readonly LocalWorkItem[],
  ordering: BacklogSortMode,
): LocalWorkItem[] {
  const customIndex = new Map(
    allItems.map((workItem, index) => [workItem._id, index]),
  );
  const custom = (left: LocalWorkItem, right: LocalWorkItem) =>
    (customIndex.get(left._id) ?? 0) - (customIndex.get(right._id) ?? 0);
  const missingLast = (value: number | undefined) =>
    value ?? Number.MAX_SAFE_INTEGER;

  return [...items].sort((left, right) => {
    switch (ordering) {
      case "priority_asc":
        return (
          missingLast(left.priority) - missingLast(right.priority) ||
          custom(left, right)
        );
      case "priority_desc":
        return (
          missingLast(right.priority) - missingLast(left.priority) ||
          custom(left, right)
        );
      case "created":
        return right.createdAt - left.createdAt || custom(left, right);
      case "remaining":
        return (
          missingLast(left.remainingEstimateHours) -
            missingLast(right.remainingEstimateHours) || custom(left, right)
        );
      case "title":
        return (
          left.title.localeCompare(right.title, undefined, {
            sensitivity: "base",
          }) || custom(left, right)
        );
      default:
        return custom(left, right);
    }
  });
}

/**
 * Whether a drag or Alt+Up and Alt+Down can move `item` past `peer` in the
 * custom order. Custom moves top-level items, since a subitem sits below its
 * parent. Priority moves an item among the items of its level, subitems
 * included, so a move never changes a priority. The other orderings sort by
 * a field, so nothing moves. Pass the item as its own peer to ask whether it
 * moves at all.
 */
export function isBacklogReorderPeer(
  ordering: BacklogSortMode,
  item: LocalWorkItem,
  peer: LocalWorkItem,
): boolean {
  switch (ordering) {
    case "custom":
      return !isSubtaskWorkItem(item) && !isSubtaskWorkItem(peer);
    case "priority_asc":
    case "priority_desc":
      return item.priority === peer.priority;
    default:
      return false;
  }
}

/** One group of rows, or one board column. */
export type BacklogGroup =
  | {
      kind: "state";
      key: string;
      label: string;
      /** Missing for "No state". */
      workflowStateId?: string;
      color?: string;
      done: boolean;
      items: LocalWorkItem[];
    }
  | {
      kind: "priority";
      key: string;
      label: string;
      priority?: PriorityLevel;
      items: LocalWorkItem[];
    }
  | {
      kind: "project";
      key: string;
      label: string;
      projectId?: string;
      archived: boolean;
      items: LocalWorkItem[];
    }
  | { kind: "all"; key: string; label: string; items: LocalWorkItem[] };

/**
 * Groups ordered items. Every workflow state, priority level and active
 * project gets a group, so the board has a column to drop on, and "No state",
 * "No priority" and "No project" collect the rest. `keepEmpty` keeps groups
 * without items; the list drops them, except "No state" which never shows
 * empty anyway.
 */
export function groupBacklogItems(
  state: Pick<LocalAppState, "workflowStates" | "projects">,
  items: readonly LocalWorkItem[],
  grouping: BacklogGrouping,
  options: { keepEmpty: boolean },
): BacklogGroup[] {
  const groups: BacklogGroup[] = (() => {
    switch (grouping) {
      case "state": {
        const known = new Set(state.workflowStates.map((s) => s._id));
        return [
          {
            kind: "state" as const,
            key: "state:none",
            label: "No state",
            done: false,
            items: items.filter(
              (workItem) =>
                !workItem.workflowStateId ||
                !known.has(workItem.workflowStateId),
            ),
          },
          ...state.workflowStates.map((workflowState) => ({
            kind: "state" as const,
            key: `state:${workflowState._id}`,
            label: workflowState.name,
            workflowStateId: workflowState._id,
            color: workflowState.color,
            done: workflowState.done === true,
            items: items.filter(
              (workItem) => workItem.workflowStateId === workflowState._id,
            ),
          })),
        ];
      }
      case "priority":
        return [
          ...PRIORITY_LEVELS.map(({ level }) => ({
            kind: "priority" as const,
            key: `priority:${level}`,
            label: getPriorityLevelName(level),
            priority: level,
            items: items.filter((workItem) => workItem.priority === level),
          })),
          {
            kind: "priority" as const,
            key: "priority:none",
            label: NO_PRIORITY_NAME,
            items: items.filter((workItem) => workItem.priority === undefined),
          },
        ];
      case "project": {
        const projects = state.projects.filter(
          (project) =>
            project.status === "active" ||
            items.some((workItem) => workItem.projectId === project._id),
        );
        const known = new Set(projects.map((project) => project._id));
        return [
          ...projects.map((project) => ({
            kind: "project" as const,
            key: `project:${project._id}`,
            label: getLocalProjectDisplayName(project),
            projectId: project._id,
            archived: project.status === "archived",
            items: items.filter(
              (workItem) => workItem.projectId === project._id,
            ),
          })),
          {
            kind: "project" as const,
            key: "project:none",
            label: "No project",
            archived: false,
            items: items.filter(
              (workItem) =>
                !workItem.projectId || !known.has(workItem.projectId),
            ),
          },
        ];
      }
      default:
        return [
          {
            kind: "all" as const,
            key: "all",
            label: "All items",
            items: [...items],
          },
        ];
    }
  })();

  return groups.filter(
    (group) =>
      group.items.length > 0 ||
      (options.keepEmpty &&
        !(group.kind === "state" && !group.workflowStateId)),
  );
}

/** The subitem progress a parent shows, as "2/5": closed over all subitems. */
export function getSubitemProgress(subitems: readonly LocalWorkItem[]) {
  if (subitems.length === 0) return null;
  return {
    closed: subitems.filter((subitem) => subitem.status === "archived").length,
    total: subitems.length,
  };
}

/**
 * The remaining estimate left on a parent's open subitems, in hours. Closed
 * subitems count for nothing; undefined when no open subitem has an estimate.
 */
export function getSubitemHoursLeft(subitems: readonly LocalWorkItem[]) {
  let hoursLeft: number | undefined;
  for (const subitem of subitems) {
    if (
      subitem.status !== "archived" &&
      subitem.remainingEstimateHours !== undefined
    ) {
      hoursLeft = (hoursLeft ?? 0) + subitem.remainingEstimateHours;
    }
  }
  return hoursLeft;
}
