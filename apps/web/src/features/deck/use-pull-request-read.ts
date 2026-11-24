import { useEffect, useState } from "react";
import type { DeckOpenRequest } from "@ajour/shared/deck";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  AppApiError,
  readPullRequestChecks,
  readPullRequestConversation,
} from "@/lib/app-api";

export type PullRequestReadState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  /** The code host's plugin doesn't offer it. Retrying won't help. */
  | { status: "unavailable" }
  | { status: "error"; message: string };

type Read<T> = (
  pluginId: string,
  connectionId: string,
  pullRequest: DeckOpenRequest,
) => Promise<T>;

/**
 * Something the review page reads about the pull request on screen, once
 * when it opens. Retry reads it again.
 */
function usePullRequestRead<T>(
  pullRequest: LocalPullRequest | undefined,
  read: Read<T>,
  fallback: string,
) {
  const [state, setState] = useState<PullRequestReadState<T>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const pluginId = pullRequest?.pluginId;
  const connectionId = pullRequest?.connectionId;
  const repository = pullRequest?.facts.repository;
  const number = pullRequest?.facts.number;
  useEffect(() => {
    if (!pluginId || !connectionId || !repository || !number) return;
    let current = true;
    setState({ status: "loading" });
    read(pluginId, connectionId, { repository, number }).then(
      (value) => {
        if (current) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!current) return;
        setState(
          error instanceof AppApiError &&
            error.payload?.reason === "not_supported"
            ? { status: "unavailable" }
            : {
                status: "error",
                message: error instanceof Error ? error.message : fallback,
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [pluginId, connectionId, repository, number, attempt, read, fallback]);
  return { state, retry: () => setAttempt((count) => count + 1) };
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
