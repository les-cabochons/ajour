import { describe, expect, it } from "vitest";
import type { DeckFile, DeckHunk } from "@ajour/shared/deck";
import { fileWithoutLines, hunkLabel, hunkPatch } from "./review-diff";

const hunk = (overrides: Partial<DeckHunk> = {}): DeckHunk => ({
  id: "src/api.ts#0",
  header: "@@ -1,3 +1,3 @@",
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  lines: [" a", "-b", "+B", " c"],
  ...overrides,
});

const file = (overrides: Partial<DeckFile> = {}): DeckFile => ({
  path: "src/api.ts",
  status: "modified",
  binary: false,
  hunks: [hunk()],
  ...overrides,
});

describe("hunkPatch", () => {
  it("writes one hunk as a unified diff of its file", () => {
    expect(hunkPatch(file(), hunk())).toBe(
      [
        "--- a/src/api.ts",
        "+++ b/src/api.ts",
        "@@ -1,3 +1,3 @@",
        " a",
        "-b",
        "+B",
        " c",
        "",
      ].join("\n"),
    );
  });

  it("names a renamed file's old path, and no side for an added or deleted one", () => {
    expect(
      hunkPatch(
        file({
          path: "src/moved.ts",
          previousPath: "src/before.ts",
          status: "renamed",
        }),
        hunk(),
      )
        .split("\n")
        .slice(0, 2),
    ).toEqual(["--- a/src/before.ts", "+++ b/src/moved.ts"]);
    expect(
      hunkPatch(file({ status: "added" }), hunk())
        .split("\n")
        .slice(0, 2),
    ).toEqual(["--- /dev/null", "+++ b/src/api.ts"]);
    expect(
      hunkPatch(file({ status: "deleted" }), hunk())
        .split("\n")
        .slice(0, 2),
    ).toEqual(["--- a/src/api.ts", "+++ /dev/null"]);
  });
});

describe("fileWithoutLines", () => {
  it("says why a file shows no lines", () => {
    const pseudo = hunk({
      header: "",
      lines: [],
      oldStart: 0,
      oldLines: 0,
      newStart: 0,
      newLines: 0,
    });
    expect(fileWithoutLines(file({ binary: true, hunks: [pseudo] }))).toBe(
      "Binary file not shown.",
    );
    expect(
      fileWithoutLines(
        file({
          status: "renamed",
          previousPath: "src/before.ts",
          hunks: [pseudo],
        }),
      ),
    ).toBe("Renamed without changes.");
    expect(fileWithoutLines(file({ status: "added", hunks: [pseudo] }))).toBe(
      "Empty file.",
    );
    expect(fileWithoutLines(file({ hunks: [pseudo] }))).toBe(
      "No changes to show.",
    );
  });

  it("is undefined for a file with lines", () => {
    expect(fileWithoutLines(file())).toBeUndefined();
  });
});

describe("hunkLabel", () => {
  it("names the hunk's file and its lines in the head", () => {
    expect(hunkLabel(file(), hunk({ newStart: 40, newLines: 3 }))).toBe(
      "src/api.ts, lines 40 to 42",
    );
    expect(hunkLabel(file(), hunk({ newStart: 7, newLines: 1 }))).toBe(
      "src/api.ts, line 7",
    );
  });

  it("names the base's lines of a hunk that only removes", () => {
    expect(
      hunkLabel(
        file(),
        hunk({ oldStart: 5, oldLines: 2, newStart: 4, newLines: 0 }),
      ),
    ).toBe("src/api.ts, removed lines 5 to 6");
  });
});
