import { describe, expect, it } from "vitest";
import {
  codeHostChecksResultSchema,
  codeHostOperationSchema,
  codeHostPullRequestFactsSchema,
  codeHostOperations,
  codeHostSyncResultSchema,
  codeHostUpdatePullRequestRequestSchema,
} from "../code-host";

const user = { login: "octocat", isBot: false };

describe("code host contract", () => {
  it("accepts synced pull request facts", () => {
    const result = codeHostSyncResultSchema.parse({
      viewer: user,
      pullRequests: [
        {
          id: "PR_1",
          repository: "acme/api",
          number: 42,
          url: "https://github.com/acme/api/pull/42",
          title: "Add rate limits",
          author: { login: "dependabot", isBot: true },
          state: "open",
          draft: false,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_100_000,
          viewerIsAuthor: false,
          headSha: "abc123",
          lastPushedAt: 1_700_000_050_000,
          reviewRequests: [
            { kind: "team", name: "acme/backend", includesViewer: true },
          ],
          reviews: [],
          comments: [
            {
              id: "C_1",
              author: user,
              createdAt: 1_700_000_060_000,
              threadId: "T_1",
              mentionsViewer: false,
            },
          ],
          checks: "pending",
          mergeability: "unknown",
        },
      ],
    });

    expect(result.pullRequests[0]?.reviewRequests[0]?.includesViewer).toBe(
      true,
    );
  });

  it("rejects a pull request update that changes nothing", () => {
    expect(() =>
      codeHostUpdatePullRequestRequestSchema.parse({
        repository: "acme/api",
        number: 42,
      }),
    ).toThrow("needs a title, a draft state or both");
  });

  it("reads each reviewer's vote on the facts, and facts stored without votes", () => {
    const facts = {
      id: "PR_1",
      repository: "acme/api",
      number: 42,
      url: "https://github.com/acme/api/pull/42",
      title: "Add rate limits",
      author: user,
      state: "open",
      draft: false,
      createdAt: 1,
      updatedAt: 2,
      viewerIsAuthor: false,
      headSha: "abc123",
      lastPushedAt: 1,
      reviewRequests: [],
      reviews: [],
      comments: [],
      checks: "success",
      mergeability: "mergeable",
    };

    expect(
      codeHostPullRequestFactsSchema.parse(facts).approvals,
    ).toBeUndefined();
    expect(
      codeHostPullRequestFactsSchema.parse({
        ...facts,
        approvals: [
          { reviewer: user, vote: "approved" },
          {
            reviewer: { login: "acme/backend", isBot: false },
            vote: "none",
            required: true,
          },
          { reviewer: user, vote: "rejected" },
        ],
      }).approvals,
    ).toHaveLength(3);
    expect(() =>
      codeHostPullRequestFactsSchema.parse({
        ...facts,
        approvals: [{ reviewer: user, vote: "approved_with_suggestions" }],
      }),
    ).toThrow();
  });

  it("reads each check's name, state and link, and refuses a link that isn't one", () => {
    expect(
      codeHostChecksResultSchema
        .parse({
          checks: [
            {
              name: "build",
              state: "success",
              url: "https://ci.example.test/1",
            },
            { name: "test", state: "pending" },
            { name: "docs", state: "skipped" },
            { name: "lint", state: "failure" },
          ],
        })
        .checks.map((check) => check.state),
    ).toEqual(["success", "pending", "skipped", "failure"]);
    expect(() =>
      codeHostChecksResultSchema.parse({
        checks: [{ name: "build", state: "success", url: "not a link" }],
      }),
    ).toThrow();
    expect(() =>
      codeHostChecksResultSchema.parse({
        checks: [{ name: " ", state: "success" }],
      }),
    ).toThrow();
    expect(() =>
      codeHostChecksResultSchema.parse({
        checks: [{ name: "build", state: "none" }],
      }),
    ).toThrow();
  });

  it("names every operation in the operation schema", () => {
    expect(codeHostOperationSchema.options).toEqual(
      Object.keys(codeHostOperations),
    );
  });
});
