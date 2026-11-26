import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeckGuide,
  DeckOpenRequest,
  DeckOpenedPullRequest,
  DeckSinceReview,
} from "@ajour/shared/deck";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  AppApiError,
  openDeckPullRequest,
  readDeckSinceReview,
  readPullRequestChecks,
  readPullRequestConversation,
  readPullRequestVersions,
} from "@/lib/app-api";

export type PullRequestReadState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  /**
   * The code host's plugin doesn't offer it, or the connection was removed.
   * Retrying won't help.
   */
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

/** A failed read: unavailable when retrying won't help, an error otherwise. */
function failedRead(
  error: unknown,
  fallback: string,
): PullRequestReadState<never> {
  const message = error instanceof Error ? error.message : fallback;
  const reason =
    error instanceof AppApiError ? error.payload?.reason : undefined;
  return {
    status:
      reason === "not_supported" || reason === "connection_removed"
        ? "unavailable"
        : "error",
    message,
  };
}

type Read<T> = (
  pluginId: string,
  connectionId: string,
  pullRequest: DeckOpenRequest,
) => Promise<T>;

/**
 * Something the review page reads about the pull request on screen, once
 * when it opens. A sync that finds a new push doesn't read it again: Retry,
 * or opening the pull request again, does. `withHead` sends the head the
 * last sync saw, so the content cache answers without the code host when it
 * holds that head (#781). `refresh` reads it again without that head, so
 * the local API finds the newest one: the last sync may not have seen a
 * push the page already knows of.
 */
function usePullRequestRead<T>(
  pullRequest: LocalPullRequest | undefined,
  read: Read<T>,
  fallback: string,
  withHead = false,
) {
  const [state, setState] = useState<PullRequestReadState<T>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState({
    count: 0,
    newestHead: false,
    quiet: false,
  });
  const pluginId = pullRequest?.pluginId;
  const connectionId = pullRequest?.connectionId;
  const repository = pullRequest?.facts.repository;
  const number = pullRequest?.facts.number;
  // Read when it opens: a sync's new head must not reload the page.
  const headSha = useRef(pullRequest?.facts.headSha);
  headSha.current = pullRequest?.facts.headSha;
  useEffect(() => {
    if (!pluginId || !connectionId || !repository || !number) return;
    let current = true;
    // A quiet read keeps what shows until the new answer is in.
    if (!attempt.quiet) setState({ status: "loading" });
    const head =
      withHead && !attempt.newestHead && headSha.current
        ? { headSha: headSha.current }
        : {};
    read(pluginId, connectionId, { repository, number, ...head }).then(
      (value) => {
        if (current) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!current) return;
        // A quiet read that failed leaves the last answer showing.
        setState((shown) =>
          attempt.quiet && shown.status === "ready"
            ? shown
            : failedRead(error, fallback),
        );
      },
    );
    return () => {
      current = false;
    };
  }, [
    pluginId,
    connectionId,
    repository,
    number,
    attempt,
    read,
    fallback,
    withHead,
  ]);
  const retry = useCallback(
    () =>
      setAttempt(({ count }) => ({
        count: count + 1,
        newestHead: false,
        quiet: false,
      })),
    [],
  );
  const refresh = useCallback(
    () =>
      setAttempt(({ count }) => ({
        count: count + 1,
        newestHead: true,
        quiet: false,
      })),
    [],
  );
  /** Reads it again behind what shows, after a write changed it. */
  const reload = useCallback(
    () =>
      setAttempt(({ count }) => ({
        count: count + 1,
        newestHead: false,
        quiet: true,
      })),
    [],
  );
  /** Changes what was read in place, such as a regrouped guide, with no read. */
  const update = useCallback(
    (change: (value: T) => T) =>
      setState((now) =>
        now.status === "ready"
          ? { status: "ready", value: change(now.value) }
          : now,
      ),
    [],
  );
  return { state, retry, refresh, reload, update };
}

/**
 * The pull request's diff from the merge base to the head, and its guide,
 * as the local API builds them. `replaceGuide` shows another guide of the
 * diff at `head`, such as the agent's after a regroup (#794), keeping the
 * rest; a guide of another head than the one shown is dropped.
 */
export function usePullRequestDiff(pullRequest: LocalPullRequest | undefined) {
  const read = usePullRequestRead<DeckOpenedPullRequest>(
    pullRequest,
    openDeckPullRequest,
    "Unable to read the pull request's changes.",
    true,
  );
  const { update } = read;
  const replaceGuide = useCallback(
    (guide: DeckGuide | null, head: string) =>
      update((opened) =>
        opened.headSha !== head || opened.guide === guide
          ? opened
          : { ...opened, guide },
      ),
    [update],
  );
  return { ...read, replaceGuide };
}

/** The pull request's description, timeline and review threads. */
export const usePullRequestConversation = (
  pullRequest: LocalPullRequest | undefined,
) =>
  usePullRequestRead(
    pullRequest,
    readPullRequestConversation,
    "Unable to read the pull request's conversation.",
  );

/** The checks on the pull request's head. */
export const usePullRequestChecks = (
  pullRequest: LocalPullRequest | undefined,
) =>
  usePullRequestRead(
    pullRequest,
    readPullRequestChecks,
    "Unable to read the pull request's checks.",
  );

/** The pull request's versions, each push or iteration with its commits. */
export const usePullRequestVersions = (
  pullRequest: LocalPullRequest | undefined,
) =>
  usePullRequestRead(
    pullRequest,
    readPullRequestVersions,
    "Unable to read the pull request's versions.",
  );

export type SinceReviewState =
  { status: "none" } | PullRequestReadState<DeckSinceReview>;

/**
 * Which hunks of the diff at `head` changed since the version whose head is
 * `reviewedHead`, as the local API compares them, read once for each pair.
 * None while either is unknown.
 */
export function useSinceReview(
  pullRequest: LocalPullRequest,
  head: string | undefined,
  reviewedHead: string | undefined,
) {
  const [state, setState] = useState<SinceReviewState>({ status: "none" });
  const [attempt, setAttempt] = useState(0);
  const { pluginId, connectionId } = pullRequest;
  const { repository, number } = pullRequest.facts;
  useEffect(() => {
    if (!head || !reviewedHead) {
      setState({ status: "none" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    readDeckSinceReview(pluginId, connectionId, {
      repository,
      number,
      head,
      reviewedHead,
    }).then(
      (value) => {
        if (current) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (current)
          setState(
            failedRead(
              error,
              "Unable to compare with the version you reviewed.",
            ),
          );
      },
    );
    return () => {
      current = false;
    };
  }, [pluginId, connectionId, repository, number, head, reviewedHead, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
