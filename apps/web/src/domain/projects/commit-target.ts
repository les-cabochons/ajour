import type {
  LocalProject,
  LocalProjectTask,
  TaskCommitAs,
} from "@/domain/local-state";

/*
 * Where a task's time goes when the week is committed (#481). Every reader
 * of the Commit page, the week changes and the agent tools asks this module,
 * so no caller decides on its own that time is local.
 */

/**
 * `sent`: the time goes to the timesheet tool, under the task's own name or
 * the name a plugin maps it to. `waiting`: the task is Not known yet, so its
 * time waits until the user picks what it commits as. `local`: the task or
 * its project is Local only, so its time never goes.
 */
export type CommitTarget = "sent" | TaskCommitAs;

/**
 * The commit target of a task in a project. A Local only project makes every
 * task local. Time without a project or task is sent, so the Commit page's
 * missing task warning still shows it.
 */
export function getCommitTarget(
  project: Pick<LocalProject, "localOnly"> | undefined,
  task: Pick<LocalProjectTask, "commitAs"> | undefined,
): CommitTarget {
  if (project?.localOnly) return "local";
  return task?.commitAs ?? "sent";
}

/** The commit target of the task with these IDs, read from the projects. */
export function findCommitTarget(
  projects: readonly LocalProject[],
  projectId: string | undefined,
  taskId: string | undefined,
): CommitTarget {
  const project = projectId
    ? projects.find((candidate) => candidate._id === projectId)
    : undefined;
  const task = taskId
    ? project?.tasks.find((candidate) => candidate._id === taskId)
    : undefined;
  return getCommitTarget(project, task);
}

/** A stored `commitAs`, or undefined for anything else. */
export function normalizeTaskCommitAs(
  value: unknown,
): TaskCommitAs | undefined {
  return value === "waiting" || value === "local" ? value : undefined;
}

/** A stored `localOnly`: true, or undefined for anything else. */
export function normalizeLocalOnly(value: unknown): true | undefined {
  return value === true ? true : undefined;
}
