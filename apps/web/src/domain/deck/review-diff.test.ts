import { describe, expect, it } from "vitest";
import type { DeckFile, DeckHunk } from "@ajour/shared/deck";
import {
  fileNote,
  fileOnCodeHost,
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
  it("says a file is too large to compare, with its lines in each version", () => {
    const tooLarge = (
      status: DeckFile["status"],
      oldLines: number,
      newLines: number,
    ) =>
      fileWithoutLines(
        file({ status, tooLarge: { oldLines, newLines }, hunks: [pseudo] }),
      );
    expect(tooLarge("modified", 4_200, 4_210)).toBe(
      "Not shown: too large to compare here, 4,200 lines before and 4,210 after.",
    );
    expect(tooLarge("renamed", 1, 4_210)).toBe(
      "Not shown: too large to compare here, 1 line before and 4,210 after.",
    );
    expect(tooLarge("added", 0, 120_000)).toBe(
      "Not shown: too large to compare here, 120,000 lines.",
    );
    expect(tooLarge("deleted", 1, 0)).toBe(
      "Not shown: too large to compare here, 1 line.",
    );
  });

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

describe("fileOnCodeHost", () => {
  const versions = { headSha: "head1", baseSha: "base1" };

  it("links a GitHub file at the head, or a deleted one at the base", () => {
    expect(
      fileOnCodeHost(
        "https://github.com/acme/api/pull/12",
        file({ path: "src/a b#.ts" }),
        versions,
      ),
    ).toBe("https://github.com/acme/api/blob/head1/src/a%20b%23.ts");
    expect(
      fileOnCodeHost(
        "https://git.acme.test/acme/api/pull/12/",
        file({ path: "old.ts", status: "deleted" }),
        versions,
      ),
    ).toBe("https://git.acme.test/acme/api/blob/base1/old.ts");
  });

  it("links an Azure DevOps file in the pull request's files", () => {
    expect(
      fileOnCodeHost(
        "https://dev.azure.com/acme/Web/_git/api/pullrequest/7",
        file({ path: "src/a b.ts" }),
        versions,
      ),
    ).toBe(
      "https://dev.azure.com/acme/Web/_git/api/pullrequest/7?_a=files&path=%2Fsrc%2Fa%20b.ts",
    );
  });

  it("links the pull request itself on a code host it doesn't know", () => {
    expect(
      fileOnCodeHost("https://code.acme.test/reviews/7", file(), versions),
    ).toBe("https://code.acme.test/reviews/7");
  });
});
