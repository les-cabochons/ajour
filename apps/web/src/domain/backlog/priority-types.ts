import type { ConnectorBacklogSource } from "@ajour/shared";

/**
 * Ajour's five priority levels, from "Priority" in agents/ux-spec.md. An item
 * without a level has No priority. Connectors map their own source values to
 * levels with one range per level.
 *
 * These types live apart from priority.ts because LocalAppState stores them
 * while priority.ts transforms LocalAppState.
 */
export type PriorityLevel = 1 | 2 | 3 | 4;

export interface PriorityRange {
  min: number;
  max: number;
}

/** The source values that map to each level. A level without a range gets none. */
export type PriorityRanges = Partial<Record<PriorityLevel, PriorityRange>>;

/** One connection's priority ranges, as set in Settings > Workflow. */
export interface LocalPriorityScale {
  source: ConnectorBacklogSource;
  connectionId: string;
  ranges: PriorityRanges;
}
