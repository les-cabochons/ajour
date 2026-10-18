import { z } from "zod";

/**
 * Comments on synced backlog items (ADR 0008). Ajour asks the plugin when the
 * item page opens and never stores the text. The plugin converts the source's
 * format to Markdown and writes a mention as `[@Name](mention:<id>)`, where the
 * id stays opaque to Ajour.
 */

/** Ajour's own reaction names. A plugin maps them to its source's reactions. */
export const backlogReactions = [
  "like",
  "dislike",
  "heart",
  "hooray",
  "laugh",
  "confused",
  "rocket",
  "eyes",
] as const;
export const backlogReactionSchema = z.enum(backlogReactions);
export type BacklogReaction = z.infer<typeof backlogReactionSchema>;

/**
 * Declared as `capabilities.connector.comments`. Having the key means the
 * plugin lists and posts comments; each flag adds what its source supports.
 */
export const backlogCommentsCapabilitySchema = z.object({
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
  /** The reactions the source supports, in Ajour's names. */
  reactions: z
    .array(backlogReactionSchema)
    .max(backlogReactions.length)
    .optional(),
  mentions: z.boolean().optional(),
  /** The longest comment the source accepts, measured as the source measures it. */
  maxLength: z.number().int().min(1).max(10_000_000).optional(),
});
export type BacklogCommentsCapability = z.infer<
  typeof backlogCommentsCapabilitySchema
>;

/** A person in the source tool, in the same id space as comment authors. */
export const backlogPersonSchema = z.object({
  id: z.string().min(1).max(400),
  displayName: z.string().max(400),
});
export type BacklogPerson = z.infer<typeof backlogPersonSchema>;

export const backlogCommentReactionSchema = z.object({
  reaction: backlogReactionSchema,
  count: z.number().int().min(0),
  /** Whether the user is one of the people who reacted. */
  viewerReacted: z.boolean(),
});

export const backlogCommentSchema = z.object({
  id: z.string().min(1).max(400),
  author: backlogPersonSchema,
  /** Markdown, converted from the source's format by the plugin. */
  body: z.string().max(1_000_000),
  /** ISO 8601. */
  createdAt: z.string().min(1).max(40),
  /** ISO 8601, when the comment was edited after it was posted. */
  updatedAt: z.string().min(1).max(40).optional(),
  reactions: z
    .array(backlogCommentReactionSchema)
    .max(backlogReactions.length)
    .optional(),
  /** Who may read it, when the source restricts it, such as a Jira group. */
  restrictedTo: z.string().max(200).optional(),
});
export type BacklogComment = z.infer<typeof backlogCommentSchema>;

export const backlogListItemCommentsRequestSchema = z.object({
  /** The item's `sourceId` in its connection. */
  sourceId: z.string().min(1).max(400),
  limit: z.number().int().min(1).max(50),
  /** An `earlierCursor` from a previous answer, to load the page before it. */
  cursor: z.string().min(1).max(2_000).optional(),
});
export type BacklogListItemCommentsRequest = z.infer<
  typeof backlogListItemCommentsRequestSchema
>;

export const backlogListItemCommentsResultSchema = z.object({
  /** The user, so Ajour can tell which comments are theirs. */
  viewer: backlogPersonSchema,
  /** Oldest first: the newest `limit` comments before the cursor. */
  comments: z.array(backlogCommentSchema).max(50),
  /** How many comments the item has, when the source says. */
  total: z.number().int().min(0).optional(),
  /** Set when earlier comments exist. */
  earlierCursor: z.string().min(1).max(2_000).optional(),
});
export type BacklogListItemCommentsResult = z.infer<
  typeof backlogListItemCommentsResultSchema
>;

/** The most text Ajour sends in one comment, whatever the source allows. */
export const BACKLOG_COMMENT_MAX_LENGTH = 1_000_000;

export const backlogPostItemCommentRequestSchema = z.object({
  sourceId: z.string().min(1).max(400),
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: z.string().trim().min(1).max(BACKLOG_COMMENT_MAX_LENGTH),
});
export type BacklogPostItemCommentRequest = z.infer<
  typeof backlogPostItemCommentRequestSchema
>;

export const backlogPostItemCommentResultSchema = z.object({
  /** The comment as the source stored it. */
  comment: backlogCommentSchema,
});
export type BacklogPostItemCommentResult = z.infer<
  typeof backlogPostItemCommentResultSchema
>;

const commentRefSchema = z.object({
  sourceId: z.string().min(1).max(400),
  commentId: z.string().min(1).max(400),
});

/** Needs `comments.edit`. Ajour offers it on the user's own comments only. */
export const backlogEditItemCommentRequestSchema = commentRefSchema.extend({
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: z.string().trim().min(1).max(BACKLOG_COMMENT_MAX_LENGTH),
});
export type BacklogEditItemCommentRequest = z.infer<
  typeof backlogEditItemCommentRequestSchema
>;

export const backlogEditItemCommentResultSchema =
  backlogPostItemCommentResultSchema;
export type BacklogEditItemCommentResult = BacklogPostItemCommentResult;

/**
 * Needs `comments.delete`. Ajour offers it on the user's own comments only,
 * and sends it once the Undo toast closes (ADR 0008).
 */
export const backlogDeleteItemCommentRequestSchema = commentRefSchema;
export type BacklogDeleteItemCommentRequest = z.infer<
  typeof backlogDeleteItemCommentRequestSchema
>;
export const backlogDeleteItemCommentResultSchema = z.object({});

/** Adds or removes the user's reaction. Needs the reaction in `comments.reactions`. */
export const backlogSetItemCommentReactionRequestSchema =
  commentRefSchema.extend({
    reaction: backlogReactionSchema,
    reacted: z.boolean(),
  });
export type BacklogSetItemCommentReactionRequest = z.infer<
  typeof backlogSetItemCommentReactionRequestSchema
>;

export const backlogSetItemCommentReactionResultSchema = z.object({
  /** The comment's reactions after the change. */
  reactions: z.array(backlogCommentReactionSchema).max(backlogReactions.length),
});
export type BacklogSetItemCommentReactionResult = z.infer<
  typeof backlogSetItemCommentReactionResultSchema
>;

/** People to mention on the item, for the editor's @ suggestions. Needs `comments.mentions`. */
export const backlogSearchItemPeopleRequestSchema = z.object({
  sourceId: z.string().min(1).max(400),
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20),
});
export type BacklogSearchItemPeopleRequest = z.infer<
  typeof backlogSearchItemPeopleRequestSchema
>;

export const backlogSearchItemPeopleResultSchema = z.object({
  /** In the id space of `mention:<id>`. */
  people: z.array(backlogPersonSchema).max(20),
});
export type BacklogSearchItemPeopleResult = z.infer<
  typeof backlogSearchItemPeopleResultSchema
>;

/**
 * The comment exports a backlog plugin can provide. Each receives the
 * connection and the parsed request. Their names say "item" because a code
 * host plugin's comment exports live in the same module.
 */
export const backlogCommentOperations = {
  listItemComments: {
    request: backlogListItemCommentsRequestSchema,
    result: backlogListItemCommentsResultSchema,
  },
  /** Posting is part of the comments capability: no flag of its own. */
  postItemComment: {
    request: backlogPostItemCommentRequestSchema,
    result: backlogPostItemCommentResultSchema,
  },
  editItemComment: {
    request: backlogEditItemCommentRequestSchema,
    result: backlogEditItemCommentResultSchema,
  },
  deleteItemComment: {
    request: backlogDeleteItemCommentRequestSchema,
    result: backlogDeleteItemCommentResultSchema,
  },
  setItemCommentReaction: {
    request: backlogSetItemCommentReactionRequestSchema,
    result: backlogSetItemCommentReactionResultSchema,
  },
  searchItemPeople: {
    request: backlogSearchItemPeopleRequestSchema,
    result: backlogSearchItemPeopleResultSchema,
  },
} as const;

/**
 * Whether the declared features allow an operation. Listing and posting come
 * with the comments capability itself.
 */
export function backlogCommentOperationAllowed(
  capability: BacklogCommentsCapability,
  operation: BacklogCommentOperation,
  reaction?: BacklogReaction,
) {
  switch (operation) {
    case "editItemComment":
      return capability.edit === true;
    case "deleteItemComment":
      return capability.delete === true;
    case "searchItemPeople":
      return capability.mentions === true;
    case "setItemCommentReaction":
      return (
        reaction !== undefined &&
        (capability.reactions ?? []).includes(reaction)
      );
    default:
      return true;
  }
}

export type BacklogCommentOperation = keyof typeof backlogCommentOperations;

export const backlogCommentOperationSchema = z.enum(
  Object.keys(backlogCommentOperations) as [
    BacklogCommentOperation,
    ...BacklogCommentOperation[],
  ],
);

export type BacklogCommentOperationRequest<
  Operation extends BacklogCommentOperation,
> = z.input<(typeof backlogCommentOperations)[Operation]["request"]>;
export type BacklogCommentOperationResult<
  Operation extends BacklogCommentOperation,
> = z.infer<(typeof backlogCommentOperations)[Operation]["result"]>;
