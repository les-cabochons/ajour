import type { AgentTurnAction, AgentTurnEvent } from "@ajour/shared/agent-runs";
import type { DeckAskAnchor, DeckCloneUse } from "@ajour/shared/deck";
import {
  applyTurnEvent,
  askGoing,
  failAsk,
  startAsk,
  stopAsk,
  type AskState,
} from "./ask";

/*
 * Deck's chat (#796), the fallback for questions no ask covers. The user's
 * messages and the agent's replies alternate, one turn at a time: nothing
 * is sent while a reply is still coming. A reply streams in as an ask's
 * answer does, so it follows the same states (`domain/deck/ask.ts`).
 *
 * Continue in chat on an answer carries the answer's anchor in as a chip,
 * which the next message takes along and the user can remove first.
 *
 * Each write the turn made in the user's name comes in as one action line,
 * before the reply's text (ADR 0024). Delete on a line removes what it
 * posted; the line then says so.
 */

/** An anchor carried in from an answer, with how the chip names it. */
export interface ChatChip {
  anchor: DeckAskAnchor;
  label: string;
}

/** What Delete did to an action line's post: going, done, or why it failed. */
export type ChatDeletion = "deleting" | "deleted" | { failed: string };

export type ChatEntry =
  | { kind: "message"; id: string; text: string; chip?: ChatChip }
  | {
      kind: "reply";
      id: string;
      /** Set once the turn started. */
      turnId?: string;
      state: AskState;
    }
  | { kind: "action"; action: AgentTurnAction; deletion?: ChatDeletion };

export interface ChatState {
  entries: ChatEntry[];
  /** The composer's words. */
  draft: string;
  chip?: ChatChip;
}

export const emptyChat = (): ChatState => ({ entries: [], draft: "" });

/** The reply still coming, if any: only one at a time. */
function goingReply(state: ChatState) {
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index]!;
    if (entry.kind === "reply")
      return askGoing(entry.state) ? entry : undefined;
  }
  return undefined;
}

/** Whether a reply is still coming, so nothing else is sent and Stop shows. */
export const chatGoing = (state: ChatState) => goingReply(state) !== undefined;

/** Puts an answer's anchor in the composer as a chip, in place of any other. */
export function carryAnchor(
  state: ChatState,
  anchor: DeckAskAnchor,
  label: string,
): ChatState {
  return { ...state, chip: { anchor, label } };
}

export function removeChip(state: ChatState): ChatState {
  if (!state.chip) return state;
  const { chip: _removed, ...rest } = state;
  return rest;
}

/**
 * Sends the composer's words, with the chip's anchor, as message `id`: the
 * composer empties and the reply is on its way. Undefined for blank words,
 * or while a reply is still coming.
 */
export function sendMessage(
  state: ChatState,
  id: string,
):
  | { state: ChatState; message: { text: string; anchor?: DeckAskAnchor } }
  | undefined {
  const text = state.draft.trim();
  if (!text || chatGoing(state)) return undefined;
  const { chip } = state;
  return {
    state: {
      entries: [
        ...state.entries,
        { kind: "message", id, text, ...(chip ? { chip } : {}) },
        { kind: "reply", id: `${id}:reply`, state: startAsk() },
      ],
      draft: "",
    },
    message: { text, ...(chip ? { anchor: chip.anchor } : {}) },
  };
}

/** Replaces the reply still coming. */
function withReply(
  state: ChatState,
  change: (reply: Extract<ChatEntry, { kind: "reply" }>) => ChatEntry,
): ChatState {
  const reply = goingReply(state);
  if (!reply) return state;
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry === reply ? change(reply) : entry,
    ),
  };
}

/** The reply's turn started: its events are now the reply's. */
export function replyStarted(state: ChatState, turnId: string): ChatState {
  return withReply(state, (reply) => ({ ...reply, turnId }));
}

/** The reply's turn couldn't start, or it was stopped before it did. */
export function failReply(state: ChatState, message: string): ChatState {
  return withReply(state, (reply) => ({
    ...reply,
    state: failAsk(reply.state, message),
  }));
}

/** The reply was stopped before its turn started, as while the clone was fetched. */
export function stopReply(state: ChatState): ChatState {
  return withReply(state, (reply) => ({
    ...reply,
    state: stopAsk(reply.state),
  }));
}

/**
 * Moves the chat on with one event of the reply's turn: its text, its end,
 * or a write it made, shown once as an action line before the reply.
 */
export function applyChatEvent(
  state: ChatState,
  event: AgentTurnEvent,
): ChatState {
  if (event.type === "conversation-closed") return state;
  const at = state.entries.findIndex(
    (entry) => entry.kind === "reply" && entry.turnId === event.turnId,
  );
  const reply = state.entries[at];
  if (reply?.kind !== "reply") return state;
  if (event.type === "action") {
    const shown = state.entries.some(
      (entry) => entry.kind === "action" && entry.action.id === event.action.id,
    );
    if (shown) return state;
    return {
      ...state,
      entries: [
        ...state.entries.slice(0, at),
        { kind: "action", action: event.action },
        ...state.entries.slice(at),
      ],
    };
  }
  // A reply keeps the page's head: its text names lines at it.
  const next = applyTurnEvent(reply.state, event, "");
  if (next === reply.state) return state;
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry === reply ? { ...reply, state: next } : entry,
    ),
  };
}

/** What Delete did to the action line `actionId`. */
export function markDeletion(
  state: ChatState,
  actionId: string,
  deletion: ChatDeletion,
): ChatState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.kind === "action" && entry.action.id === actionId
        ? { ...entry, deletion }
        : entry,
    ),
  };
}

/**
 * The chat header, the one place that names the agent and what it reads:
 * `#482 · Claude Code · PR + local clone`. `clone` is what the last turn
 * did with the user's clone, or `chosen` before any turn when the user
 * chose one. A clone that can't be read leaves the chat on the pull
 * request alone, and says why.
 */
export function chatHeader({
  number,
  provider,
  clone,
}: {
  number: number;
  /** The agent Settings › Agents picks, once known. */
  provider?: string;
  clone?: DeckCloneUse | "chosen";
}): { text: string; cloneReason?: string } {
  const reads =
    clone === "chosen" || (clone !== undefined && clone.state === "read")
      ? "PR + local clone"
      : "PR";
  const text = [`#${number}`, provider, reads]
    .filter((part) => part !== undefined)
    .join(" · ");
  return clone !== undefined &&
    clone !== "chosen" &&
    clone.state === "unavailable"
    ? { text, cloneReason: clone.reason }
    : { text };
}
