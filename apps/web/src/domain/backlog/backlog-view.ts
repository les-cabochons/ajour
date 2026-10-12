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
 * "Backlog" in agents/ux-spec.md. The ordering is the persisted
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
  projectIds: ReadonlySet<string>,
) {
  switch (filter.field) {
    case "state":
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
        (workItem.projectId && projectIds.has(workItem.projectId)
          ? workItem.projectId
          : "") === filter.value
      );
    case "task":
      return (workItem.taskId ?? "") === filter.value;
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

/**
 * The items the page shows. Archived items show only in a done state and
 * within the done window; items archived for leaving the sync live in Archive.
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
  const projectIds = new Set(state.projects.map((project) => project._id));
  const filtersByField = new Map<BacklogFilterField, BacklogFilter[]>();
  for (const filter of filters) {
    filtersByField.set(filter.field, [
      ...(filtersByField.get(filter.field) ?? []),
      filter,
    ]);
  }

  return state.workItems.filter((workItem) => {
    if (workItem.status === "archived") {
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
            projectIds,
          ),
        )
      ) {
        return false;
      }
    }
    return true;
  });
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
