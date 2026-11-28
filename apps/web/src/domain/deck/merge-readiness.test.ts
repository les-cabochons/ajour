import { describe, expect, it } from "vitest";
import type {
  CodeHostApproval,
  CodeHostCheck,
  CodeHostPullRequestFacts,
} from "@ajour/shared";
import { mergeReadiness } from "./merge-readiness";

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
  baseRef: "main",
  lastPushedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  reviewRequests: [],
  reviews: [],
  comments: [],
  checks: "success",
  mergeability: "mergeable",
  ...overrides,
});

const check = (state: CodeHostCheck["state"]): CodeHostCheck => ({
  name: state,
  state,
});
const vote = (
  login: string,
  value: CodeHostApproval["vote"],
  required = false,
): CodeHostApproval => ({
  reviewer: { login, isBot: false },
  vote: value,
  ...(required ? { required } : {}),
});

describe("mergeReadiness", () => {
  it("is ready once nothing is left", () => {
    const readiness = mergeReadiness({
      facts: facts(),
      checks: [check("success")],
      approvals: [vote("ana", "approved")],
    });
    expect(readiness.state).toBe("ready");
    expect(readiness.label).toBe("Ready to merge");
    expect(readiness.left).toBe(0);
    expect(readiness.requirements.map((entry) => entry.text)).toEqual([
      "No conflicts with main",
      "1 check passed",
      "1 approval",
    ]);
  });

  it("is blocked by a failed check, a conflict, a draft or a request for changes", () => {
    const readiness = mergeReadiness({
      facts: facts({ draft: true, mergeability: "conflicting" }),
      checks: [check("failure"), check("pending")],
      approvals: [vote("ana", "approved"), vote("bo", "changes_requested")],
    });
    expect(readiness.state).toBe("blocked");
    expect(readiness.label).toBe("Merge blocked");
    expect(
      readiness.requirements.map((entry) => [
        entry.key,
        entry.state,
        entry.text,
      ]),
    ).toEqual([
      ["draft", "failed", "Draft"],
      ["conflicts", "failed", "Conflicts with main"],
      ["checks", "failed", "1 check failed"],
      ["reviews", "failed", "Changes requested by bo"],
    ]);
    expect(readiness.left).toBe(4);
  });

  it("waits for pending checks, a required reviewer and the layer below", () => {
    const readiness = mergeReadiness({
      facts: facts({ mergeability: "unknown" }),
      checks: [check("pending")],
      approvals: [vote("ana", "approved"), vote("bo", "none", true)],
      mergesAfter: 479,
    });
    expect(readiness.state).toBe("waiting");
    expect(readiness.requirements.map((entry) => entry.text)).toEqual([
      "Conflicts not checked yet",
      "1 check pending",
      "Waiting for bo",
      "Merges after #479",
    ]);
    expect(readiness.left).toBe(4);
  });

  it("reads the synced rollup until each check is read, and waits for a first approval", () => {
    const readiness = mergeReadiness({
      facts: facts({ checks: "failure" }),
      checks: undefined,
      approvals: [],
    });
    expect(readiness.requirements.map((entry) => entry.text)).toEqual([
      "No conflicts with main",
      "Checks failed",
      "No approvals yet",
    ]);
    expect(readiness.state).toBe("blocked");
  });

  it("names a merged or closed pull request as such", () => {
    expect(
      mergeReadiness({
        facts: facts({ state: "merged" }),
        checks: [],
        approvals: [],
      }).label,
    ).toBe("Merged");
    expect(
      mergeReadiness({
        facts: facts({ state: "closed", draft: true }),
        checks: [],
        approvals: [],
      }).requirements.some((entry) => entry.key === "draft"),
    ).toBe(false);
  });
});
