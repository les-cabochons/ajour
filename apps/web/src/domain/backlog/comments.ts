import {
  isCapabilityActive,
  type BacklogComment,
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
