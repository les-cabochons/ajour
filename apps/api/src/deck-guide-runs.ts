import type {
  AgentCliId,
  AgentTurn,
  AgentTurnEvent,
  CoreAgentTask,
  CoreTaskRunRequest,
} from "../../../packages/shared/agent-runs.ts";
import type { CodeHostLinkedTicket } from "../../../packages/shared/code-host.ts";
import {
  deckPullRequestKey,
  type DeckGuide,
  type DeckPullRequestSource,
  type DeckRegroupRequest,
  type DeckSubmitGuideInput,
  type DeckSubmitGuideOutput,
  type DeckTicket,
} from "../../../packages/shared/deck.ts";
import type { GuideJobBuilt } from "../../../packages/review-deck/guide-job.ts";
import type { GroupedConcern } from "../../../packages/review-deck/summary.ts";
import {
  agentGuideOf,
  groupedConcernsOf,
  submittedGuideProblem,
} from "./deck-agent-guide.ts";
import { DeckTurnRefused, NOT_HELD } from "./deck-asks.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";
import { ticketOf } from "./deck-summary.ts";
import type { McpClientPullRequestBinding } from "./storage.ts";

/*
 * Regroup (#794, from #597 and #662): a `deck.guide` turn of the pull
 * request's conversation. Ajour writes the turn from what it holds, the
 * guide on screen with its hunk ids and the first changed lines, plus the
 * pull request's description and its linked tickets read again through the
 * code host, never from the page's words but the user's instruction. The
 * agent hands its guide back through `submit_guide`, which only that turn
 * may call: a submission that breaks a rule goes back to the agent with the
 * problem, and the first one that keeps them is saved as the agent's guide,
 * naming it. A guide turn that ends with nothing saved fails.
 */

/** The changed lines the turn quotes before the agent reads more. */
const QUOTED_LINES = 160;
/** How much of the description and of each ticket the turn quotes. */
const DESCRIPTION_MAX = 2_000;
const TICKET_BODY_MAX = 1_500;
/** The linked tickets the turn quotes. */
const TICKETS_QUOTED = 3;
/** Refused submissions a turn may send before Ajour stops checking them. */
const REJECTIONS_ALLOWED = 5;

/** Why a `submit_guide` call can't be saved, as the agent reads it. */
export class DeckGuideRefused extends Error {}

export interface DeckGuideRunsOptions {
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
    /** The rules on the agent's concerns; `signal` stops their build. */
    rulesFor(
      pullRequest: string,
      head: string,
      concerns: GroupedConcern[],
      signal?: AbortSignal,
    ): Promise<GuideJobBuilt | undefined>;
    /** Writes nothing once `stillValid`, asked right before the write, says no. */
    setAgentGuide(
      pullRequest: string,
      head: string,
      guide: DeckGuide,
      stillValid: () => Promise<boolean>,
    ): Promise<{ guide: DeckGuide | null } | undefined>;
  };
  /**
   * Refuses a turn about a repository the user hasn't allowed for the
   * description and linked tickets it sends (`deck-asks.ts`).
   */
  requireConsent(pullRequest: string): Promise<void>;
  /** Whether the binding's repository is still allowed with its agent. */
  allowed(binding: McpClientPullRequestBinding): Promise<boolean>;
  /** The turn a conversation's client is in now. */
  runningTurnOf(
    clientId: string,
  ):
    | { id: string; task: CoreAgentTask; pullRequest: string; head: string }
    | undefined;
  startTurn(request: CoreTaskRunRequest): Promise<AgentTurn>;
  /** Ends a running turn as done once its guide is saved. */
  completeTurn(turnId: string): void;
  /** The agent's name, as the source label shows it: "Claude Code". */
  labelOf(cli: AgentCliId): string;
  /**
   * The pull request's description and linked tickets, read again for the
   * turn. Either is undefined when the code host can't give it.
   */
  readContext(source: DeckPullRequestSource): Promise<{
    description?: string;
    tickets?: CodeHostLinkedTicket[];
  }>;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** The first changed lines of the guide's hunks, in reading order, as unified diff lines. */
function quotedLines(held: DeckHeldPullRequest) {
  const patches = new Map(
    held.diff.files.flatMap((file) =>
      file.hunks.map((hunk) => [hunk.id, { path: file.path, hunk }] as const),
    ),
  );
  const lines: string[] = [];
  const ids = held.guide?.concerns.flatMap((concern) => concern.hunkIds) ?? [];
  for (const id of ids) {
    if (lines.length >= QUOTED_LINES) break;
    const found = patches.get(id);
    if (!found) continue;
    const body = found.hunk.patch
      .split("\n")
      .filter((line) => /^[-+ ]/.test(line) && !/^(---|\+\+\+) /.test(line));
    if (!body.length) continue;
    lines.push(`${id} (${found.path}) ${found.hunk.header}`.trimEnd());
    lines.push(...body.slice(0, QUOTED_LINES - lines.length));
  }
  return lines;
}

/** The turn's words: the user's instruction, the context, then the guide to regroup. */
export function guideTurnMessage(
  held: DeckHeldPullRequest,
  instruction: string | undefined,
  context: { description?: string; tickets?: CodeHostLinkedTicket[] },
): string {
  const concerns = held.guide?.concerns ?? [];
  const hunkCount = concerns.reduce(
    (count, concern) => count + concern.hunkIds.length,
    0,
  );
  const description = context.description?.trim();
  const tickets = context.tickets;
  const parts = [
    instruction
      ? `The user's instruction for the new guide: ${instruction}`
      : "The user gave no instruction: group the changes as you see best.",
    "",
    description
      ? `The pull request's description:\n${clip(description, DESCRIPTION_MAX)}`
      : "The pull request has no description.",
    "",
    tickets === undefined
      ? 'Ajour couldn\'t read the tickets the pull request is linked to: infer the problem from the code, with source "inferred".'
      : tickets.length === 0
        ? 'No ticket is linked to the pull request: infer the problem from the code, with source "inferred".'
        : [
            'The tickets the pull request is linked to. Write the problem from the first one, with source "ticket" and its number:',
            ...tickets
              .slice(0, TICKETS_QUOTED)
              .map((ticket) =>
                [
                  `- ${ticket.repository ? `${ticket.repository}#` : "#"}${ticket.number} (${ticket.state}): ${ticket.title}`,
                  ticket.body.trim()
                    ? `  ${clip(ticket.body.trim(), TICKET_BODY_MAX).replace(/\n/g, "\n  ")}`
                    : undefined,
                ]
                  .filter((line) => line !== undefined)
                  .join("\n"),
              ),
          ].join("\n"),
    "",
    `The guide as it is now, in reading order. Each of its ${hunkCount} hunks goes in exactly one concern of yours:`,
    ...concerns.map(
      (concern, index) =>
        `${index + 1}. ${concern.title} — ${concern.hunkIds.join(", ")}`,
    ),
    "",
    "The first changed lines, in that order. Read the rest with read_hunks or read_file:",
    ...quotedLines(held),
  ];
  return parts.join("\n");
}

/** A guide turn's submissions so far. */
interface Submissions {
  rejected: number;
  /** Set while the first valid one is saved, then for good. */
  saved: "saving" | "saved" | undefined;
  /** The last call's check: the next one waits for it. */
  queue: Promise<unknown>;
  /** Aborts once the turn ends, to stop the rules' build. */
  ended: AbortController;
}

const NOT_GUIDING =
  "submit_guide answers only while Ajour regroups this pull request's guide, and it doesn't now. Don't call it.";
const MOVED_ON =
  "Ajour no longer holds this pull request at this head, because the user moved to another one. Stop.";
const REVOKED =
  "The user no longer allows Ajour to send this repository's code to you. Stop, and say only that you can't regroup it now.";
const STOPPED =
  "This regroup ended before Ajour saved its guide, so Ajour keeps the one it shows. Stop.";

export function createDeckGuideRuns(options: DeckGuideRunsOptions) {
  /** The guide turns that called `submit_guide`, by turn ID. */
  const submissions = new Map<string, Submissions>();
  /**
   * The linked tickets each regroup's turn quoted, null when they couldn't
   * be read, by turn ID: its submission is checked against the same ones.
   */
  const quoted = new Map<string, DeckTicket[] | null>();

  return {
    /** Starts a `deck.guide` turn that regroups the guide on screen. */
    async regroup(
      source: Pick<DeckPullRequestSource, "pluginId" | "connectionId">,
      request: DeckRegroupRequest,
    ): Promise<AgentTurn> {
      const pullRequestSource: DeckPullRequestSource = {
        ...source,
        repository: request.repository,
        number: request.number,
      };
      const pullRequest = deckPullRequestKey(pullRequestSource);
      await options.requireConsent(pullRequest);
      const held = await options.deck.held(pullRequest, request.head);
      if (!held) {
        throw new DeckTurnRefused(409, { error: NOT_HELD, reason: "not_open" });
      }
      if (!held.guide) {
        throw new DeckTurnRefused(409, {
          error: "This pull request has no guide to regroup.",
          reason: "no_guide",
        });
      }
      const context = await options.readContext(pullRequestSource);
      const turn = await options.startTurn({
        task: "deck.guide",
        pullRequest,
        head: request.head,
        message: guideTurnMessage(held, request.instruction, context),
      });
      quoted.set(turn.id, context.tickets?.map(ticketOf) ?? null);
      return turn;
    },

    /**
     * Checks a `submit_guide` call of a conversation's client and saves the
     * first one that keeps the rules, while its turn runs and its repository
     * is allowed. A turn's calls are checked one at a time, so two sent at
     * once save one guide. Throws `DeckGuideRefused` with what the agent
     * should do: outside a guide turn, after the guide is saved, or with the
     * rule the submission breaks.
     */
    async submit(
      clientId: string,
      binding: McpClientPullRequestBinding,
      input: DeckSubmitGuideInput,
    ): Promise<DeckSubmitGuideOutput> {
      const turn = options.runningTurnOf(clientId);
      if (
        !turn ||
        turn.task !== "deck.guide" ||
        turn.pullRequest !== binding.pullRequest ||
        turn.head !== binding.head
      ) {
        throw new DeckGuideRefused(NOT_GUIDING);
      }
      const tried = submissions.get(turn.id) ?? {
        rejected: 0,
        saved: undefined,
        queue: Promise.resolve(),
        ended: new AbortController(),
      };
      submissions.set(turn.id, tried);
      const answer = tried.queue.then(() =>
        answerSubmission(clientId, turn.id, tried, binding, input),
      );
      tried.queue = answer.catch(() => {});
      return answer;
    },

    /**
     * Why a guide turn the agent ended as done failed: it saved no guide.
     * One still saving its guide isn't failed: the page reads the guide.
     */
    doneFailure(turn: { id: string; task: CoreAgentTask }) {
      if (turn.task !== "deck.guide") return undefined;
      return submissions.get(turn.id)?.saved
        ? undefined
        : "The agent didn't return a guide Ajour could use.";
    },

    /** Reads every turn event, to forget a guide turn once it ended. */
    observe(event: AgentTurnEvent) {
      if (event.type !== "ended") return;
      submissions.get(event.turnId)?.ended.abort();
      submissions.delete(event.turnId);
      quoted.delete(event.turnId);
    },
  };

  /** One `submit_guide` call, once the turn's earlier ones are answered. */
  async function answerSubmission(
    clientId: string,
    turnId: string,
    tried: Submissions,
    binding: McpClientPullRequestBinding,
    input: DeckSubmitGuideInput,
  ): Promise<DeckSubmitGuideOutput> {
    /** Whether the turn still runs, and isn't being stopped. */
    const going = () => options.runningTurnOf(clientId)?.id === turnId;
    if (tried.saved === "saved") {
      throw new DeckGuideRefused(
        "Ajour already saved this turn's guide. Stop, and reply with one short line.",
      );
    }
    if (!going()) throw new DeckGuideRefused(NOT_GUIDING);
    if (tried.rejected >= REJECTIONS_ALLOWED) {
      throw new DeckGuideRefused(
        `Ajour refused ${REJECTIONS_ALLOWED} guides in this turn and keeps the one it shows. Stop, and say only that you couldn't regroup it.`,
      );
    }
    if (!(await options.allowed(binding))) throw new DeckGuideRefused(REVOKED);
    const held = await options.deck.held(binding.pullRequest, binding.head);
    if (!held?.builtGuide) throw new DeckGuideRefused(MOVED_ON);
    // The tickets the turn quoted; a turn started elsewhere, the guide's.
    const tickets = quoted.has(turnId)
      ? quoted.get(turnId)!
      : held.builtGuide.summary.tickets;
    const problem = submittedGuideProblem(input, held.diff, tickets);
    if (problem) {
      tried.rejected += 1;
      throw new DeckGuideRefused(
        `Ajour didn't save this guide: ${problem} Fix it and call submit_guide again.`,
      );
    }
    tried.saved = "saving";
    try {
      const rules = await options.deck.rulesFor(
        binding.pullRequest,
        binding.head,
        groupedConcernsOf(input),
        tried.ended.signal,
      );
      const guide =
        rules &&
        agentGuideOf({
          input,
          tickets,
          rules,
          diff: held.diff,
          provider: { cli: binding.cli, label: options.labelOf(binding.cli) },
        });
      if (!guide) throw new DeckGuideRefused(MOVED_ON);
      // The user may stop the turn, or revoke the repository, until the
      // guide is written: then it isn't theirs to show. Deck asks right
      // before it writes, after it read the pull request again.
      let refusal: string | undefined;
      const stillValid = async () => {
        if (!(await options.allowed(binding))) refusal = REVOKED;
        else if (!going()) refusal = STOPPED;
        return refusal === undefined;
      };
      const saved = await options.deck.setAgentGuide(
        binding.pullRequest,
        binding.head,
        guide,
        stillValid,
      );
      if (refusal) throw new DeckGuideRefused(refusal);
      if (!saved) throw new DeckGuideRefused(MOVED_ON);
      tried.saved = "saved";
      // The first valid guide ends the turn, once this answer is on its way.
      setTimeout(() => options.completeTurn(turnId), 0).unref();
      return { saved: true, concernCount: input.concerns.length };
    } catch (error) {
      if (tried.saved === "saving") tried.saved = undefined;
      if (error instanceof DeckGuideRefused) throw error;
      // The turn's end stops the rules' build.
      if (!going()) throw new DeckGuideRefused(STOPPED);
      throw new DeckGuideRefused(
        "Ajour couldn't save this guide. Call submit_guide again once.",
      );
    }
  }
}

export type DeckGuideRuns = ReturnType<typeof createDeckGuideRuns>;
