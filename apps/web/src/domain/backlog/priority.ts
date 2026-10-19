import type { BacklogPriorityLevel } from "@ajour/shared";

/**
 * Ajour's five priority levels, from "Priority" in docs/agents/ux-spec.md: 1 Urgent
 * to 4 Low. An item without a level has No priority. Each plugin
 * maps its source's priority values to levels, so Ajour only stores levels.
 */
export type PriorityLevel = 1 | 2 | 3 | 4;

export const PRIORITY_LEVELS: readonly {
  level: PriorityLevel;
  name: string;
  /** The level's name in the plugin contract. */
  pluginValue: BacklogPriorityLevel;
}[] = [
  { level: 1, name: "Urgent", pluginValue: "urgent" },
  { level: 2, name: "High", pluginValue: "high" },
  { level: 3, name: "Medium", pluginValue: "medium" },
  { level: 4, name: "Low", pluginValue: "low" },
];

export const NO_PRIORITY_NAME = "No priority";

export function getPriorityLevelName(level: PriorityLevel | undefined) {
  return level
    ? (PRIORITY_LEVELS.find((candidate) => candidate.level === level)?.name ??
        NO_PRIORITY_NAME)
    : NO_PRIORITY_NAME;
}

export function isPriorityLevel(value: unknown): value is PriorityLevel {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Normalizes a stored local priority. Values saved before priority had levels
 * were any whole number: 1 to 4 keep their level and anything larger is Low.
 */
export function normalizePriorityLevel(
  value: unknown,
): PriorityLevel | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return undefined;
  return Math.min(rounded, 4) as PriorityLevel;
}

/** The level a plugin reports, or undefined for No priority. */
export function priorityLevelFromSource(
  priority: BacklogPriorityLevel | undefined,
): PriorityLevel | undefined {
  return PRIORITY_LEVELS.find(({ pluginValue }) => pluginValue === priority)
    ?.level;
}

/** The level as a plugin receives it, or undefined for No priority. */
export function sourcePriorityFromLevel(
  level: PriorityLevel | undefined,
): BacklogPriorityLevel | undefined {
  return PRIORITY_LEVELS.find((candidate) => candidate.level === level)
    ?.pluginValue;
}
