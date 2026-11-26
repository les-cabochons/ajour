import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { personName } from "@/domain/deck/review-status";
import {
  isPullRequestSnoozed,
  type LocalPullRequest,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { PullRequestTitle } from "./author-actions";
import {
  pullRequestActions,
  reasonLabels,
  runPullRequestAction,
} from "./pull-request-row";

/**
 * A review page's top: the header with `review` (Finish review), the
 * author's actions and the row's actions, then the title, which the author
 * edits in place, and the meta line: the repository and number, the
 * connection, the author, and on your plate.
 */
export function PullRequestHeader({
  pullRequest,
  now,
  review,
  author,
  chat,
}: {
  pullRequest: LocalPullRequest;
  now: number;
  review: ReactNode;
  /** Chat, which opens the chat panel (#796). */
  chat?: ReactNode;
  /** Draft and ready, and Merge, for the author of an open pull request. */
  author?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        backLink={{ label: "Deck", to: "/deck" }}
        actions={
          <>
            {chat}
            {review}
            {author}
            {pullRequestActions(pullRequest, now).map((action) => (
              <Button
                key={action.id}
                variant="outline"
                onClick={() =>
                  runPullRequestAction(
                    pullRequest,
                    action.id as Parameters<typeof runPullRequestAction>[1],
                  )
                }
              >
                {action.label}
              </Button>
            ))}
          </>
        }
      />
      <header>
        <PullRequestTitle pullRequest={pullRequest} />
        <p className="backlog-item-page-meta">
          {pullRequest.facts.repository} #{pullRequest.facts.number} ·{" "}
          {pullRequest.connectionLabel} · {personName(pullRequest.facts.author)}{" "}
          ·{" "}
          {pullRequest.status === "settled"
            ? "Settled"
            : isPullRequestSnoozed(pullRequest, now)
              ? "Snoozed"
              : reasonLabels[pullRequest.reason ?? "manual"]}
        </p>
      </header>
    </>
  );
}
