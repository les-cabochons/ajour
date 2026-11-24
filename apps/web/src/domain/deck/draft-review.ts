import { z } from "zod";
import type {
  CodeHostDiffSide,
  CodeHostLineAnchor,
  CodeHostSubmitReviewRequest,
} from "@ajour/shared";
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import { findLine, type AnnotationSide } from "./review-threads";

/*
 * The draft review (#784, ADR 0002): line comments a reviewer collects on a
 * pull request, kept in the renderer's local state across restarts, and
 * sent all at once with a verdict by Finish review. Nothing here is a
 * write to the code host: a submit that fails leaves the draft as it was.
 *
 * Each comment keeps the text of its line, so a refresh to a new head can
 * tell which lines changed: a comment on one is marked outdated, stays in
 * the draft and isn't sent on a line any more. A pull request that closes
 * keeps its draft, to post as comments or discard.
 */

/** A pull request of a code host connection, as a draft review names it. */
export interface DeckReviewRef {
  pluginId: string;
  connectionId: string;
  repository: string;
  number: number;
}

export interface DeckDraftComment {
  id: string;
  path: string;
  side: CodeHostDiffSide;
  line: number;
  /** The first line of a comment on several lines. */
  startLine?: number;
  body: string;
  /** The line's text when the comment was written, to tell whether a push changed it. */
  lineText: string;
  createdAt: number;
  updatedAt: number;
  /** A push changed or removed the line: the comment isn't sent on it. */
  outdated?: true;
}

export interface DeckDraftReview extends DeckReviewRef {
  /** The head the current comments' lines are on. */
  headSha: string;
  comments: DeckDraftComment[];
  updatedAt: number;
}

const sameRef = (review: DeckReviewRef, ref: DeckReviewRef) =>
  review.pluginId === ref.pluginId &&
  review.connectionId === ref.connectionId &&
  review.repository.toLowerCase() === ref.repository.toLowerCase() &&
  review.number === ref.number;

/** The pull request's draft review, when it has one. */
export function draftReviewOf(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
) {
  return reviews.find((review) => sameRef(review, ref));
}

/** The reviews with the pull request's draft replaced, or dropped once it has no comments. */
function withDraft(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  next: DeckDraftReview | undefined,
): DeckDraftReview[] {
  const others = reviews.filter((review) => !sameRef(review, ref));
  return next && next.comments.length ? [...others, next] : others;
}

/** A line's text on the diff, after its `+`, `-` or space, or undefined when the diff doesn't show it. */
export function lineTextOf(
  diff: DeckPullRequestDiff,
  anchor: { path: string; side: CodeHostDiffSide; line: number },
) {
  return findLine(diff, anchor)?.text;
}

/** Adds a comment on lines of `headSha`. A blank comment adds nothing. */
export function addDraftComment(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  input: {
    headSha: string;
    anchor: CodeHostLineAnchor;
    body: string;
    lineText: string;
  },
  { now, createId }: { now: number; createId: () => string },
): { reviews: DeckDraftReview[]; comment?: DeckDraftComment } {
  if (!input.body.trim()) return { reviews: [...reviews] };
  const { path, side, line, startLine } = input.anchor;
  const comment: DeckDraftComment = {
    id: createId(),
    path,
    side,
    line,
    ...(startLine !== undefined && startLine < line ? { startLine } : {}),
    body: input.body,
    lineText: input.lineText,
    createdAt: now,
    updatedAt: now,
  };
  const draft = draftReviewOf(reviews, ref);
  return {
    reviews: withDraft(reviews, ref, {
      pluginId: ref.pluginId,
      connectionId: ref.connectionId,
      repository: ref.repository,
      number: ref.number,
      headSha: draft?.headSha ?? input.headSha,
      comments: [...(draft?.comments ?? []), comment],
      updatedAt: now,
    }),
    comment,
  };
}

/** Changes a comment's words. A blank edit changes nothing: removing is its own action. */
export function editDraftComment(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  commentId: string,
  body: string,
  now: number,
): readonly DeckDraftReview[] {
  const draft = draftReviewOf(reviews, ref);
  if (!body.trim() || !draft?.comments.some(({ id }) => id === commentId))
    return reviews;
  return withDraft(reviews, ref, {
    ...draft,
    comments: draft.comments.map((comment) =>
      comment.id === commentId ? { ...comment, body, updatedAt: now } : comment,
    ),
    updatedAt: now,
  });
}

/** Removes a comment; the draft goes with its last one. */
export function removeDraftComment(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  commentId: string,
): readonly DeckDraftReview[] {
  return completeDraftComments(reviews, ref, [commentId]);
}

/** Drops the pull request's draft review. */
export function discardDraftReview(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
): readonly DeckDraftReview[] {
  return draftReviewOf(reviews, ref)
    ? withDraft(reviews, ref, undefined)
    : reviews;
}

/**
 * After the page read the pull request at a new head: a current comment
 * whose line no longer reads as it did is marked outdated, and the others
 * move to the new head. `outdated` counts the comments it marked.
 */
export function refreshDraftReview(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  diff: DeckPullRequestDiff,
): { reviews: readonly DeckDraftReview[]; outdated: number } {
  const draft = draftReviewOf(reviews, ref);
  if (!draft || draft.headSha === diff.headSha) return { reviews, outdated: 0 };
  let outdated = 0;
  const comments = draft.comments.map((comment) => {
    if (comment.outdated || lineTextOf(diff, comment) === comment.lineText)
      return comment;
    outdated += 1;
    return { ...comment, outdated: true as const };
  });
  return {
    reviews: withDraft(reviews, ref, {
      ...draft,
      headSha: diff.headSha,
      comments,
    }),
    outdated,
  };
}

/** A current draft comment on a line the diff shows. */
export interface PlacedDraft {
  comment: DeckDraftComment;
  hunkId: string;
  side: AnnotationSide;
  line: number;
  row: number;
}

/**
 * The draft's current comments on the lines of the diff, in file, hunk and
 * row order, and the others (outdated, or on lines it doesn't show), for
 * the page to list apart.
 */
export function placeDrafts(
  diff: DeckPullRequestDiff,
  draft: DeckDraftReview | undefined,
): { placed: PlacedDraft[]; elsewhere: DeckDraftComment[] } {
  const order = new Map<string, number>();
  let index = 0;
  for (const file of diff.files)
    for (const hunk of file.hunks) order.set(hunk.id, index++);
  const placed: (PlacedDraft & { order: number })[] = [];
  const elsewhere: DeckDraftComment[] = [];
  for (const comment of draft?.comments ?? []) {
    const at =
      comment.outdated || draft?.headSha !== diff.headSha
        ? undefined
        : findLine(diff, comment);
    if (!at) {
      elsewhere.push(comment);
      continue;
    }
    placed.push({
      comment,
      hunkId: at.hunkId,
      side: at.side,
      line: at.line,
      row: at.row,
      order: order.get(at.hunkId)!,
    });
  }
  placed.sort((a, b) => a.order - b.order || a.row - b.row);
  return {
    placed: placed.map(({ order: _order, ...entry }) => entry),
    elsewhere,
  };
}

/**
 * What Finish review sends: the verdict, the summary when there is one, and
 * every current comment on its line at the draft's head. Outdated comments
 * stay in the draft (`kept`). `sent` names the comments the request holds.
 */
export function finishReviewRequest(
  draft: DeckDraftReview,
  {
    verdict,
    body,
  }: { verdict: CodeHostSubmitReviewRequest["verdict"]; body: string },
): {
  request: CodeHostSubmitReviewRequest;
  sent: string[];
  kept: string[];
} {
  const current = draft.comments.filter((comment) => !comment.outdated);
  const summary = body.trim();
  return {
    request: {
      repository: draft.repository,
      number: draft.number,
      headSha: draft.headSha,
      verdict,
      ...(summary ? { body: summary } : {}),
      comments: current.map((comment) => ({
        path: comment.path,
        side: comment.side,
        line: comment.line,
        ...(comment.startLine !== undefined
          ? { startLine: comment.startLine }
          : {}),
        body: comment.body,
      })),
    },
    sent: current.map((comment) => comment.id),
    kept: draft.comments
      .filter((comment) => comment.outdated)
      .map((comment) => comment.id),
  };
}

/** Takes out of the draft the comments the code host accepted; the draft goes once it's empty. */
export function completeDraftComments(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  commentIds: readonly string[],
): readonly DeckDraftReview[] {
  const draft = draftReviewOf(reviews, ref);
  if (!draft) return reviews;
  const done = new Set(commentIds);
  const comments = draft.comments.filter((comment) => !done.has(comment.id));
  if (comments.length === draft.comments.length) return reviews;
  return withDraft(reviews, ref, { ...draft, comments });
}

const storedCommentSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  side: z.enum(["base", "head"]),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().optional(),
  body: z.string(),
  lineText: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  outdated: z.literal(true).optional(),
});

const storedDraftSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: z.string().min(1),
  number: z.number().int().positive(),
  headSha: z.string().min(1),
  comments: z.array(storedCommentSchema).min(1),
  updatedAt: z.number().int().nonnegative(),
});

/** The stored draft reviews it can read. */
export function normalizeDraftReviews(value: unknown): DeckDraftReview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DeckDraftReview[] => {
    const parsed = storedDraftSchema.safeParse(raw);
    return parsed.success ? [parsed.data as DeckDraftReview] : [];
  });
}
