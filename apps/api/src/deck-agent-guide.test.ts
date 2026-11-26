import { describe, expect, it } from "vitest";
import type {
  DeckGuide,
  DeckPullRequestDiff,
  DeckSubmitGuideInput,
  DeckTicket,
} from "../../../packages/shared/deck.ts";
import {
  agentGuideOf,
  groupedConcernsOf,
  submittedGuideProblem,
} from "./deck-agent-guide.ts";

/*
 * The rules a guide run's `submit_guide` keeps (#794, from #597): every
 * hunk exactly once and no unknown id, 1 to 40 concerns, a title of 80
 * characters or fewer, a rationale and each summary text of 300 or fewer,
 * and a problem written from the linked ticket when there is one. Each
 * refusal is a sentence the agent can act on.
 */

const hunk = (id: string) => ({
  id,
  header: "@@ -1,1 +1,1 @@",
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  patch: "",
});

const diff: DeckPullRequestDiff = {
  headSha: "a41c9e2",
  baseSha: "b52d0f3",
  files: [
    {
      path: "src/api.test.ts",
      status: "added",
      binary: false,
      hunks: [hunk("src/api.test.ts#0")],
    },
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [hunk("src/api.ts#0"), hunk("src/api.ts#1")],
    },
  ],
};

const ticket: DeckTicket = {
  number: 12,
  title: "Retries hammer the billing API",
  url: "https://github.com/acme/billing-api/issues/12",
  state: "Open",
};

/** A submission that keeps every rule, with no ticket linked. */
const valid = (): DeckSubmitGuideInput => ({
  concerns: [
    {
      title: "Back off between retries",
      rationale: "The client waits longer after each failure.",
      hunkIds: ["src/api.ts#1", "src/api.ts#0"],
      kinds: ["fix"],
    },
    {
      title: "Test the backoff",
      rationale: "",
      hunkIds: ["src/api.test.ts#0"],
      kinds: [],
    },
  ],
  summary: {
    problem: { text: "Retries hammer the API.", source: "inferred" },
    breaking: [],
    risks: [],
  },
});

const check = (
  change: (input: DeckSubmitGuideInput) => void,
  tickets: DeckTicket[] | null = [],
) => {
  const input = valid();
  change(input);
  return submittedGuideProblem(input, diff, tickets);
};

describe("submit_guide's rules", () => {
  it("accepts a guide that keeps every rule", () => {
    expect(check(() => {})).toBeUndefined();
    expect(
      check(
        (input) => {
          input.summary.problem = {
            text: "Retries hammer the API.",
            source: "ticket",
            ticket: { number: 12 },
          };
        },
        [ticket],
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      "no concern",
      (input: DeckSubmitGuideInput) => {
        input.concerns = [];
      },
      "A guide has 1 to 40 concerns; this one has 0.",
    ],
    [
      "41 concerns",
      (input: DeckSubmitGuideInput) => {
        input.concerns = Array.from({ length: 41 }, (_, index) => ({
          title: `Concern ${index}`,
          rationale: "",
          hunkIds: ["src/api.ts#0"],
          kinds: [],
        }));
      },
      "A guide has 1 to 40 concerns; this one has 41.",
    ],
    [
      "a title of 81 characters",
      (input: DeckSubmitGuideInput) => {
        input.concerns[1]!.title = "t".repeat(81);
      },
      "Concern 2's title has 81 characters; a title has 80 or fewer.",
    ],
    [
      "an empty title",
      (input: DeckSubmitGuideInput) => {
        input.concerns[0]!.title = "  ";
      },
      "Concern 1's title is empty.",
    ],
    [
      "a rationale of 301 characters",
      (input: DeckSubmitGuideInput) => {
        input.concerns[0]!.rationale = "r".repeat(301);
      },
      "Concern 1's rationale has 301 characters; a rationale has 300 or fewer.",
    ],
    [
      "a concern with no hunk",
      (input: DeckSubmitGuideInput) => {
        input.concerns.push({
          title: "Empty",
          rationale: "",
          hunkIds: [],
          kinds: [],
        });
      },
      "Concern 3 has no hunks.",
    ],
    [
      "an unknown hunk id",
      (input: DeckSubmitGuideInput) => {
        input.concerns[1]!.hunkIds.push("src/gone.ts#0");
      },
      "The diff has no hunks src/gone.ts#0. Use the ids the guide lists.",
    ],
    [
      "a hunk in two concerns",
      (input: DeckSubmitGuideInput) => {
        input.concerns[1]!.hunkIds.push("src/api.ts#0");
      },
      "Hunks src/api.ts#0 are in more than one concern. Put each hunk in exactly one.",
    ],
    [
      "a hunk in no concern",
      (input: DeckSubmitGuideInput) => {
        input.concerns[0]!.hunkIds = ["src/api.ts#0"];
      },
      "Hunks src/api.ts#1 are in no concern. Put each hunk in exactly one.",
    ],
    [
      "a problem of 301 characters",
      (input: DeckSubmitGuideInput) => {
        input.summary.problem.text = "p".repeat(301);
      },
      "The problem has 301 characters; each summary text has 300 or fewer.",
    ],
    [
      "a breaking change of 301 characters",
      (input: DeckSubmitGuideInput) => {
        input.summary.breaking = [
          { text: "b".repeat(301), hunkIds: ["src/api.ts#0"] },
        ];
      },
      "Breaking change 1 has 301 characters; each summary text has 300 or fewer.",
    ],
    [
      "a risky area of 301 characters",
      (input: DeckSubmitGuideInput) => {
        input.summary.risks = [
          { text: "r".repeat(301), hunkIds: ["src/api.ts#0"] },
        ];
      },
      "Risky area 1 has 301 characters; each summary text has 300 or fewer.",
    ],
    [
      "a risky area on an unknown hunk",
      (input: DeckSubmitGuideInput) => {
        input.summary.risks = [{ text: "Locks", hunkIds: ["src/gone.ts#2"] }];
      },
      "Risky area 1 names hunks the diff doesn't have: src/gone.ts#2.",
    ],
    [
      "a breaking change on no hunk",
      (input: DeckSubmitGuideInput) => {
        input.summary.breaking = [{ text: "The route moved", hunkIds: [] }];
      },
      "Breaking change 1 names no hunk.",
    ],
    [
      "a problem from a ticket when none is linked",
      (input: DeckSubmitGuideInput) => {
        input.summary.problem.source = "ticket";
      },
      'No ticket is linked to this pull request: infer the problem from the code, with source "inferred".',
    ],
  ])("refuses %s, saying what to fix", (_, change, problem) => {
    expect(check(change)).toBe(problem);
  });

  it("refuses an inferred problem, or another ticket, when a ticket is linked", () => {
    expect(check(() => {}, [ticket])).toBe(
      'This pull request is linked to #12: write the problem from the ticket, with source "ticket".',
    );
    expect(
      check(
        (input) => {
          input.summary.problem = {
            text: "Retries.",
            source: "ticket",
            ticket: { number: 9 },
          };
        },
        [ticket],
      ),
    ).toBe("#9 isn't linked to this pull request. Its linked tickets: #12.");
  });

  it("names five ids and counts the rest", () => {
    const many: DeckPullRequestDiff = {
      ...diff,
      files: [
        {
          path: "a.ts",
          status: "added",
          binary: false,
          hunks: Array.from({ length: 8 }, (_, index) => hunk(`a.ts#${index}`)),
        },
      ],
    };
    const input = valid();
    input.concerns = [
      { title: "One", rationale: "", hunkIds: ["a.ts#0"], kinds: [] },
    ];

    expect(submittedGuideProblem(input, many, [])).toBe(
      "Hunks a.ts#1, a.ts#2, a.ts#3, a.ts#4, a.ts#5 and 2 more are in no concern. Put each hunk in exactly one.",
    );
  });
});

describe("the agent's guide", () => {
  const built: DeckGuide = {
    madeWith: "code",
    concerns: [],
    summary: {
      problem: { text: ticket.title, source: "ticket", ticket },
      tickets: [ticket],
      kinds: [],
      breaking: [],
      risks: [],
      tests: [],
      untested: [],
      leftovers: [],
    },
  };

  it("merges the agent's kinds with the rules', and marks a breaking change's concern Breaking", () => {
    const input = valid();
    input.summary.problem = {
      text: "Retries hammer the API.",
      source: "ticket",
      ticket: { number: 12 },
    };
    input.summary.breaking = [
      { text: "The retry option is renamed", hunkIds: ["src/api.ts#1"] },
    ];
    const concerns = groupedConcernsOf(input);
    const [first, second] = concerns;

    const guide = agentGuideOf({
      input,
      built,
      rules: {
        concerns: [
          { ...first!, kinds: [] },
          { ...second!, kinds: ["tests"] },
        ],
        summary: {
          kinds: ["tests"],
          risks: [],
          tests: [
            {
              id: `tests:${second!.id}`,
              text: "Tested in src/api.test.ts",
              hunkIds: ["src/api.test.ts#0"],
              concernId: second!.id,
            },
          ],
          untested: [],
          leftovers: [],
        },
      },
      diff,
      provider: { cli: "claude-code", label: "Claude Code" },
    });

    expect(guide).toMatchObject({
      madeWith: "agent",
      provider: { cli: "claude-code", label: "Claude Code" },
      concerns: [
        { title: "Back off between retries", kinds: ["breaking", "fix"] },
        { title: "Test the backoff", kinds: ["tests"] },
      ],
      summary: {
        problem: { text: "Retries hammer the API.", source: "ticket", ticket },
        tickets: [ticket],
        kinds: ["breaking", "fix", "tests"],
        breaking: [
          {
            text: "The retry option is renamed",
            hunkIds: ["src/api.ts#1"],
          },
        ],
        tests: [{ concernId: second!.id }],
      },
    });
    // A concern keeps its id from one regroup to the next.
    expect(groupedConcernsOf(valid()).map((concern) => concern.id)).toEqual(
      concerns.map((concern) => concern.id),
    );
  });
});
