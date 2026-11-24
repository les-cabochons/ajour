import { describe, expect, it } from "vitest";
import type { GuideJobBuilt } from "../../../packages/review-deck/guide-job.ts";
import type { CodeHostLinkedTicket } from "../../../packages/shared/code-host.ts";
import { guideOf, withTickets } from "./deck-summary.ts";

/*
 * A guide's summary from what the guide worker built and the linked
 * tickets (#789). The rules themselves are tested in
 * packages/review-deck/tests/summary.test.ts.
 */

const built: GuideJobBuilt = {
  concerns: [
    {
      id: "g1",
      title: "Stop on 410",
      rationale: "",
      hunkIds: ["src/retry.ts#0"],
      kinds: ["tests"],
    },
  ],
  summary: {
    kinds: ["tests"],
    risks: [],
    tests: [],
    untested: [],
    leftovers: [
      {
        id: "leftover:0",
        text: "TODO in src/retry.ts:1: // TODO: stop on 410",
        hunkIds: ["src/retry.ts#0"],
      },
    ],
  },
};

const ticket: CodeHostLinkedTicket = {
  number: 482,
  repository: "acme/api",
  title: "Retries never stop on 410",
  body: "They should stop.",
  url: "https://github.com/acme/api/issues/482",
  state: "Open",
};

describe("the summary's problem", () => {
  it("is the first linked ticket's title, and lists every ticket without its text", () => {
    const second = { ...ticket, number: 12, title: "Log the retries" };

    const { summary } = guideOf(built, [ticket, second]);

    expect(summary.problem).toEqual({
      text: "Retries never stop on 410",
      source: "ticket",
      ticket: {
        number: 482,
        repository: "acme/api",
        title: "Retries never stop on 410",
        url: "https://github.com/acme/api/issues/482",
        state: "Open",
      },
    });
    expect(summary.tickets?.map((linked) => linked.number)).toEqual([482, 12]);
    expect(JSON.stringify(summary)).not.toContain("They should stop.");
  });

  it("is empty with no linked ticket, and says when the tickets couldn't be read", () => {
    expect(guideOf(built, []).summary).toMatchObject({
      problem: null,
      tickets: [],
    });
    expect(guideOf(built, null).summary).toMatchObject({
      problem: null,
      tickets: null,
    });
  });
});

it("keeps the rules' lines and the concerns' kinds, with no breaking change before the agent's", () => {
  const guide = guideOf(built, []);

  expect(guide.madeWith).toBe("code");
  expect(guide.concerns[0]!.kinds).toEqual(["tests"]);
  expect(guide.summary).toMatchObject({
    kinds: ["tests"],
    breaking: [],
    leftovers: [expect.objectContaining({ id: "leftover:0" })],
  });
});

it("fills in the tickets of a guide whose tickets couldn't be read, keeping the rest", () => {
  const unread = guideOf(built, null);

  const read = withTickets(unread, [ticket]);

  expect(read.summary.problem?.text).toBe("Retries never stop on 410");
  expect(read.summary.tickets).toHaveLength(1);
  expect(read.summary.leftovers).toEqual(unread.summary.leftovers);
  expect(read.concerns).toEqual(unread.concerns);
});

it("keeps a test coverage line for each of as many concerns as a guide holds", () => {
  const concerns = Array.from({ length: 3_000 }, (_, index) => ({
    id: `g${index + 1}`,
    title: `Concern ${index + 1}`,
    rationale: "",
    hunkIds: [`src/${index}.ts#0`],
    kinds: [],
  }));
  const lines = concerns.map((concern) => ({
    id: `untested:${concern.id}`,
    text: `No test for src/${concern.id}.ts`,
    hunkIds: concern.hunkIds,
    concernId: concern.id,
  }));

  const guide = guideOf(
    { concerns, summary: { ...built.summary, tests: lines, untested: lines } },
    [],
  );

  expect(guide.summary.untested).toHaveLength(3_000);
});
