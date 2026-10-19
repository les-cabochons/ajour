import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiArrowUpSLine as EarlierIcon,
  RiEmotionLine as ReactIcon,
  RiMoreLine as MoreIcon,
} from "@remixicon/react";
import type {
  BacklogComment,
  BacklogCommentsCapability,
  BacklogListItemCommentsResult,
  BacklogPerson,
  BacklogReaction,
} from "@ajour/shared";
import { Markdown } from "@/components/markdown";
import {
  MarkdownEditor,
  preloadMarkdownEditor,
} from "@/components/markdown-editor";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { showErrorToast, showUndoToast } from "@/components/ui/toast";
import { Value } from "@/components/ui/value";
import {
  commentSourceOf,
  firstNewCommentIndex,
  isEditedComment,
  isOwnComment,
  mergeEarlierComments,
  withViewerReaction,
  type CommentSource,
} from "@/domain/backlog/comments";
import {
  getCachedPluginsOverview,
  getPluginsOverview,
  isPluginApiMissing,
  editItemComment,
  listItemComments,
  postItemComment,
  setItemCommentReaction,
  subscribePluginsOverview,
} from "@/lib/app-api";
import {
  cancelCommentDelete,
  pendingCommentDeleteIds,
  queueCommentDelete,
  sendCommentDelete,
} from "@/lib/comment-deletes";
import {
  getCommentDraft,
  setCommentDraft,
  subscribeCommentDrafts,
} from "@/lib/comment-drafts";
import {
  commentMentionSearch,
  commentThreadKey,
  subscribePostedComments,
} from "@/features/backlog/comment-threads";
import { getShortcutPlatform } from "@/lib/shortcuts";
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
// A comment posted from elsewhere makes the item's cached page stale.
subscribePostedComments((threadKey) => firstPages.delete(threadKey));

/** The thread with a posted comment at its end, once. */
function withPostedComment(thread: Thread, comment: BacklogComment): Thread {
  return thread.kind === "ready" &&
    !thread.comments.some((shown) => shown.id === comment.id)
    ? {
        ...thread,
        comments: [...thread.comments, comment],
        total: thread.total === undefined ? undefined : thread.total + 1,
      }
    : thread;
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
  const key = commentThreadKey(source);
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
      firstPages.set(commentThreadKey(current), { at: Date.now(), result });
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

  // Comments waiting for their delete stay hidden, even after a restart.
  const [hidden, setHidden] = useState(pendingCommentDeleteIds);
  const unhide = (commentId: string) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(commentId);
      return next;
    });

  const updateComment = (
    commentId: string,
    change: (comment: BacklogComment) => BacklogComment,
  ) => {
    firstPages.delete(key);
    setThread((current) =>
      current.kind === "ready"
        ? {
            ...current,
            comments: current.comments.map((comment) =>
              comment.id === commentId ? change(comment) : comment,
            ),
          }
        : current,
    );
  };

  /** Saves at once; a failure reaches the editor, which keeps the text. */
  const editComment = async (comment: BacklogComment, body: string) => {
    const { comment: edited } = await editItemComment(
      source.pluginId,
      source.connectionId,
      { sourceId: source.sourceId, commentId: comment.id, body },
    );
    updateComment(comment.id, () => edited);
  };

  /** Hides the comment now and deletes it once the Undo toast closes. */
  const deleteComment = (comment: BacklogComment) => {
    queueCommentDelete({
      itemId,
      pluginId: source.pluginId,
      connectionId: source.connectionId,
      sourceId: source.sourceId,
      commentId: comment.id,
      at: Date.now(),
    });
    setHidden((current) => new Set(current).add(comment.id));
    firstPages.delete(key);
    let undone = false;
    showUndoToast({
      title: "Comment deleted",
      onUndo: () => {
        undone = true;
        cancelCommentDelete(comment.id);
        unhide(comment.id);
      },
      onClose: () => {
        if (undone) return;
        sendCommentDelete(comment.id).then(
          () =>
            setThread((current) =>
              current.kind === "ready"
                ? {
                    ...current,
                    comments: current.comments.filter(
                      (candidate) => candidate.id !== comment.id,
                    ),
                    total:
                      current.total === undefined
                        ? undefined
                        : current.total - 1,
                  }
                : current,
            ),
          (error: unknown) => {
            unhide(comment.id);
            showErrorToast({
              title: "The comment wasn't deleted",
              description: error instanceof Error ? error.message : undefined,
            });
          },
        );
      },
    });
  };

  /** Shows the change at once and puts it back if the source refuses it. */
  const toggleReaction = async (
    comment: BacklogComment,
    reaction: BacklogReaction,
  ) => {
    const before = comment.reactions ?? [];
    const reacted = !before.find((entry) => entry.reaction === reaction)
      ?.viewerReacted;
    updateComment(comment.id, (current) => ({
      ...current,
      reactions: withViewerReaction(before, reaction, reacted),
    }));
    try {
      const { reactions } = await setItemCommentReaction(
        source.pluginId,
        source.connectionId,
        {
          sourceId: source.sourceId,
          commentId: comment.id,
          reaction,
          reacted,
        },
      );
      updateComment(comment.id, (current) => ({ ...current, reactions }));
    } catch (error) {
      updateComment(comment.id, (current) => ({
        ...current,
        reactions: before,
      }));
      showErrorToast({
        title: "The reaction wasn't saved",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  // A posted comment joins the thread; the cached page is stale now.
  const appendComment = (comment: BacklogComment) => {
    firstPages.delete(key);
    setThread((current) => withPostedComment(current, comment));
  };

  // A comment posted from elsewhere, such as the settle dialog, joins too.
  useEffect(
    () =>
      subscribePostedComments((threadKey, comment) => {
        if (threadKey === key) {
          setThread((current) => withPostedComment(current, comment));
        }
      }),
    [key],
  );

  const count =
    thread.kind === "ready"
      ? (thread.total ?? thread.comments.length) - hidden.size
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
      ) : thread.comments.every((comment) => hidden.has(comment.id)) ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <CommentThread
          thread={thread}
          seenAt={seenAt}
          hidden={hidden}
          capability={source.capability}
          mentions={commentMentionSearch(source)}
          onShowEarlier={() => void loadEarlier()}
          onEdit={editComment}
          onDelete={deleteComment}
          onToggleReaction={(comment, reaction) =>
            void toggleReaction(comment, reaction)
          }
        />
      )}
      {thread.kind === "ready" ? (
        <CommentComposer
          key={itemId}
          itemId={itemId}
          source={source}
          onPosted={appendComment}
        />
      ) : null}
    </section>
  );
}

/**
 * The editor pinned under the thread. It shows as a plain field until the
 * user opens it, so CodeMirror loads only then. The text is kept per item
 * until sent or discarded, and a failed send keeps it (ADR 0008).
 */
function CommentComposer({
  itemId,
  source,
  onPosted,
}: {
  itemId: string;
  source: CommentSource;
  onPosted: (comment: BacklogComment) => void;
}) {
  const [text, setText] = useState(() => getCommentDraft(itemId) ?? "");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  // A settle that was undone or failed puts its comment back here.
  useEffect(
    () =>
      subscribeCommentDrafts((draftItemId, value) => {
        if (draftItemId === itemId) setText(value);
      }),
    [itemId],
  );

  const limit = source.capability.maxLength;
  const length = text.trim().length;
  const overLimit = limit !== undefined && length > limit;
  const showCount = limit !== undefined && length >= limit * 0.8;
  const sendKeys = getShortcutPlatform() === "mac" ? "⌘↵" : "Ctrl+Enter";

  // Saved on every change, so a reload or a crash keeps what was typed.
  const change = (value: string) => {
    setText(value);
    setError(undefined);
    setCommentDraft(itemId, value);
  };

  const discard = () => {
    setCommentDraft(itemId, "");
    setText("");
    setError(undefined);
    setOpen(false);
  };

  const send = async (value: string) => {
    const body = value.trim();
    if (!body || sending || (limit !== undefined && body.length > limit)) {
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const { comment } = await postItemComment(
        source.pluginId,
        source.connectionId,
        { sourceId: source.sourceId, body },
      );
      setCommentDraft(itemId, "");
      setText("");
      setOpen(false);
      onPosted(comment);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The comment couldn't be sent.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="backlog-comment-composer">
      {open ? (
        <>
          <MarkdownEditor
            autoFocus
            aria-label="New comment"
            value={text}
            onChange={change}
            onSubmit={(value) => void send(value)}
            onCancel={() => setOpen(false)}
            placeholder="Leave a comment. Markdown supported. Type @ to mention someone."
            minLines={3}
            mentions={commentMentionSearch(source)}
          />
          <div className="mt-2 flex min-h-7 items-center gap-2">
            {error ? (
              <p
                role="alert"
                className="min-w-0 flex-1 truncate text-xs text-destructive"
                title={error}
              >
                Not sent. {error}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            {showCount && limit !== undefined ? (
              <Value tone={overLimit ? "danger" : "muted"}>
                {length.toLocaleString()} / {limit.toLocaleString()}
              </Value>
            ) : null}
            {text.trim() ? (
              <Button variant="ghost" size="sm" onClick={discard}>
                Discard
              </Button>
            ) : null}
            <span className="text-2xs text-muted-foreground">{sendKeys}</span>
            <Button
              size="sm"
              disabled={!text.trim() || overLimit || sending}
              onClick={() => void send(text)}
            >
              {sending ? "Sending…" : "Comment"}
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="backlog-comment-composer-field"
          onPointerEnter={preloadMarkdownEditor}
          onFocus={preloadMarkdownEditor}
          onClick={() => setOpen(true)}
        >
          {text.trim() ? (
            <span className="line-clamp-2 text-left">
              <span className="font-medium">Draft: </span>
              {text}
            </span>
          ) : (
            "Leave a comment…"
          )}
        </button>
      )}
    </div>
  );
}

function CommentThread({
  thread,
  seenAt,
  hidden,
  capability,
  mentions,
  onShowEarlier,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  thread: Extract<Thread, { kind: "ready" }>;
  seenAt: number | undefined;
  hidden: ReadonlySet<string>;
  capability: BacklogCommentsCapability;
  mentions: ReturnType<typeof commentMentionSearch>;
  onShowEarlier: () => void;
  onEdit: (comment: BacklogComment, body: string) => Promise<void>;
  onDelete: (comment: BacklogComment) => void;
  onToggleReaction: (
    comment: BacklogComment,
    reaction: BacklogReaction,
  ) => void;
}) {
  const comments = thread.comments.filter((comment) => !hidden.has(comment.id));
  const newIndex = firstNewCommentIndex(comments, thread.viewer, seenAt);
  const shownTotal =
    thread.total !== undefined ? thread.total - hidden.size : undefined;
  const earlier =
    shownTotal !== undefined
      ? Math.max(0, shownTotal - comments.length)
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
          {earlier ? <Value tone="muted">{earlier}</Value> : null}
        </Button>
      ) : null}
      {thread.earlierError ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Earlier comments couldn't load. {thread.earlierError}
        </p>
      ) : null}
      <ol className="backlog-comments">
        {comments.map((comment, index) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            viewer={thread.viewer}
            capability={capability}
            mentions={mentions}
            isFirstNew={index === newIndex}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleReaction={onToggleReaction}
          />
        ))}
      </ol>
    </>
  );
}

function CommentItem({
  comment,
  viewer,
  capability,
  mentions,
  isFirstNew,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  comment: BacklogComment;
  viewer: BacklogPerson;
  capability: BacklogCommentsCapability;
  mentions: ReturnType<typeof commentMentionSearch>;
  isFirstNew: boolean;
  onEdit: (comment: BacklogComment, body: string) => Promise<void>;
  onDelete: (comment: BacklogComment) => void;
  onToggleReaction: (
    comment: BacklogComment,
    reaction: BacklogReaction,
  ) => void;
}) {
  const own = isOwnComment(comment, viewer);
  const author = own ? "You" : comment.author.displayName || "Someone";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const reactable = capability.reactions ?? [];
  const canEdit = own && capability.edit === true;
  const canDelete = own && capability.delete === true;

  const save = async (value: string) => {
    const body = value.trim();
    if (!body || saving) return;
    if (body === comment.body.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onEdit(comment, body);
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The edit wasn't saved.",
      );
    } finally {
      setSaving(false);
    }
  };

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
              <Chip>Restricted to {comment.restrictedTo}</Chip>
            ) : null}
            <span className="ml-auto flex items-center gap-0.5">
              {reactable.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Add a reaction"
                      />
                    }
                  >
                    <ReactIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {reactable.map((reaction) => (
                      <DropdownMenuItem
                        key={reaction}
                        onClick={() => onToggleReaction(comment, reaction)}
                      >
                        <span aria-hidden="true">
                          {reactionEmoji[reaction]}
                        </span>
                        {reactionNames[reaction]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {canEdit || canDelete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Comment actions"
                      />
                    }
                  >
                    <MoreIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit ? (
                      <DropdownMenuItem
                        onClick={() => {
                          setDraft(comment.body);
                          setError(undefined);
                          setEditing(true);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                    ) : null}
                    {canDelete ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(comment)}
                      >
                        Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </span>
          </header>
          <div className="backlog-comment-body">
            {editing ? (
              <>
                <MarkdownEditor
                  autoFocus
                  aria-label="Edit comment"
                  value={draft}
                  onChange={setDraft}
                  onSubmit={(value) => void save(value)}
                  onCancel={() => setEditing(false)}
                  minLines={2}
                  mentions={mentions}
                />
                <div className="mt-2 flex items-center gap-2">
                  {error ? (
                    <p
                      role="alert"
                      className="min-w-0 flex-1 truncate text-xs text-destructive"
                      title={error}
                    >
                      Not saved. {error}
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!draft.trim() || saving}
                    onClick={() => void save(draft)}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </>
            ) : (
              <Markdown>{comment.body}</Markdown>
            )}
            {comment.reactions?.some((reaction) => reaction.count > 0) ? (
              <div className="backlog-comment-reactions">
                {comment.reactions
                  .filter((reaction) => reaction.count > 0)
                  .map((reaction) => {
                    const label = `${reactionNames[reaction.reaction]}: ${reaction.count}${reaction.viewerReacted ? ", including you" : ""}`;
                    const content = (
                      <>
                        <span aria-hidden="true">
                          {reactionEmoji[reaction.reaction]}
                        </span>
                        <Value aria-hidden="true">{reaction.count}</Value>
                      </>
                    );
                    return reactable.includes(reaction.reaction) ? (
                      <button
                        key={reaction.reaction}
                        type="button"
                        className="backlog-comment-reaction"
                        data-viewer-reacted={
                          reaction.viewerReacted ? "" : undefined
                        }
                        aria-pressed={reaction.viewerReacted}
                        aria-label={label}
                        onClick={() =>
                          onToggleReaction(comment, reaction.reaction)
                        }
                      >
                        {content}
                      </button>
                    ) : (
                      <span
                        key={reaction.reaction}
                        className="backlog-comment-reaction"
                        data-viewer-reacted={
                          reaction.viewerReacted ? "" : undefined
                        }
                        aria-label={label}
                      >
                        {content}
                      </span>
                    );
                  })}
              </div>
            ) : null}
          </div>
        </article>
      </li>
    </>
  );
}
