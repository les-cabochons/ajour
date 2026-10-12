import { z } from "zod";

/*
 * The code host capability: a plugin provides the user's pull requests as
 * provider-neutral facts and carries out the user's reviews, comments and
 * merges. Ajour derives the pull request lifecycle from the facts. See ADR
 * 0002 and ADR 0003, and docs/superpowers/specs/2026-10-11-code-host-pull-requests-design.md.
 *
 * Times are Unix milliseconds. A repository is its full name in the code
 * host, such as "acme/api".
 */

const idSchema = z.string().trim().min(1).max(400);
const timeSchema = z.number().int().nonnegative();
const repositorySchema = z.string().trim().min(1).max(240);
const pullRequestNumberSchema = z.number().int().positive();
const bodySchema = z.string().max(65_536);
const pathSchema = z.string().min(1).max(1_000);
const shaSchema = z.string().trim().min(1).max(120);

export const codeHostUserSchema = z.object({
  login: z.string().trim().min(1).max(120),
  displayName: z.string().trim().max(240).optional(),
  /** The code host marks the account as a bot, such as Dependabot. */
  isBot: z.boolean(),
  avatarUrl: z.string().url().optional(),
});
export type CodeHostUser = z.infer<typeof codeHostUserSchema>;

export const codeHostReviewVerdictSchema = z.enum([
  "approved",
  "changes_requested",
  "commented",
  "dismissed",
]);
export type CodeHostReviewVerdict = z.infer<typeof codeHostReviewVerdictSchema>;

export const codeHostReviewRequestSchema = z.object({
  kind: z.enum(["user", "team"]),
  name: z.string().trim().min(1).max(240),
  /** The request is for the user, directly or through one of their teams. */
  includesViewer: z.boolean(),
});
export type CodeHostReviewRequest = z.infer<typeof codeHostReviewRequestSchema>;

export const codeHostReviewFactSchema = z.object({
  id: idSchema,
  author: codeHostUserSchema,
  verdict: codeHostReviewVerdictSchema,
  submittedAt: timeSchema,
});
export type CodeHostReviewFact = z.infer<typeof codeHostReviewFactSchema>;

export const codeHostCommentFactSchema = z.object({
  id: idSchema,
  author: codeHostUserSchema,
  createdAt: timeSchema,
  /** Review thread the comment belongs to. Absent for conversation comments. */
  threadId: idSchema.optional(),
  mentionsViewer: z.boolean(),
});
export type CodeHostCommentFact = z.infer<typeof codeHostCommentFactSchema>;

export const codeHostPullRequestStateSchema = z.enum([
  "open",
  "merged",
  "closed",
]);
export type CodeHostPullRequestState = z.infer<
  typeof codeHostPullRequestStateSchema
>;

export const codeHostCheckStateSchema = z.enum([
  "none",
  "pending",
  "success",
  "failure",
]);
export type CodeHostCheckState = z.infer<typeof codeHostCheckStateSchema>;

export const codeHostMergeabilitySchema = z.enum([
  "mergeable",
  "conflicting",
  "unknown",
]);
export type CodeHostMergeability = z.infer<typeof codeHostMergeabilitySchema>;

export const codeHostMergeMethodSchema = z.enum(["merge", "squash", "rebase"]);
export type CodeHostMergeMethod = z.infer<typeof codeHostMergeMethodSchema>;

/** Identifies a pull request in a code host connection. */
export const codeHostPullRequestRefSchema = z.object({
  repository: repositorySchema,
  number: pullRequestNumberSchema,
});
export type CodeHostPullRequestRef = z.infer<
  typeof codeHostPullRequestRefSchema
>;

export const codeHostPullRequestSummarySchema =
  codeHostPullRequestRefSchema.extend({
    id: idSchema,
    url: z.string().url(),
    title: z.string().trim().min(1).max(1_000),
    author: codeHostUserSchema,
    state: codeHostPullRequestStateSchema,
    draft: z.boolean(),
    createdAt: timeSchema,
    updatedAt: timeSchema,
    closedAt: timeSchema.optional(),
  });
export type CodeHostPullRequestSummary = z.infer<
  typeof codeHostPullRequestSummarySchema
>;

export const codeHostPullRequestFactsSchema =
  codeHostPullRequestSummarySchema.extend({
    viewerIsAuthor: z.boolean(),
    headSha: shaSchema,
    lastPushedAt: timeSchema,
    reviewRequests: z.array(codeHostReviewRequestSchema).max(100),
    reviews: z.array(codeHostReviewFactSchema).max(500),
    comments: z.array(codeHostCommentFactSchema).max(2_000),
    checks: codeHostCheckStateSchema,
    mergeability: codeHostMergeabilitySchema,
  });
export type CodeHostPullRequestFacts = z.infer<
  typeof codeHostPullRequestFactsSchema
>;

export const codeHostSyncRequestSchema = z.object({
  /**
   * Pull requests Ajour already tracks. The plugin returns a tracked pull
   * request that closed, so Ajour sees it close. A tracked open pull request
   * missing from the result no longer passes the connection's filters, or the
   * token can no longer see it.
   */
  tracked: z.array(codeHostPullRequestRefSchema).max(1_000),
});
export type CodeHostSyncRequest = z.infer<typeof codeHostSyncRequestSchema>;

export const codeHostSyncResultSchema = z.object({
  viewer: codeHostUserSchema,
  pullRequests: z.array(codeHostPullRequestFactsSchema).max(1_000),
});
export type CodeHostSyncResult = z.infer<typeof codeHostSyncResultSchema>;

export const codeHostFileStatusSchema = z.enum([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
]);

export const codeHostChangedFileSchema = z.object({
  path: pathSchema,
  previousPath: pathSchema.optional(),
  status: codeHostFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** Unified diff hunks. Absent for binary files or when too large. */
  patch: z.string().max(2_000_000).optional(),
  binary: z.boolean(),
});
export type CodeHostChangedFile = z.infer<typeof codeHostChangedFileSchema>;

export const codeHostContentRequestSchema = codeHostPullRequestRefSchema;
export type CodeHostContentRequest = z.infer<
  typeof codeHostContentRequestSchema
>;

export const codeHostContentResultSchema = z.object({
  headSha: shaSchema,
  baseSha: shaSchema,
  files: z.array(codeHostChangedFileSchema).max(3_000),
});
export type CodeHostContentResult = z.infer<typeof codeHostContentResultSchema>;

export const codeHostFileContentRequestSchema = z.object({
  repository: repositorySchema,
  sha: shaSchema,
  path: pathSchema,
});
export type CodeHostFileContentRequest = z.infer<
  typeof codeHostFileContentRequestSchema
>;

export const codeHostFileContentResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string().max(5_000_000) }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("missing") }),
]);
export type CodeHostFileContentResult = z.infer<
  typeof codeHostFileContentResultSchema
>;

export const codeHostThreadCommentSchema = z.object({
  id: idSchema,
  author: codeHostUserSchema,
  body: bodySchema,
  createdAt: timeSchema,
  updatedAt: timeSchema.optional(),
});
export type CodeHostThreadComment = z.infer<typeof codeHostThreadCommentSchema>;

export const codeHostDiffSideSchema = z.enum(["base", "head"]);
export type CodeHostDiffSide = z.infer<typeof codeHostDiffSideSchema>;

export const codeHostReviewThreadSchema = z.object({
  id: idSchema,
  path: pathSchema,
  side: codeHostDiffSideSchema,
  /** Absent when the thread no longer maps to a line of the latest diff. */
  line: z.number().int().positive().optional(),
  startLine: z.number().int().positive().optional(),
  resolved: z.boolean(),
  outdated: z.boolean(),
  comments: z.array(codeHostThreadCommentSchema).min(1).max(500),
});
export type CodeHostReviewThread = z.infer<typeof codeHostReviewThreadSchema>;

export const codeHostTimelineEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("comment"),
    id: idSchema,
    author: codeHostUserSchema,
    body: bodySchema,
    createdAt: timeSchema,
  }),
  z.object({
    kind: z.literal("review"),
    id: idSchema,
    author: codeHostUserSchema,
    verdict: codeHostReviewVerdictSchema,
    body: bodySchema,
    createdAt: timeSchema,
  }),
  z.object({
    kind: z.literal("commit"),
    sha: shaSchema,
    headline: z.string().max(1_000),
    authorName: z.string().max(240),
    createdAt: timeSchema,
  }),
  /** Any other event, already phrased by the plugin, such as "renamed the title". */
  z.object({
    kind: z.literal("event"),
    id: idSchema,
    actor: codeHostUserSchema.optional(),
    text: z.string().min(1).max(1_000),
    createdAt: timeSchema,
  }),
]);
export type CodeHostTimelineEvent = z.infer<typeof codeHostTimelineEventSchema>;

export const codeHostConversationRequestSchema = codeHostPullRequestRefSchema;
export type CodeHostConversationRequest = z.infer<
  typeof codeHostConversationRequestSchema
>;

export const codeHostConversationResultSchema = z.object({
  description: bodySchema,
  timeline: z.array(codeHostTimelineEventSchema).max(5_000),
  threads: z.array(codeHostReviewThreadSchema).max(2_000),
  viewedPaths: z.array(pathSchema).max(3_000),
  mergeMethods: z.array(codeHostMergeMethodSchema).max(3),
});
export type CodeHostConversationResult = z.infer<
  typeof codeHostConversationResultSchema
>;

export const codeHostBrowseRequestSchema = z.object({
  repository: repositorySchema.optional(),
  state: z.enum(["open", "merged", "closed", "all"]).default("all"),
  author: z.string().trim().min(1).max(120).optional(),
  text: z.string().trim().min(1).max(240).optional(),
  cursor: z.string().min(1).max(1_000).optional(),
});
export type CodeHostBrowseRequest = z.input<typeof codeHostBrowseRequestSchema>;

export const codeHostBrowseResultSchema = z.object({
  items: z.array(codeHostPullRequestSummarySchema).max(100),
  nextCursor: z.string().min(1).max(1_000).optional(),
});
export type CodeHostBrowseResult = z.infer<typeof codeHostBrowseResultSchema>;

/** A comment anchored to lines of the diff at `headSha`. */
export const codeHostLineAnchorSchema = z.object({
  path: pathSchema,
  side: codeHostDiffSideSchema,
  line: z.number().int().positive(),
  startLine: z.number().int().positive().optional(),
});
export type CodeHostLineAnchor = z.infer<typeof codeHostLineAnchorSchema>;

export const codeHostSubmitReviewRequestSchema =
  codeHostPullRequestRefSchema.extend({
    headSha: shaSchema,
    verdict: z.enum(["approve", "request_changes", "comment"]),
    body: bodySchema.optional(),
    comments: z
      .array(codeHostLineAnchorSchema.extend({ body: bodySchema.min(1) }))
      .max(500),
  });
export type CodeHostSubmitReviewRequest = z.infer<
  typeof codeHostSubmitReviewRequestSchema
>;

export const codeHostSubmitReviewResultSchema = z.object({
  reviewId: idSchema,
});

/** A single comment: on the conversation, or on lines when `anchor` is set. */
export const codeHostPostCommentRequestSchema =
  codeHostPullRequestRefSchema.extend({
    body: bodySchema.min(1),
    anchor: codeHostLineAnchorSchema.extend({ headSha: shaSchema }).optional(),
  });
export type CodeHostPostCommentRequest = z.infer<
  typeof codeHostPostCommentRequestSchema
>;

export const codeHostCommentResultSchema = z.object({ commentId: idSchema });

export const codeHostReplyRequestSchema = codeHostPullRequestRefSchema.extend({
  threadId: idSchema,
  body: bodySchema.min(1),
});
export type CodeHostReplyRequest = z.infer<typeof codeHostReplyRequestSchema>;

export const codeHostResolveThreadRequestSchema =
  codeHostPullRequestRefSchema.extend({
    threadId: idSchema,
    resolved: z.boolean(),
  });
export type CodeHostResolveThreadRequest = z.infer<
  typeof codeHostResolveThreadRequestSchema
>;

export const codeHostResolveThreadResultSchema = z.object({
  resolved: z.boolean(),
});

export const codeHostSetFileViewedRequestSchema =
  codeHostPullRequestRefSchema.extend({
    path: pathSchema,
    viewed: z.boolean(),
  });
export type CodeHostSetFileViewedRequest = z.infer<
  typeof codeHostSetFileViewedRequestSchema
>;

export const codeHostSetFileViewedResultSchema = z.object({
  viewed: z.boolean(),
});

export const codeHostUpdatePullRequestRequestSchema =
  codeHostPullRequestRefSchema
    .extend({
      title: z.string().trim().min(1).max(1_000).optional(),
      draft: z.boolean().optional(),
    })
    .refine(
      (request) => request.title !== undefined || request.draft !== undefined,
      "A pull request update needs a title, a draft state or both.",
    );
export type CodeHostUpdatePullRequestRequest = z.infer<
  typeof codeHostUpdatePullRequestRequestSchema
>;

export const codeHostUpdatePullRequestResultSchema = z.object({
  title: z.string().trim().min(1).max(1_000),
  draft: z.boolean(),
});

export const codeHostMergeRequestSchema = codeHostPullRequestRefSchema.extend({
  method: codeHostMergeMethodSchema,
  /** The head the user reviewed. The code host refuses the merge if it moved. */
  headSha: shaSchema,
  commitTitle: z.string().trim().min(1).max(1_000).optional(),
  commitMessage: bodySchema.optional(),
});
export type CodeHostMergeRequest = z.infer<typeof codeHostMergeRequestSchema>;

export const codeHostMergeResultSchema = z.object({
  mergeCommitSha: shaSchema.optional(),
});

/**
 * Every code host operation, keyed by the function name the plugin exports.
 * Each export receives the connection and the parsed request.
 */
export const codeHostOperations = {
  syncPullRequests: {
    request: codeHostSyncRequestSchema,
    result: codeHostSyncResultSchema,
  },
  getPullRequestContent: {
    request: codeHostContentRequestSchema,
    result: codeHostContentResultSchema,
  },
  getFileContent: {
    request: codeHostFileContentRequestSchema,
    result: codeHostFileContentResultSchema,
  },
  getPullRequestConversation: {
    request: codeHostConversationRequestSchema,
    result: codeHostConversationResultSchema,
  },
  browsePullRequests: {
    request: codeHostBrowseRequestSchema,
    result: codeHostBrowseResultSchema,
  },
  submitReview: {
    request: codeHostSubmitReviewRequestSchema,
    result: codeHostSubmitReviewResultSchema,
  },
  postComment: {
    request: codeHostPostCommentRequestSchema,
    result: codeHostCommentResultSchema,
  },
  replyToThread: {
    request: codeHostReplyRequestSchema,
    result: codeHostCommentResultSchema,
  },
  setThreadResolved: {
    request: codeHostResolveThreadRequestSchema,
    result: codeHostResolveThreadResultSchema,
  },
  setFileViewed: {
    request: codeHostSetFileViewedRequestSchema,
    result: codeHostSetFileViewedResultSchema,
  },
  updatePullRequest: {
    request: codeHostUpdatePullRequestRequestSchema,
    result: codeHostUpdatePullRequestResultSchema,
  },
  mergePullRequest: {
    request: codeHostMergeRequestSchema,
    result: codeHostMergeResultSchema,
  },
} as const;

export type CodeHostOperation = keyof typeof codeHostOperations;

export const codeHostOperationSchema = z.enum(
  Object.keys(codeHostOperations) as [
    CodeHostOperation,
    ...CodeHostOperation[],
  ],
);

export type CodeHostOperationRequest<Operation extends CodeHostOperation> =
  z.input<(typeof codeHostOperations)[Operation]["request"]>;
export type CodeHostOperationResult<Operation extends CodeHostOperation> =
  z.infer<(typeof codeHostOperations)[Operation]["result"]>;
