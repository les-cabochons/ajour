import type { AgentTurnEvent } from "@ajour/shared/agent-runs";
import type { DeckCloneUse } from "@ajour/shared/deck";

/*
 * One ask on Deck's review page (#791): a question anchored to a concern,
 * answered in place. It starts on the anchor's default question, or the
 * user's own. A quiet placeholder shows until the first text, the answer
 * streams in, and it ends answered, stopped or failed. While a timesheet
 * task holds the agent, it waits. Another of Deck's turns ahead of it keeps
 * the placeholder: that wait is short and needs no note.
 *
 * Once the ask is sent, it knows what it does with the user's local clone
 * (#795): it reads it, or can't and why, or none is chosen. The answer's
 * footer says so.
 */

/** What every state of an ask carries: its typed question and its clone. */
interface Carried {
  question?: string;
  clone?: DeckCloneUse;
}

export type AskState =
  /** Sent, or running before its first text. */
  | ({ kind: "asking" } & Carried)
  /** A timesheet task holds the agent. */
  | ({ kind: "waiting" } & Carried)
  | ({ kind: "streaming"; pieces: string[] } & Carried)
  | ({ kind: "answered"; text: string; head: string } & Carried)
  | ({ kind: "stopped"; text: string } & Carried)
  | ({ kind: "failed"; text: string; message: string } & Carried);

/** An ask just sent, on the default question or `question`. */
export function startAsk(question?: string): AskState {
  return question === undefined
    ? { kind: "asking" }
    : { kind: "asking", question };
}

/** The text so far. */
export function askText(state: AskState): string {
  switch (state.kind) {
    case "streaming":
      return state.pieces.join("");
    case "answered":
    case "stopped":
    case "failed":
      return state.text;
    default:
      return "";
  }
}

/** Whether a turn is still going, so Stop shows and nothing else is asked. */
export function askGoing(state: AskState): boolean {
  return (
    state.kind === "asking" ||
    state.kind === "waiting" ||
    state.kind === "streaming"
  );
}

const withQuestion = (state: AskState): Carried => ({
  ...(state.question === undefined ? {} : { question: state.question }),
  ...(state.clone === undefined ? {} : { clone: state.clone }),
});

/** What the ask does with the user's clone, as the ask's start answered. */
export function withClone(
  state: AskState,
  clone: DeckCloneUse | undefined,
): AskState {
  if (clone === undefined) return state;
  return { ...state, clone };
}

/** The answer the cache gave at once. */
export function answerAsk(
  state: AskState,
  text: string,
  head: string,
): AskState {
  return { kind: "answered", ...withQuestion(state), text, head };
}

/**
 * An answer's footer: the head it read, with `, and your clone` when it
 * read the user's clone too, and why it didn't when it couldn't.
 */
export function answerFooter(state: Extract<AskState, { kind: "answered" }>): {
  source: string;
  cloneReason?: string;
  offersClone: boolean;
} {
  const source = `From the code at ${shortHead(state.head)}`;
  const clone = state.clone;
  if (clone?.state === "read") {
    return { source: `${source}, and your clone`, offersClone: false };
  }
  if (clone?.state === "unavailable") {
    return { source, cloneReason: clone.reason, offersClone: false };
  }
  return { source, offersClone: clone?.state === "not_chosen" };
}

/** The ask couldn't start or its turn failed, with what came so far. */
export function failAsk(state: AskState, message: string): AskState {
  return {
    kind: "failed",
    ...withQuestion(state),
    text: askText(state),
    message,
  };
}

/** Moves the ask on with one event of its turn, about `head`. */
export function applyTurnEvent(
  state: AskState,
  event: AgentTurnEvent,
  head: string,
): AskState {
  if (!askGoing(state)) return state;
  switch (event.type) {
    case "waiting":
      return event.waitingFor === "agent-run" && state.kind === "asking"
        ? { kind: "waiting", ...withQuestion(state) }
        : state;
    case "started":
      return state.kind === "waiting"
        ? { kind: "asking", ...withQuestion(state) }
        : state;
    case "text": {
      const pieces = state.kind === "streaming" ? [...state.pieces] : [];
      pieces[event.index] = event.text;
      return { kind: "streaming", ...withQuestion(state), pieces };
    }
    case "ended":
      if (event.outcome === "done") {
        return answerAsk(state, askText(state), head);
      }
      if (event.outcome === "cancelled") {
        return {
          kind: "stopped",
          ...withQuestion(state),
          text: askText(state),
        };
      }
      return failAsk(state, event.error ?? "The answer couldn't be finished.");
    case "conversation-closed":
      return state;
  }
}

/** The head as the answer's footer names it. */
export function shortHead(head: string) {
  return head.slice(0, 7);
}
