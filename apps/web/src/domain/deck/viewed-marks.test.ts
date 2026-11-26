import { describe, expect, it } from "vitest";
import type { DeckFile, DeckPullRequestDiff } from "@ajour/shared/deck";
import {
  adoptViewedFiles,
  forgetViewedMarks,
  normalizeViewedMarks,
  refreshViewedMarks,
  setHunksViewed,
  viewedHunks,
  viewedMarksOf,
  type DeckViewedMarks,
} from "./viewed-marks";
import type { DeckReviewRef } from "./draft-review";

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

const file = (path: string, hunks: DeckFile["hunks"]): DeckFile => ({
  path,
  status: "modified",
  binary: false,
  hunks,
});

const REF: DeckReviewRef = {
  pluginId: "github",
  connectionId: "connection-1",
  repository: "acme/api",
  number: 7,
};
const OTHER: DeckReviewRef = { ...REF, number: 8 };

/** v1: api.ts has two hunks, readme.md one. */
const V1: DeckPullRequestDiff = {
  headSha: "head-1",
  baseSha: "base-1",
  files: [
    file("src/api.ts", [
      hunk("src/api.ts", 0, "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
      hunk("src/api.ts", 1, "@@ -20,3 +20,3 @@", [" x", "-y", "+Y", " z"]),
    ]),
    file("readme.md", [
      hunk("readme.md", 0, "@@ -1,1 +1,2 @@", [" # API", "+More."]),
    ]),
  ],
};

/**
 * v2, after a rebase: a new hunk comes first in api.ts, so the old ones
 * shift to #1 and #2 and further down; the second one changed (Y became
 * Why); readme.md is untouched.
 */
const V2: DeckPullRequestDiff = {
  headSha: "head-2",
  baseSha: "base-2",
  files: [
    file("src/api.ts", [
      hunk("src/api.ts", 0, "@@ -1,2 +1,3 @@", [" top", "+inserted", " a"]),
      hunk("src/api.ts", 1, "@@ -5,3 +6,3 @@", [" a", "-b", "+B", " c"]),
      hunk("src/api.ts", 2, "@@ -30,3 +31,3 @@", [" x", "-y", "+Why", " z"]),
    ]),
    file("readme.md", [
      hunk("readme.md", 0, "@@ -1,1 +1,2 @@", [" # API", "+More."]),
    ]),
  ],
};

const NOW = 1_000;

function viewedAt(
  marks: readonly DeckViewedMarks[],
  diff: DeckPullRequestDiff,
  ref = REF,
) {
  return [...viewedHunks(viewedMarksOf(marks, ref), diff)].sort();
}

describe("viewed marks", () => {
  it("marks and unmarks hunks of one pull request", () => {
    const { marks } = setHunksViewed([], REF, V1, ["src/api.ts#0"], true, NOW);
    expect(viewedAt(marks, V1)).toEqual(["src/api.ts#0"]);
    expect(viewedAt(marks, V1, OTHER)).toEqual([]);

    const { marks: none } = setHunksViewed(
      marks,
      REF,
      V1,
      ["src/api.ts#0"],
      false,
      NOW,
    );
    // The last mark gone, the pull request keeps nothing.
    expect(none).toEqual([]);
  });

  it("says which files became viewed or not, so the code host can follow", () => {
    const first = setHunksViewed([], REF, V1, ["src/api.ts#0"], true, NOW);
    expect(first.files).toEqual([]);
    const second = setHunksViewed(
      first.marks,
      REF,
      V1,
      ["src/api.ts#1", "readme.md#0"],
      true,
      NOW,
    );
    expect(second.files).toEqual([
      { path: "src/api.ts", viewed: true },
      { path: "readme.md", viewed: true },
    ]);
    const third = setHunksViewed(
      second.marks,
      REF,
      V1,
      ["src/api.ts#0"],
      false,
      NOW,
    );
    expect(third.files).toEqual([{ path: "src/api.ts", viewed: false }]);
    // Marking what's already marked changes nothing.
    const again = setHunksViewed(
      second.marks,
      REF,
      V1,
      ["readme.md#0"],
      true,
      NOW,
    );
    expect(again.marks).toBe(second.marks);
    expect(again.files).toEqual([]);
  });

  it("keeps the marks of unchanged hunks after a refresh, wherever they moved, and clears the changed ones", () => {
    const { marks } = setHunksViewed(
      [],
      REF,
      V1,
      ["src/api.ts#0", "src/api.ts#1", "readme.md#0"],
      true,
      NOW,
    );
    const refreshed = refreshViewedMarks(marks, REF, V2, NOW + 1);
    expect(refreshed.cleared).toBe(1);
    expect(viewedAt(refreshed.marks, V2)).toEqual([
      "readme.md#0",
      "src/api.ts#1",
    ]);
    expect(viewedMarksOf(refreshed.marks, REF)?.headSha).toBe("head-2");
    // The same head again changes nothing.
    const same = refreshViewedMarks(refreshed.marks, REF, V2, NOW + 2);
    expect(same.marks).toBe(refreshed.marks);
    expect(same.cleared).toBe(0);
  });

  it("doesn't bring back a cleared mark when a later push restores the hunk", () => {
    const { marks } = setHunksViewed([], REF, V1, ["src/api.ts#1"], true, NOW);
    const atV2 = refreshViewedMarks(marks, REF, V2, NOW).marks;
    const back = refreshViewedMarks(
      atV2,
      REF,
      { ...V1, headSha: "head-3" },
      NOW,
    ).marks;
    expect(viewedAt(back, { ...V1, headSha: "head-3" })).toEqual([]);
  });

  it("refreshes marks made at another head before changing them", () => {
    const { marks } = setHunksViewed([], REF, V1, ["src/api.ts#1"], true, NOW);
    // Marking on v2 without a refresh first still clears the changed hunk.
    const { marks: after, files } = setHunksViewed(
      marks,
      REF,
      V2,
      ["readme.md#0"],
      true,
      NOW,
    );
    expect(viewedAt(after, V2)).toEqual(["readme.md#0"]);
    expect(files).toEqual([{ path: "readme.md", viewed: true }]);
  });

  it("tells copies of the same change in a file apart", () => {
    const twice: DeckPullRequestDiff = {
      headSha: "head-1",
      baseSha: "base-1",
      files: [
        file("src/a.ts", [
          hunk("src/a.ts", 0, "@@ -1,1 +1,1 @@", ["-old", "+new"]),
          hunk("src/a.ts", 1, "@@ -9,1 +9,1 @@", ["-old", "+new"]),
        ]),
      ],
    };
    const { marks } = setHunksViewed([], REF, twice, ["src/a.ts#1"], true, NOW);
    expect(viewedAt(marks, twice)).toEqual(["src/a.ts#1"]);
  });

  it("counts line endings and a missing final newline as changes", () => {
    const lf: DeckPullRequestDiff = {
      headSha: "head-1",
      baseSha: "base-1",
      files: [
        file("a.txt", [hunk("a.txt", 0, "@@ -1,1 +1,1 @@", ["-a", "+b"])]),
      ],
    };
    const crlf: DeckPullRequestDiff = {
      headSha: "head-2",
      baseSha: "base-1",
      files: [
        file("a.txt", [hunk("a.txt", 0, "@@ -1,1 +1,1 @@", ["-a", "+b\r"])]),
      ],
    };
    const noNewline: DeckPullRequestDiff = {
      headSha: "head-3",
      baseSha: "base-1",
      files: [
        file("a.txt", [
          hunk("a.txt", 0, "@@ -1,1 +1,1 @@", [
            "-a",
            "+b",
            "\\ No newline at end of file",
          ]),
        ]),
      ],
    };
    const { marks } = setHunksViewed([], REF, lf, ["a.txt#0"], true, NOW);
    expect(
      viewedAt(refreshViewedMarks(marks, REF, crlf, NOW).marks, crlf),
    ).toEqual([]);
    expect(
      viewedAt(refreshViewedMarks(marks, REF, noNewline, NOW).marks, noNewline),
    ).toEqual([]);
  });

  it("takes in the files the code host says the user viewed", () => {
    const adopted = adoptViewedFiles(
      [],
      REF,
      V1,
      ["src/api.ts", "gone.ts"],
      NOW,
    );
    expect(viewedAt(adopted, V1)).toEqual(["src/api.ts#0", "src/api.ts#1"]);
    // Nothing new to take changes nothing.
    expect(adoptViewedFiles(adopted, REF, V1, ["src/api.ts"], NOW)).toBe(
      adopted,
    );
    expect(adoptViewedFiles([], REF, V1, [], NOW)).toEqual([]);
  });

  it("forgets the marks of pull requests that left", () => {
    const one = setHunksViewed([], REF, V1, ["readme.md#0"], true, NOW).marks;
    const both = setHunksViewed(
      one,
      OTHER,
      V1,
      ["readme.md#0"],
      true,
      NOW,
    ).marks;
    const kept = forgetViewedMarks(both, (ref) => ref.number === 8);
    expect(kept.map((entry) => entry.number)).toEqual([8]);
    expect(forgetViewedMarks(kept, () => true)).toBe(kept);
  });

  it("reads back what it stored, and drops what it can't read", () => {
    const { marks } = setHunksViewed([], REF, V1, ["readme.md#0"], true, NOW);
    const stored = JSON.parse(JSON.stringify(marks)) as unknown;
    expect(normalizeViewedMarks(stored)).toEqual(marks);
    expect(normalizeViewedMarks([{ pluginId: "github" }, 3])).toEqual([]);
    expect(normalizeViewedMarks(undefined)).toEqual([]);
  });
});
