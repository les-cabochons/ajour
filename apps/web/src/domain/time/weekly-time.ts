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

export interface WeeklyLedgerRow {
  dayTotalsMs: number[];
  entryIds: string[];
  projectId?: string;
  projectName: string;
  rowKey: string;
  runningLocalDate?: string;
  taskId?: string;
  taskName: string;
  totalMs: number;
}

function createLedgerRowKey(
  value: Pick<LocalTimesheetEntry, "label" | "projectId" | "taskId">,
) {
  return `${value.projectId ?? "none"}::${value.taskId ?? value.label}`;
}

export interface WeeklyTimeProjection {
  capacityMs: number;
  days: WeeklyDayProjection[];
  ledgerRows: WeeklyLedgerRow[];
  overCapacity: boolean;
  totalMs: number;
}

export function projectWeeklyTime({
  capacityTargets,
  entries,
  projects,
  runningTime,
  weekDates,
}: {
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

  const ledgerGroups = new Map<string, LocalTimesheetEntry[]>();
  for (const entry of entries) {
    if (!dateIndex.has(entry.localDate)) {
      continue;
    }

    const key = createLedgerRowKey(entry);
    const group = ledgerGroups.get(key) ?? [];
    group.push(entry);
    ledgerGroups.set(key, group);
  }

  const ledgerRows = Array.from(ledgerGroups.values())
    .map((group): WeeklyLedgerRow => {
      const first = group[0]!;
      const project = first.projectId ? projectMap.get(first.projectId) : undefined;
      const task = first.taskId
        ? project?.tasks.find((candidate) => candidate._id === first.taskId)
        : undefined;
      const dayTotalsMs = weekDates.map((localDate) =>
        group
          .filter((entry) => entry.localDate === localDate)
          .reduce((total, entry) => total + entry.durationMs, 0),
      );

      return {
        dayTotalsMs,
        entryIds: group.map((entry) => entry._id),
        projectId: first.projectId,
        projectName: project?.displayName ?? project?.name ?? "No project",
        rowKey: createLedgerRowKey(first),
        taskId: first.taskId,
        taskName: task?.name ?? (first.label || "No task"),
        totalMs: dayTotalsMs.reduce((total, value) => total + value, 0),
      };
    })
    .sort((left, right) =>
      `${left.projectName}\u0000${left.taskName}`.localeCompare(
        `${right.projectName}\u0000${right.taskName}`,
      ),
    );

  const runningDayIndex = runningTime
    ? dateIndex.get(runningTime.localDate)
    : undefined;
  if (
    runningTime &&
    runningTime.durationMs > 0 &&
    runningDayIndex !== undefined
  ) {
    const project = runningTime.projectId
      ? projectMap.get(runningTime.projectId)
      : undefined;
    const task = runningTime.taskId
      ? project?.tasks.find((candidate) => candidate._id === runningTime.taskId)
      : undefined;
    const linkedEntry = runningTime.entryId
      ? entries.find((entry) => entry._id === runningTime.entryId)
      : undefined;
    const runningRowKey = createLedgerRowKey({
      label: linkedEntry?.label ?? "",
      projectId: runningTime.projectId,
      taskId: runningTime.taskId,
    });
    const existingRow = ledgerRows.find((row) => row.rowKey === runningRowKey);

    if (existingRow) {
      existingRow.dayTotalsMs[runningDayIndex] =
        (existingRow.dayTotalsMs[runningDayIndex] ?? 0) + runningTime.durationMs;
      existingRow.totalMs += runningTime.durationMs;
      existingRow.runningLocalDate = runningTime.localDate;
    } else {
      const dayTotalsMs = weekDates.map((_, index) =>
        index === runningDayIndex ? runningTime.durationMs : 0,
      );
      ledgerRows.push({
        dayTotalsMs,
        entryIds: runningTime.entryId ? [runningTime.entryId] : [],
        projectId: runningTime.projectId,
        projectName: project?.displayName ?? project?.name ?? "No project",
        rowKey: runningRowKey,
        runningLocalDate: runningTime.localDate,
        taskId: runningTime.taskId,
        taskName: task?.name ?? "Running timer",
        totalMs: runningTime.durationMs,
      });
    }
  }

  const totalMs = days.reduce((total, day) => total + day.totalMs, 0);
  const capacityMs = days.reduce((total, day) => total + day.capacityMs, 0);

  return {
    capacityMs,
    days,
    ledgerRows,
    overCapacity: capacityMs > 0 && totalMs > capacityMs,
    totalMs,
  };
}
