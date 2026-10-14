import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiRefreshLine as Refresh,
  RiArrowLeftLine as Back,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { MessagePanel } from "@/components/app-surface";
import { PageHeader } from "@/components/page-header";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
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
      <div className="backlog-item-page">
        <PageHeader
          breadcrumb={[
            { label: "Pull requests", to: "/pull-requests" },
            {
              label: item ? `#${item.facts.number}` : "Pull request",
              mono: Boolean(item),
            },
          ]}
          actions={
            item
              ? pullRequestActions(item, now).map((action) => (
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
                ))
              : null
          }
        >
          <TooltipButton
            label="Back to pull requests"
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="order-first -ml-1 text-muted-foreground"
                nativeButton={false}
                render={<Link to="/pull-requests" />}
              />
            }
          >
            <Back />
          </TooltipButton>
        </PageHeader>
        {!item ? (
          <MessagePanel>
            This pull request is no longer in the local list.
          </MessagePanel>
        ) : (
          <>
            <header>
              <h1 className="backlog-item-page-title">{item.facts.title}</h1>
              <p className="backlog-item-page-meta">
                {item.facts.repository} #{item.facts.number} ·{" "}
                {item.connectionLabel}
              </p>
            </header>
            <PropertyList className="max-w-xl">
              <PropertyRow label="State">
                {item.facts.state === "open"
                  ? item.facts.draft
                    ? "Draft"
                    : "Open"
                  : item.facts.state === "merged"
                    ? "Merged"
                    : "Closed"}
              </PropertyRow>
              <PropertyRow label="Author">
                {item.facts.author.displayName ?? item.facts.author.login}
              </PropertyRow>
              <PropertyRow label="On your plate">
                {item.status === "settled"
                  ? "Settled"
                  : isPullRequestSnoozed(item, now)
                    ? "Snoozed"
                    : reasonLabels[item.reason ?? "manual"]}
              </PropertyRow>
              <PropertyRow label="Checks">
                {item.facts.checks === "none"
                  ? "No checks"
                  : item.facts.checks === "success"
                    ? "Passed"
                    : item.facts.checks === "failure"
                      ? "Failed"
                      : "Pending"}
              </PropertyRow>
              <PropertyRow label="Last updated">
                {new Date(item.facts.updatedAt).toLocaleString()}
              </PropertyRow>
            </PropertyList>
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
    <div className="backlog-item-page">
      <PageHeader
        title="Pull requests"
        meta={items.length}
        actions={
          <Button
            variant="outline"
            disabled={
              syncing || !groups.some((group) => group.connections.length)
            }
            onClick={() => void refresh()}
          >
            <Refresh
              data-icon="inline-start"
              className={syncing ? "animate-spin" : ""}
            />
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        }
      />
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
        >
          <SectionHeading trailing={section.items.length}>
            {section.title}
          </SectionHeading>
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
            <p className="py-1 text-sm text-muted-foreground">
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
