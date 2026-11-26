import { memo, useContext } from "react";
import type { CodeHostReviewThread } from "@ajour/shared";
import { Markdown } from "@/components/markdown";
import { personName } from "@/domain/deck/review-status";
import { ThreadActionsContext, ThreadFooter } from "./thread-actions";
import { ThreadStates, useThreadState } from "./thread-state";

/** No actions: what a thread holds without them. */
const NO_ACTIONS = new ThreadStates();

/** When something was written, as the review page shows it. */
export function EventTime({ at }: { at: number }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  );
}

/** Where a thread is: its file, and its line or lines on the head or the base. */
export function threadLocation(
  thread: Pick<CodeHostReviewThread, "path" | "side" | "line" | "startLine">,
) {
  if (thread.line === undefined) return thread.path;
  const lines =
    thread.startLine !== undefined && thread.startLine < thread.line
      ? `lines ${thread.startLine} to ${thread.line}`
      : `line ${thread.line}`;
  return `${thread.path}, ${thread.side === "base" ? "removed " : ""}${lines}`;
}

/**
 * One review thread: each comment with its author and time, the replies
 * posted since the conversation was read, then whether it's resolved or
 * outdated, and Reply and Resolve when the page offers them (#785).
 * Hovering or focusing it calls `onHover`, so the page can highlight its
 * line.
 */
export const ReviewThreadCard = memo(function ReviewThreadCard({
  thread,
  hot,
  onHover,
  showLocation,
}: {
  thread: CodeHostReviewThread;
  /** The card is the one hovered: its border takes the accent. */
  hot?: boolean;
  onHover?: (threadId: string | undefined) => void;
  /** Names its file and lines, for a thread away from them. */
  showLocation?: boolean;
}) {
  const actions = useContext(ThreadActionsContext);
  const state = useThreadState(actions?.states ?? NO_ACTIONS, thread.id);
  const resolved = state.resolved ?? thread.resolved;
  const marks = [
    resolved ? "Resolved" : undefined,
    thread.outdated ? "Outdated" : undefined,
  ].filter(Boolean);
  return (
    <article
      className="deck-thread"
      data-thread={thread.id}
      data-hot={hot || undefined}
      aria-label={`Thread on ${threadLocation(thread)}`}
      // Focusable when it highlights its line, so the keyboard reaches that too.
      tabIndex={onHover ? 0 : undefined}
      onMouseEnter={onHover ? () => onHover(thread.id) : undefined}
      onMouseLeave={onHover ? () => onHover(undefined) : undefined}
      onFocus={onHover ? () => onHover(thread.id) : undefined}
      onBlur={onHover ? () => onHover(undefined) : undefined}
    >
      {showLocation ? (
        <p className="deck-thread-location">{threadLocation(thread)}</p>
      ) : null}
      {thread.comments.map((comment) => (
        <div key={comment.id} className="deck-comment">
          <p className="deck-comment-meta">
            <span className="deck-comment-author">
              {personName(comment.author)}
            </span>
            <EventTime at={comment.createdAt} />
          </p>
          <Markdown>{comment.body}</Markdown>
        </div>
      ))}
      {state.sent.map((body, index) => (
        <div key={`sent-${index}`} className="deck-comment">
          <p className="deck-comment-meta">
            <span className="deck-comment-author">You</span>
            <span>Just now</span>
          </p>
          <Markdown>{body}</Markdown>
        </div>
      ))}
      {marks.length ? (
        <p className="deck-thread-marks">{marks.join(" · ")}</p>
      ) : null}
      {actions ? (
        <ThreadFooter
          thread={thread}
          state={state}
          resolved={resolved}
          actions={actions}
        />
      ) : null}
    </article>
  );
});
