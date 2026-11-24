import { describe, expect, it } from "vitest";
import type { DeckFile, DeckPullRequestDiff } from "@ajour/shared/deck";
import {
  addDraftComment,
  completeDraftComments,
  completeReviewSubmission,
  discardDraftReview,
  draftReviewOf,
  editDraftComment,
  finishReviewRequest,
  lineTextOf,
  normalizeDraftReviews,
  placeDrafts,
  prepareCommentPost,
  prepareReviewSubmission,
  refreshDraftReview,
  removeDraftComment,
  reviewVerdicts,
  type DeckDraftReview,
  type DeckReviewRef,
} from "./draft-review";

function hunk(path: string, index: number, header: string, rows: string[]) {
  const [, oldStart = 0, oldLines = 0, newStart = 0, newLines = 0] =
    /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header)?.map(Number) ?? [];
  return {
    id: `${path}#${index}`,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      header,
      ...rows,
      "",
    ].join("\n"),
  };
}

const file = (path: string, hunks: DeckFile["hunks"]): DeckFile => ({
  path,
  status: "modified",
  binary: false,
  hunks,
});

/** Rows: " a" (1,1), "-b" (2,-), "+B" (-,2), " c" (3,3). */
const FIRST: DeckPullRequestDiff = {
  headSha: "head-1",
  baseSha: "base",
  files: [
    file("src/api.ts", [
      hunk("src/api.ts", 0, "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
    ]),
  ],
};

/** A push changed line 2 of the head and kept line 3: " a", "-b", "+C", " c". */
const SECOND: DeckPullRequestDiff = {
  headSha: "head-2",
  baseSha: "base",
  files: [
    file("src/api.ts", [
      hunk("src/api.ts", 0, "@@ -1,3 +1,3 @@", [" a", "-b", "+C", " c"]),
    ]),
  ],
};

const REF: DeckReviewRef = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/api",
  number: 482,
};
const OTHER: DeckReviewRef = { ...REF, number: 485 };

let ids = 0;
const options = (now = 1_000) => ({ now, createId: () => `draft-${++ids}` });

function withComment(
  reviews: readonly DeckDraftReview[],
  line: number,
  body = "Rename this.",
  diff = FIRST,
  side: "head" | "base" = "head",
) {
  return addDraftComment(
    reviews,
    REF,
    {
      headSha: diff.headSha,
      anchor: { path: "src/api.ts", side, line },
      body,
      lineText: lineTextOf(diff, { path: "src/api.ts", side, line }) ?? "",
    },
    options(),
  );
}

describe("the draft review", () => {
  it("adds a comment to a new draft for the pull request, on its head", () => {
    const { reviews, comment } = withComment([], 2);
    expect(comment).toMatchObject({
      path: "src/api.ts",
      side: "head",
      line: 2,
      body: "Rename this.",
      lineText: "B",
    });
    expect(draftReviewOf(reviews, REF)).toMatchObject({
      ...REF,
      headSha: "head-1",
      comments: [comment],
    });
    expect(draftReviewOf(reviews, OTHER)).toBeUndefined();
  });

  it("adds nothing when the comment is blank", () => {
    const { reviews, comment } = withComment([], 2, "   ");
    expect(reviews).toEqual([]);
    expect(comment).toBeUndefined();
  });

  it("keeps each pull request's draft apart", () => {
    const first = withComment([], 2).reviews;
    const both = addDraftComment(
      first,
      OTHER,
      {
        headSha: "other-head",
        anchor: { path: "README.md", side: "head", line: 1 },
        body: "Typo.",
        lineText: "# Api",
      },
      options(),
    ).reviews;
    expect(draftReviewOf(both, REF)?.comments).toHaveLength(1);
    expect(draftReviewOf(both, OTHER)?.comments).toHaveLength(1);
  });

  it("edits a comment's words and keeps its line", () => {
    const { reviews, comment } = withComment([], 2);
    const edited = editDraftComment(
      reviews,
      REF,
      comment!.id,
      "Rename it to `load`.",
      2_000,
    );
    expect(draftReviewOf(edited, REF)?.comments).toEqual([
      {
        ...comment,
        body: "Rename it to `load`.",
        updatedAt: 2_000,
      },
    ]);
    // A blank edit changes nothing: removing is its own action.
    expect(editDraftComment(reviews, REF, comment!.id, " ", 2_000)).toBe(
      reviews,
    );
  });

  it("removes a comment, and the draft with its last one", () => {
    const one = withComment([], 2);
    const two = withComment(one.reviews, 3, "And this.");
    const left = removeDraftComment(two.reviews, REF, one.comment!.id);
    expect(draftReviewOf(left, REF)?.comments).toEqual([two.comment]);
    expect(removeDraftComment(left, REF, two.comment!.id)).toEqual([]);
  });

  it("discards the whole draft of one pull request", () => {
    const first = withComment([], 2).reviews;
    expect(discardDraftReview(first, REF)).toEqual([]);
    expect(discardDraftReview(first, OTHER)).toBe(first);
  });
});

describe("a refresh to a new head", () => {
  it("marks outdated the comments on lines that changed, and moves the others to the new head", () => {
    const changed = withComment([], 2);
    const kept = withComment(changed.reviews, 3, "Fine.");
    const refreshed = refreshDraftReview(kept.reviews, REF, SECOND);
    expect(refreshed.outdated).toBe(1);
    const draft = draftReviewOf(refreshed.reviews, REF)!;
    expect(draft.headSha).toBe("head-2");
    expect(draft.comments).toEqual([
      { ...changed.comment, outdated: true },
      kept.comment,
    ]);
  });

  it("marks outdated a comment whose line is gone from the diff", () => {
    const { reviews } = withComment([], 3);
    const gone: DeckPullRequestDiff = { ...SECOND, files: [] };
    const refreshed = refreshDraftReview(reviews, REF, gone);
    expect(draftReviewOf(refreshed.reviews, REF)?.comments[0]?.outdated).toBe(
      true,
    );
  });

  it("changes nothing on the same head, or without a draft", () => {
    const { reviews } = withComment([], 2);
    expect(refreshDraftReview(reviews, REF, FIRST)).toEqual({
      reviews,
      outdated: 0,
    });
    expect(refreshDraftReview(reviews, OTHER, SECOND).reviews).toBe(reviews);
  });

  it("keeps a comment outdated through later refreshes", () => {
    const { reviews } = withComment([], 2);
    const once = refreshDraftReview(reviews, REF, SECOND).reviews;
    // The line reads "B" again on a third head; the comment stays outdated.
    const back = refreshDraftReview(once, REF, { ...FIRST, headSha: "head-3" });
    expect(back.outdated).toBe(0);
    expect(draftReviewOf(back.reviews, REF)?.comments[0]?.outdated).toBe(true);
  });

  it("places the current comments on their lines and the outdated ones elsewhere", () => {
    const changed = withComment([], 2);
    const kept = withComment(changed.reviews, 3, "Fine.");
    const removed = withComment(kept.reviews, 2, "On the base.", FIRST, "base");
    const refreshed = refreshDraftReview(removed.reviews, REF, SECOND).reviews;
    const placement = placeDrafts(SECOND, draftReviewOf(refreshed, REF)!);
    expect(placement.placed).toEqual([
      // The base's line 2 still reads "b": it stays.
      expect.objectContaining({
        hunkId: "src/api.ts#0",
        side: "deletions",
        line: 2,
        row: 1,
        comment: expect.objectContaining({ id: removed.comment!.id }),
      }),
      expect.objectContaining({
        hunkId: "src/api.ts#0",
        side: "additions",
        line: 3,
        row: 3,
        comment: expect.objectContaining({ id: kept.comment!.id }),
      }),
    ]);
    expect(placement.elsewhere.map((comment) => comment.id)).toEqual([
      changed.comment!.id,
    ]);
  });
});

describe("finishing the review", () => {
  it("sends the current comments with the verdict and keeps the outdated ones out", () => {
    const changed = withComment([], 2);
    const kept = withComment(changed.reviews, 3, "Fine.");
    const draft = draftReviewOf(
      refreshDraftReview(kept.reviews, REF, SECOND).reviews,
      REF,
    )!;
    expect(
      finishReviewRequest(draft, { verdict: "approve", body: "  Ship it. " }),
    ).toEqual({
      request: {
        repository: "acme/api",
        number: 482,
        headSha: "head-2",
        verdict: "approve",
        body: "Ship it.",
        comments: [
          { path: "src/api.ts", side: "head", line: 3, body: "Fine." },
        ],
      },
      sent: [kept.comment!.id],
      kept: [changed.comment!.id],
    });
  });

  it("sends a multi-line comment's first line, and no body when there's none", () => {
    const { reviews } = addDraftComment(
      [],
      REF,
      {
        headSha: "head-1",
        anchor: { path: "src/api.ts", side: "head", line: 3, startLine: 1 },
        body: "These three.",
        lineText: "c",
      },
      options(),
    );
    expect(
      finishReviewRequest(draftReviewOf(reviews, REF)!, {
        verdict: "comment",
        body: " ",
      }).request,
    ).toEqual({
      repository: "acme/api",
      number: 482,
      headSha: "head-1",
      verdict: "comment",
      comments: [
        {
          path: "src/api.ts",
          side: "head",
          line: 3,
          startLine: 1,
          body: "These three.",
        },
      ],
    });
  });

  it("clears what was sent and keeps the outdated comments in the draft", () => {
    const changed = withComment([], 2);
    const kept = withComment(changed.reviews, 3, "Fine.");
    const refreshed = refreshDraftReview(kept.reviews, REF, SECOND).reviews;
    const after = completeDraftComments(refreshed, REF, [kept.comment!.id]);
    expect(
      draftReviewOf(after, REF)?.comments.map((comment) => comment.id),
    ).toEqual([changed.comment!.id]);
    // With nothing left, the draft goes.
    expect(completeDraftComments(after, REF, [changed.comment!.id])).toEqual(
      [],
    );
  });

  it("keeps the draft when the pull request closes, until it's posted or discarded", () => {
    // Closing writes nothing to the draft: the sync's records are apart.
    const { reviews, comment } = withComment([], 2);
    const draft = draftReviewOf(reviews, REF)!;
    // Posting it as comments sends each one on its line, at the draft's head.
    expect(
      finishReviewRequest(draft, { verdict: "comment", body: "" }).request
        .comments,
    ).toEqual([
      { path: "src/api.ts", side: "head", line: 2, body: comment!.body },
    ]);
    expect(completeDraftComments(reviews, REF, [comment!.id])).toEqual([]);
  });
});

describe("the verdicts", () => {
  it("name a request for changes as each code host does", () => {
    expect(reviewVerdicts("github")).toEqual({
      comment: "Comment",
      request_changes: "Request changes",
      approve: "Approve",
    });
    expect(reviewVerdicts("azure_devops").request_changes).toBe(
      "Wait for author",
    );
  });
});

describe("stored drafts", () => {
  it("reads back what it saved and drops what it can't read", () => {
    const { reviews } = withComment([], 2);
    expect(normalizeDraftReviews(JSON.parse(JSON.stringify(reviews)))).toEqual(
      reviews,
    );
    expect(normalizeDraftReviews(undefined)).toEqual([]);
    expect(
      normalizeDraftReviews([{ ...reviews[0], comments: "broken" }, 4]),
    ).toEqual([]);
  });
});

describe("a comment on several lines", () => {
  /** A comment on lines `start` to `end` of the head, as the composer adds it. */
  function onLines(start: number, end: number, side: "head" | "base" = "head") {
    const anchor = { path: "src/api.ts", side, line: end, startLine: start };
    return addDraftComment(
      [],
      REF,
      {
        headSha: FIRST.headSha,
        anchor,
        body: "These.",
        lineText: lineTextOf(FIRST, anchor) ?? "",
      },
      options(),
    );
  }

  it("keeps the text of every line it's on", () => {
    expect(onLines(2, 3).comment?.lineText).toBe("B\nc");
    expect(
      lineTextOf(FIRST, {
        path: "src/api.ts",
        side: "head",
        line: 4,
        startLine: 3,
      }),
    ).toBeUndefined();
  });

  it("is outdated when a push changes its first line, not only its last", () => {
    const refreshed = refreshDraftReview(onLines(2, 3).reviews, REF, SECOND);
    expect(refreshed.outdated).toBe(1);
  });

  it("stays current while all its lines read the same", () => {
    // The base's lines 1 and 2, "a" and "b", are the same after the push.
    const refreshed = refreshDraftReview(
      onLines(1, 2, "base").reviews,
      REF,
      SECOND,
    );
    expect(refreshed.outdated).toBe(0);
  });
});

describe("a review's submission", () => {
  const press = (
    reviews: readonly DeckDraftReview[],
    verdict: "approve" | "comment" = "approve",
    body = "Ship it.",
  ) =>
    prepareReviewSubmission(
      reviews,
      REF,
      { headSha: "head-1", verdict, body },
      options(),
    );

  it("names the request, and keeps the name with the draft before it's sent", () => {
    const { reviews, comment } = withComment([], 2);
    const first = press(reviews);
    const id = first.request!.submissionId;
    expect(id).toMatch(/^[\w-]+$/);
    expect(draftReviewOf(first.reviews, REF)?.submission?.id).toBe(id);
    expect(first.sent).toEqual([comment!.id]);
    // Stored, it reads back: a retry after a restart sends the same name.
    const stored = normalizeDraftReviews(
      JSON.parse(JSON.stringify(first.reviews)),
    );
    expect(press(stored).request.submissionId).toBe(id);
  });

  it("names a review with no comments too, in a draft of its own until it's sent", () => {
    const first = press([]);
    const draft = draftReviewOf(first.reviews, REF);
    expect(draft).toMatchObject({ headSha: "head-1", comments: [] });
    expect(press(first.reviews).request.submissionId).toBe(
      first.request!.submissionId,
    );
    expect(completeReviewSubmission(first.reviews, REF, first.sent)).toEqual(
      [],
    );
  });

  it("is a new submission once what it sends changes", () => {
    const { reviews } = withComment([], 2);
    const first = press(reviews);
    const id = first.request!.submissionId;
    expect(press(first.reviews, "comment").request.submissionId).not.toBe(id);
    expect(
      press(first.reviews, "approve", "Ship it now.").request.submissionId,
    ).not.toBe(id);
    const added = withComment(first.reviews, 3, "And this.");
    expect(press(added.reviews).request.submissionId).not.toBe(id);
    const draft = draftReviewOf(first.reviews, REF)!;
    const edited = editDraftComment(
      first.reviews,
      REF,
      draft.comments[0]!.id,
      "Rename it.",
      2_000,
    );
    expect(press(edited).request.submissionId).not.toBe(id);
  });

  it("keeps its name when the draft moves to a new head", () => {
    const { reviews } = withComment([], 3);
    const first = press(reviews);
    const moved = refreshDraftReview(first.reviews, REF, SECOND).reviews;
    expect(
      prepareReviewSubmission(
        moved,
        REF,
        { headSha: "head-2", verdict: "approve", body: "Ship it." },
        options(),
      ).request.submissionId,
    ).toBe(first.request!.submissionId);
  });

  it("once the code host took it, clears the comments it sent and its name", () => {
    const changed = withComment([], 2);
    const kept = withComment(changed.reviews, 3, "Fine.");
    const refreshed = refreshDraftReview(kept.reviews, REF, SECOND).reviews;
    const first = prepareReviewSubmission(
      refreshed,
      REF,
      { headSha: "head-2", verdict: "comment", body: "" },
      options(),
    );
    const after = draftReviewOf(
      completeReviewSubmission(first.reviews, REF, first.sent),
      REF,
    );
    expect(after?.comments.map((comment) => comment.id)).toEqual([
      changed.comment!.id,
    ]);
    expect(after?.submission).toBeUndefined();
  });
});

describe("a retry of a review", () => {
  const press = (
    reviews: readonly DeckDraftReview[],
    now: number,
    again = false,
  ) =>
    prepareReviewSubmission(
      reviews,
      REF,
      { headSha: "head-1", verdict: "approve", body: "Ship it.", again },
      options(now),
    );

  it("says when the first try was sent, so the plugin looks back to then", () => {
    const first = press(withComment([], 2).reviews, 5_000);
    expect(first.request.firstTriedAt).toBeUndefined();
    const stored = normalizeDraftReviews(
      JSON.parse(JSON.stringify(first.reviews)),
    );
    const retry = press(stored, 9_000);
    expect(retry.request).toMatchObject({
      submissionId: first.request!.submissionId,
      firstTriedAt: 5_000,
    });
  });

  it("posts again as a new submission when the user chooses to", () => {
    const first = press(withComment([], 2).reviews, 5_000);
    const again = press(first.reviews, 9_000, true);
    expect(again.request!.submissionId).not.toBe(first.request!.submissionId);
    expect(again.request.firstTriedAt).toBeUndefined();
    expect(press(again.reviews, 12_000).request.firstTriedAt).toBe(9_000);
  });
});

describe("posting a closed pull request's comments", () => {
  const post = (
    reviews: readonly DeckDraftReview[],
    commentId: string,
    now: number,
    again = false,
  ) => prepareCommentPost(reviews, REF, commentId, { again }, options(now));

  it("names each comment's post and keeps the name with it before it's sent", () => {
    const { reviews, comment } = withComment([], 2, "Rename this.");
    const first = post(reviews, comment!.id, 5_000);
    expect(first.request).toEqual({
      repository: "acme/api",
      number: 482,
      body: "Rename this.",
      anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "head-1" },
      submissionId: expect.stringMatching(/^[\w-]+$/),
    });
    const stored = normalizeDraftReviews(
      JSON.parse(JSON.stringify(first.reviews)),
    );
    // Retry, after a restart too: the same name, and when it was first tried.
    expect(post(stored, comment!.id, 9_000).request).toMatchObject({
      submissionId: first.request!.submissionId,
      firstTriedAt: 5_000,
    });
  });

  it("gives each comment a name of its own", () => {
    const one = withComment([], 2, "One.");
    const two = withComment(one.reviews, 3, "Two.");
    const first = post(two.reviews, one.comment!.id, 5_000);
    const second = post(first.reviews, two.comment!.id, 5_000);
    expect(second.request!.submissionId).not.toBe(first.request!.submissionId);
  });

  it("is a new post once the comment's words change, or when the user posts again", () => {
    const { reviews, comment } = withComment([], 2);
    const first = post(reviews, comment!.id, 5_000);
    const edited = editDraftComment(
      first.reviews,
      REF,
      comment!.id,
      "Rename it.",
      6_000,
    );
    expect(post(edited, comment!.id, 7_000).request).not.toHaveProperty(
      "firstTriedAt",
    );
    const again = post(first.reviews, comment!.id, 7_000, true);
    expect(again.request!.submissionId).not.toBe(first.request!.submissionId);
    expect(again.request).not.toHaveProperty("firstTriedAt");
  });
});
