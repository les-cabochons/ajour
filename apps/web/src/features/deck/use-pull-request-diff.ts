import { useEffect, useState } from "react";
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { openDeckPullRequest } from "@/lib/app-api";

export type PullRequestDiffState =
  | { status: "loading" }
  | { status: "ready"; diff: DeckPullRequestDiff }
  | { status: "error"; message: string };

/**
 * The diff of the pull request on screen, read once when it opens. A sync
 * that finds a new push doesn't move it: Retry, or opening the pull request
 * again, reads it again.
 */
export function usePullRequestDiff(pullRequest: LocalPullRequest | undefined) {
  const [state, setState] = useState<PullRequestDiffState>({
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
    openDeckPullRequest(pluginId, connectionId, { repository, number }).then(
      (diff) => {
        if (current) setState({ status: "ready", diff });
      },
      (error: unknown) => {
        if (current)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to read the pull request's changes.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [pluginId, connectionId, repository, number, attempt]);
  return { state, retry: () => setAttempt((count) => count + 1) };
}
