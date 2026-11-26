import { describe, expect, it } from "vitest";
import type { DeckSummary, DeckTicket } from "@ajour/shared/deck";
import {
  changeKindLabel,
  summaryProblem,
  summarySections,
  ticketLabel,
} from "./summary";

const EMPTY: DeckSummary = {
  problem: null,
  tickets: [],
  kinds: [],
  breaking: [],
  risks: [],
  tests: [],
  untested: [],
  leftovers: [],
};

const issue: DeckTicket = {
  number: 482,
  repository: "acme/api",
  title: "Retries never stop on 410",
  url: "https://github.com/acme/api/issues/482",
  state: "Open",
};
const workItem: DeckTicket = {
  number: 1204,
  title: "Rate limits",
  url: "https://dev.azure.com/acme/billing/_workitems/edit/1204",
  state: "Active",
};

describe("a ticket's label", () => {
  it("is its number in the pull request's repository, or a work item's, and names another repository", () => {
    expect(ticketLabel(issue, "acme/api")).toBe("#482");
    expect(ticketLabel({ ...issue, repository: "acme/web" }, "acme/api")).toBe(
      "acme/web#482",
    );
    expect(ticketLabel(workItem, "billing/api")).toBe("#1204");
  });
});

describe("the summary's problem", () => {
  it("is the ticket's, with the other linked tickets after it", () => {
    const other = { ...issue, number: 12, title: "Show the retries" };
    expect(
      summaryProblem({
        ...EMPTY,
        problem: { text: issue.title, source: "ticket", ticket: issue },
        tickets: [issue, other],
      }),
    ).toEqual({
      kind: "ticket",
      text: "Retries never stop on 410",
      ticket: issue,
      others: [other],
    });
  });

  it("says when no ticket is linked, and when the tickets couldn't be read", () => {
    expect(summaryProblem(EMPTY)).toEqual({ kind: "none" });
    expect(summaryProblem({ ...EMPTY, tickets: null })).toEqual({
      kind: "unread",
    });
  });

  it("is labelled inferred when the agent wrote it without a ticket", () => {
    expect(
      summaryProblem({
        ...EMPTY,
        problem: { text: "Retries looped forever.", source: "inferred" },
      }),
    ).toEqual({ kind: "inferred", text: "Retries looped forever." });
  });
});

describe("the summary's sections", () => {
  const line = (id: string, concernId?: string) => ({
    id,
    text: id,
    hunkIds: [`${id}#0`],
    ...(concernId ? { concernId } : {}),
  });

  it("go breaking changes, risky areas, tests by concern, then leftovers, leaving out empty ones", () => {
    const sections = summarySections(
      {
        ...EMPTY,
        risks: [line("risk:auth")],
        tests: [line("tests:g2", "g2")],
        untested: [line("untested:g1", "g1"), line("untested:gone", "gone")],
        leftovers: [line("leftover:0")],
      },
      new Map([
        ["g1", 1],
        ["g2", 2],
      ]),
    );
    expect(
      sections.map((section) => ({
        heading: section.heading,
        lines: section.lines.map((entry) => [entry.line.id, entry.concern]),
      })),
    ).toEqual([
      { heading: "Risky areas", lines: [["risk:auth", undefined]] },
      {
        heading: "Tests",
        lines: [
          ["untested:g1", 1],
          ["tests:g2", 2],
          ["untested:gone", undefined],
        ],
      },
      { heading: "Leftovers", lines: [["leftover:0", undefined]] },
    ]);
    expect(summarySections(EMPTY, new Map())).toEqual([]);
  });
});

it("names each kind of change as the page shows it", () => {
  expect(changeKindLabel("dependencies")).toBe("Dependencies");
  expect(changeKindLabel("docs")).toBe("Docs");
});
