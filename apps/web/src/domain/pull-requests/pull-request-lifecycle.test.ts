import { describe, expect, it } from "vitest";
import type {
  CodeHostPullRequestFacts,
  CodeHostSyncResult,
} from "@ajour/shared";
import {
  changePullRequest,
  CLOSED_RETENTION_MS,
  isPullRequestReturned,
  reconcilePullRequests,
  selectSidebarPullRequests,
} from "./pull-request-lifecycle";

const viewer = { login: "alex", isBot: false };
const author = { login: "author", isBot: false };
const other = { login: "reviewer", isBot: false };
const bot = { login: "bot", isBot: true };
const source = {
  pluginId: "github",
  pluginName: "GitHub",
  connectionId: "work",
  connectionLabel: "Work",
};
export const facts: CodeHostPullRequestFacts = {
  id: "pr1",
  repository: "acme/api",
  number: 1,
  url: "https://github.com/acme/api/pull/1",
  title: "Fix request handling",
  author,
  viewerIsAuthor: false,
  state: "open",
  draft: false,
  headSha: "one",
  lastPushedAt: 100,
  createdAt: 50,
  updatedAt: 100,
  reviewRequests: [{ kind: "user", name: "alex", includesViewer: true }],
  reviewRequestEvents: [],
  reviews: [],
  comments: [],
  checks: "success",
  mergeability: "mergeable",
};
const sync = (next: CodeHostPullRequestFacts): CodeHostSyncResult => ({
  viewer,
  pullRequests: [next],
});
const options = {
  now: 300,
  createId: () => "local1",
  changesEndSnoozeEarly: false,
};
function settled(initial: CodeHostPullRequestFacts = facts) {
  return changePullRequest(
    reconcilePullRequests([], source, sync(initial), options)[0]!,
    { type: "settle" },
    400,
  );
}
const comment = (who = author, patch = {}) => ({
  id: "new-comment",
  author: who,
  createdAt: 500,
  mentionsViewer: false,
  ...patch,
});
const review = (
  who = other,
  verdict: "approved" | "commented" | "changes_requested" = "approved",
) => ({ id: "new-review", author: who, submittedAt: 500, verdict });
const changed = (patch: Partial<CodeHostPullRequestFacts>) => ({
  ...facts,
  ...patch,
});

describe("pull request lifecycle", () => {
  it("starts review requests active, including team requests, and authored items settled", () => {
    expect(
      reconcilePullRequests([], source, sync(facts), options)[0]?.status,
    ).toBe("active");
    expect(
      reconcilePullRequests(
        [],
        source,
        sync(
          changed({
            reviewRequests: [
              { kind: "team", name: "acme/dev", includesViewer: true },
            ],
          }),
        ),
        options,
      )[0]?.status,
    ).toBe("active");
    expect(
      reconcilePullRequests(
        [],
        source,
        sync(changed({ viewerIsAuthor: true, author: viewer })),
        options,
      )[0]?.status,
    ).toBe("settled");
  });

  it.each([
    [
      "re-request while already pending",
      changed({
        reviewRequestEvents: [
          { id: "request2", author, createdAt: 500, includesViewer: true },
        ],
      }),
      "review-requested",
    ],
    [
      "mention",
      changed({ comments: [comment(other, { mentionsViewer: true })] }),
      "mentioned",
    ],
    [
      "author reply in a participating thread",
      changed({
        comments: [
          comment(viewer, { id: "own", createdAt: 200, threadId: "thread" }),
          comment(author, { threadId: "thread" }),
        ],
      }),
      "new-reply",
    ],
  ])("unsettles a reviewer for %s", (_, next, reason) => {
    const item = settled(
      changed({
        comments: [
          comment(viewer, { id: "own", createdAt: 200, threadId: "thread" }),
        ],
      }),
    );
    const result = reconcilePullRequests(
      [item],
      source,
      sync(next as CodeHostPullRequestFacts),
      { ...options, now: 600 },
    )[0]!;
    expect(result).toMatchObject({
      status: "active",
      reason,
      activeAt: 500,
      returnedAt: 600,
    });
    expect(
      reconcilePullRequests(
        [result],
        source,
        sync(next as CodeHostPullRequestFacts),
        { ...options, now: 700 },
      )[0],
    ).toEqual(result);
  });

  it.each(["changes_requested", "approved", "commented"] as const)(
    "new commits after the viewer's %s review",
    (verdict) => {
      const item = settled(changed({ reviews: [review(viewer, verdict)] }));
      const next = {
        ...item.facts,
        headSha: "two",
        lastPushedAt: 700,
        lastPushActor: author,
      };
      const result = reconcilePullRequests([item], source, sync(next), {
        ...options,
        now: 800,
      })[0]!;
      expect(result.status).toBe(
        verdict === "changes_requested" ? "active" : "settled",
      );
    },
  );

  it("orders initial requests by the request event rather than PR creation", () => {
    const result = reconcilePullRequests(
      [],
      source,
      sync(
        changed({
          reviewRequestEvents: [
            { id: "requested", author, createdAt: 250, includesViewer: true },
          ],
        }),
      ),
      options,
    );
    expect(result[0]?.activeAt).toBe(250);
  });

  it("does not treat a comment before the viewer joined the thread as an author reply", () => {
    const item = settled();
    const next = changed({
      comments: [
        comment(author, { createdAt: 500, threadId: "thread" }),
        comment(viewer, { id: "own", createdAt: 550, threadId: "thread" }),
      ],
    });
    expect(
      reconcilePullRequests([item], source, sync(next), {
        ...options,
        now: 600,
      })[0]?.status,
    ).toBe("settled");
  });

  it.each([viewer, undefined])(
    "keeps own or unattributed pushes settled",
    (lastPushActor) => {
      const item = settled(
        changed({ reviews: [review(viewer, "changes_requested")] }),
      );
      const next = {
        ...item.facts,
        headSha: "two",
        lastPushedAt: 700,
        lastPushActor,
      };
      expect(
        reconcilePullRequests([item], source, sync(next), {
          ...options,
          now: 800,
        })[0]?.status,
      ).toBe("settled");
    },
  );

  it.each([other, viewer, bot])("handles review-body mentions by %s", (who) => {
    const next = changed({
      reviews: [{ ...review(who, "commented"), mentionsViewer: true }],
    });
    expect(
      reconcilePullRequests([settled()], source, sync(next), {
        ...options,
        now: 600,
      })[0]?.status,
    ).toBe(who === other ? "active" : "settled");
  });

  it("uses a newer approval received in the same sync instead of an older changes request", () => {
    const item = settled(
      changed({ reviews: [review(viewer, "changes_requested")] }),
    );
    const next = {
      ...item.facts,
      headSha: "two",
      lastPushedAt: 700,
      lastPushActor: author,
      reviews: [
        ...item.facts.reviews,
        { ...review(viewer), id: "approval", submittedAt: 650 },
      ],
    };
    expect(
      reconcilePullRequests([item], source, sync(next), {
        ...options,
        now: 800,
      })[0]?.status,
    ).toBe("settled");
  });

  it("returns a changes-requested item when a temporarily unavailable push actor resolves", () => {
    const item = settled(
      changed({ reviews: [review(viewer, "changes_requested")] }),
    );
    const missingActor = { ...item.facts, headSha: "two", lastPushedAt: 700 };
    const first = reconcilePullRequests([item], source, sync(missingActor), {
      ...options,
      now: 800,
    })[0]!;
    expect(first.status).toBe("settled");
    const resolved = { ...missingActor, lastPushActor: author };
    const second = reconcilePullRequests([first], source, sync(resolved), {
      ...options,
      now: 900,
    })[0]!;
    expect(second).toMatchObject({
      status: "active",
      activeAt: 700,
      reason: "changes-requested",
    });
    expect(
      reconcilePullRequests([second], source, sync(resolved), {
        ...options,
        now: 1000,
      })[0],
    ).toEqual(second);
  });

  it.each([
    [
      "another reviewer",
      changed({ reviews: [review()], comments: [comment(other)] }),
    ],
    [
      "a non-participating thread",
      changed({ comments: [comment(author, { threadId: "another" })] }),
    ],
    [
      "own mention and review",
      changed({
        comments: [comment(viewer, { mentionsViewer: true })],
        reviews: [review(viewer)],
      }),
    ],
    [
      "own request",
      changed({
        reviewRequestEvents: [
          {
            id: "request2",
            author: viewer,
            createdAt: 500,
            includesViewer: true,
          },
        ],
      }),
    ],
    [
      "bot mention",
      changed({ comments: [comment(bot, { mentionsViewer: true })] }),
    ],
  ])("keeps a reviewer settled for %s", (_, next) => {
    expect(
      reconcilePullRequests(
        [settled()],
        source,
        sync(next as CodeHostPullRequestFacts),
        { ...options, now: 600 },
      )[0]?.status,
    ).toBe("settled");
  });

  it.each(["approved", "changes_requested", "commented", "dismissed"] as const)(
    "unsettles an author for a %s review",
    (verdict) => {
      const item = settled(changed({ viewerIsAuthor: true, author: viewer }));
      const next = { ...item.facts, reviews: [{ ...review(), verdict }] };
      expect(
        reconcilePullRequests([item], source, sync(next), {
          ...options,
          now: 600,
        })[0],
      ).toMatchObject({ status: "active", reason: "new-review" });
    },
  );

  it.each([
    ["human comment", [comment(other)], "active"],
    ["bot comment", [comment(bot)], "settled"],
    ["own comment", [comment(viewer)], "settled"],
  ])("author lifecycle after %s", (_, comments, status) => {
    const item = settled(changed({ viewerIsAuthor: true, author: viewer }));
    expect(
      reconcilePullRequests(
        [item],
        source,
        sync({
          ...item.facts,
          comments: comments as CodeHostPullRequestFacts["comments"],
        }),
        { ...options, now: 600 },
      )[0]?.status,
    ).toBe(status);
  });

  it("does not unsettle an author when checks fail, conflicts appear, or the head changes", () => {
    const item = settled(changed({ viewerIsAuthor: true, author: viewer }));
    expect(
      reconcilePullRequests(
        [item],
        source,
        sync({
          ...item.facts,
          checks: "failure",
          mergeability: "conflicting",
          headSha: "two",
          lastPushedAt: 500,
        }),
        { ...options, now: 600 },
      )[0]?.status,
    ).toBe("settled");
  });

  it.each([false, true])(
    "honors changesEndSnoozeEarly=%s and marks natural expiry returned",
    (early) => {
      const item = changePullRequest(
        reconcilePullRequests([], source, sync(facts), options)[0]!,
        { type: "snooze", until: 1000 },
        400,
      );
      const next = reconcilePullRequests(
        [item],
        source,
        sync(changed({ comments: [comment(other, { mentionsViewer: true })] })),
        { ...options, now: 600, changesEndSnoozeEarly: early },
      )[0]!;
      expect(selectSidebarPullRequests([next], 600)).toHaveLength(
        early ? 1 : 0,
      );
      expect(isPullRequestReturned(next, 1000)).toBe(true);
      expect(
        isPullRequestReturned(
          changePullRequest(next, { type: "open" }, 1000),
          1000,
        ),
      ).toBe(false);
    },
  );

  it("removes closed items from the sidebar immediately and expires them exactly after seven days", () => {
    const active = reconcilePullRequests([], source, sync(facts), options)[0]!;
    const closed = changed({ state: "merged", closedAt: 600 });
    const result = reconcilePullRequests([active], source, sync(closed), {
      ...options,
      now: 700,
    });
    expect(selectSidebarPullRequests(result, 700)).toHaveLength(0);
    expect(
      reconcilePullRequests(result, source, sync(closed), {
        ...options,
        now: 600 + CLOSED_RETENTION_MS,
      }),
    ).toEqual([]);
  });

  it("preserves local choices when a filtered item reappears, without inventing a closure", () => {
    const item = settled();
    const hidden = reconcilePullRequests(
      [item],
      source,
      { viewer, pullRequests: [] },
      options,
    );
    expect(hidden[0]).toMatchObject({
      status: "settled",
      missingFromSync: true,
      facts: { state: "open" },
    });
    expect(
      reconcilePullRequests(hidden, source, sync(facts), options)[0],
    ).toMatchObject({
      _id: item._id,
      status: "settled",
      missingFromSync: false,
    });
  });

  it("isolates identical provider identities by connection and plugin", () => {
    const first = settled();
    const second = reconcilePullRequests(
      [first],
      { ...source, connectionId: "personal" },
      sync(facts),
      { ...options, createId: () => "local2" },
    );
    const third = reconcilePullRequests(
      second,
      { ...source, pluginId: "other" },
      sync(facts),
      { ...options, createId: () => "local3" },
    );
    expect(third.map((item) => [item._id, item.status])).toEqual([
      ["local1", "settled"],
      ["local2", "active"],
      ["local3", "active"],
    ]);
  });

  it("keeps longest waiting first and ignores invalid snoozes", () => {
    const item = settled();
    expect(changePullRequest(item, { type: "snooze", until: 700 }, 600)).toBe(
      item,
    );
    const first = changePullRequest(item, { type: "unsettle" }, 600);
    const second = { ...first, _id: "second", activeAt: 500 };
    expect(
      selectSidebarPullRequests([first, second], 700).map((entry) => entry._id),
    ).toEqual(["second", "local1"]);
    expect(changePullRequest(first, { type: "snooze", until: NaN }, 600)).toBe(
      first,
    );
  });
});
