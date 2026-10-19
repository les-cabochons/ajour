import {
  getDescriptionTimelog,
  isSameTimelog,
  type DescriptionTimelog,
} from "@/domain/backlog/description-frontmatter";
import { updateWorkItem } from "@/domain/backlog/work-item-transitions";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalProject,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  addProject,
  addProjectTask,
  DEFAULT_PROJECT_COLOR,
  setProjectTaskStatus,
  updateProject,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";

/**
 * A description's `timelog` sets its backlog item's project and task (#281).
 * Saving a description applies its timelog when the timelog changed, unless
 * the project is missing or the task would change a shared project. Whenever
 * the item's project or task differs from the timelog, the properties offer
 * to apply it (`getTimelogMismatch`, `applyItemTimelog`).
 */

/** How the item's project and task differ from what its timelog names. */
export type TimelogMismatch =
  | {
      /** No active project has the name. */
      kind: "missing-project";
      projectName: string;
      taskName?: string;
      /** An archived project of that name, which applying restores. */
      archivedProjectId?: string;
    }
  | {
      /** The project has no active task of the name. */
      kind: "missing-task";
      projectId: string;
      projectName: string;
      taskName: string;
      /** An archived task of that name, which applying restores. */
      archivedTaskId?: string;
      /** The project is shared, so the team gets the task too. */
      shared: boolean;
    }
  | {
      /** Both exist, but the item is set to another project or task. */
      kind: "different";
      projectId: string;
      projectName: string;
      taskId?: string;
      taskName?: string;
    };

function sameName(candidate: string | undefined, name: string) {
  return candidate?.trim().toLowerCase() === name.toLowerCase();
}

/** The project a timelog names, by name, display name or code. */
function findTimelogProject(
  projects: LocalProject[],
  name: string,
  status: LocalProject["status"],
) {
  return projects.find(
    (project) =>
      project.status === status &&
      [project.name, project.displayName, project.code].some((candidate) =>
        sameName(candidate, name),
      ),
  );
}

/** The project's task of that name: an active one first, else an archived one. */
function findTimelogTask(project: LocalProject, name: string) {
  const named = project.tasks.filter((task) => sameName(task.name, name));
  return named.find((task) => task.status === "active") ?? named[0];
}

/**
 * The project a timelog points to: the one it names, or for a timelog with
 * only a task, the item's own project.
 */
function getTimelogProject(
  projects: LocalProject[],
  workItem: Pick<LocalWorkItem, "projectId">,
  timelog: DescriptionTimelog,
) {
  return timelog.project
    ? findTimelogProject(projects, timelog.project, "active")
    : projects.find((project) => project._id === workItem.projectId);
}

/** How the item differs from its description's timelog, or null when it matches. */
export function getTimelogMismatch(
  projects: LocalProject[],
  workItem: Pick<LocalWorkItem, "description" | "projectId" | "taskId">,
): TimelogMismatch | null {
  const timelog = getDescriptionTimelog(workItem.description);
  if (!timelog) return null;

  const project = getTimelogProject(projects, workItem, timelog);
  if (!project) {
    if (!timelog.project) return null;
    const archived = findTimelogProject(projects, timelog.project, "archived");
    return {
      kind: "missing-project",
      projectName: timelog.project,
      ...(timelog.task ? { taskName: timelog.task } : {}),
      ...(archived ? { archivedProjectId: archived._id } : {}),
    };
  }

  const projectName = getLocalProjectDisplayName(project);
  const task = timelog.task
    ? findTimelogTask(project, timelog.task)
    : undefined;
  if (timelog.task && task?.status !== "active") {
    return {
      kind: "missing-task",
      projectId: project._id,
      projectName,
      taskName: timelog.task,
      ...(task ? { archivedTaskId: task._id } : {}),
      shared: Boolean(project.team),
    };
  }

  // Without a task name, any task of the project matches.
  if (
    workItem.projectId === project._id &&
    (!timelog.task || workItem.taskId === task?._id)
  ) {
    return null;
  }
  return {
    kind: "different",
    projectId: project._id,
    projectName,
    ...(task ? { taskId: task._id, taskName: task.name } : {}),
  };
}

interface ApplyTimelogOptions {
  /** Create the project, or restore an archived one, when none is active. */
  createProject: boolean;
  /** Add or restore a task in a shared project, which the team then gets. */
  changeSharedTasks: boolean;
}

/**
 * Sets the item's project and task from its timelog, restoring an archived
 * task or adding a missing one. Without a task name it keeps the item's task
 * in the same project and clears it in another. Returns `state` itself when
 * the options forbid a change it needs.
 */
function applyTimelog(
  state: LocalAppState,
  workItem: LocalWorkItem,
  timelog: DescriptionTimelog,
  factories: ProjectFactories,
  options: ApplyTimelogOptions,
): LocalAppState {
  let projects = state.projects;
  let project = getTimelogProject(projects, workItem, timelog);
  if (!project && timelog.project && options.createProject) {
    const archived = findTimelogProject(projects, timelog.project, "archived");
    let projectId: string;
    if (archived) {
      projectId = archived._id;
      projects = updateProject(projects, projectId, { status: "active" });
    } else {
      const added = addProject(
        projects,
        { name: timelog.project, color: DEFAULT_PROJECT_COLOR },
        factories,
      );
      projects = added.projects;
      projectId = added.result;
    }
    project = projects.find((candidate) => candidate._id === projectId);
  }
  if (!project) return state;
  const projectId = project._id;

  let taskId = workItem.projectId === projectId ? workItem.taskId : undefined;
  if (timelog.task) {
    const task = findTimelogTask(project, timelog.task);
    if (
      task?.status !== "active" &&
      project.team &&
      !options.changeSharedTasks
    ) {
      return state;
    }
    if (!task) {
      projects = addProjectTask(
        projects,
        projectId,
        { name: timelog.task },
        factories,
      );
      taskId = projects
        .find((candidate) => candidate._id === projectId)
        ?.tasks.at(-1)?._id;
    } else {
      taskId = task._id;
      if (task.status === "archived") {
        projects = setProjectTaskStatus(
          projects,
          projectId,
          task._id,
          "active",
          factories.now,
        );
      }
    }
  }

  if (workItem.projectId === projectId && workItem.taskId === taskId) {
    return projects === state.projects ? state : { ...state, projects };
  }
  return updateWorkItem({ ...state, projects }, workItem._id, {
    projectId,
    taskId,
  });
}

/**
 * Applies the timelog of every description a write changed. `previous` is
 * the backlog before the write and `next` the state it produced. An item the
 * write also mapped keeps that mapping, and so does a new item created with a
 * project. A missing project, or a task a shared project lacks, waits for the
 * user. Returns `next` itself when nothing applies.
 */
export function applyDescriptionTimelogs(
  previous: LocalWorkItem[],
  next: LocalAppState,
  factories: ProjectFactories,
): LocalAppState {
  if (previous === next.workItems) return next;
  const previousById = new Map(previous.map((item) => [item._id, item]));
  let state = next;
  for (const written of next.workItems) {
    const before = previousById.get(written._id);
    if (before?.description === written.description) continue;
    const timelog = getDescriptionTimelog(written.description);
    if (!timelog) continue;
    if (before) {
      if (isSameTimelog(getDescriptionTimelog(before.description), timelog)) {
        continue;
      }
      if (
        before.projectId !== written.projectId ||
        before.taskId !== written.taskId
      ) {
        continue;
      }
    } else if (written.projectId) {
      continue;
    }
    // An earlier item's mapping may have carried this one along as a subitem.
    const current =
      state.workItems.find((candidate) => candidate._id === written._id) ??
      written;
    state = applyTimelog(state, current, timelog, factories, {
      createProject: false,
      changeSharedTasks: false,
    });
  }
  return state;
}

/**
 * Sets the item's project and task from its timelog when the user asks:
 * creates or restores the project, adds or restores the task, even in a
 * shared project. Returns `state` itself when the item already matches or
 * has no timelog.
 */
export function applyItemTimelog(
  state: LocalAppState,
  workItemId: string,
  factories: ProjectFactories,
): LocalAppState {
  const workItem = state.workItems.find((item) => item._id === workItemId);
  const timelog = getDescriptionTimelog(workItem?.description);
  if (!workItem || !timelog) return state;
  return applyTimelog(state, workItem, timelog, factories, {
    createProject: true,
    changeSharedTasks: true,
  });
}
