import { createHash, randomUUID } from "node:crypto";
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
 *
 * A reply or a resolve acts only on one of the pull request's own threads,
 * read again through the plugin: a thread's id alone names it on the code
 * host, so an id the agent was handed could reach another pull request. The
 * chat submits a comment review only: approving and requesting changes stay
 * the user's, with Finish review, so no text the agent read can vote. A post
 * keeps one submission across the agent's tries, named by its turn, the
 * user's message, with its pull request and content, so the plugin finds
 * what an earlier try left; the same post asked for in a later message is
 * a new one. A draft comment keeps the same identity: one the window added
 * isn't added again in that turn, though the agent lost the answer.
 */

/** The chat's writes that post: each keeps its submission across tries. */
export const CHAT_POST_OPERATIONS = [
  "postComment",
  "replyToThread",
  "submitReview",
] as const satisfies readonly CodeHostOperation[];
type PostOperation = (typeof CHAT_POST_OPERATIONS)[number];

/** Whether a chat write posts: a lost answer may then have left a post. */
export const isChatPost = (operation: CodeHostOperation) =>
  (CHAT_POST_OPERATIONS as readonly CodeHostOperation[]).includes(operation);

/** A write the chat can't make, with a sentence for the agent. */
export class DeckChatRefused extends Error {
  /**
   * The code host may have taken it: the request went out, and its answer
   * didn't come back. A refusal before anything was sent leaves it unset.
   */
  readonly maybeSent: boolean;

  constructor(message: string, { maybeSent = false } = {}) {
    super(message);
    this.maybeSent = maybeSent;
  }
}

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
  /** The ids of the pull request's review threads, read through its plugin. */
  threadIds(source: DeckPullRequestSource): Promise<ReadonlySet<string>>;
  /**
   * Runs a code host write through the pull request's plugin and
   * connection, calling `beforeStart` right before the plugin starts, after
   * its admission: what it throws starts nothing. Throws a
   * `DeckChatRefused` the agent can read, `maybeSent` once the request
   * may have reached the code host.
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
  now?: () => number;
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

const NO_VERDICT =
  "Ajour doesn't let the chat approve a pull request or request changes: that stays the user's, with Finish review on the review page. Ajour submitted nothing. Submit a review with only a summary, or tell the user to finish the review themselves.";
const FOREIGN_THREAD =
  "That thread isn't one of this pull request's threads, so Ajour wrote nothing. Use only the ids read_threads gives.";
const THREADS_UNREAD =
  "Ajour couldn't read this pull request's threads to check that one, so it wrote nothing. Tell the user it wasn't done.";

/** The chat posts whose submission Ajour remembers; the oldest go first. */
const SUBMISSIONS_KEPT = 500;
/** The draft comments added whose identity Ajour remembers; the oldest go first. */
const DRAFT_ADDS_KEPT = 500;

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

/** A post's submission across the agent's tries (#784's look-back). */
interface ChatSubmission {
  submissionId: string;
  /**
   * When the first try that may have reached the code host was sent; later
   * tries send it. A try refused before it was sent doesn't count.
   */
  firstTriedAt: number;
  /** Whether a try may have reached the code host: a retry looks back only then. */
  sent: boolean;
  /** What the code host posted and the line that showed it, once one did. */
  shown?: { id: string; output: DeckChatToolOutput };
  /** The try under way, which the next one waits for. */
  trying?: Promise<void>;
}

/** A draft comment the window is adding or added in a turn. */
interface DraftAdd {
  adding: Promise<DeckChatToolOutput>;
  /** The window claimed the call: it may have added it, whatever its answer. */
  claim: { claimed: boolean };
}

export function createDeckChatWrites(options: DeckChatWritesOptions) {
  const createId = options.createId ?? (() => randomUUID());
  const now = options.now ?? Date.now;
  /**
   * Each post's submission, by its turn, pull request and content: the
   * agent repeating a post whose answer was lost names the same one, and
   * the plugin finds the earlier post instead of posting it twice. A turn
   * is one message of the user's, so a post they ask for again in a later
   * message posts again.
   */
  const submissions = new Map<string, ChatSubmission>();
  /**
   * Each draft comment the window is adding or added, by the same identity:
   * the agent repeating one whose answer was lost waits for it, or hears
   * it's in the draft already, and the window doesn't add it twice. One the
   * window claimed may be there though it never confirmed it, so it isn't
   * added again either. One the window never claimed is forgotten, so a
   * repeat adds it afresh.
   */
  const draftAdds = new Map<string, DraftAdd>();

  /** A write's identity: its turn, pull request, operation and content. */
  const identityOf = (
    turn: RunningTurn,
    binding: McpClientPullRequestBinding,
    operation: PostOperation | "addDraftComment",
    content: unknown,
  ) =>
    createHash("sha256")
      .update(
        JSON.stringify([turn.id, binding.pullRequest, operation, content]),
      )
      .digest("base64url");

  function submissionOf(
    turn: RunningTurn,
    binding: McpClientPullRequestBinding,
    operation: PostOperation,
    content: unknown,
  ) {
    const key = identityOf(turn, binding, operation, content);
    let submission = submissions.get(key);
    if (!submission) {
      submission = {
        submissionId: `chat_${key}`,
        firstTriedAt: now(),
        sent: false,
      };
      submissions.set(key, submission);
      if (submissions.size > SUBMISSIONS_KEPT) {
        submissions.delete(submissions.keys().next().value!);
      }
    }
    return submission;
  }

  /**
   * Posts through the code host under the post's submission: a try after
   * one that may have reached the code host sends the first try's time, so
   * the plugin looks for what it left. A refusal before anything was sent
   * leaves the next try a first one.
   */
  async function post<Operation extends PostOperation>(
    turn: RunningTurn,
    binding: McpClientPullRequestBinding,
    source: DeckPullRequestSource,
    operation: Operation,
    request: Omit<
      CodeHostOperationRequest<Operation>,
      "submissionId" | "firstTriedAt"
    >,
    confirm: () => void,
  ) {
    const submission = submissionOf(turn, binding, operation, request);
    // One try of a post at a time: the same post sent twice at once goes
    // out once, and the second looks for it.
    const earlier = submission.trying;
    let tried!: () => void;
    submission.trying = new Promise<void>((resolve) => (tried = resolve));
    await earlier;
    const retry = submission.sent;
    if (!retry) submission.firstTriedAt = now();
    try {
      const result = await options.codeHost(
        source,
        operation,
        {
          ...request,
          submissionId: submission.submissionId,
          ...(retry ? { firstTriedAt: submission.firstTriedAt } : {}),
        } as CodeHostOperationRequest<Operation>,
        confirm,
      );
      submission.sent = true;
      return { result, submission };
    } catch (error) {
      if (!(error instanceof DeckChatRefused) || error.maybeSent) {
        submission.sent = true;
      }
      throw error;
    } finally {
      tried();
    }
  }

  /**
   * The action line of what a post made, once: a repeat that found the
   * same post tells the agent it's there already, with no second line.
   */
  function shownOnce(
    submission: ChatSubmission,
    id: string,
    show: () => DeckChatToolOutput,
  ) {
    if (submission.shown && submission.shown.id === id) {
      throw new DeckChatRefused(
        `Ajour made this post earlier in this turn ("${submission.shown.output.action}"), and the code host still has it, so Ajour didn't post it again. Tell the user it's there.`,
      );
    }
    const output = show();
    submission.shown = { id, output };
    return output;
  }

  /** Refuses a thread that isn't one of the pull request's own. */
  async function requireThread(
    source: DeckPullRequestSource,
    threadId: string,
  ) {
    let ids: ReadonlySet<string>;
    try {
      ids = await options.threadIds(source);
    } catch {
      throw new DeckChatRefused(THREADS_UNREAD);
    }
    if (!ids.has(threadId)) throw new DeckChatRefused(FOREIGN_THREAD);
  }
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
      const identity = identityOf(turn, binding, "addDraftComment", {
        headSha: binding.head,
        anchor: lines,
        body,
      });
      // A repeat waits for the same comment the window is adding, and
      // tries afresh only once a try the window never claimed is forgotten.
      let earlier = draftAdds.get(identity);
      while (earlier) {
        const shown = await earlier.adding.then(
          ({ action }) => action,
          () => undefined,
        );
        if (shown !== undefined) {
          throw new DeckChatRefused(
            `Ajour added this draft comment earlier in this turn ("${shown}"), so it didn't add it again. Tell the user it's in their draft review.`,
          );
        }
        if (earlier.claim.claimed) {
          throw new DeckChatRefused(
            "The Ajour window took this draft comment earlier in this turn but never confirmed it, so Ajour didn't add it again. Tell the user it may already be in their draft review.",
          );
        }
        earlier = draftAdds.get(identity);
      }

      const claim = { claimed: false };
      const addToWindow = async () => {
        const lineText = await linesOf(binding, lines);
        confirm();
        // The window hears of it in this tick, and adds it only once it
        // claimed it, which the same check grants. A claim granted before
        // Stop finishes: the draft comment is added and its line shows.
        const asked = options.addDraftComment(
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
            if (!refusal) claim.claimed = true;
            return refusal;
          },
        );
        const { draftId } = await untilTurnEnds(
          turn.id,
          asked,
          () => claim.claimed,
        );
        return done(turn, facts, {
          kind: "draft_comment",
          text: `Added a draft comment on ${placeName(lines)}`,
          at: { path: lines.path, side: lines.side, line: lines.line },
          posted: { kind: "draft_comment", draftId },
        });
      };
      const add: DraftAdd = { adding: addToWindow(), claim };
      draftAdds.set(identity, add);
      if (draftAdds.size > DRAFT_ADDS_KEPT) {
        draftAdds.delete(draftAdds.keys().next().value!);
      }
      add.adding.catch(() => {
        if (!claim.claimed && draftAdds.get(identity) === add) {
          draftAdds.delete(identity);
        }
      });
      return add.adding;
    },

    async post_comment(clientId, binding, { body, lines }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      if (lines) await linesOf(binding, lines);
      confirm();
      const { result, submission } = await post(
        turn,
        binding,
        source,
        "postComment",
        {
          ...ref(source),
          body,
          ...(lines ? { anchor: { ...lines, headSha: binding.head } } : {}),
        },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return shownOnce(submission, result.commentId, () =>
        done(turn, facts, {
          kind: "comment",
          text: lines
            ? `Commented on ${placeName(lines)}`
            : "Commented on the pull request",
          ...(result.url ? { url: result.url } : {}),
          ...(lines
            ? { at: { path: lines.path, side: lines.side, line: lines.line } }
            : {}),
          posted: { kind: "comment", commentId: result.commentId },
        }),
      );
    },

    async reply_to_thread(clientId, binding, { threadId, body }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      await requireThread(source, threadId);
      confirm();
      const { result, submission } = await post(
        turn,
        binding,
        source,
        "replyToThread",
        { ...ref(source), threadId, body },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return shownOnce(submission, result.commentId, () =>
        done(turn, facts, {
          kind: "reply",
          text: "Replied in a thread",
          ...(result.url ? { url: result.url } : {}),
          posted: { kind: "comment", commentId: result.commentId },
        }),
      );
    },

    async resolve_thread(clientId, binding, { threadId, resolved }) {
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      await requireThread(source, threadId);
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

    async submit_review(clientId, binding, input) {
      // Its schema has no verdict; one sent all the same is refused, not
      // dropped: no text the agent read may approve (ADR 0024).
      const { verdict } = input as { verdict?: unknown };
      if (verdict !== undefined && verdict !== "comment") {
        throw new DeckChatRefused(NO_VERDICT);
      }
      const { turn, source, facts, confirm } = await chatTurnOf(
        clientId,
        binding,
      );
      confirm();
      // The draft review and the verdict stay the user's, sent with Finish
      // review: the chat's review is a summary.
      const { result, submission } = await post(
        turn,
        binding,
        source,
        "submitReview",
        {
          ...ref(source),
          headSha: binding.head,
          verdict: "comment",
          body: input.body,
          comments: [],
        },
        confirm,
      );
      if ("uncertain" in result) throw uncertain();
      return shownOnce(submission, result.reviewId, () =>
        done(turn, facts, {
          kind: "review",
          text: "Submitted a review",
          ...(result.url ? { url: result.url } : {}),
        }),
      );
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
