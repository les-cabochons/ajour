import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimerDraft,
} from "@/domain/local-state";
import {
  createTimesheetEntry,
  preserveTimesheetEntrySubmissionState,
  type TimesheetEntryFactories,
} from "@/domain/time/timesheet-entry";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";

export type TimerFactories = TimesheetEntryFactories;

export type TimerPatch = Partial<
  Omit<LocalTimer, "_id" | "startedAt">
>;

export interface StartTimerWithEntryValues {
  localDate: string;
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs?: number;
}

export function normalizeTimer(
  timer: Partial<LocalTimer> & { _id: string; startedAt: number },
): LocalTimer {
  return {
    _id: timer._id,
    startedAt: timer.startedAt,
    localDate:
      timer.localDate ?? formatLocalDateFromTimestamp(timer.startedAt),
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
  factories: TimerFactories,
): LocalTimer {
  return {
    _id: factories.createId("timer"),
    startedAt: factories.now(),
    localDate: timer.localDate,
    workItemId: timer.workItemId,
    projectId: timer.projectId,
    taskId: timer.taskId,
    note: timer.note,
    accumulatedDurationMs: timer.accumulatedDurationMs ?? 0,
    entryId: timer.entryId,
  };
}

export function startTimer(
  state: LocalAppState,
  timer: LocalTimerDraft,
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
    timers: [createTimer(timer, switchFactories)],
  };
}

export function startTimerWithEntry(
  state: LocalAppState,
  values: StartTimerWithEntryValues,
  factories: TimerFactories,
): LocalAppState {
  if (state.timers.length > 0) {
    return state;
  }

  const durationMs = values.durationMs ?? 0;
  const entry = createTimesheetEntry(
    state.projects,
    {
      localDate: values.localDate,
      workItemId: values.workItemId,
      projectId: values.projectId,
      taskId: values.taskId,
      note: values.note,
      durationMs,
      sourceBlockIds: [],
    },
    factories,
  );

  return {
    ...state,
    timers: [
      createTimer(
        {
          ...values,
          accumulatedDurationMs: durationMs,
          entryId: entry._id,
        },
        factories,
      ),
    ],
    timesheetEntries: [...state.timesheetEntries, entry],
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: values.workItemId,
      projectId: values.projectId,
      taskId: values.taskId,
      durationMsDelta: durationMs,
    }),
  };
}

export function updateTimer(
  state: LocalAppState,
  timerId: string,
  patch: TimerPatch,
): LocalAppState {
  return {
    ...state,
    timers: state.timers.map((timer) =>
      timer._id === timerId ? { ...timer, ...patch } : timer,
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
        (entry) => entry._id === timer.entryId && entry.durationMs === 0,
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
  const entry = preserveTimesheetEntrySubmissionState(
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

export function restartTimesheetEntry(
  state: LocalAppState,
  entryId: string,
  factories: TimerFactories,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry) {
    return state;
  }

  return startTimer(
    state,
    {
      localDate: entry.localDate,
      workItemId: entry.workItemId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      accumulatedDurationMs: entry.durationMs,
      entryId: entry._id,
    },
    factories,
  );
}
