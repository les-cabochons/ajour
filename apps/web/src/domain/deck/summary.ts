import type {
  DeckChangeKind,
  DeckSummary,
  DeckSummaryLine,
  DeckTicket,
} from "@ajour/shared/deck";

/*
 * How Deck's review page reads a pull request's summary (#789, from #662):
 * the problem from its linked ticket, its kinds of change, then its lines
 * in sections, each line going to its hunks. The local API's rules fill it
 * with the guide; the agent's guide run adds to the same fields (#794).
 */

const KIND_LABELS: Record<DeckChangeKind, string> = {
  breaking: "Breaking",
  feature: "Feature",
  fix: "Fix",
  refactor: "Refactor",
  performance: "Performance",
  tests: "Tests",
  docs: "Docs",
  dependencies: "Dependencies",
  build: "Build",
};

export const changeKindLabel = (kind: DeckChangeKind) => KIND_LABELS[kind];

/** `#482`, or `acme/web#12` for an issue of another repository. A work item is its number. */
export function ticketLabel(ticket: DeckTicket, repository: string) {
  return ticket.repository && ticket.repository !== repository
    ? `${ticket.repository}#${ticket.number}`
    : `#${ticket.number}`;
}

/** What the summary's first line says about the problem the pull request fixes. */
export type SummaryProblem =
  | { kind: "ticket"; text: string; ticket: DeckTicket; others: DeckTicket[] }
  | { kind: "inferred"; text: string }
  /** No ticket is linked. */
  | { kind: "none" }
  /** The code host couldn't say which tickets are linked. */
  | { kind: "unread" };

export function summaryProblem(summary: DeckSummary): SummaryProblem {
  const { problem, tickets } = summary;
  if (problem?.source === "ticket" && problem.ticket) {
    const { ticket } = problem;
    return {
      kind: "ticket",
      text: problem.text,
      ticket,
      others: (tickets ?? []).filter(
        (other) =>
          other.number !== ticket.number ||
          other.repository !== ticket.repository,
      ),
    };
  }
  if (problem) return { kind: "inferred", text: problem.text };
  return tickets === null ? { kind: "unread" } : { kind: "none" };
}

/** A summary line, with its concern's number in reading order when it's about one. */
export interface SummaryEntry {
  line: DeckSummaryLine;
  concern?: number;
}

export interface SummarySection {
  key: "breaking" | "risks" | "tests" | "leftovers";
  heading: string;
  lines: SummaryEntry[];
}

/**
 * The summary's sections in reading order, each line with its concern's
 * number from `concernNumbers`. Tests go by concern: what each tests, or
 * that it has no test. A section without lines is left out.
 */
export function summarySections(
  summary: DeckSummary,
  concernNumbers: ReadonlyMap<string, number>,
): SummarySection[] {
  const entry = (line: DeckSummaryLine): SummaryEntry => {
    const concern = line.concernId
      ? concernNumbers.get(line.concernId)
      : undefined;
    return concern === undefined ? { line } : { line, concern };
  };
  const byConcern = (a: SummaryEntry, b: SummaryEntry) =>
    (a.concern ?? Number.MAX_SAFE_INTEGER) -
    (b.concern ?? Number.MAX_SAFE_INTEGER);
  const sections: SummarySection[] = [
    {
      key: "breaking",
      heading: "Breaking changes",
      lines: summary.breaking.map(entry),
    },
    { key: "risks", heading: "Risky areas", lines: summary.risks.map(entry) },
    {
      key: "tests",
      heading: "Tests",
      lines: [...summary.tests, ...summary.untested].map(entry).sort(byConcern),
    },
    {
      key: "leftovers",
      heading: "Leftovers",
      lines: summary.leftovers.map(entry),
    },
  ];
  return sections.filter((section) => section.lines.length > 0);
}
