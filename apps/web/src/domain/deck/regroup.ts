import type { AgentTurnEvent } from "@ajour/shared/agent-runs";
import { DECK_REGROUP_DEFAULT_INSTRUCTION } from "@ajour/shared/deck";

/*
 * Regroup… on Deck's guide header (#794): a short instruction field opens
 * prefilled, sending it runs the guide task, and the guide shows again once
 * the agent's comes back. While a timesheet task holds the agent, it waits.
 * A failure says why, with what was sent, so Try again sends it again.
 */

export type RegroupState =
  | { kind: "closed" }
  /** The instruction field shows, prefilled. */
  | { kind: "composing"; instruction: string }
  /** Sent, or its turn runs. `waiting` while a timesheet task holds the agent. */
  | { kind: "running"; instruction?: string; waiting: boolean }
  | { kind: "failed"; instruction?: string; message: string };

export const REGROUP_CLOSED: RegroupState = { kind: "closed" };

/** Regroup… opens the field on the default instruction. */
export function openRegroup(): RegroupState {
  return { kind: "composing", instruction: DECK_REGROUP_DEFAULT_INSTRUCTION };
}

/**
 * The instruction a regroup sends for `typed`: none for the default one,
 * sent unedited, or an empty field, so the agent groups as it sees best.
 */
export function regroupInstruction(typed: string): string | undefined {
  const instruction = typed.trim();
  return instruction && instruction !== DECK_REGROUP_DEFAULT_INSTRUCTION
    ? instruction
    : undefined;
}

/** A regroup just sent. */
export function startRegroup(instruction?: string): RegroupState {
  return instruction === undefined
    ? { kind: "running", waiting: false }
    : { kind: "running", instruction, waiting: false };
}

/** It couldn't start, or its turn failed. */
export function failRegroup(
  state: RegroupState,
  message: string,
): RegroupState {
  const instruction =
    state.kind === "running" || state.kind === "failed"
      ? state.instruction
      : undefined;
  return instruction === undefined
    ? { kind: "failed", message }
    : { kind: "failed", instruction, message };
}

/** Whether its turn still goes, so Stop shows and Regroup… waits. */
export const regroupGoing = (state: RegroupState) => state.kind === "running";

/** Moves a running regroup on with one event of its turn. */
export function applyRegroupEvent(
  state: RegroupState,
  event: AgentTurnEvent,
): RegroupState {
  if (state.kind !== "running") return state;
  switch (event.type) {
    case "waiting":
      return event.waitingFor === "agent-run"
        ? { ...state, waiting: true }
        : state;
    case "started":
      return state.waiting ? { ...state, waiting: false } : state;
    case "ended":
      return event.outcome === "failed"
        ? failRegroup(state, event.error ?? "The guide couldn't be regrouped.")
        : REGROUP_CLOSED;
    default:
      return state;
  }
}
