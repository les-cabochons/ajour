import { randomUUID } from "node:crypto";
import {
  AGENT_TURN_ACTION_TEXT_MAX,
  type AgentTurnAction,
  type AgentTurnEvent,
  type CoreAgentTask,
} from "../../../packages/shared/agent-runs.ts";
import type {
  CodeHostOperation,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import {
  deckLineText,
  deckLinkOnHost,
  parseDeckPullRequestKey,
  type DeckChatToolInput,
  type DeckChatToolName,
  type DeckChatToolOutput,
  type DeckDraftCommentCall,
  type DeckPullRequestSource,
} from "../../../packages/shared/deck.ts";
import type { BridgeClaim } from "./mcp-bridge.ts";
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
 *
 * A write checks its turn, head and consent again as its last step, with
 * nothing awaited before the plugin starts or the window hears of it: the
 * user may stop the turn, or revoke the repository, while it reads the
 * diff or while the plugin is admitted. A draft comment checks them once
 * more when the window claims it, just before the window adds it: the
 * window may hear of the call late, or after a Stop it never heard.
 */

/** A write the chat can't make, with a sentence for the agent. */
export class DeckChatRefused extends Error {}

/**
 * A draft comment's claim check, which the bridge runs when the window
 * claims the call: a refusal with a sentence for the agent, or undefined
 * to let the window add it. Synchronous, so nothing changes in between.
 */
export type DraftCommentClaimCheck = BridgeClaim["refusal"];

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
  /**
   * The same, from what Ajour holds now, without waiting: the last check
   * before a write, which nothing may await after.
   */
  allowedNow(binding: McpClientPullRequestBinding): boolean;
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
  };
  /**
   * Runs a code host write through the pull request's plugin and
   * connection, calling `beforeStart` right before the plugin starts, after
   * its admission: what it throws starts nothing. Throws a
   * `DeckChatRefused` the agent can read.
   */
  codeHost<Operation extends CodeHostOperation>(
    source: DeckPullRequestSource,
    operation: Operation,
    request: CodeHostOperationRequest<Operation>,
    beforeStart: () => void,
  ): Promise<CodeHostOperationResult<Operation>>;
  /**
   * Adds a draft comment to the window's draft review, over the bridge,
   * which hands the window the call before it awaits anything. The window
   * adds it only once `claimCheck` lets it claim the call.
   */
  addDraftComment(
    call: DeckDraftCommentCall,
    claimCheck: DraftCommentClaimCheck,
  ): Promise<{ draftId: string }>;
  /** Sends a turn event to the window. */
  publish(event: AgentTurnEvent): void;
  createId?: () => string;
}

/** What the user told Deck about a chat turn when they sent its message. */
interface ChatTurnFacts {
  /** The user authored the pull request: its title and draft state are theirs to change. */
  author: boolean;
  /** The pull request's address, whose origin an action line's link must have. */
  pullRequestUrl?: string;
}

const NOT_CHATTING =
  "Ajour takes review writes only in a chat turn, when the user asks for them in Deck's chat. Answer in words instead.";
const REVOKED =
  "The user no longer allows Ajour to send this repository's code to you. Stop, and say only that you can't act on it now.";
const TURN_ENDED =
  "This chat turn ended before Ajour made the write, so it wasn't made. Stop.";

const VERDICT_TEXT = {
  approve: "Approved the pull request",
  request_changes: "Requested changes",
  comment: "Submitted a review",
} as const;

/** How much of a path an action line names: its start, then its end. */
const PATH_SHOWN = 120;
const PATH_START_SHOWN = 40;
/** How much of a title an action line quotes. */
const TITLE_SHOWN = 200;

/** Cut by characters, never inside one: an emoji keeps both halves. */
const shorten = (text: string, max: number) => {
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, max - 1).join("")}…`
    : text;
};

/** A path short enough for its line, file name kept: `src/deeply/…/nested/api.ts`. */
function shownPath(path: string) {
  const characters = Array.from(path);
  if (characters.length <= PATH_SHOWN) return path;
  const end = PATH_SHOWN - PATH_START_SHOWN - 1;
  return `${characters.slice(0, PATH_START_SHOWN).join("")}…${characters.slice(-end).join("")}`;
}

/** How an action line names lines of a file: `src/api.ts:12` or `src/api.ts:10–12`. */
function placeName(lines: { path: string; line: number; startLine?: number }) {
  const path = shownPath(lines.path);
  return lines.startLine !== undefined && lines.startLine < lines.line
    ? `${path}:${lines.startLine}–${lines.line}`
    : `${path}:${lines.line}`;
}

export function createDeckChatWrites(options: DeckChatWritesOptions) {
  const createId = options.createId ?? (() => randomUUID());
  /** The chat turns started from the page, until they end. */
  const chatTurns = new Map<string, ChatTurnFacts>();
  /** Stops waiting for the window's draft comments, by turn, once it ends. */
  const draftWaits = new Map<string, Set<() => void>>();

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
      throw new DeckChatRefused(NOT_CHATTING);
    }
    if (!(await options.allowed(binding))) throw new DeckChatRefused(REVOKED);
    const source = parseDeckPullRequestKey(binding.pullRequest);
    if (!source)
      throw new DeckChatRefused("Deck doesn't know this pull request.");
    /**
     * The write's last check: the same turn still runs, at the same head,
     * and the user still allows the repository. Nothing in it waits.
     */
    const refusalNow: DraftCommentClaimCheck = () => {
      const now = options.runningTurnOf(clientId);
      if (
        now?.id !== turn.id ||
        now.pullRequest !== binding.pullRequest ||
        now.head !== binding.head
      ) {
        return { reason: "chat_turn_ended", message: TURN_ENDED };
      }
      if (!options.allowedNow(binding)) {
        return { reason: "consent_revoked", message: REVOKED };
      }
      return undefined;
    };
    const confirm = () => {
      const refusal = refusalNow();
      if (refusal) throw new DeckChatRefused(refusal.message);
    };
    return { turn, source, facts: chatTurns.get(turn.id), confirm, refusalNow };
  }

  /**
   * The window's answer to a draft comment, or a refusal as soon as the
   * turn ends before the window claimed it: a call queued behind the
   * window's other calls doesn't keep the tool waiting, and its claim is
   * refused. A call the window claimed is added, so it waits for its line.
   */
  function untilTurnEnds<T>(
    turnId: string,
    work: Promise<T>,
    claimed: () => boolean,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waits = draftWaits.get(turnId) ?? new Set<() => void>();
      draftWaits.set(turnId, waits);
      const stop = () => {
        if (!claimed()) reject(new DeckChatRefused(TURN_ENDED));
      };
      waits.add(stop);
      work.then(resolve, reject).finally(() => {
        waits.delete(stop);
        if (waits.size === 0 && draftWaits.get(turnId) === waits) {
          draftWaits.delete(turnId);
        }
      });
    });
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
    lines: {
      path: string;
      side: "base" | "head";
      line: number;
      startLine?: number;
    },
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

  /**
   * Shows the action line in the chat, then answers the agent with it. Its
   * link stays only on the pull request's own origin, and its text fits.
   */
  function done(
    turn: RunningTurn,
    facts: ChatTurnFacts | undefined,
    { url, ...rest }: Omit<AgentTurnAction, "id">,
  ): DeckChatToolOutput {
    const link = deckLinkOnHost(url, facts?.pullRequestUrl);
    const action = {
      ...rest,
      text: shorten(rest.text, AGENT_TURN_ACTION_TEXT_MAX),
      ...(link ? { url: link } : {}),
    };
    options.publish({
      type: "action",
      turnId: turn.id,
      conversationId: turn.conversationId,
      action: { id: createId(), ...action },
    });
    return { action: action.text, ...(link ? { url: link } : {}) };
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
      const { turn, source, facts, confirm, refusalNow } = await chatTurnOf(
        clientId,
        binding,
      );
      const lineText = await linesOf(binding, lines);
      const line = (draftId: string) =>
        done(turn, facts, {
          kind: "draft_comment",
          text: `Added a draft comment on ${placeName(lines)}`,
          at: { path: lines.path, side: lines.side, line: lines.line },
          posted: { kind: "draft_comment", draftId },
        });
      confirm();
      // The window hears of it in this tick, and adds it only once it
      // claimed it, which the same check grants. A claim granted before
      // Stop finishes: the draft comment is added and its line shows.
      let claimed = false;
      const adding = options.addDraftComment(
        {
          turnId: turn.id,
          pluginId: source.pluginId,
          connectionId: source.connectionId,
          ...ref(source),
          headSha: binding.head,
          anchor: lines,
          body,
          lineText,
        },
        () => {
          const refusal = refusalNow();
          if (!refusal) claimed = true;
          return refusal;
        },
      );
      const { draftId } = await untilTurnEnds(turn.id, adding, () => claimed);
      return line(draftId);
    },

    async post_comment(clientId, binding, { body, lines }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      if (lines) await linesOf(binding, lines);
      confirm();
      const result = await options.codeHost(
        source,
        "postComment",
        {
          ...ref(source),
          body,
          ...(lines ? { anchor: { ...lines, headSha: binding.head } } : {}),
          submissionId: `chat_${createId()}`,
        },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return done(turn, facts, {
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
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      confirm();
      const result = await options.codeHost(
        source,
        "replyToThread",
        {
          ...ref(source),
          threadId,
          body,
          submissionId: `chat_${createId()}`,
        },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return done(turn, facts, {
        kind: "reply",
        text: "Replied in a thread",
        ...(result.url ? { url: result.url } : {}),
        posted: { kind: "comment", commentId: result.commentId },
      });
    },

    async resolve_thread(clientId, binding, { threadId, resolved }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      confirm();
      const result = await options.codeHost(
        source,
        "setThreadResolved",
        { ...ref(source), threadId, resolved },
        confirm,
      );
      return done(
        turn,
        facts,
        result.resolved
          ? { kind: "resolve", text: "Resolved a thread" }
          : { kind: "reopen", text: "Reopened a thread" },
      );
    },

    async submit_review(clientId, binding, { verdict, body }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      confirm();
      // The draft review stays the user's, sent with Finish review: a
      // chat's review is its verdict and summary.
      const result = await options.codeHost(
        source,
        "submitReview",
        {
          ...ref(source),
          headSha: binding.head,
          verdict,
          ...(body ? { body } : {}),
          comments: [],
          submissionId: `chat_${createId()}`,
        },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return done(turn, facts, {
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
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      requireAuthor(facts, "edit its title");
      confirm();
      const edited = await options.codeHost(
        source,
        "updatePullRequest",
        { ...ref(source), title },
        confirm,
      );
      return done(turn, facts, {
        kind: "title",
        text: `Renamed the pull request “${shorten(edited.title, TITLE_SHOWN)}”`,
        edited,
      });
    },

    async set_draft(clientId, binding, { draft }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      requireAuthor(facts, draft ? "turn it into a draft" : "mark it ready");
      confirm();
      const edited = await options.codeHost(
        source,
        "updatePullRequest",
        { ...ref(source), draft },
        confirm,
      );
      return done(
        turn,
        facts,
        edited.draft
          ? {
              kind: "draft",
              text: "Turned the pull request into a draft",
              edited,
            }
          : {
              kind: "ready",
              text: "Marked the pull request ready for review",
              edited,
            },
      );
    },
  };

  return {
    /**
     * A chat turn's `submit_guide` saved the agent's guide (#794): its
     * action line shows, and the page reads the guide again.
     */
    regrouped(clientId: string, turnId: string) {
      const turn = options.runningTurnOf(clientId);
      if (turn?.id !== turnId) return;
      done(turn, chatTurns.get(turnId), {
        kind: "regroup",
        text: "Regrouped the guide",
      });
    },

    /**
     * Records what the page said about a chat turn, as the turn is queued
     * and before it can run, so its first call already finds it.
     */
    chatStarted(turnId: string, facts: ChatTurnFacts) {
      chatTurns.set(turnId, facts);
    },

    /**
     * Reads every turn event, to forget a chat turn once it ends and stop
     * waiting for the window's draft comments.
     */
    observe(event: AgentTurnEvent) {
      if (event.type !== "ended") return;
      chatTurns.delete(event.turnId);
      const waits = draftWaits.get(event.turnId);
      draftWaits.delete(event.turnId);
      for (const stop of waits ?? []) stop();
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
