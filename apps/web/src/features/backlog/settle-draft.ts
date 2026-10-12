import {
  normalizeConnectorStatusKey,
  type ConnectorSettleState,
} from "@ajour/shared";
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
import {
  getPriorityLevel,
  getSourcePriority,
  type PriorityRanges,
} from "@/domain/backlog/priority";
import { parsePriorityInput } from "@/features/backlog/backlog-task-editor";

export interface SettleStateGroup {
  category: string;
  states: ConnectorSettleState[];
}

/** Groups states by category, in the order the connector listed them. */
export function groupSettleStates(
  states: ConnectorSettleState[],
): SettleStateGroup[] {
  const groups: SettleStateGroup[] = [];
  for (const state of states) {
    const group = groups.find(
      (candidate) => candidate.category === state.category,
    );
    if (group) {
      group.states.push(state);
    } else {
      groups.push({ category: state.category, states: [state] });
    }
  }
  return groups;
}

export function findSettleState(
  states: ConnectorSettleState[],
  name: string | undefined,
) {
  if (!name?.trim()) return undefined;
  const key = normalizeConnectorStatusKey(name);
  return states.find(
    (state) => normalizeConnectorStatusKey(state.name) === key,
  );
}

/**
 * Turns the settle dialog's fields into a change. A new priority level is
 * written as the lowest source value of its range, and only when the level
 * changed. The domain keeps only the fields that differ from the item.
 * Returns null for an invalid level, an unsupported priority clear, or a
 * changed level without a source range.
 */
export function buildSettleChange(
  states: ConnectorSettleState[],
  stateName: string,
  priorityInput: string,
  current: { importedPriority?: number; ranges: PriorityRanges },
): BacklogSettleChange | null {
  const level = parsePriorityInput(priorityInput);
  if (level === null) {
    return null;
  }

  const currentLevel = getPriorityLevel(
    current.importedPriority,
    current.ranges,
  );
  if (level === undefined && currentLevel !== undefined) return null;
  const priority =
    level !== undefined && level !== currentLevel
      ? getSourcePriority(level, current.ranges)
      : undefined;
  if (level !== undefined && level !== currentLevel && priority === undefined) {
    return null;
  }
  const state = findSettleState(states, stateName);
  return {
    state: state ? { name: state.name, done: state.done } : undefined,
    priority,
  };
}
