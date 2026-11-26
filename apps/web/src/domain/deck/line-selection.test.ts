import { describe, expect, it } from "vitest";
import type { DeckHunk, DeckPullRequestDiff } from "@ajour/shared/deck";
import {
  citationAt,
  commentLines,
  extendByTap,
  linesAnchor,
  linkCitations,
  selectLines,
} from "./line-selection";

/*
 * Lines selected in a hunk of Deck's review page (#793): a drag, Shift and
 * the keyboard, or two taps on line numbers pick them; Explain and Ask send
 * them as the ask's anchor, Comment opens the composer on one side's lines,
 * and an answer's `path:line` citations go back to them.
 */

const HUNK: DeckHunk = {
  id: "src/api.ts#0",
  header: "@@ -1,4 +1,4 @@",
  oldStart: 1,
  oldLines: 4,
  newStart: 1,
  newLines: 4,
  // Rows: one (1/1), -two (base 2), +TWO (head 2), three (3/3), -four (base 4), +FOUR (head 4).
  patch: [
    "diff --git a/src/api.ts b/src/api.ts",
    "--- a/src/api.ts",
    "+++ b/src/api.ts",
    "@@ -1,4 +1,4 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "-four",
    "+FOUR",
    "",
  ].join("\n"),
};

const DIFF: DeckPullRequestDiff = {
  headSha: "a41c9e2",
  baseSha: "b52d0f3",
  files: [
    { path: "src/api.ts", status: "modified", binary: false, hunks: [HUNK] },
  ],
};

type Point = { side: "additions" | "deletions"; line: number };
const head = (line: number): Point => ({ side: "additions", line });
const base = (line: number): Point => ({ side: "deletions", line });

describe("selecting lines", () => {
  it("orders a drag that went up, by the hunk's rows", () => {
    expect(
      selectLines(DIFF, "src/api.ts#0", {
        start: 3,
        side: "additions",
        end: 2,
        endSide: "deletions",
      }),
    ).toEqual({
      hunkId: "src/api.ts#0",
      path: "src/api.ts",
      start: base(2),
      end: head(3),
    });
  });

  it("keeps no selection for lines the hunk doesn't show", () => {
    expect(
      selectLines(DIFF, "src/api.ts#0", {
        start: 9,
        side: "additions",
        end: 9,
      }),
    ).toBeUndefined();
    expect(
      selectLines(DIFF, "nowhere#0", { start: 1, side: "additions", end: 1 }),
    ).toBeUndefined();
  });

  it("extends one tapped line to a second one tapped in the same hunk", () => {
    const first = selectLines(DIFF, "src/api.ts#0", {
      start: 3,
      side: "additions",
      end: 3,
    })!;
    const second = selectLines(DIFF, "src/api.ts#0", {
      start: 1,
      side: "additions",
      end: 1,
    })!;

    expect(extendByTap(DIFF, first, second)).toEqual({
      ...first,
      start: head(1),
      end: head(3),
    });
  });

  it("starts again on a tap after several lines, in another hunk, or on the same line", () => {
    const one = selectLines(DIFF, "src/api.ts#0", {
      start: 1,
      side: "additions",
      end: 1,
    })!;
    const several = selectLines(DIFF, "src/api.ts#0", {
      start: 1,
      side: "additions",
      end: 3,
    })!;
    const elsewhere = {
      ...one,
      hunkId: "src/other.ts#0",
      path: "src/other.ts",
    };

    expect(extendByTap(DIFF, several, one)).toBe(one);
    expect(extendByTap(DIFF, elsewhere, one)).toBe(one);
    expect(extendByTap(DIFF, undefined, one)).toBe(one);
    expect(extendByTap(DIFF, one, one)).toBe(one);
  });
});

describe("what selected lines become", () => {
  it("is an ask anchor on the base's and the head's lines", () => {
    expect(
      linesAnchor({
        hunkId: "src/api.ts#0",
        path: "src/api.ts",
        start: base(2),
        end: head(3),
      }),
    ).toEqual({
      kind: "lines",
      path: "src/api.ts",
      start: { side: "base", line: 2 },
      end: { side: "head", line: 3 },
    });
  });

  it("comments on the last line's side, from the first selected line that side has", () => {
    const selection = (start: Point, end: Point) => ({
      hunkId: "src/api.ts#0",
      path: "src/api.ts",
      start,
      end,
    });

    expect(commentLines(DIFF, selection(base(2), head(3)))).toEqual({
      side: "additions",
      start: 2,
      end: 3,
    });
    expect(commentLines(DIFF, selection(head(1), base(2)))).toEqual({
      side: "deletions",
      start: 1,
      end: 2,
    });
    expect(commentLines(DIFF, selection(head(3), head(3)))).toEqual({
      side: "additions",
      start: 3,
      end: 3,
    });
  });
});

describe("citations in an answer", () => {
  it("links the diff's paths with a line, in code or in the text, and leaves the rest", () => {
    const text = [
      "See `src/api.ts:2` and src/api.ts:3-4.",
      "Not `src/gone.ts:2`, nor api.ts:2.",
      "```ts",
      "src/api.ts:2",
      "```",
    ].join("\n");

    expect(linkCitations(text, ["src/api.ts"])).toBe(
      [
        "See [`src/api.ts:2`](citation:src/api.ts:2) and [src/api.ts:3-4](citation:src/api.ts:3-4).",
        "Not `src/gone.ts:2`, nor api.ts:2.",
        "```ts",
        "src/api.ts:2",
        "```",
      ].join("\n"),
    );
  });

  it("finds a citation's first line on the diff, the head's first", () => {
    expect(citationAt(DIFF, "citation:src/api.ts:3-4")).toEqual({
      hunkId: "src/api.ts#0",
      side: "additions",
      line: 3,
      row: 3,
    });
    expect(citationAt(DIFF, "citation:src/api.ts:9")).toBeUndefined();
    expect(citationAt(DIFF, "https://example.com")).toBeUndefined();
  });
});
