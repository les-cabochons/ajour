import {
  normalizeConnectorStatusKey,
  type ConnectorSettleState,
} from "@ajour/shared";
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
import type { PriorityLevel } from "@/domain/backlog/priority";
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

export function isSettleStateDraftValid(
  states: ConnectorSettleState[],
  stateName: string,
  sourceStatusLabel: string | undefined,
) {
  return (
    Boolean(findSettleState(states, stateName)) ||
    normalizeConnectorStatusKey(stateName) ===
      normalizeConnectorStatusKey(sourceStatusLabel ?? "")
  );
}

/**
 * Turns the settle dialog's fields into a change. A new priority level is
 * written only when it differs from the level the source reports; the
 * connector plugin picks the source value. The domain keeps only the fields
 * that differ from the item. Returns null for an unsupported changed state,
 * an invalid level, or a priority clear, which connectors cannot write.
 */
export function buildSettleChange(
  states: ConnectorSettleState[],
  stateName: string,
  priorityInput: string,
  current: {
    sourceStatusLabel?: string;
    importedPriority?: PriorityLevel;
  },
): BacklogSettleChange | null {
  if (!isSettleStateDraftValid(states, stateName, current.sourceStatusLabel))
    return null;
  const level = parsePriorityInput(priorityInput);
  if (level === null) {
    return null;
  }
  if (level === undefined && current.importedPriority !== undefined) {
    return null;
  }

  const state = findSettleState(states, stateName);
  return {
    state: state ? { name: state.name, done: state.done } : undefined,
    priority: level !== current.importedPriority ? level : undefined,
  };
}
