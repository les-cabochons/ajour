import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimerDraft,
} from "@/domain/local-state";
import {
  createTimesheetEntry,
  keepTimesheetEntryCommit,
  type TimesheetEntryFactories,
} from "@/domain/time/timesheet-entry";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";

export type TimerFactories = TimesheetEntryFactories;

/** What Save writes to the running entry. It keeps running. */
export interface RunningEntryEdit {
  projectId?: string;
  taskId?: string;
  note?: string;
  /**
   * Corrects the time counted so far, for example after a late start. The entry
   * counts on from this value. Leave it out to keep the current count.
   */
  countedDurationMs?: number;
}

export function normalizeTimer(
  timer: Partial<LocalTimer> & { _id: string; startedAt: number },
): LocalTimer {
  return {
    _id: timer._id,
    startedAt: timer.startedAt,
    localDate: timer.localDate ?? formatLocalDateFromTimestamp(timer.startedAt),
    workItemId: timer.workItemId,
    projectId: timer.projectId,
    taskId: timer.taskId,
    note:
      timer.note ??
      ("label" in timer && typeof timer.label === "string"
        ? timer.label
        : undefined),
    accumulatedDurationMs: timer.accumulatedDurationMs ?? 0,
    entryId: timer.entryId,
  };
}

function createTimer(
  timer: LocalTimerDraft,
  today: string,
  factories: TimerFactories,
): LocalTimer {
  return {
    _id: factories.createId("timer"),
    startedAt: factories.now(),
    localDate: today,
    workItemId: timer.workItemId,
    projectId: timer.projectId,
    taskId: timer.taskId,
    note: timer.note,
    accumulatedDurationMs: timer.accumulatedDurationMs ?? 0,
    entryId: timer.entryId,
  };
}

/**
 * Starts a running entry on `today`, whatever day the user started it from. A running
 * entry is always on today. When another entry runs, it is saved first and the new one
 * starts at the same instant, without a prompt (Switch). `accumulatedDurationMs` is
 * the time typed in Hours: the entry counts on from it.
 */
export function startTimer(
  state: LocalAppState,
  timer: LocalTimerDraft,
  today: string,
  factories: TimerFactories,
): LocalAppState {
  if (state.timers.length > 1) {
    return state;
  }

  const activeTimer = state.timers[0];
  if (timer.entryId !== undefined && activeTimer?.entryId === timer.entryId) {
    return state;
  }

  const switchedAt = factories.now();
  const switchFactories: TimerFactories = {
    ...factories,
    now: () => switchedAt,
  };
  const stoppedState = activeTimer
    ? saveTimer(state, activeTimer._id, switchFactories)
    : state;

  return {
    ...stoppedState,
    timers: [createTimer(timer, today, switchFactories)],
  };
}

/**
 * Saves edits to the running entry and keeps it running. A counted time correction
 * restarts the count from that value now. The linked saved entry, if any, keeps its
 * last saved values until Stop, so Discard still returns to them.
 */
export function editRunningEntry(
  state: LocalAppState,
  timerId: string,
  edit: RunningEntryEdit,
  factories: Pick<TimerFactories, "now">,
): LocalAppState {
  const timer = state.timers.find((item) => item._id === timerId);
  if (
    !timer ||
    (edit.countedDurationMs !== undefined &&
      !(Number.isFinite(edit.countedDurationMs) && edit.countedDurationMs >= 0))
  ) {
    return state;
  }

  const counted =
    edit.countedDurationMs === undefined
      ? {}
      : {
          accumulatedDurationMs: edit.countedDurationMs,
          startedAt: factories.now(),
        };
  return {
    ...state,
    timers: state.timers.map((item) =>
      item._id === timerId
        ? {
            ...item,
            projectId: edit.projectId,
            taskId: edit.taskId,
            note: edit.note,
            ...counted,
          }
        : item,
    ),
  };
}

export function cancelTimer(
  state: LocalAppState,
  timerId: string,
): LocalAppState {
  const timer = state.timers.find((item) => item._id === timerId);
  const provisionalEntry = timer?.entryId
    ? state.timesheetEntries.find(
        (entry) =>
          entry._id === timer.entryId &&
          entry.durationMs === 0 &&
          // A committed entry stays: removing it silently would hide a
          // deletion the user never asked for from the Commit page.
          !entry.commit,
      )
    : undefined;
  return {
    ...state,
    timers: state.timers.filter((timer) => timer._id !== timerId),
    timesheetEntries: provisionalEntry
      ? state.timesheetEntries.filter(
          (entry) => entry._id !== provisionalEntry._id,
        )
      : state.timesheetEntries,
  };
}

export function saveTimer(
  state: LocalAppState,
  timerId: string,
  factories: TimerFactories,
): LocalAppState {
  const timer = state.timers.find((item) => item._id === timerId);
  if (!timer) {
    return state;
  }

  const existingEntry = timer.entryId
    ? state.timesheetEntries.find((entry) => entry._id === timer.entryId)
    : undefined;
  const durationMs =
    timer.accumulatedDurationMs +
    Math.max(0, factories.now() - timer.startedAt);
  const entry = keepTimesheetEntryCommit(
    existingEntry,
    createTimesheetEntry(
      state.projects,
      {
        localDate: timer.localDate,
        workItemId: timer.workItemId,
        projectId: timer.projectId,
        taskId: timer.taskId,
        note: timer.note,
        durationMs,
        sourceBlockIds: existingEntry?.sourceBlockIds ?? [],
        entryId: timer.entryId,
      },
      factories,
    ),
  );
  if (existingEntry) {
    entry.committedAt = existingEntry.committedAt;
  }
  const revertedWorkItems = existingEntry
    ? applyLoggedTimeToWorkItems(state.workItems, {
        workItemId: existingEntry.workItemId,
        projectId: existingEntry.projectId,
        taskId: existingEntry.taskId,
        durationMsDelta: -existingEntry.durationMs,
      })
    : state.workItems;

  return {
    ...state,
    timers: state.timers.filter((item) => item._id !== timerId),
    timesheetEntries: existingEntry
      ? state.timesheetEntries.map((item) =>
          item._id === existingEntry._id ? entry : item,
        )
      : [...state.timesheetEntries, entry],
    workItems: applyLoggedTimeToWorkItems(revertedWorkItems, {
      workItemId: timer.workItemId,
      projectId: timer.projectId,
      taskId: timer.taskId,
      durationMsDelta: durationMs,
    }),
  };
}

/**
 * Continues a time entry's work. Today's entry resumes: the timer links to it and its
 * saved time carries over. Another day's entry is left as is, and a new running entry
 * starts today with the same work item, task and note.
 */
export function continueTimesheetEntry(
  state: LocalAppState,
  entryId: string,
  today: string,
  factories: TimerFactories,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry) {
    return state;
  }

  const sharedFields = {
    workItemId: entry.workItemId,
    projectId: entry.projectId,
    taskId: entry.taskId,
    note: entry.note,
  };
  if (entry.localDate !== today) {
    return startTimer(state, sharedFields, today, factories);
  }

  return startTimer(
    state,
    {
      ...sharedFields,
      accumulatedDurationMs: entry.durationMs,
      entryId: entry._id,
    },
    today,
    factories,
  );
}
