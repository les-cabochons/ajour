import { createHash } from "node:crypto";
import type { GuideJobBuilt } from "../../../packages/review-deck/guide-job.ts";
import type { GroupedConcern } from "../../../packages/review-deck/summary.ts";
import {
  DECK_CHANGE_KINDS,
  DECK_SUBMIT_CONCERNS_MAX,
  DECK_SUBMIT_TEXT_MAX,
  DECK_SUBMIT_TITLE_MAX,
  deckGuideSchema,
  type DeckChangeKind,
  type DeckGuide,
  type DeckGuideProvider,
  type DeckPullRequestDiff,
  type DeckSubmitGuideInput,
  type DeckSummaryLine,
  type DeckTicket,
} from "../../../packages/shared/deck.ts";

/*
 * The guide an agent hands back through `submit_guide` (#794, from #597 and
 * #662): the rules it must keep, and the guide Deck saves from it. Every
 * hunk of the diff is in exactly one concern, so a published guide still
 * passes Review Deck's hunk check (#600). The summary keeps the rules'
 * lines, run again on the agent's concerns, and adds the agent's problem,
 * breaking changes and risky areas; each concern's kinds are the agent's
 * and the rules' together.
 */

/** The most ids a refusal names before "and n more". */
const IDS_NAMED = 5;

const named = (ids: readonly string[]) =>
  ids.length > IDS_NAMED
    ? `${ids.slice(0, IDS_NAMED).join(", ")} and ${ids.length - IDS_NAMED} more`
    : ids.join(", ");

const ticketName = (ticket: { number: number; repository?: string }) =>
  ticket.repository
    ? `${ticket.repository}#${ticket.number}`
    : `#${ticket.number}`;

/** A stable id from its parts, so a cached answer about it stays its own. */
const idFrom = (prefix: string, ...parts: string[]) =>
  `${prefix}${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12)}`;

/** The text of a summary line or the problem, checked against its limit. */
function textProblem(label: string, text: string) {
  const length = text.trim().length;
  if (length === 0) return `${label} is empty.`;
  if (length > DECK_SUBMIT_TEXT_MAX) {
    return `${label} has ${length} characters; each summary text has ${DECK_SUBMIT_TEXT_MAX} or fewer.`;
  }
  return undefined;
}

/**
 * Why the submission can't be saved, in a sentence for the agent, or
 * undefined when it keeps every rule. `diff` is the pull request at the
 * turn's head; `tickets` the tickets it is linked to, null when they
 * couldn't be read.
 */
export function submittedGuideProblem(
  input: DeckSubmitGuideInput,
  diff: DeckPullRequestDiff,
  tickets: readonly DeckTicket[] | null,
): string | undefined {
  const { concerns, summary } = input;
  if (concerns.length < 1 || concerns.length > DECK_SUBMIT_CONCERNS_MAX) {
    return `A guide has 1 to ${DECK_SUBMIT_CONCERNS_MAX} concerns; this one has ${concerns.length}.`;
  }
  for (const [index, concern] of concerns.entries()) {
    const label = `Concern ${index + 1}`;
    const title = concern.title.trim().length;
    if (title === 0) return `${label}'s title is empty.`;
    if (title > DECK_SUBMIT_TITLE_MAX) {
      return `${label}'s title has ${title} characters; a title has ${DECK_SUBMIT_TITLE_MAX} or fewer.`;
    }
    const rationale = concern.rationale.trim().length;
    if (rationale > DECK_SUBMIT_TEXT_MAX) {
      return `${label}'s rationale has ${rationale} characters; a rationale has ${DECK_SUBMIT_TEXT_MAX} or fewer.`;
    }
    if (concern.hunkIds.length === 0) return `${label} has no hunks.`;
  }

  const known = new Set(
    diff.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
  );
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const twice = new Set<string>();
  for (const id of concerns.flatMap((concern) => concern.hunkIds)) {
    if (!known.has(id)) unknown.add(id);
    else if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  if (unknown.size) {
    return `The diff has no hunks ${named([...unknown])}. Use the ids the guide lists.`;
  }
  if (twice.size) {
    return `Hunks ${named([...twice])} are in more than one concern. Put each hunk in exactly one.`;
  }
  const missing = [...known].filter((id) => !seen.has(id));
  if (missing.length) {
    return `Hunks ${named(missing)} are in no concern. Put each hunk in exactly one.`;
  }

  const problem = textProblem("The problem", summary.problem.text);
  if (problem) return problem;
  if (summary.problem.source === "ticket") {
    if (!tickets?.length) {
      return 'No ticket is linked to this pull request: infer the problem from the code, with source "inferred".';
    }
    const ref = summary.problem.ticket;
    if (
      ref &&
      !tickets.some(
        (ticket) =>
          ticket.number === ref.number &&
          (ticket.repository ?? undefined) === ref.repository,
      )
    ) {
      return `${ticketName(ref)} isn't linked to this pull request. Its linked tickets: ${tickets.map(ticketName).join(", ")}.`;
    }
  } else if (tickets?.length) {
    return `This pull request is linked to ${tickets.map(ticketName).join(", ")}: write the problem from the ticket, with source "ticket".`;
  }
  for (const [field, label] of [
    ["breaking", "Breaking change"],
    ["risks", "Risky area"],
  ] as const) {
    for (const [index, line] of summary[field].entries()) {
      const at = `${label} ${index + 1}`;
      const text = textProblem(at, line.text);
      if (text) return text;
      if (line.hunkIds.length === 0) return `${at} names no hunk.`;
      const notInDiff = line.hunkIds.filter((id) => !known.has(id));
      if (notInDiff.length) {
        return `${at} names hunks the diff doesn't have: ${named(notInDiff)}.`;
      }
    }
  }
  return undefined;
}

/**
 * The concerns of a submission that keeps the rules, as the summary's rules
 * read them. Each id comes from its hunks, so the same concern keeps its id,
 * and its cached answers, from one regroup to the next.
 */
export function groupedConcernsOf(
  input: DeckSubmitGuideInput,
): GroupedConcern[] {
  return input.concerns.map((concern) => ({
    id: idFrom("agent-", ...concern.hunkIds),
    title: concern.title.trim(),
    rationale: concern.rationale.trim(),
    hunkIds: concern.hunkIds,
  }));
}

const kindsIn = (kinds: Iterable<DeckChangeKind>) => {
  const found = new Set(kinds);
  return DECK_CHANGE_KINDS.filter((kind) => found.has(kind));
};

/**
 * The agent's guide from a submission that keeps the rules: its concerns
 * with the rules' lines run again on them (`rules`, from the guide worker),
 * the built guide's linked tickets, and the agent's summary fields.
 */
export function agentGuideOf({
  input,
  built,
  rules,
  diff,
  provider,
}: {
  input: DeckSubmitGuideInput;
  /** The guide built from the code, for its linked tickets. */
  built: DeckGuide;
  rules: GuideJobBuilt;
  diff: DeckPullRequestDiff;
  provider: DeckGuideProvider;
}): DeckGuide {
  const order = new Map(
    diff.files
      .flatMap((file) => file.hunks.map((hunk) => hunk.id))
      .map((id, index) => [id, index] as const),
  );
  const inDiffOrder = (ids: readonly string[]) =>
    [...new Set(ids)].sort((a, b) => order.get(a)! - order.get(b)!);
  const line =
    (prefix: string) =>
    ({
      text,
      hunkIds,
    }: {
      text: string;
      hunkIds: string[];
    }): DeckSummaryLine => ({
      id: idFrom(prefix, text.trim(), ...inDiffOrder(hunkIds)),
      text: text.trim(),
      hunkIds: inDiffOrder(hunkIds),
    });

  // A concern holding a breaking change's hunk is Breaking, whatever it said.
  const breakingHunks = new Set(
    input.summary.breaking.flatMap((breaking) => breaking.hunkIds),
  );
  const concerns = rules.concerns.map((concern, index) => ({
    id: concern.id,
    title: concern.title,
    rationale: concern.rationale,
    hunkIds: concern.hunkIds,
    kinds: kindsIn([
      ...input.concerns[index]!.kinds,
      ...concern.kinds,
      ...(concern.hunkIds.some((id) => breakingHunks.has(id))
        ? (["breaking"] as const)
        : []),
    ]),
  }));
  const { problem } = input.summary;
  const ticket =
    problem.source === "ticket"
      ? (built.summary.tickets ?? []).find((linked) =>
          problem.ticket
            ? linked.number === problem.ticket.number &&
              (linked.repository ?? undefined) === problem.ticket.repository
            : true,
        )
      : undefined;
  return deckGuideSchema.parse({
    madeWith: "agent",
    provider,
    concerns,
    summary: {
      problem: ticket
        ? { text: problem.text.trim(), source: "ticket", ticket }
        : { text: problem.text.trim(), source: "inferred" },
      tickets: built.summary.tickets,
      kinds: kindsIn(concerns.flatMap((concern) => concern.kinds)),
      breaking: input.summary.breaking.map(line("breaking:")),
      risks: [
        ...rules.summary.risks,
        ...input.summary.risks.map(line("risk:agent-")),
      ],
      tests: rules.summary.tests,
      untested: rules.summary.untested,
      leftovers: rules.summary.leftovers,
    },
  });
}
