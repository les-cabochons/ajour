import { z } from "zod";
import type {
  CodeHostDiffSide,
  CodeHostLineAnchor,
  CodeHostPostCommentRequest,
  CodeHostSubmitReviewRequest,
} from "@ajour/shared";
import { deckLineText, type DeckPullRequestDiff } from "@ajour/shared/deck";
import { findLine, inDiffOrder, type AnnotationSide } from "./review-threads";

/*
 * The draft review (#784, ADR 0002): line comments a reviewer collects on a
 * pull request, kept in the renderer's local state across restarts, and
 * sent all at once with a verdict by Finish review. Nothing here is a
 * write to the code host: a submit that fails leaves the draft as it was.
 *
 * Each comment keeps the text of its lines, so a refresh to a new head can
 * tell which lines changed: a comment on one is marked outdated, stays in
 * the draft and isn't sent on a line any more. A pull request that closes
 * keeps its draft, to post as comments or discard.
 *
 * Finish review names its request with a submission id kept in the draft
 * before anything is sent, so Retry, after a restart too, sends the same
 * name, and the plugin finds what an earlier try left on the code host
 * instead of posting it twice. Changing what the review sends makes it a
 * new submission; the code host taking it clears the name. A retry says
 * when the first try was sent, a hint for which unmarked post of the
 * user's may be that try's. When the
 * plugin can't tell whether an earlier try reached the code host, the user
 * chooses to post again, as a new submission.
 *
 * A closed pull request's comments post one at a time, each named the same
 * way and kept with its comment before it's sent.
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
  /**
   * The text of its lines when the comment was written, from `startLine`
   * to `line`, one per row, to tell whether a push changed any of them.
   */
  lineText: string;
  createdAt: number;
  updatedAt: number;
  /** A push changed or removed the line: the comment isn't sent on it. */
  outdated?: true;
  /** Its post on its own, from a closed pull request, until the code host confirms it. */
  submission?: DeckReviewSubmission;
}

/** A Finish review the code host hasn't confirmed yet: tried, and failed or still sending. */
export interface DeckReviewSubmission {
  /** The request's `submissionId`. */
  id: string;
  /** What it sends, its verdict, summary and comments: anything else is a new submission. */
  key: string;
  /** When its first try was sent, in milliseconds since the epoch. */
  triedAt: number;
}

/**
 * The submission for what `key` names: the stored one when it sends the
 * same and the user didn't ask to post again, or a new one tried `now`.
 * `firstTriedAt` is set on a retry.
 */
export function nameSubmission(
  stored: DeckReviewSubmission | undefined,
  key: string,
  again: boolean,
  { now, createId }: { now: number; createId: () => string },
) {
  const submission =
    !again && stored?.key === key
      ? stored
      : { id: createId(), key, triedAt: now };
  return {
    submission,
    fields: {
      submissionId: submission.id,
      ...(submission === stored ? { firstTriedAt: submission.triedAt } : {}),
    },
  };
}

export interface DeckDraftReview extends DeckReviewRef {
  /** The head the current comments' lines are on. */
  headSha: string;
  /** Empty only while a review without comments is being submitted. */
  comments: DeckDraftComment[];
  submission?: DeckReviewSubmission;
  updatedAt: number;
}

/** Whether two refs name the same pull request: the repository by any case. */
export const sameReviewRef = (review: DeckReviewRef, ref: DeckReviewRef) =>
  review.pluginId === ref.pluginId &&
  review.connectionId === ref.connectionId &&
  review.repository.toLowerCase() === ref.repository.toLowerCase() &&
  review.number === ref.number;

/** The pull request's draft review, when it has one. */
export function draftReviewOf(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
) {
  return reviews.find((review) => sameReviewRef(review, ref));
}

/** The reviews with the pull request's draft replaced, or dropped once it has no comments and no submission. */
function withDraft(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  next: DeckDraftReview | undefined,
): DeckDraftReview[] {
  const others = reviews.filter((review) => !sameReviewRef(review, ref));
  return next && (next.comments.length || next.submission)
    ? [...others, next]
    : others;
}

/**
 * Whether the pull request's draft holds comments on another head than
 * `headSha`: a comment on lines of `headSha` can't join it until the page
 * reads the new head and moves the draft there. Deck's chat (#796) adds
 * nothing then.
 */
export function draftOnOtherHead(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  headSha: string,
) {
  const draft = draftReviewOf(reviews, ref);
  return draft !== undefined && draft.headSha !== headSha;
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
  const comment: DeckDraftComment = {
    id: createId(),
    ...lineAnchor(input.anchor),
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
    if (comment.outdated || deckLineText(diff, comment) === comment.lineText)
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
  const placed: PlacedDraft[] = [];
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
    });
  }
  return { placed: inDiffOrder(diff, placed), elsewhere };
}

/** Lines of the diff as the code host contract names them, without an empty `startLine`. */
export function lineAnchor(lines: {
  path: string;
  side: CodeHostDiffSide;
  line: number;
  startLine?: number;
}): CodeHostLineAnchor {
  return {
    path: lines.path,
    side: lines.side,
    line: lines.line,
    ...(lines.startLine !== undefined && lines.startLine < lines.line
      ? { startLine: lines.startLine }
      : {}),
  };
}

/** A comment a review sent, with the words it sent. */
export interface DeckSentComment {
  id: string;
  body: string;
}

/**
 * What Finish review sends: the verdict, the summary when there is one, and
 * every current comment on its line at the draft's head. Outdated comments
 * stay in the draft (`kept`). `sent` names the comments the request holds,
 * with their words.
 */
export function finishReviewRequest(
  draft: DeckDraftReview,
  {
    verdict,
    body,
  }: { verdict: CodeHostSubmitReviewRequest["verdict"]; body: string },
): {
  request: CodeHostSubmitReviewRequest;
  sent: DeckSentComment[];
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
        ...lineAnchor(comment),
        body: comment.body,
      })),
    },
    sent: current.map(({ id, body }) => ({ id, body })),
    kept: draft.comments
      .filter((comment) => comment.outdated)
      .map((comment) => comment.id),
  };
}

/**
 * What a Finish review sends, as its submission's key. The head isn't part
 * of it: a retry after a push is the same review.
 */
function submissionKey(
  request: CodeHostSubmitReviewRequest,
  draft: DeckDraftReview,
  sent: readonly DeckSentComment[],
) {
  const edited = new Map(
    draft.comments.map((comment) => [comment.id, comment.updatedAt]),
  );
  return JSON.stringify([
    request.verdict,
    request.body ?? "",
    sent.map(({ id }) => [id, edited.get(id)]),
  ]);
}

/**
 * Finish review's request, named: the draft's submission id when the
 * review sends what the last try did, or a new one. The draft keeps it,
 * a review without comments in a draft of its own, so the caller stores
 * `reviews` before it sends `request`.
 */
export function prepareReviewSubmission(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  input: {
    headSha: string;
    verdict: CodeHostSubmitReviewRequest["verdict"];
    body: string;
    /** The user chose to post again after an uncertain try: a new submission. */
    again?: boolean;
  },
  { now, createId }: { now: number; createId: () => string },
): {
  reviews: DeckDraftReview[];
  request: CodeHostSubmitReviewRequest;
  sent: DeckSentComment[];
} {
  const draft: DeckDraftReview = draftReviewOf(reviews, ref) ?? {
    pluginId: ref.pluginId,
    connectionId: ref.connectionId,
    repository: ref.repository,
    number: ref.number,
    headSha: input.headSha,
    comments: [],
    updatedAt: now,
  };
  const { request, sent } = finishReviewRequest(draft, input);
  const { submission, fields } = nameSubmission(
    draft.submission,
    submissionKey(request, draft, sent),
    input.again ?? false,
    { now, createId },
  );
  return {
    reviews: withDraft(reviews, ref, { ...draft, submission }),
    request: { ...request, ...fields },
    sent,
  };
}

/**
 * A closed pull request's comment as a post of its own, named: its stored
 * name when its words are what the last try sent, or a new one. The draft
 * keeps it, so the caller stores `reviews` before it sends `request`, and
 * `completeDraftComments` takes the comment out once the code host has it.
 */
export function prepareCommentPost(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  commentId: string,
  { again = false }: { again?: boolean },
  { now, createId }: { now: number; createId: () => string },
): { reviews: DeckDraftReview[]; request?: CodeHostPostCommentRequest } {
  const draft = draftReviewOf(reviews, ref);
  const comment = draft?.comments.find(({ id }) => id === commentId);
  if (!draft || !comment) return { reviews: [...reviews] };
  const { submission, fields } = nameSubmission(
    comment.submission,
    JSON.stringify([comment.body, comment.updatedAt]),
    again,
    { now, createId },
  );
  return {
    reviews: withDraft(reviews, ref, {
      ...draft,
      comments: draft.comments.map((each) =>
        each.id === commentId ? { ...comment, submission } : each,
      ),
    }),
    request: {
      repository: draft.repository,
      number: draft.number,
      body: comment.body,
      anchor: { ...lineAnchor(comment), headSha: draft.headSha },
      ...fields,
    },
  };
}

/**
 * After the code host took the review: the comments it sent leave the
 * draft, and so does its submission. A comment the user edited while the
 * review was sending stays, with its new words, as a draft to send again.
 */
export function completeReviewSubmission(
  reviews: readonly DeckDraftReview[],
  ref: DeckReviewRef,
  sent: readonly DeckSentComment[],
): readonly DeckDraftReview[] {
  const draft = draftReviewOf(reviews, ref);
  if (!draft) return reviews;
  const done = new Map(sent.map(({ id, body }) => [id, body]));
  const { submission: _confirmed, ...rest } = draft;
  return withDraft(reviews, ref, {
    ...rest,
    comments: draft.comments.filter(
      (comment) => done.get(comment.id) !== comment.body,
    ),
  });
}

/**
 * Each verdict's name on the pull request's code host. Azure DevOps votes,
 * so a request for changes is its "Wait for author" vote there.
 */
export function reviewVerdicts(
  pluginId: string,
): Record<CodeHostSubmitReviewRequest["verdict"], string> {
  return {
    comment: "Comment",
    request_changes:
      pluginId === "azure_devops" ? "Wait for author" : "Request changes",
    approve: "Approve",
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

const storedSubmissionSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,100}$/),
    key: z.string(),
    // Absent in drafts named before retries said when they began: look back fully.
    triedAt: z.number().int().nonnegative().default(0),
  })
  .optional();

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
  submission: storedSubmissionSchema,
});

/** A stored draft, its comments read one by one: one it can't read drops alone. */
const storedDraftSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: z.string().min(1),
  number: z.number().int().positive(),
  headSha: z.string().min(1),
  comments: z.array(z.unknown()),
  submission: storedSubmissionSchema,
  updatedAt: z.number().int().nonnegative(),
});

/** The stored draft reviews it can read, each with the comments it can read. */
export function normalizeDraftReviews(value: unknown): DeckDraftReview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DeckDraftReview[] => {
    const parsed = storedDraftSchema.safeParse(raw);
    if (!parsed.success) return [];
    const comments = parsed.data.comments.flatMap((comment) => {
      const read = storedCommentSchema.safeParse(comment);
      return read.success ? [read.data] : [];
    });
    // A draft left with nothing to send goes.
    if (comments.length === 0 && !parsed.data.submission) return [];
    return [{ ...parsed.data, comments } as DeckDraftReview];
  });
}
