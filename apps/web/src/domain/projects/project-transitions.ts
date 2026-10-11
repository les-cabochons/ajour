import type {
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
} from "@/domain/local-state";
import { normalizeProjectIcon } from "@/domain/projects/project-icon";
import {
  normalizeProjectTaskAdjustmentMs,
  normalizeProjectTaskBudgetMs,
} from "@/domain/projects/task-budget";

export interface ProjectFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export type ProjectPatch = Partial<Omit<LocalProject, "_id">>;

export type ProjectTaskPatch = Partial<
  Pick<LocalProjectTask, "name" | "billable" | "budgetMs" | "adjustmentMs">
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

  return {
    ...project,
    name,
    displayName,
    icon: normalizeProjectIcon(project.icon),
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
      };
    }),
  };
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

/** Appends a new task, with its billable flag, budget and adjustment, to a project. */
export function addProjectTask(
  projects: LocalProject[],
  projectId: string,
  task: LocalProjectTaskDraft,
  factories: ProjectFactories,
) {
  return projects.map((project) =>
    project._id === projectId
      ? {
          ...project,
          tasks: [...project.tasks, createProjectTask(task, factories)],
        }
      : project,
  );
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
  return projects.map((project) =>
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
