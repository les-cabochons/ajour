import { describe, expect, it } from "vitest";
import type { CodeHostReviewThread } from "@ajour/shared";
import type { DeckFile, DeckPullRequestDiff } from "@ajour/shared/deck";
import { conversationEntries, placeThreads } from "./review-threads";

/** A hunk as the local API sends it: its patch is its file's header, the `@@` line and its rows. */
function hunk(path: string, index: number, header: string, rows: string[]) {
  const [, oldStart = 0, oldLines = 0, newStart = 0, newLines = 0] =
    /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header)?.map(Number) ?? [];
  return {
    id: `${path}#${index}`,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      header,
      ...rows,
      "",
    ].join("\n"),
  };
}

const file = (
  path: string,
  hunks: DeckFile["hunks"],
  extra = {},
): DeckFile => ({
  path,
  status: "modified",
  binary: false,
  hunks,
  ...extra,
});

const DIFF: DeckPullRequestDiff = {
  headSha: "head",
  baseSha: "base",
  files: [
    file("src/api.ts", [
      // Rows: 0 " a" (1,1), 1 "-b" (2,-), 2 "+B" (-,2), 3 " c" (3,3).
      hunk("src/api.ts", 0, "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
      // Rows: 0 " x" (40,40), 1 "+y" (-,41), 2 " z" (41,42).
      hunk("src/api.ts", 1, "@@ -40,2 +40,3 @@", [" x", "+y", " z"]),
    ]),
    file("src/new.ts", [hunk("src/new.ts", 0, "@@ -0,0 +1,1 @@", ["+a"])], {
      previousPath: "src/old.ts",
      status: "renamed",
    }),
  ],
};

const thread = (
  id: string,
  overrides: Partial<CodeHostReviewThread> = {},
): CodeHostReviewThread => ({
  id,
  path: "src/api.ts",
  side: "head",
  line: 2,
  resolved: false,
  outdated: false,
  comments: [
    {
      id: `${id}-1`,
      author: { login: "alice", isBot: false },
      body: "Why?",
      createdAt: 10,
    },
  ],
  ...overrides,
});

describe("placing review threads on the diff", () => {
  it("puts each thread after its line, on the side it names, with the row it's on", () => {
    const placement = placeThreads(DIFF, [
      thread("head-line", { line: 2 }),
      thread("base-line", { side: "base", line: 2 }),
      thread("context", { line: 42 }),
      thread("range", { line: 41, startLine: 40 }),
    ]);

    expect(
      placement.placed.map((entry) => [
        entry.thread.id,
        entry.hunkId,
        entry.side,
        entry.line,
        entry.row,
      ]),
    ).toEqual([
      ["base-line", "src/api.ts#0", "deletions", 2, 1],
      ["head-line", "src/api.ts#0", "additions", 2, 2],
      ["range", "src/api.ts#1", "additions", 41, 1],
      ["context", "src/api.ts#1", "additions", 42, 2],
    ]);
    expect(placement.elsewhere).toEqual([]);
  });

  it("keeps a thread the diff can't show for the conversation", () => {
    const placement = placeThreads(DIFF, [
      thread("outdated", { line: undefined, outdated: true }),
      thread("between hunks", { line: 20 }),
      thread("other file", { path: "README.md" }),
      thread("old name", { path: "src/old.ts", side: "base", line: 1 }),
    ]);

    expect(placement.placed).toEqual([]);
    expect(placement.elsewhere.map((entry) => entry.id)).toEqual([
      "outdated",
      "between hunks",
      "other file",
      "old name",
    ]);
  });

  it("finds a renamed file's thread on the head by its new path", () => {
    const placement = placeThreads(DIFF, [
      thread("renamed", { path: "src/new.ts", line: 1 }),
    ]);

    expect(placement.placed.map((entry) => [entry.hunkId, entry.row])).toEqual([
      ["src/new.ts#0", 0],
    ]);
  });
});

describe("the conversation at the end", () => {
  it("puts the timeline and the threads the diff can't show in time order", () => {
    const entries = conversationEntries(
      [
        {
          kind: "event",
          id: "opened",
          text: "opened this pull request",
          createdAt: 1,
        },
        {
          kind: "comment",
          id: "c",
          author: { login: "bob", isBot: false },
          body: "Ready",
          createdAt: 30,
        },
      ],
      [
        thread("t", {
          comments: [
            {
              id: "t-1",
              author: { login: "a", isBot: false },
              body: "x",
              createdAt: 20,
            },
          ],
        }),
      ],
    );

    expect(entries.map((entry) => entry.key)).toEqual([
      "event:opened",
      "thread:t",
      "comment:c",
    ]);
  });
});
