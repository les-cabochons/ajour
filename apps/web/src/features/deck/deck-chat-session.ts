import { useSyncExternalStore } from "react";
import type { AgentTurnAction } from "@ajour/shared/agent-runs";
import {
  deckNeedsConsentSchema,
  type DeckAskAnchor,
  type DeckCloneUse,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import {
  applyChatEvent,
  carryAnchor,
  chatGoing,
  emptyChat,
  failReply,
  markDeletion,
  removeChip,
  replyStarted,
  sendMessage,
  stopReply,
  type ChatState,
} from "@/domain/deck/chat";
import { watchAgentTurn, watchClosedConversations } from "@/lib/agent-turns";
import {
  AppApiError,
  cancelAgentTurn,
  chatDeck,
  deletePullRequestComment,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import type { ConsentAnswer, DeckAskTarget } from "./deck-ask-sessions";

/*
 * The chat of one review page (#796), kept by the page so closing the
 * panel, or the narrow sheet, keeps the conversation: reopening it shows it
 * as it was, and a reply still coming carries on. A message goes through
 * the repository's consent as an ask does. Each write a reply's turn
 * makes arrives once as an action line, and the page hears it, to show
 * the new comment, title or draft state. A write can come after its turn
 * ended, and after the next message started, so the chat follows each of
 * its turns while the page shows.
 */

/** The pull request the chat is about, at the head the page shows. */
export interface DeckChatTarget extends DeckAskTarget {
  /** The user authored it, so the chat may edit its title and draft state. */
  author: boolean;
  /** Its address on the code host: an action line links only to its origin. */
  pullRequestUrl: string;
}

export class DeckChatSession {
  #state: ChatState = emptyChat();
  readonly #listeners = new Set<() => void>();
  readonly #requestConsent: (
    request: DeckNeedsConsent,
  ) => Promise<ConsentAnswer>;
  readonly #onAction: (action: AgentTurnAction) => void;
  /** Stops following each of the chat's turns, by turn. */
  readonly #watching = new Map<string, () => void>();
  /** Stops the message before its turn starts, while it waits for consent too. */
  #starting?: AbortController;
  /** Stops hearing about closed conversations. */
  #unwatchClosed?: () => void;
  /** The conversation the reply's turn runs in. */
  #conversationId?: string;
  /** What the last turn did with the user's clone, which the header says. */
  clone?: DeckCloneUse;

  constructor(
    requestConsent: (request: DeckNeedsConsent) => Promise<ConsentAnswer>,
    onAction: (action: AgentTurnAction) => void,
  ) {
    this.#requestConsent = requestConsent;
    this.#onAction = onAction;
  }

  get state() {
    return this.#state;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  editDraft(draft: string) {
    this.#set({ ...this.#state, draft });
  }

  /** Continue in chat: the answer's anchor goes in as a chip. */
  carry(anchor: DeckAskAnchor, label: string) {
    this.#set(carryAnchor(this.#state, anchor, label));
  }

  removeChip() {
    this.#set(removeChip(this.#state));
  }

  /** Sends what the composer holds, with its chip, about `target`. */
  async send(target: DeckChatTarget) {
    const sending = sendMessage(this.#state, crypto.randomUUID());
    if (!sending) return;
    this.#set(sending.state);
    const { text, anchor } = sending.message;
    // One controller for the message: Stop aborts it while the consent
    // dialog shows too.
    const starting = new AbortController();
    this.#starting = starting;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const chatted = await chatDeck(
          target.pluginId,
          target.connectionId,
          {
            repository: target.repository,
            number: target.number,
            head: target.head,
            message: text,
            ...(anchor ? { anchor } : {}),
            ...(target.author ? { author: true } : {}),
            pullRequestUrl: target.pullRequestUrl,
            ...(target.clone ? { clone: target.clone } : {}),
          },
          starting.signal,
        );
        if (this.#starting !== starting) return;
        this.#starting = undefined;
        if (chatted.clone) this.clone = chatted.clone;
        this.#conversationId = chatted.turn.conversationId;
        this.#set(replyStarted(this.#state, chatted.turn.id));
        this.#watch(chatted.turn.id);
        return;
      } catch (error) {
        if (this.#starting !== starting) return;
        const consent =
          error instanceof AppApiError
            ? deckNeedsConsentSchema.safeParse(error.payload)
            : undefined;
        if (consent?.success && attempt === 0) {
          const answer = await this.#requestConsent(consent.data);
          // Stopped while the dialog showed: nothing is sent.
          if (this.#starting !== starting) return;
          if (answer === true) continue;
          this.#starting = undefined;
          this.#set(
            failReply(
              this.#state,
              answer === false
                ? "Nothing was sent: you chose Not now."
                : answer.error,
            ),
          );
          return;
        }
        this.#starting = undefined;
        this.#set(
          failReply(
            this.#state,
            error instanceof Error
              ? error.message
              : "Ajour couldn't send the message.",
          ),
        );
        return;
      }
    }
  }

  /** Stops the reply: its turn, or the message before its turn started. */
  stop() {
    const reply = this.#state.entries.at(-1);
    if (reply?.kind === "reply" && reply.turnId) {
      void cancelAgentTurn(reply.turnId).catch(() => undefined);
      return;
    }
    const starting = this.#starting;
    if (!starting) return;
    this.#starting = undefined;
    starting.abort();
    this.#set(stopReply(this.#state));
  }

  get going() {
    return chatGoing(this.#state);
  }

  /**
   * Delete on an action line: the comment or reply goes from the code
   * host, or the draft comment from the draft review. A code host that
   * can't delete one says so, and the line keeps its link.
   */
  async delete(
    action: AgentTurnAction,
    target: Pick<
      DeckChatTarget,
      "pluginId" | "connectionId" | "repository" | "number"
    >,
    pluginName: string,
  ) {
    const { posted } = action;
    if (!posted) return;
    const ref = {
      pluginId: target.pluginId,
      connectionId: target.connectionId,
      repository: target.repository,
      number: target.number,
    };
    if (posted.kind === "draft_comment") {
      localStore.removeDraftComment(ref, posted.draftId);
      this.#set(markDeletion(this.#state, action.id, "deleted"));
      return;
    }
    this.#set(markDeletion(this.#state, action.id, "deleting"));
    try {
      await deletePullRequestComment(target.pluginId, target.connectionId, {
        repository: target.repository,
        number: target.number,
        commentId: posted.commentId,
      });
    } catch (error) {
      const unsupported =
        error instanceof AppApiError &&
        error.payload?.reason === "not_supported";
      this.#set(
        markDeletion(this.#state, action.id, {
          failed: unsupported
            ? `${pluginName} doesn't let Ajour delete it yet. Delete it on ${pluginName}.`
            : error instanceof Error
              ? error.message
              : "Ajour couldn't delete it.",
        }),
      );
      return;
    }
    this.#set(markDeletion(this.#state, action.id, "deleted"));
    this.#onAction(action);
  }

  /**
   * The page shows: the chat follows each of its turns again, the writes
   * that came while it was away replaying first, and hears its
   * conversation close. React's development remount detaches it first.
   */
  attach() {
    this.#unwatchClosed ??= watchClosedConversations((event) => {
      // A conversation closed under a reply still coming: its text comes
      // no more, but a write it made still has its line.
      if (event.conversationId === this.#conversationId && this.going) {
        this.#set(stopReply(this.#state));
      }
    });
    for (const entry of this.#state.entries) {
      if (entry.kind === "reply" && entry.turnId) this.#watch(entry.turnId);
    }
  }

  /** The page is gone: the chat stops following its turns, and writes nothing to the page. */
  detach() {
    this.#watching.forEach((unwatch) => unwatch());
    this.#watching.clear();
    this.#unwatchClosed?.();
    this.#unwatchClosed = undefined;
  }

  /**
   * Follows one of the chat's turns until the page goes. An ended turn is
   * followed too: a write its agent made can be confirmed after the end,
   * as a draft comment the window added as the turn ended or a comment the
   * code host answered late, and its line needs its Delete (#796). The
   * window doesn't say when a turn's last write is in, so nothing earlier
   * stops it; an ended reply takes nothing but action lines.
   */
  #watch(turnId: string) {
    if (this.#watching.has(turnId)) return;
    this.#watching.set(
      turnId,
      watchAgentTurn(turnId, (event) => {
        const next = applyChatEvent(this.#state, event);
        if (next === this.#state) return;
        this.#set(next);
        // Once per write: a replayed event changes nothing.
        if (event.type === "action") this.#onAction(event.action);
      }),
    );
  }

  #set(state: ChatState) {
    this.#state = state;
    this.#listeners.forEach((listener) => listener());
  }
}

/** The chat's state, as the panel shows it. */
export function useChatState(session: DeckChatSession): ChatState {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.state,
  );
}
