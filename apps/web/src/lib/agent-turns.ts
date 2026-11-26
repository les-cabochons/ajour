import type { AgentTurnEvent } from "@ajour/shared/agent-runs";

/*
 * The `agent-turn` events the local API sends on the window's stream, by
 * turn (#778, #791). A turn's events can come before its start answers, so
 * the last turns' events are kept and replayed to whoever watches one later.
 * They hold an answer's text, so they live in memory only.
 */

type TurnEvent = Extract<AgentTurnEvent, { turnId: string }>;
type Listener = (event: TurnEvent) => void;
type ClosedEvent = Extract<AgentTurnEvent, { type: "conversation-closed" }>;
type ClosedListener = (event: ClosedEvent) => void;

/** Turns whose events are kept, newest last. */
const TURNS_KEPT = 50;

const kept = new Map<string, TurnEvent[]>();
const listeners = new Map<string, Set<Listener>>();
const closedListeners = new Set<ClosedListener>();

/** Hands an event from the stream to its turn's watchers. */
export function receiveAgentTurnEvent(event: AgentTurnEvent) {
  if (event.type === "conversation-closed") {
    for (const listener of [...closedListeners]) listener(event);
    return;
  }
  const events = kept.get(event.turnId) ?? [];
  kept.delete(event.turnId);
  kept.set(event.turnId, [...events, event]);
  for (const oldest of kept.keys()) {
    if (kept.size <= TURNS_KEPT) break;
    kept.delete(oldest);
  }
  listeners.get(event.turnId)?.forEach((listener) => listener(event));
}

/**
 * Whether the window heard the turn end. A turn it never heard of, or
 * forgot among older ones, hasn't: this is no proof a turn still runs. The
 * bridge drops a queued call whose turn ends while it waits
 * (`lib/mcp-bridge.ts`), and that holds however many turns come after.
 */
export function agentTurnEnded(turnId: string) {
  return kept.get(turnId)?.some((event) => event.type === "ended") ?? false;
}

/** Calls `listener` each time a conversation closes, from now on. */
export function watchClosedConversations(listener: ClosedListener) {
  closedListeners.add(listener);
  return () => {
    closedListeners.delete(listener);
  };
}

/**
 * Calls `listener` with each of the turn's events, those already here first.
 * Returns a function that stops it.
 */
export function watchAgentTurn(turnId: string, listener: Listener) {
  const watchers = listeners.get(turnId) ?? new Set<Listener>();
  watchers.add(listener);
  listeners.set(turnId, watchers);
  for (const event of kept.get(turnId) ?? []) listener(event);
  return () => {
    watchers.delete(listener);
    if (watchers.size === 0) listeners.delete(turnId);
  };
}
