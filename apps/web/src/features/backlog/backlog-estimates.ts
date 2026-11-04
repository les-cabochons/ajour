import { formatCompactDuration } from "@/domain/time/duration";
import type { LocalWorkItemEstimateFieldKey } from "@/domain/local-state";

/**
 * The estimate figures shown on the backlog item page and in the peek, as
 * part, part, whole: Remaining first, the item page's lead number (product
 * owner, council round 23), then Completed, then Original, the whole the bar
 * under them measures Remaining against (council round 25).
 */
export const ESTIMATE_FIGURES: {
  key: LocalWorkItemEstimateFieldKey;
  label: string;
}[] = [
  { key: "remainingEstimateHours", label: "Remaining" },
  { key: "completedEstimateHours", label: "Completed" },
  { key: "originalEstimateHours", label: "Original" },
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
