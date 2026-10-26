import type {
  LocalProject,
  LocalProjectTask,
  LocalTimer,
  LocalTimesheetEntry,
} from "@/domain/local-state";

/** How many tasks the task menu's Recent page lists. */
export const RECENT_TASK_LIMIT = 10;

export interface RecentTask {
  project: LocalProject;
  task: LocalProjectTask;
  /** When time was last saved to the task or a running entry started on it. */
  usedAt: number;
}

/** The key `getTaskLastUsedTimes` stores a task's time under. */
export function taskUseKey(projectId: string, taskId: string) {
  return `${projectId}\u0000${taskId}`;
}

/**
 * When each task was last used: the latest save of one of its entries, or the
 * start of a running entry on it. Nothing is stored for this; saving and
 * starting are the use.
 */
export function getTaskLastUsedTimes(
  timesheetEntries: readonly LocalTimesheetEntry[],
  timers: readonly LocalTimer[],
) {
  const lastUsed = new Map<string, number>();
  const use = (
    projectId: string | undefined,
    taskId: string | undefined,
    at: number,
  ) => {
    if (!projectId || !taskId) return;
    const key = taskUseKey(projectId, taskId);
    if (at > (lastUsed.get(key) ?? -Infinity)) lastUsed.set(key, at);
  };

  for (const entry of timesheetEntries) {
    use(entry.projectId, entry.taskId, entry.committedAt);
  }
  for (const timer of timers) {
    use(timer.projectId, timer.taskId, timer.startedAt);
  }
  return lastUsed;
}

/**
 * The tasks used last, newest first, each once: up to `limit` active tasks
 * of active projects. Projects are never recent on their own.
 */
export function getRecentTasks(
  projects: readonly LocalProject[],
  timesheetEntries: readonly LocalTimesheetEntry[],
  timers: readonly LocalTimer[],
  limit = RECENT_TASK_LIMIT,
): RecentTask[] {
  const lastUsed = getTaskLastUsedTimes(timesheetEntries, timers);
  const recent: RecentTask[] = [];

  for (const project of projects) {
    if (project.status !== "active") continue;
    for (const task of project.tasks) {
      const usedAt = lastUsed.get(taskUseKey(project._id, task._id));
      if (task.status === "active" && usedAt !== undefined) {
        recent.push({ project, task, usedAt });
      }
    }
  }

  return recent.sort((a, b) => b.usedAt - a.usedAt).slice(0, limit);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** How long ago a task was used, in its largest whole unit: "5m", "2h", "3d", "2w". */
export function formatLastUsed(usedAt: number, now: number) {
  const ago = Math.max(0, now - usedAt);
  if (ago < MINUTE) return "Now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`;
  if (ago < WEEK) return `${Math.floor(ago / DAY)}d`;
  return `${Math.floor(ago / WEEK)}w`;
}
