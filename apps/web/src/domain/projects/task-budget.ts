import { formatDurationHoursInput } from "@/domain/time/duration";

const MS_PER_HOUR = 60 * 60 * 1000;

export type ProjectTaskConsumedTone =
  "default" | "success" | "warning" | "danger" | "danger-strong";

type ProjectTaskConsumedOptions = {
  budgetMs?: number;
  trackedMs: number;
  adjustmentMs?: number;
};

function roundDurationMs(durationMs: number) {
  return Math.round(durationMs);
}

export function normalizeProjectTaskBudgetMs(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const roundedValue = roundDurationMs(value);
  return roundedValue > 0 ? roundedValue : undefined;
}

/**
 * The budget a task reads: the user's override on a task its project source
 * knows, else its own budget. An override of 0 means no budget.
 */
export function getTaskBudgetMs(task: {
  budgetMs?: number;
  budgetOverrideMs?: number;
}) {
  return normalizeProjectTaskBudgetMs(task.budgetOverrideMs ?? task.budgetMs);
}

/**
 * Whether two budgets read the same to the minute, the precision the editor
 * shows. No budget and a budget of 0 are the same.
 */
export function sameBudgetMs(
  left: number | undefined,
  right: number | undefined,
) {
  const minutes = (value: number | undefined) => {
    const budgetMs = normalizeProjectTaskBudgetMs(value);
    return budgetMs === undefined ? undefined : Math.round(budgetMs / 60_000);
  };
  return minutes(left) === minutes(right);
}

export function normalizeProjectTaskAdjustmentMs(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const roundedValue = roundDurationMs(value);
  return roundedValue === 0 ? undefined : roundedValue;
}

export function formatSignedDurationHoursInput(durationMs: number) {
  const sign = durationMs < 0 ? "-" : "";
  return `${sign}${formatDurationHoursInput(Math.abs(durationMs))}`;
}

export function getProjectTaskTrackedWithAdjustmentMs(
  options: ProjectTaskConsumedOptions,
) {
  return (
    options.trackedMs +
    (normalizeProjectTaskAdjustmentMs(options.adjustmentMs) ?? 0)
  );
}

export function formatProjectTaskConsumedBadge(
  options: ProjectTaskConsumedOptions,
) {
  const budgetMs = normalizeProjectTaskBudgetMs(options.budgetMs);
  const consumedMs = getProjectTaskTrackedWithAdjustmentMs(options);
  const consumedLabel = formatSignedDurationHoursInput(consumedMs);

  if (!budgetMs) {
    return consumedLabel;
  }

  return `${formatDurationHoursInput(budgetMs)} | ${consumedLabel}`;
}

export function getProjectTaskConsumedTone(
  options: ProjectTaskConsumedOptions,
): ProjectTaskConsumedTone {
  const budgetMs = normalizeProjectTaskBudgetMs(options.budgetMs);
  if (!budgetMs) {
    return "default";
  }

  const consumedMs = Math.max(
    0,
    getProjectTaskTrackedWithAdjustmentMs(options),
  );
  const ratio = consumedMs / budgetMs;

  if (ratio < 0.8) {
    return "success";
  }

  if (ratio <= 1) {
    return "warning";
  }

  if (ratio <= 1.2) {
    return "danger";
  }

  return "danger-strong";
}

export function durationMsToHoursValue(durationMs: number | undefined) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return undefined;
  }

  return Math.round((durationMs / MS_PER_HOUR) * 10_000) / 10_000;
}

export function durationHoursValueToMs(hours: number | undefined) {
  if (typeof hours !== "number" || !Number.isFinite(hours)) {
    return undefined;
  }

  const durationMs = Math.round(hours * MS_PER_HOUR);
  return Number.isFinite(durationMs) ? durationMs : undefined;
}
