import { useCallback, useSyncExternalStore } from "react";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
  deckNeedsConsentSchema,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import {
  answerAsk,
  applyTurnEvent,
  askGoing,
  failAsk,
  startAsk,
  stopAsk,
  type AskState,
} from "@/domain/deck/ask";
import { watchAgentTurn } from "@/lib/agent-turns";
import { AppApiError, askDeck, cancelAgentTurn } from "@/lib/app-api";

/*
 * The open asks of Deck's review page (#791), kept by the page rather than
 * by the concern header that shows one. A huge pull request mounts only
 * the rows near the screen (#790), so a header scrolled away unmounts: its
 * question, its answer and the turn writing it carry on here, and show
 * again as it comes back. Each ask is keyed by the head it is about and
 * its concern. A revoked consent drops the repository's answers, cached
 * ones too, and stops the asks still waiting for one.
 */

/** The pull request the page asks about, at the head it shows. */
export interface DeckAskTarget {
  pluginId: string;
  connectionId: string;
  repository: string;
  number: number;
  head: string;
}

/** True once the repository is allowed, false for Not now, or why recording the consent failed. */
export type ConsentAnswer = boolean | { error: string };

/** A concern's open ask. */
export interface AskSession {
  /** Nothing is asked yet: the question shows, to send or edit. */
  composing: boolean;
  /** The question as written so far. */
  question: string;
  /** The question takes the focus as it mounts, once: right after `more ›`. */
  focusQuestion: boolean;
  /** What is typed in Ask something else. */
  followUp: string;
  state: AskState;
  /** The consent dialog is open: nothing is asked yet, so nothing shows. */
  awaitingConsent: boolean;
  /** The running turn, which Stop stops and whose events the ask follows. */
  turnId?: string;
}

/** The answer a session shows, its turn's or the cache's, which a revoked consent hides. */
const holdsAnswer = (session: AskSession) =>
  !session.composing && !session.awaitingConsent && !askGoing(session.state);

/** The key of `concernId`'s ask at `head`. */
export function askKey(head: string, concernId: string) {
  return `${head} ${concernId}`;
}

const headOf = (key: string) => key.slice(0, key.indexOf(" "));

export class DeckAskSessions {
  readonly #requestConsent: (
    request: DeckNeedsConsent,
  ) => Promise<ConsentAnswer>;
  readonly #sessions = new Map<string, AskSession>();
  readonly #listeners = new Map<string, Set<() => void>>();
  /** Counts each key's asks, so an answer for an earlier one is dropped. */
  readonly #generations = new Map<string, number>();
  /** The turn each key follows, and how to stop following it. */
  readonly #watching = new Map<string, () => void>();
  /** Whether the page shows, so its asks follow their turns. */
  #attached = false;
  /** The conversations the asks' turns ran in. */
  readonly #conversations = new Set<string>();

  constructor(
    requestConsent: (request: DeckNeedsConsent) => Promise<ConsentAnswer>,
  ) {
    this.#requestConsent = requestConsent;
  }

  get(key: string): AskSession | undefined {
    return this.#sessions.get(key);
  }

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(key);
    };
  }

  /** Opens the ask on the concern's default question. */
  open(key: string) {
    this.#set(key, {
      composing: true,
      question: DECK_CONCERN_DEFAULT_QUESTION,
      focusQuestion: true,
      followUp: "",
      state: startAsk(),
      awaitingConsent: false,
    });
  }

  /** Closes the ask. A turn still going ends on its own and is cached. */
  close(key: string) {
    this.#bump(key);
    this.#unwatch(key);
    this.#set(key, undefined);
  }

  edit(
    key: string,
    change: Partial<
      Pick<AskSession, "question" | "followUp" | "focusQuestion">
    >,
  ) {
    const session = this.#sessions.get(key);
    if (session) this.#set(key, { ...session, ...change });
  }

  stop(key: string) {
    const turnId = this.#sessions.get(key)?.turnId;
    if (turnId) void cancelAgentTurn(turnId).catch(() => undefined);
  }

  /**
   * Asks `question`, or the default one, about the concern at `target`'s
   * head. Not now in the consent dialog closes the ask and calls `declined`.
   */
  async ask(
    target: DeckAskTarget,
    concernId: string,
    question: string | undefined,
    declined: () => void,
  ) {
    const key = askKey(target.head, concernId);
    const mine = this.#bump(key);
    this.#unwatch(key);
    this.#update(key, () => ({
      composing: false,
      focusQuestion: false,
      awaitingConsent: false,
      turnId: undefined,
      state: startAsk(question),
    }));
    const current = () => this.#generations.get(key) === mine;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const asked = await askDeck(target.pluginId, target.connectionId, {
          repository: target.repository,
          number: target.number,
          head: target.head,
          anchor: { kind: "concern", id: concernId },
          ...(question === undefined ? {} : { question }),
        });
        if (!current()) return;
        if (asked.kind === "answer") {
          this.#update(key, (session) => ({
            state: answerAsk(session.state, asked.text, asked.head),
          }));
          return;
        }
        this.#conversations.add(asked.turn.conversationId);
        this.#update(key, () => ({ turnId: asked.turn.id }));
        this.#watch(key, asked.turn.id, target.head);
        return;
      } catch (error) {
        if (!current()) return;
        const consent =
          error instanceof AppApiError
            ? deckNeedsConsentSchema.safeParse(error.payload)
            : undefined;
        if (consent?.success && attempt === 0) {
          this.#update(key, () => ({ awaitingConsent: true }));
          const answer = await this.#requestConsent(consent.data);
          if (!current()) return;
          this.#update(key, () => ({ awaitingConsent: false }));
          if (answer === true) continue;
          if (answer === false) {
            this.close(key);
            declined();
            return;
          }
          this.#update(key, (session) => ({
            state: failAsk(session.state, answer.error),
          }));
          return;
        }
        this.#update(key, (session) => ({
          state: failAsk(
            session.state,
            error instanceof Error
              ? error.message
              : "Ajour couldn't get more detail.",
          ),
        }));
        return;
      }
    }
  }

  /** The page shows: its asks follow their turns again. */
  attach() {
    this.#attached = true;
    for (const [key, session] of this.#sessions) {
      if (session.turnId && askGoing(session.state)) {
        this.#watch(key, session.turnId, headOf(key));
      }
    }
  }

  /** The page is gone: its asks stop following their turns. */
  detach() {
    this.#attached = false;
    for (const key of [...this.#watching.keys()]) this.#unwatch(key);
  }

  /**
   * The repository's consent is taken back: its answers, cached or not, show
   * no more, and an ask still waiting for its answer stops and drops it. A
   * running turn stops on its own, keeping what came; a question being
   * written stays, and its ask opens the consent dialog again.
   */
  revoke() {
    // Every conversation so far is the revoked consent's: a close of one that
    // comes later, after the repository was allowed again, revokes nothing.
    this.#conversations.clear();
    for (const [key, session] of [...this.#sessions]) {
      if (session.composing || session.awaitingConsent) continue;
      if (holdsAnswer(session)) {
        this.close(key);
      } else if (!session.turnId) {
        this.#bump(key);
        this.#set(key, { ...session, state: stopAsk(session.state) });
      }
    }
  }

  /** A conversation closed: revoked, it is the repository's consent taken back. */
  conversationClosed(conversationId: string, reason: string) {
    if (reason === "revoked" && this.#conversations.has(conversationId)) {
      this.revoke();
    }
  }

  /** Drops the asks about any head but `head`, which the page no longer shows. */
  keepHead(head: string) {
    for (const key of [...this.#sessions.keys()]) {
      if (headOf(key) !== head) this.close(key);
    }
  }

  /**
   * Follows the turn. Its events so far come first; once it ends, nothing
   * more is followed.
   */
  #watch(key: string, turnId: string, head: string) {
    if (!this.#attached || this.#watching.has(key)) return;
    const stop = watchAgentTurn(turnId, (event) => {
      const session = this.#sessions.get(key);
      if (session?.turnId !== turnId) return;
      const state = applyTurnEvent(session.state, event, head);
      if (state !== session.state) this.#set(key, { ...session, state });
      if (!askGoing(state)) this.#unwatch(key);
    });
    const session = this.#sessions.get(key);
    if (session?.turnId === turnId && askGoing(session.state)) {
      this.#watching.set(key, stop);
    } else {
      stop();
    }
  }

  #unwatch(key: string) {
    this.#watching.get(key)?.();
    this.#watching.delete(key);
  }

  #bump(key: string) {
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    return generation;
  }

  #update(key: string, change: (session: AskSession) => Partial<AskSession>) {
    const session = this.#sessions.get(key);
    if (session) this.#set(key, { ...session, ...change(session) });
  }

  #set(key: string, session: AskSession | undefined) {
    if (session) this.#sessions.set(key, session);
    else this.#sessions.delete(key);
    this.#listeners.get(key)?.forEach((listener) => listener());
  }
}

const NO_SESSIONS = () => () => {};

/** The ask at `key`, or undefined while none is open. */
export function useAskSession(
  sessions: DeckAskSessions | undefined,
  key: string,
): AskSession | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessions ? sessions.subscribe(key, listener) : NO_SESSIONS(),
    [sessions, key],
  );
  return useSyncExternalStore(subscribe, () => sessions?.get(key));
}
