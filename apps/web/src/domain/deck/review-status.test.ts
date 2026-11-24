import { describe, expect, it } from "vitest";
import type { CodeHostCheck, CodeHostPullRequestFacts } from "@ajour/shared";
import {
  approvalsOf,
  approvalsSummary,
  checksSummary,
  pullRequestStateLabel,
  rollupSummary,
} from "./review-status";

const facts = (
  overrides: Partial<CodeHostPullRequestFacts> = {},
): CodeHostPullRequestFacts => ({
  id: "1",
  repository: "acme/api",
  number: 1,
  url: "https://github.com/acme/api/pull/1",
  title: "Fix",
  author: { login: "author", isBot: false },
  viewerIsAuthor: false,
  state: "open",
  draft: false,
  headSha: "one",
  lastPushedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  reviewRequests: [],
  reviews: [],
  comments: [],
  checks: "pending",
  mergeability: "mergeable",
  ...overrides,
});

const check = (state: CodeHostCheck["state"], name = state): CodeHostCheck => ({
  name,
  state,
});

describe("the status line", () => {
  it("names the pull request's state", () => {
    expect(pullRequestStateLabel(facts())).toBe("Open");
    expect(pullRequestStateLabel(facts({ draft: true }))).toBe("Draft");
    expect(pullRequestStateLabel(facts({ state: "merged" }))).toBe("Merged");
    expect(pullRequestStateLabel(facts({ state: "closed" }))).toBe("Closed");
  });

  it("counts pending checks in the warning tone, and passed ones in the success tone", () => {
    expect(
      checksSummary([check("success"), check("pending"), check("pending")]),
    ).toEqual({
      text: "2 checks pending",
      tone: "warning",
    });
    expect(
      checksSummary([check("success"), check("success"), check("skipped")]),
    ).toEqual({
      text: "2 checks passed",
      tone: "success",
    });
    expect(checksSummary([check("success")])).toEqual({
      text: "1 check passed",
      tone: "success",
    });
  });

  it("says a failure first, with no color, and says when nothing ran", () => {
    expect(checksSummary([check("pending"), check("failure")])).toEqual({
      text: "1 check failed",
    });
    expect(checksSummary([check("skipped")])).toEqual({
      text: "1 check skipped",
    });
    expect(checksSummary([])).toEqual({ text: "No checks" });
  });

  it("reads the synced rollup until the checks load", () => {
    expect(rollupSummary("pending")).toEqual({
      text: "Checks pending",
      tone: "warning",
    });
    expect(rollupSummary("success")).toEqual({
      text: "Checks passed",
      tone: "success",
    });
    expect(rollupSummary("failure")).toEqual({ text: "Checks failed" });
    expect(rollupSummary("none")).toEqual({ text: "No checks" });
  });

  it("counts the approvals, uncolored", () => {
    expect(
      approvalsSummary([
        { reviewer: { login: "a", isBot: false }, vote: "approved" },
        { reviewer: { login: "b", isBot: false }, vote: "none" },
      ]),
    ).toBe("1 approval");
    expect(
      approvalsSummary([
        { reviewer: { login: "a", isBot: false }, vote: "approved" },
        { reviewer: { login: "b", isBot: false }, vote: "approved" },
      ]),
    ).toBe("2 approvals");
    expect(approvalsSummary([])).toBe("No approvals yet");
  });
});

describe("each reviewer's vote", () => {
  it("is the plugin's when it sends them", () => {
    const approvals = [
      { reviewer: { login: "a", isBot: false }, vote: "approved" as const },
    ];
    expect(approvalsOf(facts({ approvals }))).toBe(approvals);
  });

  it("comes from the reviews and requests of a plugin that doesn't", () => {
    expect(
      approvalsOf(
        facts({
          reviews: [
            {
              id: "1",
              author: { login: "alice", isBot: false },
              verdict: "changes_requested",
              submittedAt: 1,
            },
            {
              id: "2",
              author: { login: "alice", isBot: false },
              verdict: "approved",
              submittedAt: 3,
            },
            {
              id: "3",
              author: { login: "alice", isBot: false },
              verdict: "commented",
              submittedAt: 4,
            },
            {
              id: "4",
              author: { login: "bob", isBot: false },
              verdict: "changes_requested",
              submittedAt: 2,
            },
            {
              id: "5",
              author: { login: "carol", isBot: false },
              verdict: "commented",
              submittedAt: 2,
            },
          ],
          reviewRequests: [
            { kind: "user", name: "dave", includesViewer: false },
            { kind: "user", name: "Bob", includesViewer: false },
          ],
        }),
      ),
    ).toEqual([
      { reviewer: { login: "alice", isBot: false }, vote: "approved" },
      { reviewer: { login: "bob", isBot: false }, vote: "changes_requested" },
      { reviewer: { login: "dave", isBot: false }, vote: "none" },
    ]);
  });

  it("clears a vote a later dismissal resets, in time order, while a later comment keeps it", () => {
    const review = (
      id: string,
      login: string,
      verdict: CodeHostPullRequestFacts["reviews"][number]["verdict"],
      submittedAt: number,
    ) => ({ id, author: { login, isBot: false }, verdict, submittedAt });
    // As Azure DevOps sends them: an approval, then the vote reset by a
    // push. Listed out of time order, as a plugin may.
    const reset = facts({
      reviews: [
        review("2", "alice", "dismissed", 5),
        review("1", "alice", "approved", 3),
        review("3", "bob", "approved", 2),
        review("4", "bob", "commented", 6),
        review("5", "carol", "changes_requested", 1),
        review("6", "carol", "dismissed", 2),
        review("7", "carol", "approved", 4),
      ],
    });

    expect(approvalsOf(reset)).toEqual([
      { reviewer: { login: "carol", isBot: false }, vote: "approved" },
      { reviewer: { login: "bob", isBot: false }, vote: "approved" },
      { reviewer: { login: "alice", isBot: false }, vote: "none" },
    ]);
    expect(approvalsSummary(approvalsOf(reset))).toBe("2 approvals");
  });
});
