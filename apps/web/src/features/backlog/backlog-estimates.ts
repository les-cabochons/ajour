import { formatCompactDuration } from "@/domain/time/duration";
import type { LocalWorkItemEstimateFieldKey } from "@/domain/local-state";

/**
 * The estimate figures shown on the backlog item page and in the peek.
 * Remaining comes first: it is the item page's lead number, and a lead
 * number opens its row (product owner, council round 23).
 */
export const ESTIMATE_FIGURES: {
  key: LocalWorkItemEstimateFieldKey;
  label: string;
}[] = [
  { key: "remainingEstimateHours", label: "Remaining" },
  { key: "originalEstimateHours", label: "Original" },
  { key: "completedEstimateHours", label: "Completed" },
];

/**
 * Hours as "4h", "2h30" or "45m", the one estimate format, or "–" when there is
 * no estimate. Logged time is a clock ("2:30"); an estimate never is.
 */
export function formatHours(hours?: number) {
  if (hours === undefined) return "–";
  if (hours === 0) return "0h";
  return formatCompactDuration(hours * 3_600_000);
}
