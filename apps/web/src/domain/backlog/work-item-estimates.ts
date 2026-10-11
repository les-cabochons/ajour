import { formatDurationHoursInput } from "@/domain/time/duration";
import type {
  LocalWorkItem,
  LocalWorkItemEstimateFieldState,
  LocalWorkItemEstimateSyncState,
} from "@/domain/local-state";

export type WorkItemEstimateValues = {
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  remainingEstimateOverrunHours?: number;
  completedEstimateHours?: number;
};

export type LoggedTimeEstimateUpdate = {
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  durationMsDelta: number;
};

export function normalizeWorkItemEstimateValue(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalizedValue = Math.round(Math.max(0, value) * 10_000) / 10_000;
  return Number.isFinite(normalizedValue) ? normalizedValue : undefined;
}

function signedDurationMsToHours(durationMs: number) {
  return Number.isFinite(durationMs) ? durationMs / (60 * 60 * 1000) : 0;
}

function hoursToDurationMs(hours: number) {
  return Math.max(0, hours) * 60 * 60 * 1000;
}

function formatEstimateHours(hours: number | undefined) {
  return formatDurationHoursInput(hoursToDurationMs(hours ?? 0));
}

function normalizeDisplayEstimateValue(value: number | undefined) {
  return normalizeWorkItemEstimateValue(value) ?? 0;
}

function hasVisibleEstimateValue(values: WorkItemEstimateValues) {
  return (
    normalizeDisplayEstimateValue(values.originalEstimateHours) > 0 ||
    normalizeDisplayEstimateValue(values.remainingEstimateHours) > 0 ||
    normalizeDisplayEstimateValue(values.completedEstimateHours) > 0
  );
}

function applyEstimateHoursDelta(
  value: number | undefined,
  delta: number,
  options?: { clampAtZero?: boolean },
) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0000001) {
    return value;
  }

  const nextValue = (value ?? 0) + delta;
  return normalizeWorkItemEstimateValue(
    options?.clampAtZero ? Math.max(0, nextValue) : nextValue,
  );
}

export function applyLoggedTimeToEstimateValues(
  values: WorkItemEstimateValues,
  update: LoggedTimeEstimateUpdate,
): WorkItemEstimateValues {
  if (update.durationMsDelta === 0) {
    return values;
  }

  const deltaHours = signedDurationMsToHours(update.durationMsDelta);
  if (deltaHours === 0) {
    return values;
  }

  const remainingHours = values.remainingEstimateHours ?? 0;
  const currentOverrunHours = values.remainingEstimateOverrunHours ?? 0;
  if (deltaHours > 0) {
    const appliedToRemainingHours = Math.min(remainingHours, deltaHours);
    return {
      ...values,
      remainingEstimateHours:
        values.remainingEstimateHours === undefined
          ? undefined
          : normalizeWorkItemEstimateValue(
              remainingHours - appliedToRemainingHours,
            ),
      remainingEstimateOverrunHours:
        normalizeWorkItemEstimateValue(
          currentOverrunHours + deltaHours - appliedToRemainingHours,
        ) || undefined,
      completedEstimateHours: applyEstimateHoursDelta(
        values.completedEstimateHours,
        deltaHours,
        { clampAtZero: true },
      ),
    };
  }

  const refundedHours = -deltaHours;
  const refundedOverrunHours = Math.min(currentOverrunHours, refundedHours);
  const restoredRemainingHours = refundedHours - refundedOverrunHours;
  return {
    ...values,
    remainingEstimateHours:
      values.remainingEstimateHours === undefined &&
      restoredRemainingHours === 0
        ? undefined
        : normalizeWorkItemEstimateValue(
            remainingHours + restoredRemainingHours,
          ),
    remainingEstimateOverrunHours:
      normalizeWorkItemEstimateValue(
        currentOverrunHours - refundedOverrunHours,
      ) || undefined,
    completedEstimateHours: applyEstimateHoursDelta(
      values.completedEstimateHours,
      deltaHours,
      { clampAtZero: true },
    ),
  };
}

export function createImportedEstimateSyncState(
  values: WorkItemEstimateValues,
): LocalWorkItemEstimateSyncState | undefined {
  const createFieldState = (
    value: number | undefined,
  ): LocalWorkItemEstimateFieldState | undefined => {
    const normalizedValue = normalizeWorkItemEstimateValue(value);
    if (normalizedValue === undefined) {
      return undefined;
    }

    return {
      baselineValue: normalizedValue,
      remoteValue: normalizedValue,
    };
  };

  const originalEstimateHours = createFieldState(values.originalEstimateHours);
  const remainingEstimateHours = createFieldState(
    values.remainingEstimateHours,
  );
  const completedEstimateHours = createFieldState(
    values.completedEstimateHours,
  );

  if (
    !originalEstimateHours &&
    !remainingEstimateHours &&
    !completedEstimateHours
  ) {
    return undefined;
  }

  return {
    originalEstimateHours,
    remainingEstimateHours,
    completedEstimateHours,
  };
}

export function applyLoggedTimeToWorkItems(
  workItems: LocalWorkItem[],
  update: LoggedTimeEstimateUpdate,
) {
  if (update.durationMsDelta === 0) {
    return workItems;
  }

  const deltaHours = signedDurationMsToHours(update.durationMsDelta);
  if (deltaHours === 0) {
    return workItems;
  }

  const fallbackMatches = update.workItemId
    ? []
    : workItems.filter(
        (workItem) =>
          workItem.status === "active" &&
          Boolean(update.projectId) &&
          Boolean(update.taskId) &&
          workItem.projectId === update.projectId &&
          workItem.taskId === update.taskId,
      );
  const fallbackWorkItemId =
    fallbackMatches.length === 1 ? fallbackMatches[0]?._id : undefined;

  return workItems.map((workItem) => {
    const matchesWorkItem =
      Boolean(update.workItemId) && workItem._id === update.workItemId;
    const matchesMappedTask =
      !update.workItemId && workItem._id === fallbackWorkItemId;

    if (!matchesWorkItem && !matchesMappedTask) {
      return workItem;
    }

    const nextEstimates = applyLoggedTimeToEstimateValues(workItem, update);
    return {
      ...workItem,
      remainingEstimateHours: nextEstimates.remainingEstimateHours,
      remainingEstimateOverrunHours:
        nextEstimates.remainingEstimateOverrunHours,
      completedEstimateHours: nextEstimates.completedEstimateHours,
    };
  });
}

export function getWorkItemEstimateSummary(values: WorkItemEstimateValues) {
  if (!hasVisibleEstimateValue(values)) {
    return null;
  }

  return [
    `Original ${formatEstimateHours(values.originalEstimateHours)}`,
    `Remaining ${formatEstimateHours(values.remainingEstimateHours)}`,
    `Completed ${formatEstimateHours(values.completedEstimateHours)}`,
  ].join(" · ");
}

export function getWorkItemEstimateBadgeLabel(values: WorkItemEstimateValues) {
  const remainingEstimateHours = normalizeDisplayEstimateValue(
    values.remainingEstimateHours,
  );
  const completedEstimateHours = normalizeDisplayEstimateValue(
    values.completedEstimateHours,
  );

  if (remainingEstimateHours > 0) {
    return `${formatEstimateHours(remainingEstimateHours)} | ${formatEstimateHours(completedEstimateHours)}`;
  }

  return formatEstimateHours(completedEstimateHours);
}
