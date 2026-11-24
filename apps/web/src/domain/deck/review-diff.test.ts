import { describe, expect, it } from "vitest";
import type { DeckFile, DeckHunk } from "@ajour/shared/deck";
import {
  fileNote,
  fileWithoutLines,
  hunkLabel,
  hunkRowCount,
} from "./review-diff";

const hunk = (overrides: Partial<DeckHunk> = {}): DeckHunk => ({
  id: "src/api.ts#0",
  header: "@@ -1,3 +1,3 @@",
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  patch: [
    "diff --git a/src/api.ts b/src/api.ts",
    "--- a/src/api.ts",
    "+++ b/src/api.ts",
    "@@ -1,3 +1,3 @@",
    " a",
    "-b",
    "+B",
    " c",
    "",
  ].join("\n"),
  ...overrides,
});

const file = (overrides: Partial<DeckFile> = {}): DeckFile => ({
  path: "src/api.ts",
  status: "modified",
  binary: false,
  hunks: [hunk()],
  ...overrides,
});

const pseudo = hunk({
  header: "",
  patch: "diff --git a/src/api.ts b/src/api.ts\n",
  oldStart: 0,
  oldLines: 0,
  newStart: 0,
  newLines: 0,
});

describe("fileNote", () => {
  it("names how a file changed, and nothing for a modified one", () => {
    expect(
      fileNote(file({ status: "renamed", previousPath: "src/before.ts" })),
    ).toBe("Renamed from src/before.ts");
    expect(fileNote(file({ status: "added" }))).toBe("Added");
    expect(fileNote(file({ status: "deleted" }))).toBe("Deleted");
    expect(fileNote(file())).toBeUndefined();
  });
});

describe("fileWithoutLines", () => {
  it("says why a file shows no lines", () => {
    expect(fileWithoutLines(file({ binary: true, hunks: [pseudo] }))).toBe(
      "Not shown: a binary file, or one too large to read.",
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

describe("hunkRowCount", () => {
  it("counts the rows after the @@ line", () => {
    expect(hunkRowCount(hunk())).toBe(4);
  });
});
