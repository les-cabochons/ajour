import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";

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

export function parseSignedHoursInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sign = trimmed.startsWith("-") ? -1 : 1;
  const normalized = trimmed.replace(/^[+-]\s*/, "");
  const parsed = parseHoursInput(normalized);

  return parsed === null ? null : parsed * sign;
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
