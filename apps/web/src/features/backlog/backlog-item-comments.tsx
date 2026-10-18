import { useCallback, useEffect, useRef, useState } from "react";
import { RiArrowUpSLine as EarlierIcon } from "@remixicon/react";
import type {
  BacklogComment,
  BacklogListItemCommentsResult,
  BacklogPerson,
  BacklogReaction,
} from "@ajour/shared";
import { Markdown } from "@/components/markdown";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Value } from "@/components/ui/value";
import {
  commentSourceOf,
  firstNewCommentIndex,
  isEditedComment,
  isOwnComment,
  mergeEarlierComments,
  type CommentSource,
} from "@/domain/backlog/comments";
import {
  getCachedPluginsOverview,
  getPluginsOverview,
  isPluginApiMissing,
  listItemComments,
  subscribePluginsOverview,
} from "@/lib/app-api";
import { getCommentsSeenAt, markCommentsSeen } from "@/lib/comments-seen";
import type { LocalWorkItem } from "@/domain/local-state";

/** The newest comments the page opens with. */
export const FIRST_COMMENT_PAGE = 5;
/** How many more each "Show earlier comments" loads. */
export const EARLIER_COMMENT_PAGE = 20;
/** How long the newest page stays in memory, so a quick return doesn't refetch. */
const CACHE_MS = 5 * 60_000;

const reactionEmoji: Record<BacklogReaction, string> = {
  like: "👍",
  dislike: "👎",
  heart: "❤️",
  hooray: "🎉",
  laugh: "😄",
  confused: "😕",
  rocket: "🚀",
  eyes: "👀",
};

const reactionNames: Record<BacklogReaction, string> = {
  like: "Like",
  dislike: "Dislike",
  heart: "Heart",
  hooray: "Hooray",
  laugh: "Laugh",
  confused: "Confused",
  rocket: "Rocket",
  eyes: "Eyes",
};

// The text of the newest page, held in memory only (ADR 0008).
const firstPages = new Map<
  string,
  { at: number; result: BacklogListItemCommentsResult }
>();

function cacheKey(source: CommentSource) {
  return `${source.pluginId}\n${source.connectionId}\n${source.sourceId}`;
}

type Thread =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      viewer: BacklogPerson;
      comments: BacklogComment[];
      total?: number;
      earlierCursor?: string;
      loadingEarlier: boolean;
      earlierError?: string;
    };

/** "10:42" today, "Oct 13" this year, else with the year. */
export function formatCommentTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : (parts[0]?.slice(0, 2) ?? "?");
  return letters.toUpperCase();
}

/**
 * Where the item's comments come from, kept current as plugins and
 * connections change. Asks for the plugin overview when none is cached yet.
 */
export function useCommentSource(
  item:
    | Pick<LocalWorkItem, "source" | "sourceId" | "sourceConnectionId">
    | undefined,
) {
  const [overview, setOverview] = useState(getCachedPluginsOverview);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePluginsOverview((next) => {
      if (active) setOverview(next);
    });
    if (!getCachedPluginsOverview()) {
      void getPluginsOverview()
        .then((next) => active && setOverview(next))
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return item ? commentSourceOf(item, overview) : undefined;
}

/**
 * The comments of a synced item, under its description: the newest five, then
 * twenty more per "Show earlier comments", oldest first, with a New divider
 * before what arrived since the last visit. The text is fetched through the
 * plugin and never stored (ADR 0008).
 */
export function BacklogItemComments({
  itemId,
  source,
}: {
  itemId: string;
  source: CommentSource;
}) {
  const key = cacheKey(source);
  const [thread, setThread] = useState<Thread>(() => {
    const cached = firstPages.get(key);
    return cached && Date.now() - cached.at < CACHE_MS
      ? { kind: "ready", ...cached.result, loadingEarlier: false }
      : { kind: "loading" };
  });
  // The divider compares with the visit before this one, read once per mount.
  const [seenAt] = useState(() => getCommentsSeenAt(itemId));
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const loadFirstPage = useCallback(async () => {
    const current = sourceRef.current;
    try {
      const result = await listItemComments(
        current.pluginId,
        current.connectionId,
        { sourceId: current.sourceId, limit: FIRST_COMMENT_PAGE },
      );
      firstPages.set(cacheKey(current), { at: Date.now(), result });
      setThread({ kind: "ready", ...result, loadingEarlier: false });
    } catch (error) {
      setThread(
        isPluginApiMissing(error)
          ? { kind: "unavailable" }
          : {
              kind: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "The comments couldn't load.",
            },
      );
    }
  }, []);

  useEffect(() => {
    const cached = firstPages.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      setThread({ kind: "ready", ...cached.result, loadingEarlier: false });
      return;
    }
    setThread({ kind: "loading" });
    void loadFirstPage();
  }, [key, loadFirstPage]);

  // Once the thread shows, this visit is the one the next divider counts from.
  const shown = thread.kind === "ready";
  useEffect(() => {
    if (shown) markCommentsSeen(itemId, Date.now());
  }, [shown, itemId]);

  const loadEarlier = async () => {
    if (thread.kind !== "ready" || !thread.earlierCursor) return;
    const cursor = thread.earlierCursor;
    setThread({ ...thread, loadingEarlier: true, earlierError: undefined });
    try {
      const page = await listItemComments(
        source.pluginId,
        source.connectionId,
        { sourceId: source.sourceId, limit: EARLIER_COMMENT_PAGE, cursor },
      );
      setThread((current) =>
        current.kind === "ready"
          ? {
              ...current,
              comments: mergeEarlierComments(page.comments, current.comments),
              earlierCursor: page.earlierCursor,
              loadingEarlier: false,
            }
          : current,
      );
    } catch (error) {
      setThread((current) =>
        current.kind === "ready"
          ? {
              ...current,
              loadingEarlier: false,
              earlierError:
                error instanceof Error
                  ? error.message
                  : "Earlier comments couldn't load.",
            }
          : current,
      );
    }
  };

  const count =
    thread.kind === "ready"
      ? (thread.total ?? thread.comments.length)
      : undefined;

  return (
    <section aria-label="Comments" className="mt-6 flex flex-col">
      <SectionHeading>
        Comments
        {count !== undefined ? (
          <Value tone="muted" className="ml-1.5">
            {count}
          </Value>
        ) : null}
      </SectionHeading>
      {thread.kind === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : thread.kind === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          Comments need the desktop app.
        </p>
      ) : thread.kind === "error" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Comments couldn't load. {thread.message}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setThread({ kind: "loading" });
              void loadFirstPage();
            }}
          >
            Retry
          </Button>
        </div>
      ) : thread.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <CommentThread
          thread={thread}
          seenAt={seenAt}
          onShowEarlier={() => void loadEarlier()}
        />
      )}
    </section>
  );
}

function CommentThread({
  thread,
  seenAt,
  onShowEarlier,
}: {
  thread: Extract<Thread, { kind: "ready" }>;
  seenAt: number | undefined;
  onShowEarlier: () => void;
}) {
  const newIndex = firstNewCommentIndex(thread.comments, thread.viewer, seenAt);
  const hidden =
    thread.total !== undefined
      ? Math.max(0, thread.total - thread.comments.length)
      : undefined;
  return (
    <>
      {thread.earlierCursor ? (
        <Button
          variant="outline"
          size="sm"
          className="mb-3 w-fit text-muted-foreground"
          disabled={thread.loadingEarlier}
          onClick={onShowEarlier}
        >
          <EarlierIcon data-icon="inline-start" />
          Show earlier comments
          {hidden ? <Value tone="muted">{hidden}</Value> : null}
        </Button>
      ) : null}
      {thread.earlierError ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Earlier comments couldn't load. {thread.earlierError}
        </p>
      ) : null}
      <ol className="backlog-comments">
        {thread.comments.map((comment, index) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            viewer={thread.viewer}
            isFirstNew={index === newIndex}
          />
        ))}
      </ol>
    </>
  );
}

function CommentItem({
  comment,
  viewer,
  isFirstNew,
}: {
  comment: BacklogComment;
  viewer: BacklogPerson;
  isFirstNew: boolean;
}) {
  const own = isOwnComment(comment, viewer);
  const author = own ? "You" : comment.author.displayName || "Someone";
  return (
    <>
      {isFirstNew ? (
        <li className="backlog-comments-new" aria-label="New comments">
          New
        </li>
      ) : null}
      <li className="backlog-comment">
        <span className="backlog-comment-avatar" aria-hidden="true">
          {initials(comment.author.displayName || "?")}
        </span>
        <article
          className="backlog-comment-box"
          aria-label={own ? "Your comment" : `${author}'s comment`}
        >
          <header className="backlog-comment-header">
            <span className="font-medium text-foreground">{author}</span>
            <span className="text-muted-foreground">
              commented {formatCommentTime(comment.createdAt)}
              {isEditedComment(comment) ? " · edited" : ""}
            </span>
            {comment.restrictedTo ? (
              <Chip className="ml-auto">
                Restricted to {comment.restrictedTo}
              </Chip>
            ) : null}
          </header>
          <div className="backlog-comment-body">
            <Markdown>{comment.body}</Markdown>
            {comment.reactions?.some((reaction) => reaction.count > 0) ? (
              <div className="backlog-comment-reactions">
                {comment.reactions
                  .filter((reaction) => reaction.count > 0)
                  .map((reaction) => (
                    <span
                      key={reaction.reaction}
                      className="backlog-comment-reaction"
                      data-viewer-reacted={
                        reaction.viewerReacted ? "" : undefined
                      }
                      aria-label={`${reactionNames[reaction.reaction]}: ${reaction.count}${reaction.viewerReacted ? ", including you" : ""}`}
                    >
                      <span aria-hidden="true">
                        {reactionEmoji[reaction.reaction]}
                      </span>
                      <Value aria-hidden="true">{reaction.count}</Value>
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
        </article>
      </li>
    </>
  );
}
