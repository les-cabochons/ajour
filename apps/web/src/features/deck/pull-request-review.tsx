import { useCallback, useMemo, useRef, useState } from "react";
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
import { PullRequestSummary, type ReachHunk } from "./pull-request-summary";
import {
  usePullRequestChecks,
  usePullRequestConversation,
  usePullRequestDiff,
} from "./use-pull-request-read";

/**
 * A pull request's review page below its title, in reading order: the
 * status line, the summary once the guide is built, the description
 * drawer, the changes in the guide's order or
 * A–Z with each review thread beside or after its line, then the
 * conversation. The diff and its guide, the conversation and the checks
 * are read at once when the page opens.
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
  // The changes set it once they show, so a summary line reaches its hunk.
  const reachHunk = useRef<ReachHunk | undefined>(undefined);
  const onReach = useCallback((hunkId: string) => {
    reachHunk.current?.(hunkId);
  }, []);

  const threads =
    conversation.state.status === "ready"
      ? conversation.state.value.threads
      : undefined;
  const diffState = diff.state;
  const placement = useMemo(
    () =>
      threads && diffState.status === "ready"
        ? placeThreads(diffState.value, threads)
        : undefined,
    [threads, diffState],
  );
  // Without a diff to show them on, every thread joins the conversation.
  const elsewhere = useMemo(
    () =>
      placement
        ? placement.elsewhere
        : diffState.status === "loading"
          ? []
          : (threads ?? []),
    [placement, diffState.status, threads],
  );

  return (
    <>
      <PullRequestStatusLine pullRequest={pullRequest} checks={checks.state} />
      {diffState.status === "ready" ? (
        <PullRequestSummary
          pullRequest={diffState.value}
          repository={pullRequest.facts.repository}
          onReach={onReach}
        />
      ) : null}
      <DescriptionDrawer
        state={conversation.state}
        retry={conversation.retry}
      />
      <PullRequestChanges
        pullRequest={pullRequest}
        state={diff.state}
        retry={diff.retry}
        threads={{ placement, floating, hovered, onHover: setHovered }}
        reachHunkRef={reachHunk}
      />
      <PullRequestConversation
        state={conversation.state}
        retry={conversation.retry}
        elsewhere={elsewhere}
      />
    </>
  );
}
