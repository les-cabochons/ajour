import { useCallback, useSyncExternalStore } from "react";
import type { DeckReviewSubmission } from "@/domain/deck/draft-review";

/*
 * What each review thread holds on the page beyond what the code host said
 * (#785): its reply being written, posting or failed, the replies posted
 * since the conversation was last read, and a resolve or unresolve on its
 * way. Kept by the review page rather than by the card, so a thread
 * scrolled away in a huge pull request (#790), or moved between the gutter
 * and its line, keeps them. Several threads may hold a reply at once.
 */

export interface ThreadState {
  /** The reply field is open. */
  replying: boolean;
  /** The reply's words as typed so far. */
  body: string;
  /** The reply is waiting for the code host. */
  posting: boolean;
  /** Why the last reply failed. */
  failure?: string;
  /** The code host couldn't tell whether the last reply reached it: the next posts anew. */
  uncertain: boolean;
  /**
   * The reply's last try, named: Retry with the same words sends the same
   * name. Undefined once a try lands or goes unsettled.
   */
  submission?: DeckReviewSubmission;
  /** The field takes the focus as it mounts, once: right after it opens. */
  focus: boolean;
  /** Replies the code host took since the conversation was read, shown until it's read again. */
  sent: readonly string[];
  /** Resolved or opened again since the conversation was read. */
  resolved?: boolean;
  /** A resolve or unresolve is waiting for the code host. */
  resolving: boolean;
  /** Why the last resolve or unresolve failed. */
  resolveFailure?: string;
}

const IDLE: ThreadState = {
  replying: false,
  body: "",
  posting: false,
  uncertain: false,
  focus: false,
  sent: [],
  resolving: false,
};

export class ThreadStates {
  readonly #states = new Map<string, ThreadState>();
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  of(threadId: string): ThreadState {
    return this.#states.get(threadId) ?? IDLE;
  }

  update(threadId: string, change: Partial<ThreadState>) {
    this.#states.set(threadId, { ...this.of(threadId), ...change });
    this.#emit();
  }

  /** Opens the reply field, focused, on what it held. */
  openReply(threadId: string) {
    this.update(threadId, { replying: true, focus: true });
  }

  /** Closes the reply field; one opened again starts empty. */
  closeReply(threadId: string) {
    this.update(threadId, {
      replying: false,
      body: "",
      posting: false,
      failure: undefined,
      uncertain: false,
      submission: undefined,
      focus: false,
    });
  }

  /**
   * The thread's reply while it still holds the try named `submissionId`:
   * a field closed and opened again starts without a name.
   */
  sender(threadId: string, submissionId: string) {
    const state = this.#states.get(threadId);
    return state?.replying && state.submission?.id === submissionId
      ? state
      : undefined;
  }

  /** The code host answered the try named `submissionId`: only the reply that sent it changes. */
  answer(threadId: string, submissionId: string, change: Partial<ThreadState>) {
    if (this.sender(threadId, submissionId)) this.update(threadId, change);
  }

  /** The reply's try named `submission` is on its way. */
  replyStarted(threadId: string, submission: DeckReviewSubmission) {
    this.update(threadId, {
      posting: true,
      failure: undefined,
      uncertain: false,
      submission,
    });
  }

  /** It failed: the words and the name stay, for Retry. */
  replyFailed(threadId: string, submissionId: string, failure: string) {
    this.answer(threadId, submissionId, { posting: false, failure });
  }

  /** The code host couldn't tell whether it has it: the next try is a new reply, Post again. */
  replyUnsettled(threadId: string, submissionId: string, failure: string) {
    this.answer(threadId, submissionId, {
      posting: false,
      failure,
      uncertain: true,
      submission: undefined,
    });
  }

  /**
   * The code host took `body`: it shows at the end of the thread until the
   * conversation is read again. The field closes, unless words were typed
   * into it meanwhile, which stay as a new reply.
   */
  replySent(threadId: string, submissionId: string, body: string) {
    const sender = this.sender(threadId, submissionId);
    const sent = [...this.of(threadId).sent, body];
    if (sender?.body === body) this.closeReply(threadId);
    else if (sender)
      this.update(threadId, { posting: false, submission: undefined });
    this.update(threadId, { sent });
  }

  /**
   * The conversation was read again: what it says replaces the replies
   * shown as sent and the resolved state set here. Words being written stay.
   */
  conversationRead() {
    let changed = false;
    for (const [id, state] of this.#states) {
      if (!state.sent.length && state.resolved === undefined) continue;
      this.#states.set(id, { ...state, sent: [], resolved: undefined });
      changed = true;
    }
    if (changed) this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

/** What the thread holds on the page, drawn again as it changes. */
export function useThreadState(store: ThreadStates, threadId: string) {
  const read = useCallback(() => store.of(threadId), [store, threadId]);
  return useSyncExternalStore(store.subscribe, read, read);
}
