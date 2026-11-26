import type { GuideJobBuilt } from "../../../packages/review-deck/guide-job.ts";
import type { CodeHostLinkedTicket } from "../../../packages/shared/code-host.ts";
import {
  deckGuideSchema,
  type DeckGuide,
  type DeckSummary,
  type DeckTicket,
} from "../../../packages/shared/deck.ts";

/*
 * A pull request's guide with its summary (#789, from #662). The guide
 * worker builds the concerns and the summary's rule-based lines
 * (`packages/review-deck/summary.ts`); the local API adds the tickets the
 * pull request is linked to, the first one's title as the problem. The
 * agent's guide run fills the rest later (#794), in the same fields.
 */

/** A linked ticket as the page shows it: never its text. */
export const ticketOf = (ticket: CodeHostLinkedTicket): DeckTicket => ({
  number: ticket.number,
  ...(ticket.repository ? { repository: ticket.repository } : {}),
  title: ticket.title,
  url: ticket.url,
  state: ticket.state,
});

/** The problem and the tickets, from the linked tickets, or null when they couldn't be read. */
function ticketFields(
  tickets: readonly CodeHostLinkedTicket[] | null,
): Pick<DeckSummary, "problem" | "tickets"> {
  const first = tickets?.[0];
  return {
    problem: first
      ? { text: first.title, source: "ticket", ticket: ticketOf(first) }
      : null,
    tickets: tickets ? tickets.map(ticketOf) : null,
  };
}

/** The guide from what the worker built and the linked tickets, within the wire's limits. */
export function guideOf(
  built: GuideJobBuilt,
  tickets: readonly CodeHostLinkedTicket[] | null,
): DeckGuide {
  return deckGuideSchema.parse({
    madeWith: "code",
    concerns: built.concerns,
    summary: { ...ticketFields(tickets), breaking: [], ...built.summary },
  });
}

/** A guide whose tickets couldn't be read, with the tickets read since. */
export function withTickets(
  guide: DeckGuide,
  tickets: readonly CodeHostLinkedTicket[],
): DeckGuide {
  return deckGuideSchema.parse({
    ...guide,
    summary: { ...guide.summary, ...ticketFields(tickets) },
  });
}
