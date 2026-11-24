import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { personName } from "@/domain/deck/review-status";
import {
  isPullRequestSnoozed,
  type LocalPullRequest,
} from "@/domain/pull-requests/pull-request-lifecycle";
import {
  pullRequestActions,
  reasonLabels,
  runPullRequestAction,
} from "./pull-request-row";

/**
 * A review page's top: the header with `review` (Finish review) and the
 * row's actions, then the title and the meta line: the repository and
 * number, the connection, the author, and on your plate.
 */
export function PullRequestHeader({
  pullRequest,
  now,
  review,
}: {
  pullRequest: LocalPullRequest;
  now: number;
  review: ReactNode;
}) {
  return (
    <>
      <PageHeader
        backLink={{ label: "Deck", to: "/deck" }}
        actions={
          <>
            {review}
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
        <h1 className="backlog-item-page-title">{pullRequest.facts.title}</h1>
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
