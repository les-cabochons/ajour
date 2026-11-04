import type { CSSProperties } from "react";

/**
 * A workflow state mark's style: its color and how full it is drawn, from
 * `getWorkflowStateFills` (council round 14).
 */
export function stateDotStyle(color: string | undefined, fill = 0) {
  return {
    color,
    "--state-fill": `${Math.round(fill * 100)}%`,
  } as CSSProperties;
}
