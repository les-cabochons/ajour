import {
  isPinnedTaskSlot,
  type LocalProject,
  type LocalProjectDraft,
  type LocalProjectSource,
  type LocalProjectTask,
  type LocalProjectTaskDraft,
  type PinnedTaskSlot,
} from "@/domain/local-state";
import {
  normalizeLocalOnly,
  normalizeTaskCommitAs,
} from "@/domain/projects/commit-target";
import { normalizeProjectIcon } from "@/domain/projects/project-icon";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";
import { normalizePluginProperties } from "@/domain/projects/plugin-properties";
import {
  normalizeArchiveMark,
  normalizeProjectSourceBudget,
  normalizeProjectSourceLink,
  normalizeSourceText,
  normalizeTaskSourceLink,
} from "@/domain/projects/source-link";
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
    | "name"
    | "billable"
    | "budgetMs"
    | "adjustmentMs"
    | "pinnedSlot"
    | "pluginProperties"
    | "commitAs"
  >
>;

export function createProjectTask(
  task: LocalProjectTaskDraft,
  factories: ProjectFactories,
): LocalProjectTask {
  const createdAt = factories.now();
  const status = task.status ?? "active";
  const pluginProperties = normalizePluginProperties(task.pluginProperties);
  const commitAs = normalizeTaskCommitAs(task.commitAs);

  return {
    _id: factories.createId("task"),
    name: task.name,
    status,
    createdAt,
    archivedAt: status === "archived" ? createdAt : undefined,
    billable: task.billable ?? true,
    budgetMs: normalizeProjectTaskBudgetMs(task.budgetMs),
    adjustmentMs: normalizeProjectTaskAdjustmentMs(task.adjustmentMs),
    ...(pluginProperties ? { pluginProperties } : {}),
    ...(commitAs ? { commitAs } : {}),
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
  // A project is managed or shared, never both: the team link wins.
  const source = team ? undefined : normalizeProjectSourceLink(project.source);

  return {
    ...project,
    name,
    displayName,
    icon: normalizeProjectIcon(project.icon),
    pluginProperties: normalizePluginProperties(project.pluginProperties),
    localOnly: normalizeLocalOnly(project.localOnly),
    favoritedAt: normalizeFavoritedAt(project.favoritedAt),
    team,
    source,
    client: normalizeSourceText(project.client),
    startsOn: normalizeSourceText(project.startsOn),
    endsOn: normalizeSourceText(project.endsOn),
    budget: normalizeProjectSourceBudget(project.budget),
    archivedByMissingSync: normalizeArchiveMark(project.archivedByMissingSync),
    archivedBySource: normalizeArchiveMark(project.archivedBySource),
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
        pluginProperties: normalizePluginProperties(task.pluginProperties),
        commitAs: normalizeTaskCommitAs(task.commitAs),
        // Only a project the team knows can have tasks the team knows.
        team: team?.remoteId ? normalizeTaskTeamLink(task.team) : undefined,
        // Only a managed project can have tasks its source knows.
        source: source ? normalizeTaskSourceLink(task.source) : undefined,
        archivedByMissingSync: normalizeArchiveMark(task.archivedByMissingSync),
        archivedBySource: normalizeArchiveMark(task.archivedBySource),
      };
    }),
  };
}

function normalizeFavoritedAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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

/**
 * The fields a managed project's source owns. The user can't change them in
 * Ajour: every sync would put the source's value back (ADR 0016).
 */
const SOURCE_OWNED_PROJECT_FIELDS = [
  "name",
  "code",
  "client",
  "startsOn",
  "endsOn",
  "budget",
] as const satisfies readonly (keyof LocalProject)[];

/** Whether the project follows a project source, which locks its full name, code and client. */
export function isManagedProject(project: Pick<LocalProject, "source">) {
  return project.source !== undefined;
}

/** Whether the task's name follows its project source, so the user can't change it. */
export function isTaskNameLocked(task: Pick<LocalProjectTask, "source">) {
  return task.source !== undefined;
}

/** The patch without what the project's source owns, when it has one. */
function withoutSourceOwnedFields(project: LocalProject, patch: ProjectPatch) {
  if (!isManagedProject(project)) return patch;
  const allowed = { ...patch };
  for (const field of SOURCE_OWNED_PROJECT_FIELDS) delete allowed[field];
  return allowed;
}

/**
 * Changes a project. On a managed project, a change to a field its source
 * owns is left out.
 */
export function updateProject(
  projects: LocalProject[],
  projectId: string,
  requested: ProjectPatch,
) {
  return projects.map((project) => {
    if (project._id !== projectId) {
      return project;
    }

    const patch = withoutSourceOwnedFields(project, requested);
    const nextProject = { ...project, ...patch };
    if (
      typeof patch.name === "string" &&
      !Object.prototype.hasOwnProperty.call(patch, "displayName") &&
      project.displayName === project.name
    ) {
      nextProject.displayName = patch.name;
    }
    // The user's archive or restore: no longer the project source's.
    if (patch.status !== undefined && patch.status !== project.status) {
      delete nextProject.archivedByMissingSync;
      delete nextProject.archivedBySource;
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

/**
 * The project's task with this name as task imports compare names: trimmed,
 * spaces collapsed, case and accents ignored. An active task wins over an
 * archived one of the same name.
 */
export function findProjectTaskByImportName(
  project: Pick<LocalProject, "tasks">,
  name: string,
): LocalProjectTask | undefined {
  const key = normalizeTaskImportName(name);
  const matches = project.tasks.filter(
    (task) => normalizeTaskImportName(task.name) === key,
  );
  return matches.find((task) => task.status === "active") ?? matches[0];
}

/** What `createOrRestoreProjectTask` did. */
export type CreateOrRestoreTaskOutcome = "existing" | "restored" | "created";

/**
 * Gives the project a task of this name for a picker or a timelog (#481):
 * the active task of that name, an archived one restored, or a new task with
 * the name as typed, trimmed and with spaces collapsed. Matching the way
 * imports do means a later import of the same task updates this one instead
 * of adding a twin. Throws when the project is missing or the name is blank.
 */
export function createOrRestoreProjectTask(
  projects: LocalProject[],
  projectId: string,
  draft: LocalProjectTaskDraft,
  factories: ProjectFactories,
): {
  projects: LocalProject[];
  taskId: string;
  outcome: CreateOrRestoreTaskOutcome;
} {
  const project = projects.find((candidate) => candidate._id === projectId);
  if (!project) throw new Error(`No project has the id ${projectId}.`);
  const name = formatTaskImportName(draft.name);
  if (!name) throw new Error("Enter a task name.");

  const found = findProjectTaskByImportName(project, name);
  if (found?.status === "active") {
    return { projects, taskId: found._id, outcome: "existing" };
  }
  if (found) {
    return {
      projects: setProjectTaskStatus(
        projects,
        projectId,
        found._id,
        "active",
        factories.now,
      ),
      taskId: found._id,
      outcome: "restored",
    };
  }
  const created = createProjectTask({ ...draft, name }, factories);
  return {
    projects: projects.map((candidate) =>
      candidate._id === projectId
        ? { ...candidate, tasks: [...candidate.tasks, created] }
        : candidate,
    ),
    taskId: created._id,
    outcome: "created",
  };
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
                  // A source task's name follows its source.
                  name: isTaskNameLocked(task)
                    ? task.name
                    : (patch.name ?? task.name),
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
                  pluginProperties:
                    "pluginProperties" in patch
                      ? normalizePluginProperties(patch.pluginProperties)
                      : task.pluginProperties,
                  commitAs:
                    "commitAs" in patch
                      ? normalizeTaskCommitAs(patch.commitAs)
                      : task.commitAs,
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
                  // The user's archive or restore: no longer the source's.
                  archivedByMissingSync: undefined,
                  archivedBySource: undefined,
                }
              : task,
          ),
        }
      : project,
  );
}

/** What a hand restore gives: the projects, or why it changed nothing. */
export interface RestoreResult {
  projects: LocalProject[];
  /** Set when the restore is refused, as a sentence for the user. */
  refusal?: string;
}

/** What the user calls a project's source, such as "Example planner". */
function sourceLabelOf(
  project: LocalProject,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
) {
  const connectionId = project.source?.connectionId;
  return (
    (connectionId ? projectSources?.[connectionId]?.label : undefined) ??
    "Its source"
  );
}

/**
 * Why the user can't restore this project by hand: its project source
 * archived it, so the next sync would archive it again (#505).
 */
export function getProjectRestoreRefusal(
  project: LocalProject,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): string | undefined {
  if (project.status !== "archived") return undefined;
  const label = sourceLabelOf(project, projectSources);
  if (project.archivedBySource) return `${label} marks this project complete.`;
  if (project.archivedByMissingSync) {
    return `This project is no longer in ${label}.`;
  }
  return undefined;
}

/** Why the user can't restore this task by hand: its source archived it. */
export function getTaskRestoreRefusal(
  project: LocalProject,
  task: LocalProjectTask,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): string | undefined {
  if (task.status !== "archived") return undefined;
  const label = sourceLabelOf(project, projectSources);
  if (task.archivedBySource) return `${label} closed this task.`;
  if (task.archivedByMissingSync) return `This task is no longer in ${label}.`;
  return undefined;
}

/**
 * The user's Restore of an archived project. A project its source archived
 * stays archived: the source decides when it comes back.
 */
export function restoreProject(
  projects: LocalProject[],
  projectId: string,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): RestoreResult {
  const project = projects.find((candidate) => candidate._id === projectId);
  const refusal = project
    ? getProjectRestoreRefusal(project, projectSources)
    : undefined;
  if (refusal) return { projects, refusal };
  return { projects: updateProject(projects, projectId, { status: "active" }) };
}

/**
 * The user's Restore of an archived task. A task its source closed or left
 * out stays archived.
 */
export function restoreProjectTask(
  projects: LocalProject[],
  projectId: string,
  taskId: string,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
  now: () => number,
): RestoreResult {
  const project = projects.find((candidate) => candidate._id === projectId);
  const task = project?.tasks.find((candidate) => candidate._id === taskId);
  const refusal =
    project && task
      ? getTaskRestoreRefusal(project, task, projectSources)
      : undefined;
  if (refusal) return { projects, refusal };
  return {
    projects: setProjectTaskStatus(projects, projectId, taskId, "active", now),
  };
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
