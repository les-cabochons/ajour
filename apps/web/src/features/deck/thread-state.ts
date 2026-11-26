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
  /** Replies the code host took since the conversation `readWith` was read. */
  sent: readonly string[];
  /** Resolved or opened again since the conversation `readWith` was read. */
  resolved?: boolean;
  /**
   * The conversation read showing when `sent` and `resolved` were set: once
   * another read shows, it holds them as the code host has them, and they
   * stop counting in the same render (`sinceRead`).
   */
  readWith?: object;
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

/** The replies sent and the resolved state the page shows over `conversation`, the read on screen. */
export function sinceRead(
  state: ThreadState,
  conversation: object | undefined,
) {
  return state.readWith !== undefined && state.readWith === conversation
    ? { sent: state.sent, resolved: state.resolved }
    : { sent: [] as readonly string[], resolved: undefined };
}

export class ThreadStates {
  readonly #states = new Map<string, ThreadState>();
  readonly #listeners = new Set<() => void>();
  /** The conversation read on screen, which the page keeps current. */
  conversation: object | undefined;

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
    const shown = this.#shown(threadId);
    if (sender?.body === body) this.closeReply(threadId);
    else if (sender)
      this.update(threadId, { posting: false, submission: undefined });
    this.update(threadId, { ...shown, sent: [...shown.sent, body] });
  }

  /** The code host resolved the thread, or opened it again: it shows so until the next read. */
  resolvedAs(threadId: string, resolved: boolean) {
    this.update(threadId, {
      ...this.#shown(threadId),
      resolving: false,
      resolved,
    });
  }

  /** What the thread shows over the read on screen, stamped with it. */
  #shown(threadId: string) {
    return {
      ...sinceRead(this.of(threadId), this.conversation),
      readWith: this.conversation,
    };
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
