import { useCallback, useSyncExternalStore } from "react";
import type { DeckReviewSubmission } from "@/domain/deck/draft-review";
import {
  composerIdentity,
  type ComposerTarget,
} from "@/domain/deck/review-notes";

/*
 * The open composer's words and its Comment now, kept by the review page
 * rather than by the composer that shows them (#784). A huge pull request
 * mounts only the rows near the screen (#790), and the gutter only the
 * cards of mounted hunks, so a composer scrolled away unmounts: what it
 * holds stays here, and shows again as it comes back. One composer is open
 * at a time; another target starts from its own words.
 */

/** What the open composer holds. */
export interface ComposerState {
  /** The words as typed so far. */
  body: string;
  /** Comment now is waiting for the code host. */
  posting: boolean;
  /** Why the last Comment now failed. */
  failure?: string;
  /**
   * The code host couldn't tell whether the last Comment now reached it:
   * the next one posts anew, as Post again.
   */
  uncertain: boolean;
  /**
   * Comment now's last try, named: Retry with the same words and lines
   * sends the same name. Each composer keeps its own, and hears only the
   * answers to it: an earlier post that lands while another composer is
   * open, or one opened again on the same lines, leaves that one be.
   * Undefined once a try lands or goes unsettled, so the next is a new post.
   */
  submission?: DeckReviewSubmission;
  /** The field takes the focus as it mounts, once: right after it opens. */
  focus: boolean;
}

export class ReviewComposerState {
  #identity: string | undefined;
  #state: ComposerState | undefined;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** What `target`'s composer holds: its own words, when it's another composer. */
  of(target: ComposerTarget): ComposerState {
    const identity = composerIdentity(target);
    if (identity !== this.#identity || !this.#state) {
      this.#identity = identity;
      this.#state = {
        body: target.body,
        posting: false,
        uncertain: false,
        focus: true,
      };
    }
    return this.#state;
  }

  /**
   * `target`'s composer takes `words`, an answer turned into a comment
   * (#793): after the words it holds, when it's the one open, keeping its
   * try's name and state; as its words, when it opens with them.
   */
  transfer(target: ComposerTarget, words: string) {
    const held = this.holds(target) ? this.#state : undefined;
    if (!held) {
      this.close();
      this.of({ ...target, body: words });
      return;
    }
    const before = held.body.trimEnd();
    this.update(target, {
      body: before ? `${before}\n\n${words}` : words,
    });
  }

  /** Changes what `target`'s composer holds, while it's the one open. */
  update(target: ComposerTarget, change: Partial<ComposerState>) {
    if (composerIdentity(target) !== this.#identity || !this.#state) return;
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }

  /**
   * What `target`'s composer holds while it's the one that sent the try
   * named `submissionId`. One closed and opened again on the same lines
   * starts without a name, so an answer to the earlier one isn't its own.
   */
  sender(target: ComposerTarget, submissionId: string) {
    return this.holds(target) && this.#state?.submission?.id === submissionId
      ? this.#state
      : undefined;
  }

  /**
   * The code host answered the try named `submissionId`: only the
   * composer that sent it changes.
   */
  answer(
    target: ComposerTarget,
    submissionId: string,
    change: Partial<ComposerState>,
  ) {
    if (this.sender(target, submissionId)) this.update(target, change);
  }

  /** True while `target`'s composer is the one open. */
  holds(target: ComposerTarget) {
    return this.#identity === composerIdentity(target);
  }

  /** The composer closed: one opened again starts from its own words. */
  close() {
    this.#identity = undefined;
    this.#state = undefined;
  }
}

/** What `target`'s composer holds, drawn again as it changes. */
export function useComposerState(
  store: ReviewComposerState,
  target: ComposerTarget,
) {
  const read = useCallback(() => store.of(target), [store, target]);
  return useSyncExternalStore(store.subscribe, read, read);
}
