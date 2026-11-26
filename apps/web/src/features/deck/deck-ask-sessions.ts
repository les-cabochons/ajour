import { useCallback, useSyncExternalStore } from "react";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
  DECK_SUMMARY_DEFAULT_QUESTION,
  deckNeedsConsentSchema,
  type DeckAskAnchor,
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
 * its anchor, a concern or a summary line (#794). A revoked consent drops the repository's answers, cached
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

/** An open ask, about a concern or a summary line. */
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
  /** When it was asked: a revocation from before then leaves it. */
  askedAt?: number;
}

/** The answer a session shows, its turn's or the cache's, which a revoked consent hides. */
const holdsAnswer = (session: AskSession) =>
  !session.composing && !session.awaitingConsent && !askGoing(session.state);

/** The key of the ask about `anchor` at `head`. */
export function askKey(head: string, anchor: DeckAskAnchor) {
  return `${head} ${anchor.kind}:${anchor.id}`;
}

/** The question an ask about `anchor` opens on, which it sends as no question. */
export function defaultQuestionOf(anchor: DeckAskAnchor) {
  return anchor.kind === "concern"
    ? DECK_CONCERN_DEFAULT_QUESTION
    : DECK_SUMMARY_DEFAULT_QUESTION;
}

const headOf = (key: string) => key.slice(0, key.indexOf(" "));

/** What a request that may need the repository's consent came to. */
export type ConsentedOutcome<T> =
  | { kind: "done"; value: T }
  /** Not now in the consent dialog. */
  | { kind: "declined" }
  /** Why it failed, when the error said. */
  | { kind: "failed"; message: string | undefined }
  /** A later request replaced it: nothing of it shows. */
  | { kind: "stale" };

/**
 * Runs `run`, an ask's or a regroup's request. When the local API refuses
 * it for the repository's consent, asks the user once, through the page's
 * consent dialog, and runs it again once allowed. `onAsking` says while the
 * dialog is open; once `current` says false, nothing more is asked or run.
 */
export async function withConsent<T>(
  run: () => Promise<T>,
  {
    requestConsent,
    current,
    onAsking,
  }: {
    requestConsent: (request: DeckNeedsConsent) => Promise<ConsentAnswer>;
    current: () => boolean;
    onAsking?: (asking: boolean) => void;
  },
): Promise<ConsentedOutcome<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const value = await run();
      return current() ? { kind: "done", value } : { kind: "stale" };
    } catch (error) {
      if (!current()) return { kind: "stale" };
      const consent =
        attempt === 0 && error instanceof AppApiError
          ? deckNeedsConsentSchema.safeParse(error.payload)
          : undefined;
      if (!consent?.success) {
        return {
          kind: "failed",
          message: error instanceof Error ? error.message : undefined,
        };
      }
      onAsking?.(true);
      const answer = await requestConsent(consent.data);
      if (!current()) return { kind: "stale" };
      onAsking?.(false);
      if (answer === false) return { kind: "declined" };
      if (answer !== true) return { kind: "failed", message: answer.error };
    }
  }
}

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
  /** The conversations the asks' turns ran in, with when each was asked. */
  readonly #conversations = new Map<string, number>();
  /** When the latest revocation this page heard was made. */
  #revokedAt = Number.NEGATIVE_INFINITY;

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

  /**
   * Asks the user to allow the repository, with the page's one consent
   * dialog, as a regroup does before its turn (#794).
   */
  requestConsent(request: DeckNeedsConsent): Promise<ConsentAnswer> {
    return this.#requestConsent(request);
  }

  /** Opens the ask on its anchor's default question. */
  open(key: string, anchor: DeckAskAnchor) {
    this.#set(key, {
      composing: true,
      question: defaultQuestionOf(anchor),
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
   * Asks `question`, or the default one, about `anchor` at `target`'s
   * head. Not now in the consent dialog closes the ask and calls `declined`.
   */
  async ask(
    target: DeckAskTarget,
    anchor: DeckAskAnchor,
    question: string | undefined,
    declined: () => void,
  ) {
    const key = askKey(target.head, anchor);
    const mine = this.#bump(key);
    this.#unwatch(key);
    this.#update(key, () => ({
      composing: false,
      focusQuestion: false,
      awaitingConsent: false,
      turnId: undefined,
      askedAt: Date.now(),
      state: startAsk(question),
    }));
    const current = () => this.#generations.get(key) === mine;
    const outcome = await withConsent(
      () =>
        askDeck(target.pluginId, target.connectionId, {
          repository: target.repository,
          number: target.number,
          head: target.head,
          anchor,
          ...(question === undefined ? {} : { question }),
        }),
      {
        requestConsent: this.#requestConsent,
        current,
        onAsking: (asking) =>
          this.#update(key, () => ({ awaitingConsent: asking })),
      },
    );
    if (outcome.kind === "stale") return;
    if (outcome.kind === "declined") {
      this.close(key);
      declined();
      return;
    }
    if (outcome.kind === "failed") {
      this.#update(key, (session) => ({
        state: failAsk(
          session.state,
          outcome.message ?? "Ajour couldn't get more detail.",
        ),
      }));
      return;
    }
    const asked = outcome.value;
    if (asked.kind === "answer") {
      this.#update(key, (session) => ({
        state: answerAsk(session.state, asked.text, asked.head),
      }));
      return;
    }
    this.#conversations.set(
      asked.turn.conversationId,
      this.#sessions.get(key)?.askedAt ?? Date.now(),
    );
    this.#update(key, () => ({ turnId: asked.turn.id }));
    this.#watch(key, asked.turn.id, target.head);
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
   * written stays, and its ask opens the consent dialog again. `at` is when
   * the consent was taken back, now when unknown. A revocation the page
   * already heard, or one older, changes nothing: it reached this page
   * late, after the repository was allowed and asked again. Otherwise the
   * asks and conversations from before it go.
   */
  revoke(at?: number) {
    const when = at ?? Date.now();
    if (at !== undefined && at <= this.#revokedAt) return;
    this.#revokedAt = Math.max(this.#revokedAt, when);
    // A conversation from before it is the revoked consent's: its close,
    // coming later, revokes nothing more.
    for (const [conversationId, askedAt] of [...this.#conversations]) {
      if (askedAt <= when) this.#conversations.delete(conversationId);
    }
    for (const [key, session] of [...this.#sessions]) {
      if (session.composing || session.awaitingConsent) continue;
      if ((session.askedAt ?? 0) > when) continue;
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
