import {
  isPinnedTaskSlot,
  type LocalProject,
  type LocalProjectDraft,
  type LocalProjectTask,
  type LocalProjectTaskDraft,
  type PinnedTaskSlot,
} from "@/domain/local-state";
import { normalizeProjectIcon } from "@/domain/projects/project-icon";
import { normalizePluginProperties } from "@/domain/projects/plugin-properties";
import {
  normalizeProjectTeamLink,
  normalizeTaskTeamLink,
} from "@/domain/projects/team-link";
import {
  normalizeProjectTaskAdjustmentMs,
  normalizeProjectTaskBudgetMs,
} from "@/domain/projects/task-budget";

/** The color a new project starts with. */
export const DEFAULT_PROJECT_COLOR = "#1f7667";

export interface ProjectFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export type ProjectPatch = Partial<Omit<LocalProject, "_id">>;

/** A task edit. `pinnedSlot` moves the slot from any task that holds it. */
export type ProjectTaskPatch = Partial<
  Pick<
    LocalProjectTask,
    "name" | "billable" | "budgetMs" | "adjustmentMs" | "pinnedSlot"
  >
>;

export function createProjectTask(
  task: LocalProjectTaskDraft,
  factories: ProjectFactories,
): LocalProjectTask {
  const createdAt = factories.now();
  const status = task.status ?? "active";

  return {
    _id: factories.createId("task"),
    name: task.name,
    status,
    createdAt,
    archivedAt: status === "archived" ? createdAt : undefined,
    billable: task.billable ?? true,
    budgetMs: normalizeProjectTaskBudgetMs(task.budgetMs),
    adjustmentMs: normalizeProjectTaskAdjustmentMs(task.adjustmentMs),
  };
}

export function createProject(
  project: LocalProjectDraft,
  factories: ProjectFactories,
): LocalProject {
  const name = project.name.trim();
  const displayName = project.displayName?.trim() || name;

  return {
    ...project,
    name,
    displayName,
    _id: factories.createId("project"),
    icon: normalizeProjectIcon(project.icon),
    status: project.status ?? "active",
    tasks: (project.tasks ?? []).map((task) =>
      createProjectTask(task, factories),
    ),
  };
}

export function normalizeProject(
  project: LocalProject,
  now: () => number,
): LocalProject {
  const name = project.name.trim();
  const displayName = project.displayName?.trim() || name;
  let hydrationTimestamp: number | undefined;
  const getHydrationTimestamp = () => (hydrationTimestamp ??= now());
  const team = normalizeProjectTeamLink(project.team);

  return {
    ...project,
    name,
    displayName,
    icon: normalizeProjectIcon(project.icon),
    pluginProperties: normalizePluginProperties(project.pluginProperties),
    favoritedAt: normalizeFavoritedAt(project.favoritedAt),
    team,
    status:
      project.status === "archived" || project.status === "active"
        ? project.status
        : "active",
    tasks: (project.tasks ?? []).map((task) => {
      const createdAt = task.createdAt ?? getHydrationTimestamp();
      const status = task.status === "archived" ? "archived" : "active";

      return {
        ...task,
        status,
        createdAt,
        archivedAt:
          status === "archived" ? (task.archivedAt ?? createdAt) : undefined,
        billable: task.billable ?? true,
        budgetMs: normalizeProjectTaskBudgetMs(task.budgetMs),
        adjustmentMs: normalizeProjectTaskAdjustmentMs(task.adjustmentMs),
        pinnedSlot: isPinnedTaskSlot(task.pinnedSlot)
          ? task.pinnedSlot
          : undefined,
        favoritedAt: normalizeFavoritedAt(task.favoritedAt),
        // Only a project the team knows can have tasks the team knows.
        team: team?.remoteId ? normalizeTaskTeamLink(task.team) : undefined,
      };
    }),
  };
}

function normalizeFavoritedAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function addProject(
  projects: LocalProject[],
  draft: LocalProjectDraft,
  factories: ProjectFactories,
) {
  const project = createProject(draft, factories);

  return {
    projects: [...projects, project],
    result: project._id,
  };
}

export function updateProject(
  projects: LocalProject[],
  projectId: string,
  patch: ProjectPatch,
) {
  return projects.map((project) => {
    if (project._id !== projectId) {
      return project;
    }

    const nextProject = { ...project, ...patch };
    if (
      typeof patch.name === "string" &&
      !Object.prototype.hasOwnProperty.call(patch, "displayName") &&
      project.displayName === project.name
    ) {
      nextProject.displayName = patch.name;
    }
    return nextProject;
  });
}

export function reorderProjects(
  projects: LocalProject[],
  orderedIds: string[],
) {
  if (orderedIds.length < 2) {
    return projects;
  }

  const nextIndexById = new Map(orderedIds.map((id, index) => [id, index]));
  const selectedProjects = projects.filter((project) =>
    nextIndexById.has(project._id),
  );

  if (selectedProjects.length !== orderedIds.length) {
    return projects;
  }

  const reorderedProjects = [...selectedProjects].sort(
    (left, right) =>
      nextIndexById.get(left._id)! - nextIndexById.get(right._id)!,
  );
  let cursor = 0;
  let changed = false;
  const nextProjects = projects.map((project) => {
    if (!nextIndexById.has(project._id)) {
      return project;
    }

    const nextProject = reorderedProjects[cursor++] ?? project;
    changed ||= nextProject._id !== project._id;
    return nextProject;
  });

  return changed ? nextProjects : projects;
}

/**
 * Appends a new task, with its billable flag, budget and adjustment, to a
 * project. A pinned slot in the draft moves from any task that holds it.
 */
export function addProjectTask(
  projects: LocalProject[],
  projectId: string,
  task: LocalProjectTaskDraft,
  factories: ProjectFactories,
) {
  const createdTask = createProjectTask(task, factories);
  const nextProjects = projects.map((project) =>
    project._id === projectId
      ? { ...project, tasks: [...project.tasks, createdTask] }
      : project,
  );

  return task.pinnedSlot
    ? setProjectTaskPinnedSlot(
        nextProjects,
        projectId,
        createdTask._id,
        task.pinnedSlot,
      )
    : nextProjects;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);

  if (!item) {
    return items;
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

export function reorderProjectTask(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  toIndex: number,
) {
  return projects.map((project) => {
    if (project._id !== projectId) {
      return project;
    }

    const activeTasks = project.tasks.filter(
      (task) => task.status === "active",
    );
    if (
      activeTasks.length < 2 ||
      !Number.isFinite(toIndex) ||
      !Number.isInteger(toIndex)
    ) {
      return project;
    }

    const sourceIndex = activeTasks.findIndex((task) => task._id === taskId);
    const targetIndex = Math.max(0, Math.min(toIndex, activeTasks.length - 1));

    if (sourceIndex === -1 || sourceIndex === targetIndex) {
      return project;
    }

    return {
      ...project,
      tasks: [
        ...moveItem(activeTasks, sourceIndex, targetIndex),
        ...project.tasks.filter((task) => task.status === "archived"),
      ],
    };
  });
}

export function updateProjectTask(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  patch: ProjectTaskPatch,
) {
  const nextProjects = projects.map((project) =>
    project._id === projectId
      ? {
          ...project,
          tasks: project.tasks.map((task) =>
            task._id === taskId
              ? {
                  ...task,
                  name: patch.name ?? task.name,
                  billable:
                    "billable" in patch
                      ? (patch.billable ?? true)
                      : (task.billable ?? true),
                  budgetMs:
                    "budgetMs" in patch
                      ? normalizeProjectTaskBudgetMs(patch.budgetMs)
                      : task.budgetMs,
                  adjustmentMs:
                    "adjustmentMs" in patch
                      ? normalizeProjectTaskAdjustmentMs(patch.adjustmentMs)
                      : task.adjustmentMs,
                }
              : task,
          ),
        }
      : project,
  );

  return "pinnedSlot" in patch
    ? setProjectTaskPinnedSlot(
        nextProjects,
        projectId,
        taskId,
        patch.pinnedSlot,
      )
    : nextProjects;
}

export function setProjectTaskStatus(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  status: LocalProjectTask["status"],
  now: () => number,
) {
  return projects.map((project) =>
    project._id === projectId
      ? {
          ...project,
          tasks: project.tasks.map((task) =>
            task._id === taskId
              ? {
                  ...task,
                  status,
                  archivedAt:
                    status === "archived"
                      ? (task.archivedAt ?? now())
                      : undefined,
                }
              : task,
          ),
        }
      : project,
  );
}

/**
 * Gives a task a pinned slot, or clears it when `slot` is undefined. A slot
 * belongs to one task at most, so assigning a slot another task holds moves it:
 * that task loses it. The task's previous slot becomes free.
 */
export function setProjectTaskPinnedSlot(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  slot: PinnedTaskSlot | undefined,
) {
  return projects.map((project) => {
    const isTarget = (task: LocalProjectTask) =>
      project._id === projectId && task._id === taskId;
    const holdsSlot = (task: LocalProjectTask) =>
      slot !== undefined && task.pinnedSlot === slot;

    if (!project.tasks.some((task) => isTarget(task) || holdsSlot(task))) {
      return project;
    }

    return {
      ...project,
      tasks: project.tasks.map((task) => {
        if (isTarget(task)) {
          return { ...task, pinnedSlot: slot };
        }

        return holdsSlot(task) ? { ...task, pinnedSlot: undefined } : task;
      }),
    };
  });
}

/**
 * Stars a project at `favoritedAt`, or removes its star when undefined. A
 * project's star and its tasks' stars are independent.
 */
export function setProjectFavorite(
  projects: LocalProject[],
  projectId: string,
  favoritedAt: number | undefined,
) {
  return projects.map((project) =>
    project._id === projectId ? { ...project, favoritedAt } : project,
  );
}

/** Stars a task at `favoritedAt`, or removes its star when undefined. */
export function setProjectTaskFavorite(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  favoritedAt: number | undefined,
) {
  return projects.map((project) =>
    project._id === projectId
      ? {
          ...project,
          tasks: project.tasks.map((task) =>
            task._id === taskId ? { ...task, favoritedAt } : task,
          ),
        }
      : project,
  );
}

export type Favorite =
  | { kind: "project"; project: LocalProject; favoritedAt: number }
  | {
      kind: "task";
      project: LocalProject;
      task: LocalProjectTask;
      favoritedAt: number;
    };

/**
 * The starred projects and tasks, mixed, newest star first. An archived task,
 * or anything in an archived project, keeps its star but is left out until it
 * is restored.
 */
export function getFavorites(projects: readonly LocalProject[]): Favorite[] {
  const favorites: Favorite[] = [];

  for (const project of projects) {
    if (project.status !== "active") continue;
    if (project.favoritedAt !== undefined) {
      favorites.push({
        kind: "project",
        project,
        favoritedAt: project.favoritedAt,
      });
    }
    for (const task of project.tasks) {
      if (task.status === "active" && task.favoritedAt !== undefined) {
        favorites.push({
          kind: "task",
          project,
          task,
          favoritedAt: task.favoritedAt,
        });
      }
    }
  }

  return favorites.sort((a, b) => b.favoritedAt - a.favoritedAt);
}

export interface PinnedTask {
  project: LocalProject;
  task: LocalProjectTask;
}

/**
 * The task holding each pinned slot, archived or not. A slot no task holds is
 * missing from the map.
 */
export function getPinnedTasksBySlot(projects: LocalProject[]) {
  const pinnedTasks = new Map<PinnedTaskSlot, PinnedTask>();

  for (const project of projects) {
    for (const task of project.tasks) {
      if (task.pinnedSlot && !pinnedTasks.has(task.pinnedSlot)) {
        pinnedTasks.set(task.pinnedSlot, { project, task });
      }
    }
  }

  return pinnedTasks;
}

/**
 * The task a number key opens or starts. An archived task, or a task in an
 * archived project, keeps its slot, but the key does nothing until it is restored.
 */
export function findPinnedTask(
  projects: LocalProject[],
  slot: PinnedTaskSlot,
): PinnedTask | undefined {
  const pinnedTask = getPinnedTasksBySlot(projects).get(slot);

  return pinnedTask?.project.status === "active" &&
    pinnedTask.task.status === "active"
    ? pinnedTask
    : undefined;
}
