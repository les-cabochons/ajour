import type {
  AgentCliId,
  AgentCliStatus,
  AgentTurn,
  AgentTurnEvent,
  CoreTaskRunRequest,
} from "../../../packages/shared/agent-runs.ts";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
  DECK_LINES_DEFAULT_QUESTION,
  DECK_SUMMARY_DEFAULT_QUESTION,
  deckConsentCovers,
  deckHunkRows,
  deckLinesLabel,
  deckPullRequestKey,
  parseDeckPullRequestKey,
  repositoryName,
  sameLinePoint,
  type DeckAgentConsent,
  type DeckConsentCovers,
  type DeckAskAnchor,
  type DeckAskRequest,
  type DeckAskResponse,
  type DeckTurnRefusal,
  type DeckConcern,
  type DeckGuide,
  type DeckLinesAnchor,
  type DeckPullRequestDiff,
  type DeckPullRequestSource,
  type DeckSummaryLine,
} from "../../../packages/shared/deck.ts";
import { AgentRunError, PICK_AN_AGENT } from "./agent-runner/launch.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's asks (#791, #793, #794). An ask is a `deck.ask` turn of the pull
 * request's conversation, anchored to a concern, a summary line or lines
 * selected in one hunk: Ajour writes the turn from the guide and the diff
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

/** The selected rows of the hunk that shows them, in its order, or undefined when none does. */
function selectedRows(diff: DeckPullRequestDiff, anchor: DeckLinesAnchor) {
  const file = diff.files.find((entry) => entry.path === anchor.path);
  for (const hunk of file?.hunks ?? []) {
    const rows = deckHunkRows(hunk);
    const first = rows.findIndex(({ point }) =>
      sameLinePoint(point, anchor.start),
    );
    const last = rows.findIndex(({ point }) =>
      sameLinePoint(point, anchor.end),
    );
    if (first < 0 || last < 0) continue;
    return {
      hunkId: hunk.id,
      rows: rows
        .slice(Math.min(first, last), Math.max(first, last) + 1)
        .map(({ text }) => text),
    };
  }
  return undefined;
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

/** The turn's words for selected lines: where they are, the rows as the diff has them, then the question. */
function linesMessage(
  anchor: DeckLinesAnchor,
  selected: { hunkId: string; rows: string[] },
  question: string | undefined,
) {
  return [
    `The user selected ${deckLinesLabel(anchor)} of ${anchor.path}, in hunk ${selected.hunkId}:`,
    "```diff",
    ...selected.rows,
    "```",
    "Read the hunk with read_hunks, and the file with read_file, for what is around them.",
    "",
    `The question: ${question ?? DECK_LINES_DEFAULT_QUESTION}`,
  ].join("\n");
}

/** The turn's words for the ask's anchor; refused when Ajour holds no such anchor. */
function turnMessage(held: DeckHeldPullRequest, request: DeckAskRequest) {
  const { anchor, question } = request;
  if (anchor.kind === "lines") {
    const selected = selectedRows(held.diff, anchor);
    if (!selected) {
      throw new DeckTurnRefused(404, {
        error: "The diff doesn't show those lines.",
        reason: "unknown_anchor",
      });
    }
    return linesMessage(anchor, selected, question);
  }
  if (anchor.kind === "summary") {
    const line = summaryLineOf(held.guide, anchor.id);
    if (!line) {
      throw new DeckTurnRefused(404, {
        error: "The summary has no such line.",
        reason: "unknown_anchor",
      });
    }
    return summaryLineMessage(line, question);
  }
  const concern = held.guide?.concerns.find(({ id }) => id === anchor.id);
  if (!concern) {
    throw new DeckTurnRefused(404, {
      error: "The guide has no such concern.",
      reason: "unknown_anchor",
    });
  }
  return concernMessage(concern, question);
}

/**
 * The anchor as its answers are cached: a concern or a summary line by its
 * id, lines by their path and ends.
 */
const anchorKey = (anchor: DeckAskAnchor) =>
  anchor.kind !== "lines"
    ? [anchor.kind, anchor.id]
    : [
        anchor.kind,
        anchor.path,
        anchor.start.side,
        anchor.start.line,
        anchor.end.side,
        anchor.end.line,
      ];

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
    JSON.stringify([pullRequest, head, ...anchorKey(anchor), question ?? null]);

  /**
   * Whether the user allowed the repository with this agent, for what
   * `covers` names: a consent that covers the context covers the code too.
   */
  async function consentedWith(
    source: DeckPullRequestSource,
    cli: AgentCliId | null,
    covers: DeckConsentCovers = "code",
  ) {
    if (!cli) return false;
    const consents = await options.storage.getDeckConsents();
    return consents.some(
      (consent) =>
        consent.pluginId === source.pluginId &&
        consent.connectionId === source.connectionId &&
        consent.repository === source.repository &&
        consent.cli === cli &&
        deckConsentCovers(consent.covers, covers),
    );
  }

  /**
   * Refuses unless the user allowed the pull request's repository with the
   * agent Settings › Agents picks, for what `covers` names. The check reads
   * only the saved choices, so a cached answer shows at once; the refusal
   * names the agent and its version, and says when the repository is
   * allowed for the code only. Throws an AgentRunError when no agent is
   * picked or installed, as the turn's start would.
   */
  async function requireConsent(
    source: DeckPullRequestSource,
    covers: DeckConsentCovers,
  ) {
    const { cli: picked } = await options.storage.getAgentRunnerSettings();
    if (await consentedWith(source, picked, covers)) return;
    const cli = await options.selectedCli();
    if (!cli) throw new AgentRunError(PICK_AN_AGENT, 400);
    if (!cli.installed) {
      throw new AgentRunError(`${cli.label} is not installed.`, 400);
    }
    const again =
      covers === "context" && (await consentedWith(source, cli.id, "code"));
    const name = repositoryName(source.repository);
    throw new DeckTurnRefused(409, {
      error: again
        ? `Ajour asks again for ${name} before a regroup sends its description and linked tickets to ${cli.label}.`
        : `Ajour asks once for ${name} before it sends its code to ${cli.label}.`,
      reason: "needs_consent",
      repository: source.repository,
      provider: {
        cli: cli.id,
        label: cli.label,
        ...(cli.version ? { version: cli.version } : {}),
      },
      ...(again ? { again: "regroup" as const } : {}),
    });
  }

  return {
    /**
     * Whether a pull request's repository is allowed now with `cli`, the
     * agent a conversation runs, whatever the consent covers: asked before
     * each turn is sent to it, and at each of its reads. Another agent's
     * consent never counts.
     */
    async allowedWith(pullRequest: string, cli: AgentCliId | undefined) {
      const source = parseDeckPullRequestKey(pullRequest);
      return source !== undefined && (await consentedWith(source, cli ?? null));
    },

    /**
     * The gate of every core turn, whoever starts it: a turn about anything
     * but a Deck pull request whose repository the user allowed, for what
     * `covers` names, is refused. A regroup's turn needs the context.
     */
    async requireTurnConsent(
      pullRequest: string,
      covers: DeckConsentCovers = "code",
    ) {
      const source = parseDeckPullRequestKey(pullRequest);
      if (!source) {
        throw new DeckTurnRefused(404, {
          error: "Deck doesn't know that pull request.",
          reason: "not_open",
        });
      }
      await requireConsent(source, covers);
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
      await requireConsent(pullRequestSource, "code");
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
      const turn = await options.startTurn({
        task: "deck.ask",
        pullRequest,
        head: request.head,
        message: turnMessage(held, request),
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
