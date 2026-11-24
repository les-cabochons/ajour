import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeckOpenRequest,
  DeckOpenedPullRequest,
} from "@ajour/shared/deck";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  AppApiError,
  openDeckPullRequest,
  readPullRequestChecks,
  readPullRequestConversation,
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
 * holds that head (#781).
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
  const [attempt, setAttempt] = useState(0);
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
    setState({ status: "loading" });
    const head =
      withHead && headSha.current ? { headSha: headSha.current } : {};
    read(pluginId, connectionId, { repository, number, ...head }).then(
      (value) => {
        if (current) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!current) return;
        const message = error instanceof Error ? error.message : fallback;
        const reason =
          error instanceof AppApiError ? error.payload?.reason : undefined;
        setState({
          status:
            reason === "not_supported" || reason === "connection_removed"
              ? "unavailable"
              : "error",
          message,
        });
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
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}

/** The pull request's diff from the merge base to the head, and its guide, as the local API builds them. */
export const usePullRequestDiff = (pullRequest: LocalPullRequest | undefined) =>
  usePullRequestRead<DeckOpenedPullRequest>(
    pullRequest,
    openDeckPullRequest,
    "Unable to read the pull request's changes.",
    true,
  );

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
