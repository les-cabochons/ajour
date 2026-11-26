import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeThreads } from "@/domain/deck/review-threads";
import {
  changedHunks,
  pushesSince,
  reviewedVersion,
} from "@/domain/deck/versions";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { localStore } from "@/lib/local-store";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  PullRequestChanges,
  type ReviewVersionsView,
} from "./pull-request-changes";
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
  usePullRequestVersions,
  useSinceReview,
} from "./use-pull-request-read";

/**
 * A pull request's review page below its title, in reading order: the
 * status line, the summary once the guide is built, the description
 * drawer, the changes under their versions bar in the guide's order or
 * A–Z with each review thread beside or after its line, then the
 * conversation. The diff and its guide, the conversation, the checks and
 * the versions are read at once when the page opens, and again on Refresh
 * after a push came in.
 */
export function PullRequestReview({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const diff = usePullRequestDiff(pullRequest);
  const conversation = usePullRequestConversation(pullRequest);
  const checks = usePullRequestChecks(pullRequest);
  const versions = usePullRequestVersions(pullRequest);
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

  const shownHead =
    diffState.status === "ready" ? diffState.value.headSha : undefined;
  const list =
    versions.state.status === "ready"
      ? versions.state.value.versions
      : undefined;
  const { _id: id, viewerLogin, reviewed: remembered } = pullRequest;
  const { reviews } = pullRequest.facts;
  const reviewed = useMemo(
    () => list && reviewedVersion(list, { viewerLogin, reviews, remembered }),
    [list, viewerLogin, reviews, remembered],
  );
  // The version reviewed is remembered with the pull request, so it outlives
  // a review the code host stops listing.
  useEffect(() => {
    if (reviewed && (!remembered || reviewed.at > remembered.at))
      localStore.changePullRequest(id, {
        type: "reviewed",
        headSha: reviewed.version.headSha,
        at: reviewed.at,
      });
  }, [id, reviewed, remembered]);
  const shown = list?.find((version) => version.headSha === shownHead);
  const since = useSinceReview(
    pullRequest,
    shownHead,
    reviewed && shown && reviewed.version.number < shown.number
      ? reviewed.version.headSha
      : undefined,
  );
  // Reviewed at the version on screen, or a later one: nothing changed since.
  const reviewedOnScreen =
    !!reviewed && !!shown && reviewed.version.number >= shown.number;
  const changed = useMemo(
    () =>
      since.state.status === "ready"
        ? changedHunks(since.state.value.changed)
        : reviewedOnScreen
          ? changedHunks([])
          : undefined,
    [since.state, reviewedOnScreen],
  );
  const { refresh: refreshDiff } = diff;
  const { retry: retryConversation } = conversation;
  const { retry: retryChecks } = checks;
  const { retry: retryVersions } = versions;
  // The head the last sync had seen when the diff was read: a later sync
  // that sees another one means a push came in during the review.
  const syncedHead = pullRequest.facts.headSha;
  const [syncedAtOpen, setSyncedAtOpen] = useState(syncedHead);
  const refresh = useCallback(() => {
    setSyncedAtOpen(syncedHead);
    // The newest head, wherever it is: the last sync may not know it yet.
    refreshDiff();
    retryConversation();
    retryChecks();
    retryVersions();
  }, [syncedHead, refreshDiff, retryConversation, retryChecks, retryVersions]);

  const versionsView: ReviewVersionsView = {
    state: versions.state,
    retry: retryVersions,
    reviewed: reviewed?.version,
    since: since.state,
    retrySince: since.retry,
    changed,
    pushes: shownHead
      ? pushesSince(list, shownHead, {
          synced: syncedHead,
          syncedAtOpen,
        })
      : 0,
    refresh,
    baseRef: pullRequest.facts.baseRef,
  };

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
        versions={versionsView}
      />
      <PullRequestConversation
        state={conversation.state}
        retry={conversation.retry}
        elsewhere={elsewhere}
      />
    </>
  );
}
