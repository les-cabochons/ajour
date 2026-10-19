import {
  isCapabilityActive,
  type BacklogComment,
  type BacklogListItemCommentsResult,
  type BacklogReaction,
  type BacklogCommentsCapability,
  type BacklogPerson,
  type PluginsOverview,
} from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";

/**
 * Comments on synced backlog items (ADR 0008): which items have them and how
 * the thread reads. The text comes from the plugin when the page opens and is
 * never stored.
 */

/** Where a synced item's comments come from. */
export interface CommentSource {
  pluginId: string;
  connectionId: string;
  sourceId: string;
  capability: BacklogCommentsCapability;
}

/**
 * The plugin connection that serves the item's comments, or undefined when
 * the item is manual, its plugin has no comments, or its backlog capability
 * is off.
 */
export function commentSourceOf(
  item: Pick<LocalWorkItem, "source" | "sourceId" | "sourceConnectionId">,
  overview: PluginsOverview | null | undefined,
): CommentSource | undefined {
  if (
    item.source === "manual" ||
    !item.sourceId ||
    !item.sourceConnectionId ||
    !overview
  ) {
    return undefined;
  }
  const group = overview.connectionGroups.find(
    (candidate) => candidate.plugin.id === item.source,
  );
  const capability = group?.plugin.capabilities.connector?.comments;
  if (
    !group ||
    !capability ||
    !isCapabilityActive(group, "connector") ||
    !group.connections.some(
      (connection) => connection.id === item.sourceConnectionId,
    )
  ) {
    return undefined;
  }
  return {
    pluginId: item.source,
    connectionId: item.sourceConnectionId,
    sourceId: item.sourceId,
    capability,
  };
}

export function isOwnComment(comment: BacklogComment, viewer: BacklogPerson) {
  return comment.author.id === viewer.id;
}

/**
 * Where the New divider goes: before the first comment someone else posted
 * after the user last saw the thread. -1 on a first visit, when nothing is
 * new, or when only the user's own comments arrived since.
 */
export function firstNewCommentIndex(
  comments: readonly BacklogComment[],
  viewer: BacklogPerson,
  seenAt: number | undefined,
) {
  if (seenAt === undefined) return -1;
  return comments.findIndex(
    (comment) =>
      !isOwnComment(comment, viewer) && Date.parse(comment.createdAt) > seenAt,
  );
}

/** Whether the comment changed after it was posted. */
export function isEditedComment(comment: BacklogComment) {
  return (
    comment.updatedAt !== undefined &&
    Date.parse(comment.updatedAt) > Date.parse(comment.createdAt)
  );
}

/** Comments that arrive while earlier pages load, without duplicates. */
export function mergeEarlierComments(
  earlier: readonly BacklogComment[],
  loaded: readonly BacklogComment[],
) {
  const loadedIds = new Set(loaded.map((comment) => comment.id));
  return [
    ...earlier.filter((comment) => !loadedIds.has(comment.id)),
    ...loaded,
  ];
}

/** Whether the item still comes from the queued comment's thread. */
export function isCommentSourceOf(
  item: Pick<LocalWorkItem, "source" | "sourceId" | "sourceConnectionId">,
  thread: { pluginId: string; connectionId: string; sourceId: string },
) {
  return (
    item.source === thread.pluginId &&
    item.sourceConnectionId === thread.connectionId &&
    item.sourceId === thread.sourceId
  );
}

/**
 * A first page with the comments posted while it loaded at its end, once
 * each: its answer may predate them.
 */
export function withPostedComments(
  page: BacklogListItemCommentsResult,
  posted: readonly BacklogComment[],
): BacklogListItemCommentsResult {
  const shown = new Set(page.comments.map((comment) => comment.id));
  const missing = posted.filter((comment) => !shown.has(comment.id));
  return missing.length === 0
    ? page
    : {
        ...page,
        comments: [...page.comments, ...missing],
        total:
          page.total === undefined ? undefined : page.total + missing.length,
      };
}

/**
 * The reactions after the user adds or removes theirs, shown before the
 * source tool confirms. Reactions keep their order; a new one goes last.
 */
export function withViewerReaction(
  reactions: NonNullable<BacklogComment["reactions"]>,
  reaction: BacklogReaction,
  reacted: boolean,
): NonNullable<BacklogComment["reactions"]> {
  const existing = reactions.find((entry) => entry.reaction === reaction);
  if (!existing) {
    return reacted
      ? [...reactions, { reaction, count: 1, viewerReacted: true }]
      : reactions;
  }
  if (existing.viewerReacted === reacted) return reactions;
  return reactions.map((entry) =>
    entry.reaction === reaction
      ? {
          ...entry,
          count: Math.max(0, entry.count + (reacted ? 1 : -1)),
          viewerReacted: reacted,
        }
      : entry,
  );
}
