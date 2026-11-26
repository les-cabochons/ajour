import { describe, expect, it } from "vitest";
import type { CodeHostReviewFact, CodeHostVersion } from "@ajour/shared";
import type { DeckFile, DeckOpenedPullRequest } from "@ajour/shared/deck";
import { NO_DECK_SUMMARY } from "../../test-support/deck";
import { reviewSections } from "./guide";
import {
  changedHunks,
  pushesSince,
  reviewedVersion,
  scopeLine,
  sinceReviewSections,
  versionNames,
} from "./versions";

const version = (
  number: number,
  pushedAt: number,
  extra: Partial<CodeHostVersion> = {},
): CodeHostVersion => ({
  number,
  headSha: `h${number}`,
  pushedAt,
  commits: [],
  ...extra,
});
const VERSIONS = [version(1, 1_000), version(2, 2_000), version(3, 3_000)];

const review = (
  login: string,
  submittedAt: number,
  verdict: CodeHostReviewFact["verdict"] = "approved",
): CodeHostReviewFact => ({
  id: `${login}-${submittedAt}`,
  author: { login, isBot: false },
  verdict,
  submittedAt,
});

describe("the version the user reviewed", () => {
  it("is the version in effect when the user last submitted a review", () => {
    expect(
      reviewedVersion(VERSIONS, {
        viewerLogin: "Alex",
        reviews: [
          review("alex", 1_500, "commented"),
          review("someone", 2_900),
          review("ALEX", 2_500, "changes_requested"),
        ],
      }),
    ).toEqual({ version: VERSIONS[1], at: 2_500 });
  });

  it("doesn't count a dismissed review, nor one before the first version", () => {
    expect(
      reviewedVersion(VERSIONS, {
        viewerLogin: "alex",
        reviews: [review("alex", 500), review("alex", 3_500, "dismissed")],
      }),
    ).toBeUndefined();
  });

  it("is the version remembered on this computer when it is the later one", () => {
    expect(
      reviewedVersion(VERSIONS, {
        viewerLogin: "alex",
        reviews: [review("alex", 1_500)],
        remembered: { headSha: "h3", at: 3_100 },
      }),
    ).toEqual({ version: VERSIONS[2], at: 3_100 });
    // A later review on the code host wins over what was remembered.
    expect(
      reviewedVersion(VERSIONS, {
        viewerLogin: "alex",
        reviews: [review("alex", 2_500)],
        remembered: { headSha: "h1", at: 1_100 },
      }),
    ).toEqual({ version: VERSIONS[1], at: 2_500 });
  });

  it("ignores a remembered head that is none of the versions", () => {
    expect(
      reviewedVersion(VERSIONS, {
        viewerLogin: "alex",
        reviews: [],
        remembered: { headSha: "gone", at: 9_000 },
      }),
    ).toBeUndefined();
  });
});

const file = (path: string, count: number): DeckFile => ({
  path,
  status: "modified",
  binary: false,
  hunks: Array.from({ length: count }, (_, index) => ({
    id: `${path}#${index}`,
    header: `@@ -${index + 1} +${index + 1} @@`,
    oldStart: index + 1,
    oldLines: 1,
    newStart: index + 1,
    newLines: 1,
    patch: "",
  })),
});

const opened: DeckOpenedPullRequest = {
  headSha: "h3",
  baseSha: "b",
  files: [file("src/a.ts", 3), file("src/b.ts", 1), file("src/c.ts", 1)],
  guide: {
    madeWith: "code",
    summary: NO_DECK_SUMMARY,
    concerns: [
      {
        id: "g1",
        title: "Routes",
        rationale: "",
        kinds: [],
        hunkIds: ["src/a.ts#0", "src/a.ts#1"],
      },
      {
        id: "g2",
        title: "Config",
        rationale: "",
        hunkIds: ["src/b.ts#0"],
        kinds: [],
      },
      {
        id: "g3",
        title: "Tests",
        rationale: "",
        kinds: [],
        hunkIds: ["src/a.ts#2", "src/c.ts#0"],
      },
    ],
  },
};

describe("the since-review filter", () => {
  const changed = changedHunks([
    { hunkId: "src/a.ts#1", version: 3 },
    { hunkId: "src/c.ts#0", version: 2 },
  ]);

  it("keeps only the changed hunks, says how many of each concern's are shown, and folds the untouched concerns", () => {
    const filtered = sinceReviewSections(
      reviewSections(opened, "guide"),
      changed,
    );
    expect(
      filtered.sections.map((section) => ({
        title: section.title,
        number: section.number,
        hunks: section.hunks.map((entry) => entry.hunk.id),
        of: section.of,
      })),
    ).toEqual([
      { title: "Routes", number: 1, hunks: ["src/a.ts#1"], of: 2 },
      { title: "Tests", number: 3, hunks: ["src/c.ts#0"], of: 2 },
    ]);
    expect(
      filtered.folded.map((section) => [section.number, section.title]),
    ).toEqual([[2, "Config"]]);
  });

  it("filters the files A–Z the same way", () => {
    const filtered = sinceReviewSections(
      reviewSections(opened, "files"),
      changed,
    );
    expect(filtered.sections.map((section) => section.title)).toEqual([
      "src/a.ts",
      "src/c.ts",
    ]);
    expect(filtered.folded.map((section) => section.title)).toEqual([
      "src/b.ts",
    ]);
  });

  it("folds everything when nothing changed", () => {
    const filtered = sinceReviewSections(
      reviewSections(opened, "guide"),
      changedHunks([]),
    );
    expect(filtered.sections).toEqual([]);
    expect(filtered.folded).toHaveLength(3);
  });
});

describe("the versions bar's words", () => {
  it("says pushes, or iterations when the code host calls them so", () => {
    expect(versionNames(undefined)).toEqual({ plural: "Pushes", one: "Push" });
    expect(versionNames("iteration")).toEqual({
      plural: "Iterations",
      one: "Iteration",
    });
  });

  it("names the branch the diff compares with", () => {
    expect(scopeLine("main")).toBe(
      "Changes in this pull request, against main",
    );
    expect(scopeLine(undefined)).toBe(
      "Changes in this pull request, against its base branch",
    );
  });
});

describe("new pushes during a review", () => {
  const heads = (synced: string, syncedAtOpen = "h1") => ({
    synced,
    syncedAtOpen,
  });

  it("counts the versions after the one on screen", () => {
    expect(pushesSince(VERSIONS, "h1", heads("h1"))).toBe(2);
    expect(pushesSince(VERSIONS, "h3", heads("h3", "h3"))).toBe(0);
  });

  it("counts one when only a sync since the page opened saw the new head", () => {
    expect(pushesSince(VERSIONS, "h3", heads("h4", "h3"))).toBe(1);
    expect(pushesSince(undefined, "h3", heads("h4", "h3"))).toBe(1);
    expect(pushesSince(undefined, "h3", heads("h3", "h3"))).toBe(0);
  });

  it("counts none when the diff opened newer than the last sync", () => {
    expect(pushesSince(undefined, "h3", heads("h2", "h2"))).toBe(0);
  });
});
