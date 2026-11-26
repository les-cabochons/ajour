import { memo, useMemo } from "react";
import type {
  DeckChangeKind,
  DeckOpenedPullRequest,
  DeckSummary,
} from "@ajour/shared/deck";
import { SectionHeading } from "@/components/section-heading";
import { Chip } from "@/components/ui/chip";
import { Value } from "@/components/ui/value";
import { reviewSections } from "@/domain/deck/guide";
import {
  changeKindLabel,
  summaryProblem,
  summarySections,
  ticketLabel,
  type SummaryEntry,
} from "@/domain/deck/summary";
import { openSourceUrl } from "@/lib/source-navigation";
import { SummaryLineAsk } from "./deck-ask";

/*
 * The summary at the top of Deck's review page (#789, from #662), above
 * the description drawer and the guide: the problem from the linked
 * ticket, the kinds of change, then the breaking changes, the risky areas,
 * the tests by concern and the leftovers, each line a link to its first
 * hunk ended by `more ›`. After a regroup (#794), the agent's guide carries
 * the agent's problem, kinds and lines with the rules'.
 */

/** Scrolls the changes to a hunk and focuses it. `PullRequestChanges` provides it. */
export type ReachHunk = (hunkId: string) => void;

/** Kinds of change as chips, on the summary and under a concern's title. */
export function ChangeKinds({ kinds }: { kinds: readonly DeckChangeKind[] }) {
  if (!kinds.length) return null;
  return (
    <ul className="deck-kinds" aria-label="Kinds of change">
      {kinds.map((kind) => (
        <li key={kind}>
          <Chip>{changeKindLabel(kind)}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** One line, a link to its first hunk, ended by its `more ›` (#794). */
function SummaryLineView({
  entry: { line, concern },
  onReach,
}: {
  entry: SummaryEntry;
  onReach: ReachHunk;
}) {
  const count = line.hunkIds.length;
  return (
    <li className="deck-summary-line">
      <SummaryLineAsk lineId={line.id} label={line.text}>
        {concern !== undefined ? (
          <Value tone="muted" className="deck-summary-concern" aria-hidden>
            {concern}
          </Value>
        ) : null}
        <button
          type="button"
          className="deck-summary-link"
          onClick={() => onReach(line.hunkIds[0]!)}
        >
          {concern !== undefined ? (
            <>
              <span className="sr-only">{`Concern ${concern}:`}</span>{" "}
            </>
          ) : null}
          {line.text}
        </button>
        {count > 1 ? (
          <Value tone="muted" className="deck-summary-count">
            {count} hunks
          </Value>
        ) : null}
      </SummaryLineAsk>
    </li>
  );
}

function ProblemView({
  summary,
  repository,
}: {
  summary: DeckSummary;
  repository: string;
}) {
  const problem = summaryProblem(summary);
  if (problem.kind === "none" || problem.kind === "unread") {
    return (
      <p className="deck-summary-quiet">
        {problem.kind === "none"
          ? "No linked ticket"
          : "The linked tickets couldn't be read."}
      </p>
    );
  }
  if (problem.kind === "inferred") {
    return (
      <p className="deck-summary-problem">
        {problem.text}{" "}
        <span className="deck-summary-quiet">Inferred, no linked ticket</span>
      </p>
    );
  }
  const tickets = [problem.ticket, ...problem.others];
  return (
    <>
      <p className="deck-summary-problem">{problem.text}</p>
      <p className="deck-summary-tickets">
        {tickets.map((ticket, index) => (
          <span key={`${ticket.repository ?? ""}#${ticket.number}`}>
            {index > 0 ? " · " : null}
            <button
              type="button"
              className="deck-summary-ticket"
              aria-label={`Open ${ticketLabel(ticket, repository)}: ${ticket.title}`}
              onClick={() => openSourceUrl(ticket.url)}
            >
              {ticketLabel(ticket, repository)}
            </button>{" "}
            {ticket.state}
          </span>
        ))}
      </p>
    </>
  );
}

/**
 * The pull request's summary, once its guide is built. Nothing shows while
 * the changes load, fail, or have no guide: the changes say so.
 */
export const PullRequestSummary = memo(function PullRequestSummary({
  pullRequest,
  repository,
  onReach,
}: {
  pullRequest: DeckOpenedPullRequest;
  repository: string;
  onReach: ReachHunk;
}) {
  const summary = pullRequest.guide?.summary;
  const sections = useMemo(() => {
    if (!summary) return [];
    const numbers = new Map<string, number>();
    for (const section of reviewSections(pullRequest, "guide")) {
      if (section.concernId && section.number !== undefined) {
        numbers.set(section.concernId, section.number);
      }
    }
    return summarySections(summary, numbers);
  }, [pullRequest, summary]);
  if (!summary) return null;
  return (
    <section className="deck-summary" aria-label="Summary">
      <SectionHeading className="deck-summary-heading">Summary</SectionHeading>
      <ProblemView summary={summary} repository={repository} />
      <ChangeKinds kinds={summary.kinds} />
      {sections.map((section) => (
        <div key={section.key} className="deck-summary-section">
          <h3 className="deck-summary-label">{section.heading}</h3>
          <ul className="deck-summary-lines">
            {section.lines.map((entry) => (
              <SummaryLineView
                key={entry.line.id}
                entry={entry}
                onReach={onReach}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
});
