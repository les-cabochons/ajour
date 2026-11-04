import {
  normalizeSourceStatusKey,
  type BacklogPerson,
  type BacklogSettleState,
} from "@ajour/shared";
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
import type { PriorityLevel } from "@/domain/backlog/priority";
import { parsePriorityInput } from "@/features/backlog/backlog-task-editor";

export interface SettleStateGroup {
  category: string;
  states: BacklogSettleState[];
}

/**
 * The Undo toast's title for a settle: what it did besides settling, then
 * "settled" or "archived", such as "Commented, assigned to Ana Silva and
 * settled". `assignee` is the new one, null when unassigned, or undefined
 * when the settle kept it.
 */
export function settleToastTitle({
  archived,
  commented,
  assignee,
}: {
  archived: boolean;
  commented: boolean;
  assignee?: BacklogPerson | null;
}) {
  const outcome = archived ? "archived" : "settled";
  const done = [
    commented ? "commented" : undefined,
    assignee === undefined
      ? undefined
      : assignee === null
        ? "unassigned"
        : `assigned to ${assignee.displayName}`,
  ].filter((part): part is string => part !== undefined);
  if (done.length === 0) return `Backlog item ${outcome}`;
  const title = `${done.join(", ")} and ${outcome}`;
  return title.charAt(0).toUpperCase() + title.slice(1);
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
    /** Null when no one has the item; absent when the plugin hasn't said. */
    assignee?: BacklogPerson | null;
  },
  /** The picked person, null for Unassigned, or undefined to keep the item's. */
  assignee?: BacklogPerson | null,
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
  const reassigned =
    assignee !== undefined &&
    (current.assignee === undefined ||
      (current.assignee?.id ?? null) !== (assignee?.id ?? null));
  return {
    state: state ? { name: state.name, done: state.done } : undefined,
    priority: level !== current.importedPriority ? level : undefined,
    ...(reassigned ? { assignee } : {}),
  };
}
