import type { BacklogComment } from "@ajour/shared";
import {
  itemPeopleMatching,
  type CommentSource,
} from "@/domain/backlog/comments";
import {
  editItemComment,
  postItemComment,
  searchItemPeople,
} from "@/lib/app-api";
import { holdRefusedComment } from "@/lib/held-edits";

type ThreadRef = Pick<CommentSource, "pluginId" | "connectionId" | "sourceId">;
type PostedListener = (threadKey: string, comment: BacklogComment) => void;

const listeners = new Set<PostedListener>();

/** One key per item thread. */
export function commentThreadKey(source: ThreadRef) {
  return `${source.pluginId}\n${source.connectionId}\n${source.sourceId}`;
}

/** Tells the item's thread about a comment posted from elsewhere, such as a settle. */
export function announcePostedComment(
  source: ThreadRef,
  comment: BacklogComment,
) {
  const key = commentThreadKey(source);
  for (const listener of listeners) listener(key, comment);
}

export function subscribePostedComments(listener: PostedListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const ref = (source: ThreadRef): ThreadRef => ({
  pluginId: source.pluginId,
  connectionId: source.connectionId,
  sourceId: source.sourceId,
});

/**
 * Posts the user's comment on the item's thread. A connection that can't
 * edit work items holds it for review in Sync review: `held`. Throws on any
 * other failure.
 */
export async function postThreadComment(
  source: ThreadRef,
  itemId: string,
  body: string,
): Promise<BacklogComment | "held"> {
  try {
    return (
      await postItemComment(
        source.pluginId,
        source.connectionId,
        { sourceId: source.sourceId, body },
        { itemId },
      )
    ).comment;
  } catch (error) {
    if (
      !holdRefusedComment(error, {
        kind: "comment",
        itemId,
        ...ref(source),
        body,
      })
    ) {
      throw error;
    }
    return "held";
  }
}

/**
 * Saves the user's edit of their comment, held for review as a post is when
 * the connection can't edit work items.
 */
export async function saveThreadCommentEdit(
  source: ThreadRef,
  itemId: string,
  commentId: string,
  body: string,
): Promise<BacklogComment | "held"> {
  try {
    return (
      await editItemComment(
        source.pluginId,
        source.connectionId,
        { sourceId: source.sourceId, commentId, body },
        { itemId },
      )
    ).comment;
  } catch (error) {
    if (
      !holdRefusedComment(error, {
        kind: "commentEdit",
        itemId,
        ...ref(source),
        commentId,
        body,
      })
    ) {
      throw error;
    }
    return "held";
  }
}

/**
 * The editor's @ suggestions, when the plugin can search people. While the
 * connection's access leaves people search off, they come from the item's
 * own people, which a search without a query returns, matched here.
 */
export function commentMentionSearch(source: CommentSource, itemId: string) {
  if (!source.capability.mentions) return undefined;
  const search = async (query: string) =>
    (
      await searchItemPeople(
        source.pluginId,
        source.connectionId,
        { sourceId: source.sourceId, query, limit: 20 },
        { itemId },
      )
    ).people;
  return {
    search: source.peopleSearchOff
      ? async (query: string) => itemPeopleMatching(await search(""), query)
      : search,
  };
}
