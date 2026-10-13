import type {
  ConnectorBacklogSource,
  ConnectorPriorityScale,
} from "@ajour/shared";
import type { LocalAppState } from "@/domain/local-state";

/**
 * Ajour's five priority levels, from "Priority" in agents/ux-spec.md. An item
 * without a level has No priority. Connectors map their own source values to
 * levels with one range per level.
 */
export type PriorityLevel = 1 | 2 | 3 | 4;

export const PRIORITY_LEVELS: readonly {
  level: PriorityLevel;
  name: string;
}[] = [
  { level: 1, name: "Urgent" },
  { level: 2, name: "High" },
  { level: 3, name: "Medium" },
  { level: 4, name: "Low" },
];

export const NO_PRIORITY_NAME = "No priority";

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

/** Azure DevOps style: 1 Urgent, 2 High, 3 Medium, 4 Low. */
export const DEFAULT_PRIORITY_RANGES: PriorityRanges = {
  1: { min: 1, max: 1 },
  2: { min: 2, max: 2 },
  3: { min: 3, max: 3 },
  4: { min: 4, max: 4 },
};

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

/** The level a source value falls in, or undefined when no range holds it. */
export function getPriorityLevel(
  sourceValue: number | undefined,
  ranges: PriorityRanges,
): PriorityLevel | undefined {
  if (sourceValue === undefined) return undefined;
  return PRIORITY_LEVELS.find(({ level }) => {
    const range = ranges[level];
    return range && sourceValue >= range.min && sourceValue <= range.max;
  })?.level;
}

/** The value Ajour writes to the source for a level: the lowest of its range. */
export function getSourcePriority(
  level: PriorityLevel | undefined,
  ranges: PriorityRanges,
): number | undefined {
  return level ? ranges[level]?.min : undefined;
}

/** The ranges a connection uses: the ones set in Settings, or the defaults. */
export function getPriorityRanges(
  scales: readonly LocalPriorityScale[],
  source: string,
  connectionId: string | undefined,
): PriorityRanges {
  return (
    scales.find(
      (scale) => scale.source === source && scale.connectionId === connectionId,
    )?.ranges ?? DEFAULT_PRIORITY_RANGES
  );
}

/** The ranges that apply to a synced item. Manual items have none. */
export function getWorkItemPriorityRanges(
  state: Pick<LocalAppState, "priorityScales">,
  workItem: { source: string; sourceConnectionId?: string },
): PriorityRanges {
  return getPriorityRanges(
    state.priorityScales,
    workItem.source,
    workItem.sourceConnectionId,
  );
}

/**
 * Checks a connection's ranges: whole numbers from 0 to 999, min at most max,
 * and no value in two levels. Returns the problem, or null.
 */
export function validatePriorityRanges(ranges: PriorityRanges): string | null {
  const set = PRIORITY_LEVELS.flatMap(({ level, name }) => {
    const range = ranges[level];
    return range ? [{ name, ...range }] : [];
  });
  for (const range of set) {
    if (
      !Number.isInteger(range.min) ||
      !Number.isInteger(range.max) ||
      range.min < 0 ||
      range.max > 999
    ) {
      return `${range.name} needs whole numbers from 0 to 999.`;
    }
    if (range.min > range.max) {
      return `${range.name} starts after it ends.`;
    }
  }
  for (const [index, range] of set.entries()) {
    const overlap = set
      .slice(index + 1)
      .find((other) => other.min <= range.max && range.min <= other.max);
    if (overlap) {
      return `${range.name} and ${overlap.name} overlap.`;
    }
  }
  return null;
}

/** A connector manifest's default ranges, by Ajour level. */
export function priorityRangesFromConnectorScale(
  scale: ConnectorPriorityScale,
): PriorityRanges {
  const ranges: PriorityRanges = {};
  if (scale.urgent) ranges[1] = scale.urgent;
  if (scale.high) ranges[2] = scale.high;
  if (scale.medium) ranges[3] = scale.medium;
  if (scale.low) ranges[4] = scale.low;
  return ranges;
}

/**
 * Gives each connection without its own ranges its plugin's defaults, the
 * first time one of its items syncs. Connections whose plugin declares none
 * keep the built-in defaults.
 */
export function seedPriorityScales(
  state: LocalAppState,
  connections: readonly {
    source: ConnectorBacklogSource;
    connectionId: string;
  }[],
  defaultsBySource: Readonly<Record<string, PriorityRanges>>,
): LocalAppState {
  const added: LocalPriorityScale[] = [];
  for (const { source, connectionId } of connections) {
    const ranges = defaultsBySource[source];
    const known = [...state.priorityScales, ...added].some(
      (scale) => scale.source === source && scale.connectionId === connectionId,
    );
    if (ranges && !known && validatePriorityRanges(ranges) === null) {
      added.push({ source, connectionId, ranges });
    }
  }
  return added.reduce(
    (current, scale) => setPriorityScale(current, scale),
    state,
  );
}

/** Keeps only valid stored scales. */
export function normalizePriorityScales(value: unknown): LocalPriorityScale[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): LocalPriorityScale[] => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.source !== "string" ||
      typeof candidate.connectionId !== "string" ||
      typeof candidate.ranges !== "object" ||
      candidate.ranges === null
    ) {
      return [];
    }
    const ranges: PriorityRanges = {};
    for (const { level } of PRIORITY_LEVELS) {
      const range = candidate.ranges[level];
      if (
        range &&
        typeof range.min === "number" &&
        typeof range.max === "number"
      ) {
        ranges[level] = { min: range.min, max: range.max };
      }
    }
    return validatePriorityRanges(ranges) === null
      ? [
          {
            source: candidate.source,
            connectionId: candidate.connectionId,
            ranges,
          },
        ]
      : [];
  });
}

/** Sets one connection's ranges. Throws when they are not valid. */
export function setPriorityScale(
  state: LocalAppState,
  scale: LocalPriorityScale,
): LocalAppState {
  const problem = validatePriorityRanges(scale.ranges);
  if (problem) throw new Error(problem);

  // Items that follow their source priority take the level the new ranges give.
  const previous = getPriorityRanges(
    state.priorityScales,
    scale.source,
    scale.connectionId,
  );
  return {
    ...state,
    workItems: state.workItems.map((workItem) => {
      if (
        workItem.source !== scale.source ||
        workItem.sourceConnectionId !== scale.connectionId
      )
        return workItem;
      const recovery = workItem.pendingSourceWrite?.previous;
      return {
        ...workItem,
        priority:
          workItem.priority ===
          getPriorityLevel(workItem.importedPriority, previous)
            ? getPriorityLevel(workItem.importedPriority, scale.ranges)
            : workItem.priority,
        pendingSourceWrite:
          workItem.pendingSourceWrite && recovery
            ? {
                ...workItem.pendingSourceWrite,
                previous: {
                  ...recovery,
                  priority:
                    recovery.priority ===
                    getPriorityLevel(recovery.importedPriority, previous)
                      ? getPriorityLevel(
                          recovery.importedPriority,
                          scale.ranges,
                        )
                      : recovery.priority,
                },
              }
            : workItem.pendingSourceWrite,
      };
    }),
    priorityScales: [
      ...state.priorityScales.filter(
        (candidate) =>
          !(
            candidate.source === scale.source &&
            candidate.connectionId === scale.connectionId
          ),
      ),
      scale,
    ],
  };
}
