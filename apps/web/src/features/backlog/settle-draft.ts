import {
  normalizeSourceStatusKey,
  type BacklogSettleState,
} from "@ajour/shared";
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
import type { PriorityLevel } from "@/domain/backlog/priority";
import { parsePriorityInput } from "@/features/backlog/backlog-task-editor";

export interface SettleStateGroup {
  category: string;
  states: BacklogSettleState[];
}

/** Groups states by category, in the order the plugin listed them. */
export function groupSettleStates(
  states: BacklogSettleState[],
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
  states: BacklogSettleState[],
  name: string | undefined,
) {
  if (!name?.trim()) return undefined;
  const key = normalizeSourceStatusKey(name);
  return states.find((state) => normalizeSourceStatusKey(state.name) === key);
}

export function isSettleStateDraftValid(
  states: BacklogSettleState[],
  stateName: string,
  sourceStatusLabel: string | undefined,
) {
  return (
    Boolean(findSettleState(states, stateName)) ||
    normalizeSourceStatusKey(stateName) ===
      normalizeSourceStatusKey(sourceStatusLabel ?? "")
  );
}

/**
 * Turns the settle dialog's fields into a change. A level other than the
 * one the item shows is passed on, and the domain writes it only when it
 * differs from the source's, so the source's own level takes back a level
 * still waiting. The plugin picks the source value. Returns null for an
 * unsupported changed state, an invalid level, or a priority clear, which
 * plugins cannot write.
 */
export function buildSettleChange(
  states: BacklogSettleState[],
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
