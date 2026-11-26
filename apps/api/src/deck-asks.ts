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
  deckHunkRows,
  deckLinesLabel,
  deckPullRequestKey,
  parseDeckPullRequestKey,
  repositoryName,
  sameLinePoint,
  type DeckAgentConsent,
  type DeckAskAnchor,
  type DeckAskRequest,
  type DeckAskResponse,
  type DeckAskRefusal,
  type DeckCloneUse,
  type DeckConcern,
  type DeckLinesAnchor,
  type DeckPullRequestDiff,
  type DeckPullRequestSource,
} from "../../../packages/shared/deck.ts";
import type { TurnOptions } from "./agent-runner/conversations.ts";
import { AgentRunError, PICK_AN_AGENT } from "./agent-runner/launch.ts";
import type {
  DeckCloneEntry,
  DeckCloneFailure,
  DeckClonePrepared,
  DeckCloneRepository,
} from "./deck-clones.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's asks (#791, #793). An ask is a `deck.ask` turn of the pull
 * request's conversation, anchored to a concern or to lines selected in one
 * hunk: Ajour writes the turn from the guide and the diff it holds, never
 * from the page's words, with the anchor's default question
 * or the user's own. Nothing reaches the agent before the user allowed the
 * repository with that agent. A done answer is cached per anchor, typed
 * question and head commit, so asking again answers at once. The cache lives
 * in memory until the disk cache (#781).
 *
 * When the user chose a local clone of the repository, the turn may read it
 * too, at the pull request's head (#795). A clone that can't be prepared
 * never stops the ask: the agent reads the pull request alone, and the
 * answer says why.
 */

/** Answers kept. Older ones are asked again. */
const ANSWERS_KEPT = 200;

/** The ask was stopped before its turn started: nobody waits for an answer. */
export class DeckAskStopped extends Error {
  constructor() {
    super("The ask was stopped.");
  }
}

/** Why an ask, or a core turn, can't run: its status and the body the page reads. */
export class DeckAskRefused extends Error {
  readonly status: 404 | 409;
  readonly body: DeckAskRefusal;

  constructor(status: DeckAskRefused["status"], body: DeckAskRefusal) {
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
  startTurn(
    request: CoreTaskRunRequest,
    options?: TurnOptions,
  ): Promise<AgentTurn>;
  /** The user's local clones. Without them, asks read the pull request alone. */
  clones?: {
    isChosen(repository: DeckCloneRepository): Promise<boolean>;
    prepare(
      entry: DeckCloneEntry,
      signal?: AbortSignal,
    ): Promise<DeckClonePrepared>;
    release(key: string): Promise<void>;
  };
  /** Whether the agent can read a folder with read-only file tools. */
  readsFiles?: (cli: AgentCliId) => boolean;
}

/** What an ask did with the clone, for its event: never a path or a reason's words. */
export type DeckAskCloneFact =
  "read" | "not_chosen" | "agent_reads_no_files" | DeckCloneFailure;

/** The answer and, when there was one, what it read of the clone. */
interface Answer {
  text: string;
  clone?: DeckCloneUse;
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
      throw new DeckAskRefused(404, {
        error: "The diff doesn't show those lines.",
        reason: "unknown_anchor",
      });
    }
    return linesMessage(anchor, selected, question);
  }
  const concern = held.guide?.concerns.find(({ id }) => id === anchor.id);
  if (!concern) {
    throw new DeckAskRefused(404, {
      error: "The guide has no such concern.",
      reason: "unknown_anchor",
    });
  }
  return concernMessage(concern, question);
}

/** The anchor as its answers are cached: a concern by its id, lines by their path and ends. */
const anchorKey = (anchor: DeckAskAnchor) =>
  anchor.kind === "concern"
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
  const answers = new Map<string, Answer>();
  /** The asks still streaming, by turn ID: their cache key, text so far and clone. */
  const streaming = new Map<
    string,
    { key: string; pieces: string[]; clone?: DeckCloneUse }
  >();

  /** The pull request's repository, as Deck keys its clone. */
  const repositoryOf = (
    source: DeckPullRequestSource,
  ): DeckCloneRepository => ({
    pluginId: source.pluginId,
    connectionId: source.connectionId,
    repository: source.repository,
  });

  /** Whether the agent Settings › Agents picks can read a folder with read-only file tools. */
  async function agentReadsFiles() {
    const { cli } = await options.storage.getAgentRunnerSettings();
    return cli !== null && (!options.readsFiles || options.readsFiles(cli));
  }

  /**
   * Whether a cached answer asked before any clone was chosen could read
   * one now: the user chose a clone since, so the ask runs again. An answer
   * that couldn't read the clone stays cached: asking again would pay for
   * the same failure.
   */
  async function couldReadClone(
    cached: Answer,
    request: DeckAskRequest,
    source: DeckPullRequestSource,
  ) {
    if (!options.clones || !request.clone) return false;
    if (cached.clone?.state !== "not_chosen") return false;
    if (!(await agentReadsFiles())) return false;
    return options.clones.isChosen(repositoryOf(source));
  }

  /**
   * The user's clone at the pull request's head, when they chose one and
   * the agent can read it: the folder the turn reads, or why it can't.
   * `signal` stops the preparation, and git with it.
   */
  async function cloneFor(
    source: DeckPullRequestSource,
    held: DeckHeldPullRequest,
    request: DeckAskRequest,
    signal?: AbortSignal,
  ): Promise<{ use?: DeckCloneUse; root?: string; fact?: DeckAskCloneFact }> {
    const { clones } = options;
    if (!clones || !request.clone) return {};
    const repository = repositoryOf(source);
    if (!(await agentReadsFiles())) {
      if (!(await clones.isChosen(repository))) return {};
      return {
        use: {
          state: "unavailable",
          reason:
            "This agent reads files only through a shell, which Ajour keeps off, so it read the pull request alone.",
        },
        fact: "agent_reads_no_files",
      };
    }
    const prepared = await clones.prepare(
      {
        ...repository,
        key: held.key,
        number: source.number,
        head: request.head,
        clone: request.clone,
      },
      signal,
    );
    if (signal?.aborted) throw new DeckAskStopped();
    if (prepared.state === "read") {
      return { use: { state: "read" }, root: prepared.root, fact: "read" };
    }
    if (prepared.state === "not_chosen") {
      return { use: { state: "not_chosen" }, fact: "not_chosen" };
    }
    return {
      use: { state: "unavailable", reason: prepared.reason },
      fact: prepared.failure,
    };
  }

  const cacheKey = (
    pullRequest: string,
    head: string,
    anchor: DeckAskAnchor,
    question: string | undefined,
  ) =>
    JSON.stringify([pullRequest, head, ...anchorKey(anchor), question ?? null]);

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
    throw new DeckAskRefused(409, {
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
        throw new DeckAskRefused(404, {
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
      signal?: AbortSignal,
    ): Promise<DeckAskResponse & { cloneFact?: DeckAskCloneFact }> {
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
      if (
        cached !== undefined &&
        !(await couldReadClone(cached, request, pullRequestSource))
      ) {
        answers.delete(key);
        answers.set(key, cached);
        return {
          kind: "answer",
          text: cached.text,
          head: request.head,
          ...(cached.clone ? { clone: cached.clone } : {}),
        };
      }
      const held = await options.deck.held(pullRequest, request.head);
      if (!held) {
        throw new DeckAskRefused(409, {
          error:
            "Open the pull request again: Ajour no longer holds it at this commit.",
          reason: "not_open",
        });
      }
      const message = turnMessage(held, request);
      const clone = await cloneFor(pullRequestSource, held, request, signal);
      // The pull request may have left while the clone was prepared: its
      // worktree goes with it, and the ask asks to open it again.
      if (clone.root && !(await options.deck.held(pullRequest, request.head))) {
        void options.clones?.release(held.key).catch(() => undefined);
        throw new DeckAskRefused(409, {
          error:
            "Open the pull request again: Ajour no longer holds it at this commit.",
          reason: "not_open",
        });
      }
      const turn = await options.startTurn(
        {
          task: "deck.ask",
          pullRequest,
          head: request.head,
          message,
        },
        clone.root ? { readRoot: clone.root } : {},
      );
      streaming.set(turn.id, {
        key,
        pieces: [],
        ...(clone.use ? { clone: clone.use } : {}),
      });
      return {
        kind: "turn",
        turn,
        ...(clone.use ? { clone: clone.use } : {}),
        ...(clone.fact ? { cloneFact: clone.fact } : {}),
      };
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
      answers.set(ask.key, {
        text: ask.pieces.join(""),
        ...(ask.clone ? { clone: ask.clone } : {}),
      });
      for (const oldest of answers.keys()) {
        if (answers.size <= ANSWERS_KEPT) break;
        answers.delete(oldest);
      }
    },
  };
}

export type DeckAsks = ReturnType<typeof createDeckAsks>;
