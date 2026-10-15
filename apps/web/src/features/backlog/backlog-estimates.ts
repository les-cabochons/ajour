import type { LocalWorkItemEstimateFieldKey } from "@/domain/local-state";

/** The estimate figures shown on the backlog item page and in the peek. */
export const ESTIMATE_FIGURES: {
  key: LocalWorkItemEstimateFieldKey;
  label: string;
}[] = [
  { key: "originalEstimateHours", label: "Original" },
  { key: "remainingEstimateHours", label: "Remaining" },
  { key: "completedEstimateHours", label: "Completed" },
];

/** Hours as "4h" or "2.5h", or "–" when there is no estimate. */
export function formatHours(hours?: number) {
  if (hours === undefined) return "–";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
