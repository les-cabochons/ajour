import type {
  AgentCliStatus,
  AgentTurn,
  AgentTurnEvent,
  CoreTaskRunRequest,
} from "../../../packages/shared/agent-runs.ts";
import {
  deckPullRequestKey,
  parseDeckPullRequestKey,
  type DeckAgentConsent,
  type DeckAskAnchor,
  type DeckAskRequest,
  type DeckAskResponse,
  type DeckConcern,
  type DeckNeedsConsent,
  type DeckPullRequestSource,
} from "../../../packages/shared/deck.ts";
import { AgentRunError } from "./agent-runner/launch.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's asks (#791). An ask is a `deck.ask` turn of the pull request's
 * conversation, anchored to a concern: Ajour writes the turn from the guide
 * it holds, never from the page's words, with the anchor's default question
 * or the user's own. Nothing reaches the agent before the user allowed the
 * repository with that agent. A done answer is cached per anchor, typed
 * question and head commit, so asking again answers at once. The cache lives
 * in memory until the disk cache (#781).
 */

/** Answers kept. Older ones are asked again. */
const ANSWERS_KEPT = 200;

/** The question an ask about a concern starts from. */
export const CONCERN_DEFAULT_QUESTION =
  "Give more detail on this concern: what it changes, why, and what a reviewer should check.";

/** Why an ask can't run: its status, and the body the page reads. */
export class DeckAskRefused extends Error {
  readonly status: 404 | 409;
  readonly reason: "needs_consent" | "not_open" | "unknown_anchor";
  readonly body: Record<string, unknown>;

  constructor(
    status: DeckAskRefused["status"],
    reason: DeckAskRefused["reason"],
    body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : reason);
    this.status = status;
    this.reason = reason;
    this.body = body;
  }
}

export interface DeckAsksOptions {
  storage: {
    getDeckConsents(): Promise<DeckAgentConsent[]>;
  };
  /** The agent Settings › Agents picks, as Settings shows it. */
  selectedCli(): Promise<AgentCliStatus | null>;
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
  };
  startTurn(request: CoreTaskRunRequest): Promise<AgentTurn>;
}

const repositoryName = (repository: string) =>
  repository.slice(repository.lastIndexOf("/") + 1) || repository;

/** The turn's words: the anchor as Ajour holds it, then the question. */
function concernMessage(
  concern: DeckConcern,
  number: number,
  question: string | undefined,
) {
  return [
    `The user reads concern ${number} of the guide, "${concern.title}".`,
    concern.rationale ? `Its rationale: ${concern.rationale}` : undefined,
    `Its hunks, in reading order: ${concern.hunkIds.join(", ")}. Read them with read_hunks.`,
    "",
    `The question: ${question ?? CONCERN_DEFAULT_QUESTION}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function createDeckAsks(options: DeckAsksOptions) {
  /** Done answers by `cacheKey`, oldest first. */
  const answers = new Map<string, string>();
  /** The asks still streaming, by turn ID: their cache key and text so far. */
  const streaming = new Map<string, { key: string; pieces: string[] }>();

  const cacheKey = (
    pullRequest: string,
    head: string,
    anchor: DeckAskAnchor,
    question: string | undefined,
  ) =>
    JSON.stringify([
      pullRequest,
      head,
      anchor.kind,
      anchor.id,
      question ?? null,
    ]);

  /**
   * Refuses unless the user allowed the pull request's repository with the
   * agent Settings › Agents picks. Throws an AgentRunError when no agent is
   * picked or installed, as the turn's start would.
   */
  async function requireConsent(source: DeckPullRequestSource) {
    const cli = await options.selectedCli();
    if (!cli) {
      throw new AgentRunError(
        "Pick an installed agent in Settings > Agents.",
        400,
      );
    }
    if (!cli.installed) {
      throw new AgentRunError(`${cli.label} is not installed.`, 400);
    }
    const consents = await options.storage.getDeckConsents();
    const allowed = consents.some(
      (consent) =>
        consent.pluginId === source.pluginId &&
        consent.connectionId === source.connectionId &&
        consent.repository === source.repository &&
        consent.cli === cli.id,
    );
    if (allowed) return;
    const body: DeckNeedsConsent & { error: string } = {
      error: `Ajour asks once for ${repositoryName(source.repository)} before it sends its code to ${cli.label}.`,
      reason: "needs_consent",
      repository: source.repository,
      provider: {
        cli: cli.id,
        label: cli.label,
        ...(cli.version ? { version: cli.version } : {}),
      },
    };
    throw new DeckAskRefused(409, "needs_consent", body);
  }

  return {
    requireConsent,

    /**
     * The gate of every core turn, whoever starts it: a turn about anything
     * but a Deck pull request whose repository the user allowed is refused.
     */
    async requireTurnConsent(pullRequest: string) {
      const source = parseDeckPullRequestKey(pullRequest);
      if (!source) {
        throw new DeckAskRefused(404, "not_open", {
          error: "Deck doesn't know that pull request.",
          reason: "not_open",
        });
      }
      await requireConsent(source);
    },

    /** Answers an ask from the cache, or starts the turn that answers it. */
    async ask(
      source: Pick<DeckPullRequestSource, "pluginId" | "connectionId">,
      request: DeckAskRequest,
    ): Promise<DeckAskResponse> {
      const pullRequestSource: DeckPullRequestSource = {
        ...source,
        repository: request.repository,
        number: request.number,
      };
      await requireConsent(pullRequestSource);
      const pullRequest = deckPullRequestKey(pullRequestSource);
      const key = cacheKey(
        pullRequest,
        request.head,
        request.anchor,
        request.question,
      );
      const cached = answers.get(key);
      if (cached !== undefined) {
        answers.delete(key);
        answers.set(key, cached);
        return { kind: "answer", text: cached, head: request.head };
      }
      const held = await options.deck.held(pullRequest, request.head);
      if (!held) {
        throw new DeckAskRefused(409, "not_open", {
          error:
            "Open the pull request again: Ajour no longer holds it at this commit.",
          reason: "not_open",
        });
      }
      const concerns = held.guide?.concerns ?? [];
      const index = concerns.findIndex(
        (concern) => concern.id === request.anchor.id,
      );
      if (index < 0) {
        throw new DeckAskRefused(404, "unknown_anchor", {
          error: "The guide has no such concern.",
          reason: "unknown_anchor",
        });
      }
      const turn = await options.startTurn({
        task: "deck.ask",
        pullRequest,
        head: request.head,
        message: concernMessage(concerns[index]!, index + 1, request.question),
      });
      streaming.set(turn.id, { key, pieces: [] });
      return { kind: "turn", turn };
    },

    /** Reads every turn event the window gets, to cache the asks' answers. */
    observe(event: AgentTurnEvent) {
      if (event.type === "text") {
        const ask = streaming.get(event.turnId);
        if (ask) ask.pieces[event.index] = event.text;
        return;
      }
      if (event.type !== "ended") return;
      const ask = streaming.get(event.turnId);
      if (!ask) return;
      streaming.delete(event.turnId);
      if (event.outcome !== "done") return;
      answers.delete(ask.key);
      answers.set(ask.key, ask.pieces.join(""));
      for (const oldest of answers.keys()) {
        if (answers.size <= ANSWERS_KEPT) break;
        answers.delete(oldest);
      }
    },
  };
}

export type DeckAsks = ReturnType<typeof createDeckAsks>;
