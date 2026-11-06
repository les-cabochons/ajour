import type { LocalAppState } from "@/domain/local-state";
import {
  setProjectTaskStatus,
  updateProject,
} from "@/domain/projects/project-transitions";
import {
  saveTimer,
  type TimerFactories,
} from "@/domain/time/timer-transitions";

/** What archiving did, besides the archive itself. */
export interface ArchiveResult {
  /** A running entry on what was archived stopped and was saved. */
  savedRunningEntry: boolean;
}

/**
 * Stops and saves the running entries `matches` picks, as Stop does. An
 * archived project or task can't take time, so archiving it ends its entry
 * instead of leaving it counting on something the pickers no longer offer.
 */
function saveRunningEntries(
  state: LocalAppState,
  matches: (timer: LocalAppState["timers"][number]) => boolean,
  factories: TimerFactories,
) {
  return state.timers
    .filter(matches)
    .reduce((next, timer) => saveTimer(next, timer._id, factories), state);
}

/**
 * Archives a project and stops and saves the running entry on it, so Undo
 * puts both back. Its backlog items stay as they are.
 */
export function archiveProject(
  state: LocalAppState,
  projectId: string,
  factories: TimerFactories,
): { state: LocalAppState; result: ArchiveResult } {
  const archived = {
    ...state,
    projects: updateProject(state.projects, projectId, { status: "archived" }),
  };
  const next = saveRunningEntries(
    archived,
    (timer) => timer.projectId === projectId,
    factories,
  );
  return {
    state: next,
    result: { savedRunningEntry: next.timers !== archived.timers },
  };
}

/** Archives a task and stops and saves the running entry on it. */
export function archiveProjectTask(
  state: LocalAppState,
  projectId: string,
  taskId: string,
  factories: TimerFactories,
): { state: LocalAppState; result: ArchiveResult } {
  const archived = {
    ...state,
    projects: setProjectTaskStatus(
      state.projects,
      projectId,
      taskId,
      "archived",
      factories.now,
    ),
  };
  const next = saveRunningEntries(
    archived,
    (timer) => timer.projectId === projectId && timer.taskId === taskId,
    factories,
  );
  return {
    state: next,
    result: { savedRunningEntry: next.timers !== archived.timers },
  };
}
