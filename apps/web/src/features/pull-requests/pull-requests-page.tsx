import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiRefreshLine as Refresh,
  RiArrowLeftLine as Back,
} from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import {
  isPullRequestSnoozed,
  selectSidebarPullRequests,
  selectVisiblePullRequests,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { useCodeHostConnections } from "@/lib/code-host-connections";
import { useLocalState } from "@/lib/local-hooks";
import { syncCodeHostConnection } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { useNow } from "@/lib/use-now";
import {
  PullRequestRow,
  pullRequestActions,
  reasonLabels,
  runPullRequestAction,
} from "./pull-request-row";

export function PullRequestsPage({ itemId }: { itemId?: string }) {
  const state = useLocalState();
  const { overview, groups } = useCodeHostConnections();
  const now = useNow();
  const items = selectVisiblePullRequests(
    state.pullRequests ?? [],
    overview,
    now,
  );
  const item = itemId ? items.find((entry) => entry._id === itemId) : undefined;
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleItemId = item?._id;
  useEffect(() => {
    if (visibleItemId)
      localStore.changePullRequest(visibleItemId, { type: "open" });
  }, [visibleItemId]);
  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    const results = await Promise.allSettled(
      groups.flatMap((group) =>
        group.connections.map((connection) =>
          syncCodeHostConnection(group.plugin.id, connection.id),
        ),
      ),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length)
      setError(
        failures
          .map((failure) =>
            failure.reason instanceof Error
              ? failure.reason.message
              : "Unable to sync pull requests.",
          )
          .join(" "),
      );
    setSyncing(false);
  }
  if (!groups.length)
    return (
      <div className="p-4 desktop:p-6">
        <MessagePanel>
          Activate a code host plugin in Settings to see pull requests.
        </MessagePanel>
      </div>
    );
  if (itemId)
    return (
      <div className="space-y-5 p-4 desktop:p-6">
        <Button
          variant="ghost"

          nativeButton={false}
          render={<Link to="/pull-requests" />}
        >
          <Back />
          Pull requests
        </Button>
        {!item ? (
          <MessagePanel>
            This pull request is no longer in the local list.
          </MessagePanel>
        ) : (
          <>
            <header className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {item.facts.repository} #{item.facts.number} ·{" "}
                {item.connectionLabel}
              </p>
              <h1 className="text-lg font-semibold">{item.facts.title}</h1>
            </header>
            <div className="flex flex-wrap gap-2">
              {pullRequestActions(item, now).map((action) => (
                <Button
                  key={action.id}
                  variant="outline"

                  onClick={() =>
                    runPullRequestAction(
                      item,
                      action.id as Parameters<typeof runPullRequestAction>[1],
                    )
                  }
                >
                  {action.label}
                </Button>
              ))}
            </div>
            <dl className="grid max-w-xl grid-cols-[7rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">State</dt>
              <dd>
                {item.facts.state === "open"
                  ? item.facts.draft
                    ? "Draft"
                    : "Open"
                  : item.facts.state === "merged"
                    ? "Merged"
                    : "Closed"}
              </dd>
              <dt className="text-muted-foreground">Author</dt>
              <dd>
                {item.facts.author.displayName ?? item.facts.author.login}
              </dd>
              <dt className="text-muted-foreground">On your plate</dt>
              <dd>
                {item.status === "settled"
                  ? "Settled"
                  : isPullRequestSnoozed(item, now)
                    ? "Snoozed"
                    : reasonLabels[item.reason ?? "manual"]}
              </dd>
              <dt className="text-muted-foreground">Checks</dt>
              <dd>
                {item.facts.checks === "none"
                  ? "No checks"
                  : item.facts.checks === "success"
                    ? "Passed"
                    : item.facts.checks === "failure"
                      ? "Failed"
                      : "Pending"}
              </dd>
              <dt className="text-muted-foreground">Last updated</dt>
              <dd>{new Date(item.facts.updatedAt).toLocaleString()}</dd>
            </dl>
          </>
        )}
      </div>
    );
  const sections = [
    {
      title: "Active",
      items: [
        ...selectSidebarPullRequests(items, now),
        ...items.filter(
          (entry) =>
            entry.facts.state === "open" && isPullRequestSnoozed(entry, now),
        ),
      ],
    },
    {
      title: "Settled",
      items: items.filter(
        (entry) => entry.facts.state === "open" && entry.status === "settled",
      ),
    },
    {
      title: "Recently closed",
      items: items
        .filter((entry) => entry.facts.state !== "open")
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    },
  ];
  return (
    <div className="space-y-6 p-4 desktop:p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Pull requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your authored pull requests and review requests.
          </p>
        </div>
        <Button
          variant="outline"

          disabled={
            syncing || !groups.some((group) => group.connections.length)
          }
          onClick={() => void refresh()}
        >
          <Refresh className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </header>
      {error ? <MessagePanel role="alert">{error}</MessagePanel> : null}
      {!groups.some((group) => group.connections.length) ? (
        <MessagePanel>
          Add a code host connection in Plugins settings to sync pull requests.
        </MessagePanel>
      ) : null}
      {sections.map((section) => (
        <section
          key={section.title}
          data-focus-scope
          aria-label={section.title}
          className="space-y-2"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {section.title}
            <span className="text-xs font-normal text-muted-foreground">
              {section.items.length}
            </span>
          </h2>
          {section.items.length ? (
            section.items.map((entry) => (
              <PullRequestRow
                key={entry._id}
                item={entry}
                now={now}
                showConnection={
                  groups.reduce(
                    (count, group) => count + group.connections.length,
                    0,
                  ) > 1
                }
              />
            ))
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              {section.title === "Active"
                ? "No pull requests need your attention."
                : section.title === "Settled"
                  ? "No settled pull requests."
                  : "No pull requests closed in the last seven days."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
