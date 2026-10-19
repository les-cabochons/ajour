import {
  useLayoutEffect,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  RiCornerLeftUpLine as ParentIcon,
  RiGitClosePullRequestLine as ClosedIcon,
  RiGitMergeLine as MergedIcon,
  RiGitPrDraftLine as DraftIcon,
  RiGitPullRequestLine as OpenIcon,
  RiLinksLine as SourceIcon,
} from "@remixicon/react";
import { HoverCard, HoverCardContent } from "@/components/ui/hover-card";
import { Value } from "@/components/ui/value";
import { summarizeBacklogItem } from "@/domain/backlog/backlog-item-summary";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  selectVisiblePullRequests,
  type LocalPullRequest,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { getBacklogItemOriginFor } from "@/features/backlog/backlog-item-search";
import {
  WorkItemIcon,
  type useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { useCodeHostConnections } from "@/lib/code-host-connections";
import { useRowHoverCard } from "@/lib/row-hover-card";
import { openModifiedSourceClick } from "@/lib/source-navigation";
import { cn } from "@/lib/utils";

type IconData = ReturnType<typeof useWorkItemIconData>;

const ROW_SELECTOR = "[data-backlog-item-id]";
const readItemId = (row: HTMLElement) => row.dataset.backlogItemId;

const PULL_REQUEST_ICONS = {
  open: OpenIcon,
  draft: DraftIcon,
  merged: MergedIcon,
  closed: ClosedIcon,
};
const PULL_REQUEST_STATES = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

function pullRequestState(item: LocalPullRequest) {
  return item.facts.state === "open" && item.facts.draft
    ? "draft"
    : item.facts.state;
}

/** Card rows: one line, tinted on hover like the sidebar's. */
const cardRow =
  "flex h-7 min-w-0 items-center gap-2 rounded-sm px-1.5 text-sm outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring";

function CardSection({
  label,
  count,
  children,
}: {
  label: string;
  count: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col border-t border-border p-1.5"
    >
      <div className="flex h-6 items-center justify-between px-1.5 text-xs font-medium text-muted-foreground">
        {label}
        <Value tone="muted">{count}</Value>
      </div>
      {children}
    </section>
  );
}

function MoreLine({ count }: { count: number }) {
  return count > 0 ? (
    <p className="flex h-6 items-center px-1.5 text-xs text-muted-foreground">
      {count} more
    </p>
  ) : null;
}

/**
 * The card's contents: the whole title, where the item comes from, its
 * parent, its subitems and the pull requests that name it. Subitems and pull
 * requests open on click; Ctrl or Cmd-click opens them in their source.
 */
function BacklogItemSummaryCard({
  workItem,
  state,
  now,
  iconData,
  onNavigate,
}: {
  workItem: LocalWorkItem;
  state: LocalAppState;
  now: number;
  iconData: IconData;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const { overview } = useCodeHostConnections();
  const summary = summarizeBacklogItem(workItem, {
    workItems: state.workItems,
    workflowStates: state.workflowStates,
    pullRequests: selectVisiblePullRequests(
      state.pullRequests ?? [],
      overview,
      now,
    ),
  });
  const plugin = overview?.plugins.find(
    (candidate) => candidate.id === workItem.source,
  );
  const logo = plugin?.iconSvg ?? iconData.pluginIconsBySource[workItem.source];
  const from = getBacklogItemOriginFor(router.state.location);
  const { origin, parent } = summary;

  function follow(event: MouseEvent, sourceUrl: string | undefined) {
    openModifiedSourceClick(event, sourceUrl);
    onNavigate();
  }

  return (
    <>
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-sm leading-5 font-medium [overflow-wrap:anywhere] text-foreground">
          {workItem.title}
        </p>
        {origin ? (
          <div className="flex h-5 items-center gap-2 text-muted-foreground">
            {logo ? (
              <WorkItemIcon
                icon={{
                  kind: "plugin",
                  svg: logo,
                  currentColor: iconData.pluginIconCurrentColor,
                }}
              />
            ) : (
              <SourceIcon aria-hidden className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {plugin ? (
                <span className="sr-only">{plugin.displayName}: </span>
              ) : null}
              {[origin.organization, origin.project]
                .filter(Boolean)
                .join(" / ")}
            </span>
            {summary.key ? <Value tone="muted">{summary.key}</Value> : null}
          </div>
        ) : null}
        {parent ? (
          <div className="flex h-5 items-center gap-2 text-muted-foreground">
            <ParentIcon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              <span className="sr-only">Subitem of </span>
              {parent.title}
            </span>
          </div>
        ) : null}
      </div>

      {summary.subitemCount > 0 ? (
        <CardSection
          label="Subitems"
          count={`${summary.closedSubitemCount}/${summary.subitemCount}`}
        >
          {summary.subitems.map(
            ({ workItem: subitem, workflowState, closed }) => (
              <Link
                key={subitem._id}
                to="/backlog/$itemId"
                params={{ itemId: subitem._id }}
                search={{ from }}
                className={cardRow}
                onClick={(event) => follow(event, subitem.sourceUrl)}
              >
                <span
                  className="backlog-state-dot size-2.5"
                  style={
                    workflowState ? { color: workflowState.color } : undefined
                  }
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    closed && "text-muted-foreground",
                  )}
                >
                  {subitem.title}
                </span>
              </Link>
            ),
          )}
          <MoreLine count={summary.subitemCount - summary.subitems.length} />
        </CardSection>
      ) : null}

      {summary.pullRequestCount > 0 ? (
        <CardSection
          label="Pull requests"
          count={String(summary.pullRequestCount)}
        >
          {summary.pullRequests.map((item) => {
            const pullState = pullRequestState(item);
            const Icon = PULL_REQUEST_ICONS[pullState];
            return (
              <Link
                key={item._id}
                to="/pull-requests/$itemId"
                params={{ itemId: item._id }}
                className={cardRow}
                onClick={(event) => follow(event, item.facts.url)}
              >
                <Icon
                  role="img"
                  aria-label={PULL_REQUEST_STATES[pullState]}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <Value tone="muted">#{item.facts.number}</Value>
                <span className="min-w-0 flex-1 truncate">
                  {item.facts.title}
                </span>
              </Link>
            );
          })}
          <MoreLine
            count={summary.pullRequestCount - summary.pullRequests.length}
          />
        </CardSection>
      ) : null}
    </>
  );
}

/**
 * The hover card of the backlog rows in `container`, like T3 Code's thread
 * card: resting the mouse on a row for most of a second shows the item beside
 * it. There is one card for the whole list, and the rows mount nothing for it.
 */
export function BacklogItemHoverCard({
  container,
  state,
  now,
  iconData,
}: {
  container: RefObject<HTMLElement | null>;
  state: LocalAppState;
  now: number;
  iconData: IconData;
}) {
  const { shown, dismiss, rowGone, cardProps } = useRowHoverCard(
    container,
    ROW_SELECTOR,
    readItemId,
  );
  const workItem = shown
    ? state.workItems.find((candidate) => candidate._id === shown.id)
    : undefined;
  // A sync can take the row away under the card, or replace it. React removes
  // the old row in the commit, after this renders, so look again after it.
  useLayoutEffect(() => {
    if (shown && (!workItem || !shown.element.isConnected)) rowGone(shown.id);
  });
  if (!shown || !workItem || !shown.element.isConnected) return null;

  return (
    <HoverCard
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <HoverCardContent
        anchor={shown.element}
        side="right"
        align="start"
        sideOffset={12}
        // A look, not a visit: focus stays where the user left it.
        initialFocus={false}
        finalFocus={false}
        aria-label={workItem.title}
        className="w-80 gap-0 p-0"
        {...cardProps}
      >
        <BacklogItemSummaryCard
          workItem={workItem}
          state={state}
          now={now}
          iconData={iconData}
          onNavigate={dismiss}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
