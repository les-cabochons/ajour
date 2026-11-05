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
  type LocalProjectSource,
  type LocalProjectTask,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  addProject,
  createOrRestoreProjectTask,
  DEFAULT_PROJECT_COLOR,
  findProjectTaskByImportName,
  getProjectRestoreRefusal,
  getTaskRestoreRefusal,
  updateProject,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";

/**
 * A description's `timelog` sets its backlog item's project and task (#281).
 * Saving a description applies its timelog when the timelog changed, unless
 * the project is missing or the task would change a shared project. Whenever
 * the item's project or task differs from the timelog, the properties offer
 * to apply it (`getTimelogMismatch`, `applyItemTimelog`). Both read the
 * timelog through `resolveTimelogTarget`, so they never disagree. Neither
 * restores a project or task its project source archived (#637): the
 * mismatch says why instead.
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
      /** Why that archived project, or its task, can't be restored: its source archived it. */
      refusal?: string;
    }
  | {
      /** The project has no active task of the name. */
      kind: "missing-task";
      projectId: string;
      projectName: string;
      taskName: string;
      /** An archived task of that name, which applying restores. */
      archivedTaskId?: string;
      /** Why that archived task can't be restored: its source closed it. */
      refusal?: string;
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

/** What a timelog points to among the user's projects. */
type TimelogTarget =
  | {
      /** No active project matches; `archived` is one of that name. */
      kind: "no-project";
      archived?: LocalProject;
    }
  | {
      kind: "project";
      project: LocalProject;
      /** The task of the timelog's name: an active one, else an archived one. */
      task?: LocalProjectTask;
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

/**
 * The project and task a timelog points to: the project it names, or for a
 * timelog with only a task, the item's own project. Null when a timelog with
 * only a task meets an item without a project.
 */
function resolveTimelogTarget(
  projects: LocalProject[],
  workItem: Pick<LocalWorkItem, "projectId">,
  timelog: DescriptionTimelog,
): TimelogTarget | null {
  const project = timelog.project
    ? findTimelogProject(projects, timelog.project, "active")
    : projects.find((candidate) => candidate._id === workItem.projectId);
  if (!project) {
    if (!timelog.project) return null;
    const archived = findTimelogProject(projects, timelog.project, "archived");
    return { kind: "no-project", ...(archived ? { archived } : {}) };
  }
  // The pickers' and imports' name rule, so Apply finds the task it creates.
  const task = timelog.task
    ? findProjectTaskByImportName(project, timelog.task)
    : undefined;
  return { kind: "project", project, ...(task ? { task } : {}) };
}

/**
 * How the item differs from its description's timelog, or null when it
 * matches. `projectSources` names the source in a refusal.
 */
export function getTimelogMismatch(
  projects: LocalProject[],
  workItem: Pick<LocalWorkItem, "description" | "projectId" | "taskId">,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): TimelogMismatch | null {
  const timelog = getDescriptionTimelog(workItem.description);
  const target = timelog
    ? resolveTimelogTarget(projects, workItem, timelog)
    : null;
  if (!timelog || !target) return null;

  if (target.kind === "no-project") {
    // Restoring the project also restores the task the timelog names, so a
    // task its source closed refuses the whole Restore project…
    const archivedTask =
      target.archived && timelog.task
        ? findProjectTaskByImportName(target.archived, timelog.task)
        : undefined;
    const refusal = target.archived
      ? (getProjectRestoreRefusal(target.archived, projectSources) ??
        (archivedTask
          ? getTaskRestoreRefusal(target.archived, archivedTask, projectSources)
          : undefined))
      : undefined;
    return {
      kind: "missing-project",
      projectName: timelog.project!,
      ...(timelog.task ? { taskName: timelog.task } : {}),
      ...(target.archived ? { archivedProjectId: target.archived._id } : {}),
      ...(refusal ? { refusal } : {}),
    };
  }

  const { project, task } = target;
  const projectName = getLocalProjectDisplayName(project);
  if (timelog.task && task?.status !== "active") {
    const refusal = task
      ? getTaskRestoreRefusal(project, task, projectSources)
      : undefined;
    return {
      kind: "missing-task",
      projectId: project._id,
      projectName,
      taskName: timelog.task,
      ...(task ? { archivedTaskId: task._id } : {}),
      shared: Boolean(project.team),
      ...(refusal ? { refusal } : {}),
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
  let target = resolveTimelogTarget(state.projects, workItem, timelog);
  if (!target) return state;
  let projects = state.projects;

  if (target.kind === "no-project") {
    if (!options.createProject) return state;
    let projectId: string;
    if (target.archived) {
      // A project its source archived stays archived: the source decides.
      if (getProjectRestoreRefusal(target.archived, state.projectSources)) {
        return state;
      }
      projectId = target.archived._id;
      projects = updateProject(projects, projectId, { status: "active" });
    } else {
      const added = addProject(
        projects,
        { name: timelog.project!, color: DEFAULT_PROJECT_COLOR },
        factories,
      );
      projects = added.projects;
      projectId = added.result;
    }
    target = resolveTimelogTarget(
      projects,
      { projectId },
      {
        ...timelog,
        project: undefined,
      },
    );
    if (target?.kind !== "project") return state;
  }

  const { project, task } = target;
  const projectId = project._id;
  let taskId = workItem.projectId === projectId ? workItem.taskId : undefined;
  if (timelog.task) {
    if (task?.status === "active") {
      taskId = task._id;
    } else {
      if (project.team && !options.changeSharedTasks) return state;
      // The pickers' rule: restore the archived task, or add one that a
      // later import of the same name updates.
      const given = createOrRestoreProjectTask(
        projects,
        projectId,
        { name: timelog.task },
        factories,
        state.projectSources,
      );
      // A task its source closed stays archived: the source decides.
      if (given.outcome === "refused") return state;
      taskId = given.taskId;
      projects = given.projects;
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
 * the backlog before the write and `next` the state it produced.
 * `mappedIds` are the items whose project or task the write itself set: they
 * keep that mapping, as does an item whose mapping the write changed, and a
 * new item created with a project of its own rather than its parent's. A
 * missing project, or a task a shared project lacks, waits for the user.
 * Returns `next` itself when nothing applies.
 */
export function applyDescriptionTimelogs(
  previous: LocalWorkItem[],
  next: LocalAppState,
  factories: ProjectFactories,
  mappedIds: ReadonlySet<string> = new Set(),
): LocalAppState {
  if (previous === next.workItems) return next;
  const previousById = new Map(previous.map((item) => [item._id, item]));
  let state = next;
  for (const written of next.workItems) {
    const before = previousById.get(written._id);
    if (before?.description === written.description) continue;
    if (mappedIds.has(written._id)) continue;
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
    } else if (written.projectId && !written.inheritsParentMapping) {
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

/**
 * Why the user can't apply the item's timelog: the project or the task it
 * names is one its project source archived. Undefined when Apply can go on.
 */
export function getItemTimelogRefusal(
  state: LocalAppState,
  workItemId: string,
): string | undefined {
  const workItem = state.workItems.find((item) => item._id === workItemId);
  if (!workItem) return undefined;
  const mismatch = getTimelogMismatch(
    state.projects,
    workItem,
    state.projectSources,
  );
  return mismatch && "refusal" in mismatch ? mismatch.refusal : undefined;
}
