import { memo, useId, useState } from "react";
import { RiArrowRightSLine as Chevron } from "@remixicon/react";
import type {
  CodeHostConversationResult,
  CodeHostReviewThread,
  CodeHostTimelineEvent,
} from "@ajour/shared";
import { MessagePanel } from "@/components/app-surface";
import { Markdown } from "@/components/markdown";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { personName } from "@/domain/deck/review-status";
import { conversationEntries } from "@/domain/deck/review-threads";
import { PluginUpdateLink } from "./plugin-update-link";
import { EventTime, ReviewThreadCard } from "./review-thread-card";
import type { PullRequestReadState } from "./use-pull-request-read";

type ConversationState = PullRequestReadState<CodeHostConversationResult>;

function ReadProblem({
  state,
  retry,
}: {
  state: Extract<ConversationState, { status: "unavailable" | "error" }>;
  retry: () => void;
}) {
  return state.status === "unavailable" ? (
    <p className="deck-file-empty">
      {state.message}
      {state.update ? (
        <>
          {" "}
          <PluginUpdateLink />
        </>
      ) : null}
    </p>
  ) : (
    <MessagePanel role="alert" className="flex items-center gap-3">
      <span className="flex-1">{state.message}</span>
      <Button variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </MessagePanel>
  );
}

/** The author's description, in a drawer that starts closed. */
export const DescriptionDrawer = memo(function DescriptionDrawer({
  state,
  retry,
}: {
  state: ConversationState;
  retry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="deck-description" aria-label="Description">
      <button
        type="button"
        className="deck-drawer-toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Chevron aria-hidden="true" className="deck-drawer-chevron" />
        Description
      </button>
      {open ? (
        <div id={bodyId} className="deck-description-body">
          {state.status === "loading" ? (
            <p role="status" className="deck-file-empty">
              Loading the description…
            </p>
          ) : state.status === "ready" ? (
            state.value.description.trim() ? (
              <Markdown>{state.value.description}</Markdown>
            ) : (
              <p className="deck-file-empty">No description.</p>
            )
          ) : (
            <ReadProblem state={state} retry={retry} />
          )}
        </div>
      ) : null}
    </section>
  );
});

const verdicts = {
  approved: "approved",
  changes_requested: "requested changes",
  commented: "reviewed",
  dismissed: "had a review dismissed",
} as const;

/** One event of the timeline: who did what, when, and what they wrote. */
function TimelineEvent({ event }: { event: CodeHostTimelineEvent }) {
  const [who, what] =
    event.kind === "comment"
      ? [personName(event.author), "commented"]
      : event.kind === "review"
        ? [personName(event.author), verdicts[event.verdict]]
        : event.kind === "commit"
          ? [
              event.authorName || undefined,
              `committed ${event.sha.slice(0, 7)} ${event.headline}`,
            ]
          : [event.actor ? personName(event.actor) : undefined, event.text];
  const body =
    (event.kind === "comment" || event.kind === "review") && event.body.trim()
      ? event.body
      : undefined;
  return (
    <>
      <p className="deck-timeline-line">
        {who ? <span className="deck-comment-author">{who}</span> : null}
        <span className="min-w-0">{what}</span>
        <EventTime at={event.createdAt} />
      </p>
      {body ? <Markdown className="deck-timeline-body">{body}</Markdown> : null}
    </>
  );
}

/**
 * The conversation at the end of the page: the pull request's timeline, with
 * the review threads the diff can't show, in time order.
 */
export const PullRequestConversation = memo(function PullRequestConversation({
  state,
  retry,
  elsewhere,
}: {
  state: ConversationState;
  retry: () => void;
  /** Review threads with no line on the diff on screen. */
  elsewhere: readonly CodeHostReviewThread[];
}) {
  const headingId = useId();
  return (
    <section className="deck-conversation" aria-labelledby={headingId}>
      <SectionHeading id={headingId}>Conversation</SectionHeading>
      {state.status === "loading" ? (
        <p role="status" className="deck-file-empty">
          Loading the conversation…
        </p>
      ) : state.status === "ready" ? (
        <ol className="deck-timeline">
          {conversationEntries(state.value.timeline, elsewhere).map((entry) => (
            <li key={entry.key} className="deck-timeline-entry">
              {entry.kind === "event" ? (
                <TimelineEvent event={entry.event} />
              ) : (
                <ReviewThreadCard thread={entry.thread} showLocation />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <ReadProblem state={state} retry={retry} />
      )}
    </section>
  );
});
