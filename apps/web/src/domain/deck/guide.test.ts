import { describe, expect, it } from "vitest";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import {
  reviewSections,
  sectionToReach,
  tickLength,
  toggleViewed,
  viewedCount,
} from "./guide";

const hunk = (id: string) => ({
  id,
  header: "@@ -1,1 +1,1 @@",
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  patch: "",
});

const file = (path: string, count: number) => ({
  path,
  status: "modified" as const,
  binary: false,
  hunks: Array.from({ length: count }, (_, index) => hunk(`${path}#${index}`)),
});

/** Files in the order the local API sends them, which isn't A–Z here. */
const PULL_REQUEST: DeckOpenedPullRequest = {
  headSha: "head",
  baseSha: "base",
  files: [file("src/b.ts", 2), file("README.md", 1), file("src/a.ts", 1)],
  guide: {
    madeWith: "code",
    concerns: [
      {
        id: "g1",
        title: "Read the config",
        rationale: "Both readers change together.",
        hunkIds: ["src/b.ts#1", "src/a.ts#0"],
      },
      {
        id: "misc",
        title: "Other changes",
        rationale: "Changes with no strong link to the rest.",
        hunkIds: ["README.md#0"],
      },
    ],
  },
};

const ids = (sections: ReturnType<typeof reviewSections>) =>
  sections.map((section) => ({
    title: section.title,
    number: section.number,
    hunks: section.hunks.map((entry) => entry.hunk.id),
  }));

describe("the review page's order", () => {
  it("follows the guide: its concerns numbered in reading order, each hunk with its file", () => {
    const sections = reviewSections(PULL_REQUEST, "guide");

    expect(ids(sections)).toEqual([
      {
        title: "Read the config",
        number: 1,
        hunks: ["src/b.ts#1", "src/a.ts#0"],
      },
      { title: "Other changes", number: 2, hunks: ["README.md#0"] },
      // A hunk the guide left out still shows, after its concerns.
      { title: "Not in the guide", number: 3, hunks: ["src/b.ts#0"] },
    ]);
    expect(sections[0]!.rationale).toBe("Both readers change together.");
    expect(sections[0]!.hunks[1]!.file.path).toBe("src/a.ts");
  });

  it("lists the files A–Z, by path, each with its hunks in order", () => {
    expect(ids(reviewSections(PULL_REQUEST, "files"))).toEqual([
      { title: "README.md", number: undefined, hunks: ["README.md#0"] },
      { title: "src/a.ts", number: undefined, hunks: ["src/a.ts#0"] },
      {
        title: "src/b.ts",
        number: undefined,
        hunks: ["src/b.ts#0", "src/b.ts#1"],
      },
    ]);
  });

  it("lists the files A–Z when there is no guide", () => {
    const sections = reviewSections({ ...PULL_REQUEST, guide: null }, "guide");

    expect(sections.map((section) => section.title)).toEqual([
      "README.md",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("drops a guide's hunk id the diff doesn't have, and a concern left empty", () => {
    const sections = reviewSections(
      {
        ...PULL_REQUEST,
        files: [file("src/a.ts", 1)],
        guide: {
          madeWith: "code",
          concerns: [
            {
              id: "g1",
              title: "Gone",
              rationale: "",
              hunkIds: ["src/gone.ts#0"],
            },
            {
              id: "g2",
              title: "Kept",
              rationale: "",
              hunkIds: ["src/a.ts#0", "src/a.ts#0"],
            },
          ],
        },
      },
      "guide",
    );

    expect(ids(sections)).toEqual([
      { title: "Kept", number: 1, hunks: ["src/a.ts#0"] },
    ]);
  });
});

describe("moving between concerns", () => {
  // Section tops relative to the reading line at 0: the page has scrolled
  // into the second section.
  const tops = [-900, -40, 300, 1200];

  it("goes to the next section after the one being read", () => {
    expect(sectionToReach(tops, 0, 1)).toBe(2);
  });

  it("goes back to the top of the section being read, then to the one before", () => {
    expect(sectionToReach(tops, 0, -1)).toBe(1);
    expect(sectionToReach([-900, 0, 300], 0, -1)).toBe(0);
  });

  it("starts at the first section before any is reached, and stops at either end", () => {
    expect(sectionToReach([50, 400], 0, 1)).toBe(0);
    expect(sectionToReach([50, 400], 0, -1)).toBeUndefined();
    expect(sectionToReach([-400, 0], 0, 1)).toBeUndefined();
    expect(sectionToReach([], 0, 1)).toBeUndefined();
  });
});

describe("viewed marks", () => {
  it("toggles a hunk's mark and counts the viewed hunks of a section", () => {
    let viewed = toggleViewed(new Set(), "src/a.ts#0");
    viewed = toggleViewed(viewed, "README.md#0");
    viewed = toggleViewed(viewed, "README.md#0");

    const [first] = reviewSections(PULL_REQUEST, "guide");
    expect(viewedCount(first!, viewed)).toBe(1);
    expect([...viewed]).toEqual(["src/a.ts#0"]);
  });

  it("gives a tick a length that grows with the hunks, within bounds", () => {
    expect(tickLength(1)).toBeLessThan(tickLength(5));
    expect(tickLength(0)).toBe(tickLength(1));
    expect(tickLength(500)).toBe(tickLength(1_000));
  });
});
