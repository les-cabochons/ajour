import {
  getDescriptionTimelog,
  isSameTimelog,
  type DescriptionTimelog,
} from "@/domain/backlog/description-frontmatter";
import { updateWorkItem } from "@/domain/backlog/work-item-transitions";
import type {
  LocalAppState,
  LocalProject,
  LocalWorkItem,
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
 * It applies when the timelog changes, so a project or task the user picks
 * afterwards stays until the timelog changes again.
 */

/** A timelog project that no active project matches. */
export interface MissingTimelogProject {
  projectName: string;
  taskName?: string;
  /** An archived project of that name, which Create restores instead. */
  archivedProjectId?: string;
}

function matchesName(project: LocalProject, name: string) {
  const wanted = name.toLowerCase();
  return [project.name, project.displayName, project.code].some(
    (candidate) => candidate?.trim().toLowerCase() === wanted,
  );
}

/** The project a timelog names: by name, then display name, then code. */
function findTimelogProject(
  projects: LocalProject[],
  name: string,
  status: LocalProject["status"],
) {
  return projects.find(
    (project) => project.status === status && matchesName(project, name),
  );
}

/**
 * Sets the item's project and the task of that name, restoring an archived
 * task or adding a missing one. Without a task name it clears the task.
 */
function mapToTimelogTask(
  state: LocalAppState,
  workItem: LocalWorkItem,
  projectId: string,
  taskName: string | undefined,
  factories: ProjectFactories,
): LocalAppState {
  let projects = state.projects;
  let taskId: string | undefined;
  if (taskName) {
    const project = projects.find((candidate) => candidate._id === projectId);
    const wanted = taskName.toLowerCase();
    const named = (project?.tasks ?? []).filter(
      (task) => task.name.trim().toLowerCase() === wanted,
    );
    const existing = named.find((task) => task.status === "active") ?? named[0];
    if (existing) {
      taskId = existing._id;
      if (existing.status === "archived") {
        projects = setProjectTaskStatus(
          projects,
          projectId,
          existing._id,
          "active",
          factories.now,
        );
      }
    } else {
      projects = addProjectTask(
        projects,
        projectId,
        { name: taskName },
        factories,
      );
      taskId = projects
        .find((candidate) => candidate._id === projectId)
        ?.tasks.at(-1)?._id;
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

function applyTimelog(
  state: LocalAppState,
  workItem: LocalWorkItem,
  timelog: DescriptionTimelog,
  factories: ProjectFactories,
): LocalAppState {
  const projectId = timelog.project
    ? findTimelogProject(state.projects, timelog.project, "active")?._id
    : workItem.projectId;
  if (!projectId) return state;
  return mapToTimelogTask(state, workItem, projectId, timelog.task, factories);
}

/**
 * Applies the timelog of every description a write changed. `previous` is
 * the backlog before the write and `next` the state it produced. An item the
 * write also mapped keeps that mapping, and so does a new item created with a
 * project. Returns `next` itself when nothing applies.
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
    state = applyTimelog(state, current, timelog, factories);
  }
  return state;
}

/** The timelog project an item's description names when no active project has that name. */
export function getMissingTimelogProject(
  projects: LocalProject[],
  workItem: Pick<LocalWorkItem, "description">,
): MissingTimelogProject | null {
  const timelog = getDescriptionTimelog(workItem.description);
  if (!timelog?.project) return null;
  if (findTimelogProject(projects, timelog.project, "active")) return null;
  const archived = findTimelogProject(projects, timelog.project, "archived");
  return {
    projectName: timelog.project,
    ...(timelog.task ? { taskName: timelog.task } : {}),
    ...(archived ? { archivedProjectId: archived._id } : {}),
  };
}

/**
 * Creates the project the item's timelog names, or restores an archived one
 * of that name, then maps the item to it and its task. Returns `state` itself
 * when the project already exists or the item has no timelog project.
 */
export function createTimelogProject(
  state: LocalAppState,
  workItemId: string,
  factories: ProjectFactories,
): LocalAppState {
  const workItem = state.workItems.find((item) => item._id === workItemId);
  const missing = workItem
    ? getMissingTimelogProject(state.projects, workItem)
    : null;
  if (!workItem || !missing) return state;

  let projects: LocalProject[];
  let projectId: string;
  if (missing.archivedProjectId) {
    projectId = missing.archivedProjectId;
    projects = updateProject(state.projects, projectId, { status: "active" });
  } else {
    const added = addProject(
      state.projects,
      { name: missing.projectName, color: DEFAULT_PROJECT_COLOR },
      factories,
    );
    projects = added.projects;
    projectId = added.result;
  }
  return mapToTimelogTask(
    { ...state, projects },
    workItem,
    projectId,
    missing.taskName,
    factories,
  );
}
