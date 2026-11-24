import { useEffect, useRef, useState } from "react";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { AppApiError, openDeckPullRequest } from "@/lib/app-api";

export type PullRequestDiffState =
  | { status: "loading" }
  | { status: "ready"; diff: DeckOpenedPullRequest }
  /** The code host's plugin doesn't read a pull request's changes. Retrying won't help. */
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

/**
 * The diff and guide of the pull request on screen, read once when it opens,
 * at the head the last sync saw: the content cache answers it without the
 * code host when it holds that head (#781). A sync that finds a new push
 * doesn't move it: Retry, or opening the pull request again, reads it again.
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
  // Read when it opens: a sync's new head must not reload the page.
  const headSha = useRef(pullRequest?.facts.headSha);
  headSha.current = pullRequest?.facts.headSha;
  useEffect(() => {
    if (!pluginId || !connectionId || !repository || !number) return;
    let current = true;
    setState({ status: "loading" });
    openDeckPullRequest(pluginId, connectionId, {
      repository,
      number,
      ...(headSha.current ? { headSha: headSha.current } : {}),
    }).then(
      (diff) => {
        if (current) setState({ status: "ready", diff });
      },
      (error: unknown) => {
        if (!current) return;
        const message =
          error instanceof Error
            ? error.message
            : "Unable to read the pull request's changes.";
        setState({
          status:
            error instanceof AppApiError &&
            error.payload?.reason === "not_supported"
              ? "unavailable"
              : "error",
          message,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [pluginId, connectionId, repository, number, attempt]);
  return { state, retry: () => setAttempt((count) => count + 1) };
}
