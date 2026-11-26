import { useCallback, useSyncExternalStore } from "react";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
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
 * The open asks of Deck's review page (#791, #793), kept by the page rather
 * than by the concern header or the hunk that shows one. A huge pull
 * request mounts only the rows near the screen (#790), so a header or a
 * hunk scrolled away unmounts: its question, its answer and the turn
 * writing it carry on here, and show again as it comes back. Each ask is
 * keyed by the head it is about and its anchor, a concern or lines of a
 * hunk, and each hunk finds the asks about its lines. A revoked consent
 * drops the repository's answers, cached ones too, and stops the asks
 * still waiting for one.
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

/** A concern's or selected lines' open ask. */
export interface AskSession {
  /** What it asks about. */
  anchor: DeckAskAnchor;
  /** The hunk whose lines it asks about, which shows it under its lines. */
  hunkId?: string;
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

/** The key of the ask about `anchor` at `head`: a concern by its id, lines by their path and ends. */
export function askKey(head: string, anchor: DeckAskAnchor) {
  return anchor.kind === "concern"
    ? `${head} ${anchor.id}`
    : `${head} lines:${JSON.stringify([
        anchor.path,
        anchor.start.side,
        anchor.start.line,
        anchor.end.side,
        anchor.end.line,
      ])}`;
}

const NO_ASKS: readonly string[] = [];

/** Where a hunk's asks are heard: never an ask's key, which starts with a head. */
const hunkChannel = (hunkId: string) => `hunk:${hunkId}`;

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
  /** The conversations the asks' turns ran in, with when each was asked. */
  readonly #conversations = new Map<string, number>();
  /** When the latest revocation this page heard was made. */
  #revokedAt = Number.NEGATIVE_INFINITY;
  /** The keys of the asks about each hunk's lines, in the order they opened. */
  readonly #byHunk = new Map<string, readonly string[]>();

  constructor(
    requestConsent: (request: DeckNeedsConsent) => Promise<ConsentAnswer>,
  ) {
    this.#requestConsent = requestConsent;
  }

  get(key: string): AskSession | undefined {
    return this.#sessions.get(key);
  }

  /** The keys of the open asks about `hunkId`'s lines, the same list while they are the same. */
  hunkAsks(hunkId: string): readonly string[] {
    return this.#byHunk.get(hunkId) ?? NO_ASKS;
  }

  /** Hears the asks about `hunkId`'s lines open and close. */
  subscribeHunk(hunkId: string, listener: () => void): () => void {
    return this.subscribe(hunkChannel(hunkId), listener);
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
   * Opens the ask about `anchor` at `head` on its default question, the
   * concern's unless `question` says, to send as is or edit. `hunkId`
   * shows it under that hunk's lines. An ask already open there starts
   * again, and an answer still coming for it is dropped.
   */
  open(
    head: string,
    anchor: DeckAskAnchor,
    {
      question = DECK_CONCERN_DEFAULT_QUESTION,
      hunkId,
    }: { question?: string; hunkId?: string } = {},
  ) {
    const key = askKey(head, anchor);
    this.#bump(key);
    this.#unwatch(key);
    this.#set(key, {
      anchor,
      ...(hunkId === undefined ? {} : { hunkId }),
      composing: true,
      question,
      focusQuestion: true,
      followUp: "",
      state: startAsk(),
      awaitingConsent: false,
    });
    return key;
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
   * Asks `question`, or the default one, about the open ask on `anchor` at
   * `target`'s head. Not now in the consent dialog closes the ask and
   * calls `declined`.
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const asked = await askDeck(target.pluginId, target.connectionId, {
          repository: target.repository,
          number: target.number,
          head: target.head,
          anchor,
          ...(question === undefined ? {} : { question }),
        });
        if (!current()) return;
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
    const before = this.#sessions.get(key);
    if (session) this.#sessions.set(key, session);
    else this.#sessions.delete(key);
    if (before?.hunkId !== session?.hunkId) {
      if (before?.hunkId) this.#index(before.hunkId, key, false);
      if (session?.hunkId) this.#index(session.hunkId, key, true);
    }
    this.#listeners.get(key)?.forEach((listener) => listener());
  }

  /** Adds `key` to the asks about `hunkId`'s lines, or takes it out. */
  #index(hunkId: string, key: string, open: boolean) {
    const keys = this.#byHunk.get(hunkId) ?? NO_ASKS;
    const next = open
      ? keys.includes(key)
        ? keys
        : [...keys, key]
      : keys.filter((entry) => entry !== key);
    if (next === keys) return;
    if (next.length) this.#byHunk.set(hunkId, next);
    else this.#byHunk.delete(hunkId);
    this.#listeners.get(hunkChannel(hunkId))?.forEach((listener) => listener());
  }
}

const NO_SESSIONS = () => () => {};

/** The keys of the open asks about `hunkId`'s lines. */
export function useHunkAsks(
  sessions: DeckAskSessions | undefined,
  hunkId: string,
): readonly string[] {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessions ? sessions.subscribeHunk(hunkId, listener) : NO_SESSIONS(),
    [sessions, hunkId],
  );
  return useSyncExternalStore(
    subscribe,
    () => sessions?.hunkAsks(hunkId) ?? NO_ASKS,
  );
}

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
