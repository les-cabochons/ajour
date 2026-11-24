import { describe, expect, it } from "vitest";
import type { CodeHostReviewThread } from "@ajour/shared";
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import {
  composerIdentity,
  reviewNotes,
  type ComposerTarget,
} from "./review-notes";
import type { DeckDraftComment } from "./draft-review";

const hunk = (path: string, index: number, header: string, rows: string[]) => {
  const [, oldStart = 0, oldLines = 0, newStart = 0, newLines = 0] =
    /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header)?.map(Number) ?? [];
  return {
    id: `${path}#${index}`,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    patch: [`diff --git a/${path} b/${path}`, header, ...rows, ""].join("\n"),
  };
};

/** Two hunks: rows " a" "-b" "+B" " c" on lines 1 to 3, and " x" "+y" on 40 and 41. */
const DIFF: DeckPullRequestDiff = {
  headSha: "head",
  baseSha: "base",
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts", 0, "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
        hunk("src/api.ts", 1, "@@ -40,1 +40,2 @@", [" x", "+y"]),
      ],
    },
  ],
};

const thread = {
  id: "T1",
  path: "src/api.ts",
  side: "head",
  line: 41,
  resolved: false,
  outdated: false,
  comments: [],
} as unknown as CodeHostReviewThread;

const draft = (id: string, line: number): DeckDraftComment => ({
  id,
  path: "src/api.ts",
  side: "head",
  line,
  body: "Words.",
  lineText: "",
  createdAt: 1,
  updatedAt: 1,
});

const composer: ComposerTarget = {
  path: "src/api.ts",
  side: "head",
  line: 3,
  startLine: 1,
  lineText: "c",
  body: "",
};

describe("the notes at the lines", () => {
  it("puts threads, draft comments and the composer in the diff's order", () => {
    const notes = reviewNotes(
      DIFF,
      [{ thread, hunkId: "src/api.ts#1", side: "additions", line: 41, row: 1 }],
      [
        {
          comment: draft("d1", 2),
          hunkId: "src/api.ts#0",
          side: "additions",
          line: 2,
          row: 2,
        },
      ],
      composer,
    );
    expect(
      notes.map((note) => [note.kind, note.key, note.hunkId, note.row]),
    ).toEqual([
      ["draft", "draft:d1", "src/api.ts#0", 2],
      ["composer", "composer", "src/api.ts#0", 3],
      ["thread", "T1", "src/api.ts#1", 1],
    ]);
    expect(notes[1]).toMatchObject({
      side: "additions",
      line: 3,
      startLine: 1,
    });
  });

  it("leaves out the draft comment the composer edits, and a composer on lines the diff doesn't show", () => {
    const placed = {
      comment: draft("d1", 2),
      hunkId: "src/api.ts#0",
      side: "additions" as const,
      line: 2,
      row: 2,
    };
    expect(
      reviewNotes(DIFF, [], [placed], {
        ...composer,
        line: 2,
        editing: "d1",
      }).map((note) => note.key),
    ).toEqual(["composer"]);
    expect(reviewNotes(DIFF, [], [placed], { ...composer, line: 99 })).toEqual([
      expect.objectContaining({ key: "draft:d1" }),
    ]);
  });

  it("gives other lines, or another comment to edit, a composer of their own", () => {
    expect(composerIdentity(composer)).not.toBe(
      composerIdentity({ ...composer, line: 2 }),
    );
    expect(composerIdentity({ ...composer, editing: "d1" })).not.toBe(
      composerIdentity({ ...composer, editing: "d2" }),
    );
    expect(composerIdentity({ ...composer, body: "typed" })).toBe(
      composerIdentity(composer),
    );
  });
});
