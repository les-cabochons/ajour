import type {
  LocalProject,
  LocalTimesheetEntry,
  WeeklyCapacityTargets,
} from "@/domain/local-state";

const CAPACITY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export interface WeeklyRunningTime {
  entryId?: string;
  localDate: string;
  durationMs: number;
  projectId?: string;
  taskId?: string;
}

export interface WeeklyDayProjection {
  capacityMs: number;
  entries: LocalTimesheetEntry[];
  localDate: string;
  overCapacity: boolean;
  totalMs: number;
}

export interface WeeklyGridRow {
  /** True when a new entry with this row's project and task lands in this row. Rows grouped by a legacy label get false. */
  acceptsNewEntries: boolean;
  /**
   * Saved entries per day, in `weekDates` order. The running entry's saved part is
   * left out: `runningLocalDate` marks its cell and `dayTotalsMs` includes its time.
   */
  dayEntries: LocalTimesheetEntry[][];
  dayTotalsMs: number[];
  entryIds: string[];
  /**
   * True when the running entry shows in this row or its saved part is listed
   * here. A running entry whose task changed does both, in two rows.
   */
  holdsRunningEntry: boolean;
  projectId?: string;
  projectName: string;
  rowKey: string;
  runningLocalDate?: string;
  taskId?: string;
  taskName: string;
  totalMs: number;
}

/** A Grid row the user added with "+ Add row". It shows even while it has no time. */
export interface WeeklyGridAddedRow {
  projectId?: string;
  taskId?: string;
}

/** Names the Grid row of a row added with "+ Add row", which has no label. */
export function getWeeklyGridAddedRowKey(row: WeeklyGridAddedRow) {
  return getWeeklyGridRowKey({ label: "", ...row });
}

/**
 * Names the Grid row an entry belongs to: its project and task, or its label when
 * it has no task.
 */
export function getWeeklyGridRowKey(
  value: Pick<LocalTimesheetEntry, "label" | "projectId" | "taskId">,
) {
  return `${value.projectId ?? "none"}::${value.taskId ?? value.label}`;
}

/** Where the running entry sits: its day, its project and task, and the saved entry it continues. */
type WeeklyRunningPlacement = Pick<
  WeeklyRunningTime,
  "entryId" | "localDate" | "projectId" | "taskId"
>;

/**
 * Names the Grid row of the running entry. A continued entry without a task keeps
 * the row of the entry it continues, which is grouped by label.
 */
function getWeeklyRunningRowKey(
  running: WeeklyRunningPlacement,
  entries: LocalTimesheetEntry[],
) {
  const linkedEntry = running.entryId
    ? entries.find((entry) => entry._id === running.entryId)
    : undefined;
  return getWeeklyGridRowKey({
    label: linkedEntry?.label ?? "",
    projectId: running.projectId,
    taskId: running.taskId,
  });
}

/**
 * Lists what one Grid cell holds: its saved entries, and whether the running entry
 * is in it. When it is, the saved entry it continues is left out of `entries`, as in
 * `WeeklyGridRow.dayEntries`. A running entry whose project or task changed shows
 * in its new row, so its saved entry stays listed in the old one.
 */
export function selectWeeklyGridCell({
  entries,
  localDate,
  rowKey,
  running,
}: {
  entries: LocalTimesheetEntry[];
  localDate: string;
  rowKey: string;
  running?: WeeklyRunningPlacement | null;
}) {
  const hasRunning = Boolean(
    running &&
    running.localDate === localDate &&
    getWeeklyRunningRowKey(running, entries) === rowKey,
  );
  return {
    entries: entries.filter(
      (entry) =>
        entry.localDate === localDate &&
        getWeeklyGridRowKey(entry) === rowKey &&
        !(hasRunning && entry._id === running?.entryId),
    ),
    hasRunning,
  };
}

export interface WeeklyTimeProjection {
  capacityMs: number;
  days: WeeklyDayProjection[];
  gridRows: WeeklyGridRow[];
  overCapacity: boolean;
  totalMs: number;
}

/**
 * Projects a week for the Week view: day columns with their entries and capacity,
 * and Grid rows grouping entries by project and task. `addedRows` are rows the user
 * added with "+ Add row"; they show empty until they get time.
 */
export function projectWeeklyTime({
  addedRows = [],
  capacityTargets,
  entries,
  projects,
  runningTime,
  weekDates,
}: {
  addedRows?: WeeklyGridAddedRow[];
  capacityTargets: WeeklyCapacityTargets;
  entries: LocalTimesheetEntry[];
  projects: LocalProject[];
  runningTime?: WeeklyRunningTime | null;
  weekDates: string[];
}): WeeklyTimeProjection {
  const dateIndex = new Map(weekDates.map((date, index) => [date, index]));
  const projectMap = new Map(projects.map((project) => [project._id, project]));
  const days = weekDates.map((localDate, index) => {
    const dayEntries = entries
      .filter((entry) => entry.localDate === localDate)
      .sort((left, right) => right.committedAt - left.committedAt);
    const savedTotalMs = dayEntries.reduce(
      (total, entry) => total + entry.durationMs,
      0,
    );
    const runningContributionMs =
      runningTime?.localDate === localDate ? runningTime.durationMs : 0;
    const capacityKey = CAPACITY_KEYS[index];
    const capacityMs = capacityKey ? capacityTargets[capacityKey] : 0;
    const totalMs = savedTotalMs + runningContributionMs;

    return {
      capacityMs,
      entries: dayEntries,
      localDate,
      overCapacity: capacityMs > 0 && totalMs > capacityMs,
      totalMs,
    };
  });

  function describeRow(projectId?: string, taskId?: string) {
    const project = projectId ? projectMap.get(projectId) : undefined;
    const task = taskId
      ? project?.tasks.find((candidate) => candidate._id === taskId)
      : undefined;
    return {
      projectName: project?.displayName ?? project?.name ?? "No project",
      taskName: task?.name,
    };
  }

  function acceptsNewEntries(
    rowKey: string,
    projectId?: string,
    taskId?: string,
  ) {
    return rowKey === getWeeklyGridAddedRowKey({ projectId, taskId });
  }

  const gridGroups = new Map<string, LocalTimesheetEntry[]>();
  for (const entry of entries) {
    if (!dateIndex.has(entry.localDate)) {
      continue;
    }

    const key = getWeeklyGridRowKey(entry);
    const group = gridGroups.get(key) ?? [];
    group.push(entry);
    gridGroups.set(key, group);
  }

  const runningRowKey = runningTime
    ? getWeeklyRunningRowKey(runningTime, entries)
    : undefined;
  const gridRows = Array.from(gridGroups.values()).map(
    (group): WeeklyGridRow => {
      const first = group[0]!;
      const rowKey = getWeeklyGridRowKey(first);
      const { projectName, taskName } = describeRow(
        first.projectId,
        first.taskId,
      );
      const dayTotalsMs = weekDates.map((localDate) =>
        group
          .filter((entry) => entry.localDate === localDate)
          .reduce((total, entry) => total + entry.durationMs, 0),
      );

      return {
        acceptsNewEntries: acceptsNewEntries(
          rowKey,
          first.projectId,
          first.taskId,
        ),
        // The running entry's saved part leaves only the cell its time shows in.
        dayEntries: weekDates.map((localDate) =>
          group.filter(
            (entry) =>
              entry.localDate === localDate &&
              !(
                rowKey === runningRowKey &&
                localDate === runningTime?.localDate &&
                entry._id === runningTime.entryId
              ),
          ),
        ),
        dayTotalsMs,
        entryIds: group.map((entry) => entry._id),
        holdsRunningEntry:
          rowKey === runningRowKey ||
          group.some((entry) => entry._id === runningTime?.entryId),
        projectId: first.projectId,
        projectName,
        rowKey,
        taskId: first.taskId,
        taskName: taskName ?? (first.label || "No task"),
        totalMs: dayTotalsMs.reduce((total, value) => total + value, 0),
      };
    },
  );

  for (const added of addedRows) {
    const rowKey = getWeeklyGridAddedRowKey(added);
    if (gridRows.some((row) => row.rowKey === rowKey)) {
      continue;
    }

    const { projectName, taskName } = describeRow(
      added.projectId,
      added.taskId,
    );
    gridRows.push({
      acceptsNewEntries: true,
      dayEntries: weekDates.map(() => []),
      dayTotalsMs: weekDates.map(() => 0),
      entryIds: [],
      holdsRunningEntry: false,
      projectId: added.projectId,
      projectName,
      rowKey,
      taskId: added.taskId,
      taskName: taskName ?? "No task",
      totalMs: 0,
    });
  }

  gridRows.sort((left, right) =>
    `${left.projectName}\u0000${left.taskName}`.localeCompare(
      `${right.projectName}\u0000${right.taskName}`,
    ),
  );

  const runningDayIndex = runningTime
    ? dateIndex.get(runningTime.localDate)
    : undefined;
  // `durationMs` is what the running entry adds to its day. It is negative when a
  // resumed entry's counted time was corrected below its saved time, so it always
  // applies to the row that already holds the saved entry. Only positive time
  // opens a row of its own.
  if (
    runningTime &&
    runningRowKey !== undefined &&
    runningDayIndex !== undefined
  ) {
    const { projectName, taskName } = describeRow(
      runningTime.projectId,
      runningTime.taskId,
    );
    const existingRow = gridRows.find((row) => row.rowKey === runningRowKey);

    if (existingRow) {
      existingRow.dayTotalsMs[runningDayIndex] =
        (existingRow.dayTotalsMs[runningDayIndex] ?? 0) +
        runningTime.durationMs;
      existingRow.totalMs += runningTime.durationMs;
      existingRow.runningLocalDate = runningTime.localDate;
      existingRow.holdsRunningEntry = true;
    } else if (runningTime.durationMs > 0) {
      const dayTotalsMs = weekDates.map((_, index) =>
        index === runningDayIndex ? runningTime.durationMs : 0,
      );
      gridRows.push({
        acceptsNewEntries: acceptsNewEntries(
          runningRowKey,
          runningTime.projectId,
          runningTime.taskId,
        ),
        dayEntries: weekDates.map(() => []),
        dayTotalsMs,
        entryIds: runningTime.entryId ? [runningTime.entryId] : [],
        holdsRunningEntry: true,
        projectId: runningTime.projectId,
        projectName,
        rowKey: runningRowKey,
        runningLocalDate: runningTime.localDate,
        taskId: runningTime.taskId,
        taskName: taskName ?? "Running",
        totalMs: runningTime.durationMs,
      });
    }
  }

  const totalMs = days.reduce((total, day) => total + day.totalMs, 0);
  const capacityMs = days.reduce((total, day) => total + day.capacityMs, 0);

  return {
    capacityMs,
    days,
    gridRows,
    overCapacity: capacityMs > 0 && totalMs > capacityMs,
    totalMs,
  };
}
