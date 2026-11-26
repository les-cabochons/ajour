import type {
  AgentCliId,
  AgentCliStatus,
  AgentTurn,
  AgentTurnEvent,
  CoreTaskRunRequest,
} from "../../../packages/shared/agent-runs.ts";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
  DECK_SUMMARY_DEFAULT_QUESTION,
  deckPullRequestKey,
  parseDeckPullRequestKey,
  repositoryName,
  type DeckAgentConsent,
  type DeckAskAnchor,
  type DeckAskRequest,
  type DeckAskResponse,
  type DeckTurnRefusal,
  type DeckConcern,
  type DeckGuide,
  type DeckPullRequestSource,
  type DeckSummaryLine,
} from "../../../packages/shared/deck.ts";
import { AgentRunError, PICK_AN_AGENT } from "./agent-runner/launch.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's asks (#791). An ask is a `deck.ask` turn of the pull request's
 * conversation, anchored to a concern or a summary line (#794): Ajour
 * writes the turn from the guide
 * it holds, never from the page's words, with the anchor's default question
 * or the user's own. Nothing reaches the agent before the user allowed the
 * repository with that agent. A done answer is cached per anchor, typed
 * question and head commit, so asking again answers at once. The cache lives
 * in memory until the disk cache (#781).
 */

/** Why a turn about a pull request Deck no longer holds at its head is refused. */
export const NOT_HELD =
  "Open the pull request again: Ajour no longer holds it at this commit.";

/** Answers kept. Older ones are asked again. */
const ANSWERS_KEPT = 200;

/** Why an ask, or a core turn, can't run: its status and the body the page reads. */
export class DeckTurnRefused extends Error {
  readonly status: 404 | 409;
  readonly body: DeckTurnRefusal;

  constructor(status: DeckTurnRefused["status"], body: DeckTurnRefusal) {
    super(body.error);
    this.status = status;
    this.body = body;
  }

  /** The reason its event records. Plugin consent is `needs_consent` there. */
  get eventReason() {
    return this.body.reason === "needs_consent"
      ? ("repository_not_allowed" as const)
      : this.body.reason;
  }
}

export interface DeckAsksOptions {
  storage: {
    getDeckConsents(): Promise<DeckAgentConsent[]>;
    getAgentRunnerSettings(): Promise<{ cli: AgentCliId | null }>;
  };
  /**
   * The agent Settings › Agents picks, as Settings shows it, version
   * included. It runs the agent's `--version`, so only a refusal reads it.
   */
  selectedCli(): Promise<AgentCliStatus | null>;
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
  };
  startTurn(request: CoreTaskRunRequest): Promise<AgentTurn>;
}

/** The turn's words: the anchor as Ajour holds it, then the question. */
function concernMessage(concern: DeckConcern, question: string | undefined) {
  return [
    `The user reads the guide's concern "${concern.title}".`,
    concern.rationale ? `Its rationale: ${concern.rationale}` : undefined,
    `Its hunks, in reading order: ${concern.hunkIds.join(", ")}. Read them with read_hunks.`,
    "",
    `The question: ${question ?? DECK_CONCERN_DEFAULT_QUESTION}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/** The summary's sections, as the page names them, for an ask about one of their lines. */
const SUMMARY_SECTIONS = [
  ["breaking", "Breaking changes"],
  ["risks", "Risky areas"],
  ["tests", "Tests"],
  ["untested", "Tests"],
  ["leftovers", "Leftovers"],
] as const;

/** A summary line of the guide, with the section it is in. */
function summaryLineOf(guide: DeckGuide | null, id: string) {
  for (const [field, section] of SUMMARY_SECTIONS) {
    const line = guide?.summary[field].find((candidate) => candidate.id === id);
    if (line) return { line, section };
  }
  return undefined;
}

/** The turn's words for a summary line: the line as Ajour holds it, then the question. */
function summaryLineMessage(
  { line, section }: { line: DeckSummaryLine; section: string },
  question: string | undefined,
) {
  return [
    `The user reads this line of the summary, under "${section}": ${line.text}`,
    `Its hunks: ${line.hunkIds.join(", ")}. Read them with read_hunks.`,
    "",
    `The question: ${question ?? DECK_SUMMARY_DEFAULT_QUESTION}`,
  ].join("\n");
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

  /** Whether the user allowed the repository with this agent. */
  async function consentedWith(
    source: DeckPullRequestSource,
    cli: AgentCliId | null,
  ) {
    if (!cli) return false;
    const consents = await options.storage.getDeckConsents();
    return consents.some(
      (consent) =>
        consent.pluginId === source.pluginId &&
        consent.connectionId === source.connectionId &&
        consent.repository === source.repository &&
        consent.cli === cli,
    );
  }

  /**
   * Refuses unless the user allowed the pull request's repository with the
   * agent Settings › Agents picks. The check reads only the saved choices, so
   * a cached answer shows at once; the refusal names the agent and its
   * version. Throws an AgentRunError when no agent is picked or installed,
   * as the turn's start would.
   */
  async function requireConsent(source: DeckPullRequestSource) {
    const { cli: picked } = await options.storage.getAgentRunnerSettings();
    if (await consentedWith(source, picked)) return;
    const cli = await options.selectedCli();
    if (!cli) throw new AgentRunError(PICK_AN_AGENT, 400);
    if (!cli.installed) {
      throw new AgentRunError(`${cli.label} is not installed.`, 400);
    }
    throw new DeckTurnRefused(409, {
      error: `Ajour asks once for ${repositoryName(source.repository)} before it sends its code to ${cli.label}.`,
      reason: "needs_consent",
      repository: source.repository,
      provider: {
        cli: cli.id,
        label: cli.label,
        ...(cli.version ? { version: cli.version } : {}),
      },
    });
  }

  return {
    /**
     * Whether a pull request's repository is allowed now with `cli`, the
     * agent a conversation runs: asked before each turn is sent to it, and
     * at each of its reads. Another agent's consent never counts.
     */
    async allowedWith(pullRequest: string, cli: AgentCliId | undefined) {
      const source = parseDeckPullRequestKey(pullRequest);
      return source !== undefined && (await consentedWith(source, cli ?? null));
    },

    /**
     * The gate of every core turn, whoever starts it: a turn about anything
     * but a Deck pull request whose repository the user allowed is refused.
     */
    async requireTurnConsent(pullRequest: string) {
      const source = parseDeckPullRequestKey(pullRequest);
      if (!source) {
        throw new DeckTurnRefused(404, {
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
        throw new DeckTurnRefused(409, { error: NOT_HELD, reason: "not_open" });
      }
      const { anchor } = request;
      let message: string;
      if (anchor.kind === "concern") {
        const concerns = held.guide?.concerns ?? [];
        const concern = concerns.find(({ id }) => id === anchor.id);
        if (!concern) {
          throw new DeckTurnRefused(404, {
            error: "The guide has no such concern.",
            reason: "unknown_anchor",
          });
        }
        message = concernMessage(concern, request.question);
      } else {
        const line = summaryLineOf(held.guide, anchor.id);
        if (!line) {
          throw new DeckTurnRefused(404, {
            error: "The summary has no such line.",
            reason: "unknown_anchor",
          });
        }
        message = summaryLineMessage(line, request.question);
      }
      const turn = await options.startTurn({
        task: "deck.ask",
        pullRequest,
        head: request.head,
        message,
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
