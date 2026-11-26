import { randomUUID } from "node:crypto";
import type {
  AgentTurnAction,
  AgentTurnEvent,
  CoreAgentTask,
} from "../../../packages/shared/agent-runs.ts";
import type {
  CodeHostOperation,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import {
  deckLineText,
  parseDeckPullRequestKey,
  type DeckChatToolInput,
  type DeckChatToolName,
  type DeckChatToolOutput,
  type DeckDraftCommentCall,
  type DeckPullRequestSource,
} from "../../../packages/shared/deck.ts";
import type { McpClientPullRequestBinding } from "./storage.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's chat writes (#796, ADR 0024): the review writes the user can make
 * from Deck, made by the agent of a chat turn in the user's name. Each is
 * a tool of the conversation's client, bound to its pull request and head,
 * and taken only while a chat turn the user started runs: an ask or a
 * guide turn that calls one is refused. Each goes to the code host at once
 * (ADR 0002), and comes back to the window as an `action` event of the
 * turn, the action line that says what it did, links to it and, for what
 * it posted, lets the user delete it. A draft comment goes to the draft
 * review in the window, over the bridge. Merge is not one of them: merging
 * stays the user's own confirmed action.
 */

/** A write the chat can't make, with a sentence for the agent. */
export class DeckChatRefused extends Error {}

/** The running turn a call of a client's tools is part of. */
export interface RunningTurn {
  id: string;
  task: CoreAgentTask;
  pullRequest: string;
  head: string;
  conversationId: string;
}

export interface DeckChatWritesOptions {
  /** The turn running in the conversation whose client is `clientId`. */
  runningTurnOf(clientId: string): RunningTurn | undefined;
  /** Whether the user still allows the binding's repository with its agent. */
  allowed(binding: McpClientPullRequestBinding): Promise<boolean>;
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
  };
  /**
   * Runs a code host write through the pull request's plugin and
   * connection. Throws a `DeckChatRefused` the agent can read.
   */
  codeHost<Operation extends CodeHostOperation>(
    source: DeckPullRequestSource,
    operation: Operation,
    request: CodeHostOperationRequest<Operation>,
  ): Promise<CodeHostOperationResult<Operation>>;
  /** Adds a draft comment to the window's draft review, over the bridge. */
  addDraftComment(call: DeckDraftCommentCall): Promise<{ draftId: string }>;
  /** Sends a turn event to the window. */
  publish(event: AgentTurnEvent): void;
  createId?: () => string;
}

/** What the user told Deck about a chat turn when they sent its message. */
interface ChatTurnFacts {
  /** The user authored the pull request: its title and draft state are theirs to change. */
  author: boolean;
}

const VERDICT_TEXT = {
  approve: "Approved the pull request",
  request_changes: "Requested changes",
  comment: "Submitted a review",
} as const;

/** How an action line names lines of a file: `src/api.ts:12` or `src/api.ts:10–12`. */
function placeName(lines: {
  path: string;
  line: number;
  startLine?: number;
}) {
  return lines.startLine !== undefined && lines.startLine < lines.line
    ? `${lines.path}:${lines.startLine}–${lines.line}`
    : `${lines.path}:${lines.line}`;
}

export function createDeckChatWrites(options: DeckChatWritesOptions) {
  const createId = options.createId ?? (() => randomUUID());
  /** The chat turns started from the page, until they end. */
  const chatTurns = new Map<string, ChatTurnFacts>();

  /** The chat turn this call is part of, at the binding's head, or a refusal. */
  async function chatTurnOf(
    clientId: string,
    binding: McpClientPullRequestBinding,
  ) {
    const turn = options.runningTurnOf(clientId);
    if (
      !turn ||
      turn.task !== "deck.chat" ||
      turn.pullRequest !== binding.pullRequest ||
      turn.head !== binding.head
    ) {
      throw new DeckChatRefused(
        "Ajour takes review writes only in a chat turn, when the user asks for them in Deck's chat. Answer in words instead.",
      );
    }
    if (!(await options.allowed(binding))) {
      throw new DeckChatRefused(
        "The user no longer allows Ajour to send this repository's code to you. Stop, and say only that you can't act on it now.",
      );
    }
    const source = parseDeckPullRequestKey(binding.pullRequest);
    if (!source) throw new DeckChatRefused("Deck doesn't know this pull request.");
    return { turn, source, facts: chatTurns.get(turn.id) };
  }

  /** The diff at the binding's head, to check lines against. */
  async function heldFor(binding: McpClientPullRequestBinding) {
    const held = await options.deck.held(binding.pullRequest, binding.head);
    if (!held) {
      throw new DeckChatRefused(
        "Ajour no longer holds this pull request at this head, because the user moved to another one. Write nothing more.",
      );
    }
    return held;
  }

  /** The text of the lines a comment is on, or a refusal when the diff doesn't show them. */
  async function linesOf(
    binding: McpClientPullRequestBinding,
    lines: { path: string; side: "base" | "head"; line: number; startLine?: number },
  ) {
    const { diff } = await heldFor(binding);
    const text = deckLineText(diff, lines);
    if (text === undefined) {
      throw new DeckChatRefused(
        `The diff at this head doesn't show ${placeName(lines)} on the ${lines.side} side. Comment only on lines read_hunks shows, by the base's numbers for removed lines and the head's for the others.`,
      );
    }
    return text;
  }

  function requireAuthor(facts: ChatTurnFacts | undefined, what: string) {
    if (!facts?.author) {
      throw new DeckChatRefused(
        `Only the pull request's author can ${what} from Deck, and the user isn't its author. Say so instead.`,
      );
    }
  }

  /** Shows the action line in the chat, then answers the agent with it. */
  function done(
    turn: RunningTurn,
    action: Omit<AgentTurnAction, "id">,
  ): DeckChatToolOutput {
    options.publish({
      type: "action",
      turnId: turn.id,
      conversationId: turn.conversationId,
      action: { id: createId(), ...action },
    });
    return {
      action: action.text,
      ...(action.url ? { url: action.url } : {}),
    };
  }

  const ref = (source: DeckPullRequestSource) => ({
    repository: source.repository,
    number: source.number,
  });

  /** A post the code host couldn't confirm: nothing to show or delete. */
  const uncertain = () =>
    new DeckChatRefused(
      "The code host couldn't confirm the post. Tell the user it may be there, and don't post it again.",
    );

  const writes: {
    [Name in DeckChatToolName]: (
      clientId: string,
      binding: McpClientPullRequestBinding,
      input: DeckChatToolInput<Name>,
    ) => Promise<DeckChatToolOutput>;
  } = {
    async add_draft_comment(clientId, binding, { body, ...lines }) {
      const { turn, source } = await chatTurnOf(clientId, binding);
      const lineText = await linesOf(binding, lines);
      const { draftId } = await options.addDraftComment({
        pluginId: source.pluginId,
        connectionId: source.connectionId,
        ...ref(source),
        headSha: binding.head,
        anchor: lines,
        body,
        lineText,
      });
      return done(turn, {
        kind: "draft_comment",
        text: `Added a draft comment on ${placeName(lines)}`,
        at: { path: lines.path, side: lines.side, line: lines.line },
        posted: { kind: "draft_comment", draftId },
      });
    },

    async post_comment(clientId, binding, { body, lines }) {
      const { turn, source } = await chatTurnOf(clientId, binding);
      if (lines) await linesOf(binding, lines);
      const result = await options.codeHost(source, "postComment", {
        ...ref(source),
        body,
        ...(lines ? { anchor: { ...lines, headSha: binding.head } } : {}),
        submissionId: `chat_${createId()}`,
      });
      if ("uncertain" in result) throw uncertain();
      return done(turn, {
        kind: "comment",
        text: lines
          ? `Commented on ${placeName(lines)}`
          : "Commented on the pull request",
        ...(result.url ? { url: result.url } : {}),
        ...(lines
          ? { at: { path: lines.path, side: lines.side, line: lines.line } }
          : {}),
        posted: { kind: "comment", commentId: result.commentId },
      });
    },

    async reply_to_thread(clientId, binding, { threadId, body }) {
      const { turn, source } = await chatTurnOf(clientId, binding);
      const result = await options.codeHost(source, "replyToThread", {
        ...ref(source),
        threadId,
        body,
        submissionId: `chat_${createId()}`,
      });
      if ("uncertain" in result) throw uncertain();
      return done(turn, {
        kind: "reply",
        text: "Replied in a thread",
        ...(result.url ? { url: result.url } : {}),
        posted: { kind: "comment", commentId: result.commentId },
      });
    },

    async resolve_thread(clientId, binding, { threadId, resolved }) {
      const { turn, source } = await chatTurnOf(clientId, binding);
      const result = await options.codeHost(source, "setThreadResolved", {
        ...ref(source),
        threadId,
        resolved,
      });
      return done(
        turn,
        result.resolved
          ? { kind: "resolve", text: "Resolved a thread" }
          : { kind: "reopen", text: "Reopened a thread" },
      );
    },

    async submit_review(clientId, binding, { verdict, body }) {
      const { turn, source } = await chatTurnOf(clientId, binding);
      // The draft review stays the user's, sent with Finish review: a
      // chat's review is its verdict and summary.
      const result = await options.codeHost(source, "submitReview", {
        ...ref(source),
        headSha: binding.head,
        verdict,
        ...(body ? { body } : {}),
        comments: [],
        submissionId: `chat_${createId()}`,
      });
      if ("uncertain" in result) throw uncertain();
      return done(turn, {
        kind: "review",
        // Azure DevOps calls request changes "Wait for author" (#784).
        text:
          verdict === "request_changes" && source.pluginId === "azure_devops"
            ? "Voted Wait for author"
            : VERDICT_TEXT[verdict],
        ...(result.url ? { url: result.url } : {}),
      });
    },

    async edit_title(clientId, binding, { title }) {
      const { turn, source, facts } = await chatTurnOf(clientId, binding);
      requireAuthor(facts, "edit its title");
      const edited = await options.codeHost(source, "updatePullRequest", {
        ...ref(source),
        title,
      });
      return done(turn, {
        kind: "title",
        text: `Renamed the pull request “${edited.title}”`,
        edited,
      });
    },

    async set_draft(clientId, binding, { draft }) {
      const { turn, source, facts } = await chatTurnOf(clientId, binding);
      requireAuthor(facts, draft ? "turn it into a draft" : "mark it ready");
      const edited = await options.codeHost(source, "updatePullRequest", {
        ...ref(source),
        draft,
      });
      return done(
        turn,
        edited.draft
          ? { kind: "draft", text: "Turned the pull request into a draft", edited }
          : { kind: "ready", text: "Marked the pull request ready for review", edited },
      );
    },
  };

  return {
    /** Records what the page said about a chat turn as it started it. */
    chatStarted(turnId: string, facts: ChatTurnFacts) {
      chatTurns.set(turnId, facts);
    },

    /** Reads every turn event, to forget a chat turn once it ends. */
    observe(event: AgentTurnEvent) {
      if (event.type === "ended") chatTurns.delete(event.turnId);
    },

    run<Name extends DeckChatToolName>(
      name: Name,
      clientId: string,
      binding: McpClientPullRequestBinding,
      input: DeckChatToolInput<Name>,
    ): Promise<DeckChatToolOutput> {
      return (
        writes[name] as (
          clientId: string,
          binding: McpClientPullRequestBinding,
          input: DeckChatToolInput<Name>,
        ) => Promise<DeckChatToolOutput>
      )(clientId, binding, input);
    },
  };
}

export type DeckChatWrites = ReturnType<typeof createDeckChatWrites>;
