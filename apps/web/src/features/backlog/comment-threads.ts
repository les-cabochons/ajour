import type { BacklogComment } from "@ajour/shared";
import type { CommentSource } from "@/domain/backlog/comments";
import { searchItemPeople } from "@/lib/app-api";

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

/** The editor's @ suggestions, when the plugin can search people. */
export function commentMentionSearch(source: CommentSource) {
  return source.capability.mentions
    ? {
        search: async (query: string) =>
          (
            await searchItemPeople(source.pluginId, source.connectionId, {
              sourceId: source.sourceId,
              query,
              limit: 20,
            })
          ).people,
      }
    : undefined;
}
