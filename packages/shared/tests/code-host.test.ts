import { describe, expect, it } from "vitest";
import {
  codeHostOperationSchema,
  codeHostOperations,
  codeHostSyncResultSchema,
  codeHostUpdatePullRequestRequestSchema,
} from "../src/code-host";

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

  it("names every operation in the operation schema", () => {
    expect(codeHostOperationSchema.options).toEqual(
      Object.keys(codeHostOperations),
    );
  });
});
