import {
  normalizeConnectorStatusKey,
  type ConnectorSettleState,
} from "@ajour/shared";
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
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
 * Turns the settle dialog's fields into a change. The domain keeps only the
 * fields that differ from the item. Returns null for a priority that is not a
 * whole number from 0 to 999.
 */
export function buildSettleChange(
  states: ConnectorSettleState[],
  stateName: string,
  priorityInput: string,
): BacklogSettleChange | null {
  const priority = parsePriorityInput(priorityInput);
  if (priority === null || (priority !== undefined && priority > 999)) {
    return null;
  }

  const state = findSettleState(states, stateName);
  return {
    state: state ? { name: state.name, done: state.done } : undefined,
    priority,
  };
}
