import { useMemo, useState } from "react";
import { placeThreads } from "@/domain/deck/review-threads";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { useMediaQuery } from "@/lib/use-media-query";
import { PullRequestChanges } from "./pull-request-changes";
import {
  DescriptionDrawer,
  PullRequestConversation,
} from "./pull-request-conversation";
import { PullRequestStatusLine } from "./pull-request-status-line";
import { usePullRequestDiff } from "./use-pull-request-diff";
import {
  usePullRequestChecks,
  usePullRequestConversation,
} from "./use-pull-request-read";

/**
 * A pull request's review page below its title, in reading order: the
 * status line, the description drawer, the changes with each review thread
 * beside or after its line, then the conversation. The diff, the
 * conversation and the checks are read at once when the page opens.
 */
export function PullRequestReview({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const diff = usePullRequestDiff(pullRequest);
  const conversation = usePullRequestConversation(pullRequest);
  const checks = usePullRequestChecks(pullRequest);
  const floating = useMediaQuery(DECK_GUTTER_QUERY);
  const [hovered, setHovered] = useState<string | undefined>();

  const threads =
    conversation.state.status === "ready"
      ? conversation.state.value.threads
      : undefined;
  const diffState = diff.state;
  const placement = useMemo(
    () =>
      threads && diffState.status === "ready"
        ? placeThreads(diffState.diff, threads)
        : undefined,
    [threads, diffState],
  );
  // Without a diff to show them on, every thread joins the conversation.
  const elsewhere = placement
    ? placement.elsewhere
    : diffState.status === "loading"
      ? []
      : (threads ?? []);

  return (
    <>
      <PullRequestStatusLine pullRequest={pullRequest} checks={checks.state} />
      <DescriptionDrawer
        state={conversation.state}
        retry={conversation.retry}
      />
      <PullRequestChanges
        state={diff.state}
        retry={diff.retry}
        placement={placement}
        floating={floating}
        hovered={hovered}
        onHover={setHovered}
      />
      <PullRequestConversation
        state={conversation.state}
        retry={conversation.retry}
        elsewhere={elsewhere}
      />
    </>
  );
}
