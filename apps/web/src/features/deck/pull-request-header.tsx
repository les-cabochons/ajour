import type { ReactNode } from "react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { PageHeader } from "@/components/page-header";
import type { ObjectAction } from "@/domain/actions/object-actions";
import { authorActions } from "@/domain/deck/author-actions";
import { personName } from "@/domain/deck/review-status";
import {
  isPullRequestSnoozed,
  type LocalPullRequest,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { PullRequestTitle, useDraftToggle } from "./author-actions";
import {
  pullRequestActions,
  reasonLabels,
  runPullRequestAction,
} from "./pull-request-row";

/** The repository's own name, as the top bar's crumb shows it: `acme/api` reads `api`. */
const repositoryName = (repository: string) =>
  repository.slice(repository.lastIndexOf("/") + 1);

type HeaderAction = Parameters<typeof runPullRequestAction>[1] | "draft";

/**
 * A review page's top: the breadcrumb in the top bar, then the title,
 * which the author edits in place, with Finish review (`review`) and the
 * "…" menu beside it: Convert to draft or Ready for review for the author,
 * Open in the code host, Settle and Snooze. Under it, the meta line: who
 * opened it, which branch merges into which, the repository and number,
 * the connection, and why it's on the user's plate.
 */
export function PullRequestHeader({
  pullRequest,
  now,
  review,
}: {
  pullRequest: LocalPullRequest;
  now: number;
  /** Finish review, while the pull request is open. */
  review: ReactNode;
}) {
  const { facts } = pullRequest;
  const draft = useDraftToggle(pullRequest);
  const actions: ObjectAction<HeaderAction>[] = [
    ...(authorActions(facts)
      ? [
          {
            id: "draft" as const,
            label: draft.label,
            group: "author",
            ...(draft.sending ? { disabledReason: "Sending…" } : {}),
          },
        ]
      : []),
    ...pullRequestActions(pullRequest, now).filter(
      (action): action is ObjectAction<Exclude<HeaderAction, "draft">> =>
        action.id !== "open",
    ),
  ];
  const plate =
    pullRequest.status === "settled"
      ? "Settled"
      : isPullRequestSnoozed(pullRequest, now)
        ? "Snoozed"
        : reasonLabels[pullRequest.reason ?? "manual"];
  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Deck", to: "/deck" },
          {
            label: `${repositoryName(facts.repository)} #${facts.number}`,
          },
        ]}
      />
      <header className="deck-review-title">
        <div className="deck-review-title-row">
          <PullRequestTitle pullRequest={pullRequest} />
          <div className="deck-review-title-actions">
            {review}
            <ObjectActionsButton
              label="More actions"
              actions={actions}
              onAction={(id) => {
                if (id === "draft") draft.run();
                else runPullRequestAction(pullRequest, id);
              }}
            />
          </div>
        </div>
        <p className="deck-review-meta">
          <span>{personName(facts.author)}</span>
          {facts.headRef && facts.baseRef ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="deck-review-branches">
                <code>{facts.headRef}</code>
                <span aria-label="into">→</span>
                <code>{facts.baseRef}</code>
              </span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>
            {facts.repository} #{facts.number}
          </span>
          <span aria-hidden="true">·</span>
          <span>{pullRequest.connectionLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{plate}</span>
        </p>
      </header>
    </>
  );
}
