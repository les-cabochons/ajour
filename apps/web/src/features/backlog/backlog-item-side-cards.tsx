import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiAddLine as AddIcon,
  RiArrowRightSLine as ChevronIcon,
  RiGitBranchLine as BranchIcon,
  RiGitPullRequestLine as PullRequestIcon,
  RiMoreLine as MoreIcon,
} from "@remixicon/react";
import { isHttpsUrl, type Handoff } from "@ajour/shared/handoffs";
import type { HandoffThreadOffer } from "@ajour/shared/handoff-threads";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Value } from "@/components/ui/value";
import {
  getHandoffChip,
  sortHandoffs,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import { syncAge } from "@/domain/backlog/sync-freshness";
import { HandoffToolIcon } from "@/features/backlog/handoff-button";
import {
  openHandoffThread,
  refreshHandoffThread,
  removeHandoffFromItem,
} from "@/features/backlog/handoff-workflow";
import {
  getSubitemHoursLeft,
  getSubitemProgress,
} from "@/domain/backlog/backlog-view";
import type {
  LocalTimesheetEntry,
  LocalWorkItem,
  LocalWorkflowState,
} from "@/domain/local-state";
import { getWorkflowStateFills } from "@/domain/backlog/workflow-state-fill";
import { stateDotStyle } from "@/features/backlog/state-dot";
import { formatClockDuration } from "@/domain/time/duration";
import { formatHours } from "@/features/backlog/backlog-estimates";
import { AddSubitemRow } from "@/features/backlog/backlog-item-inline-edit";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  type useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { cn } from "@/lib/utils";

/** Above this many subitems the segments would be too thin to read. */
const MAX_PROGRESS_SEGMENTS = 10;

/** "Fri, Oct 17", the day an entry was logged. */
function formatEntryDay(localDate: string) {
  return new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A card under the properties on the item page. The header opens and closes
 * it, and its + adds a row. A closed card shows `summary` instead of its rows.
 */
function FoldingCard({
  label,
  trailing,
  open,
  onOpenChange,
  addLabel,
  onAdd,
  summary,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addLabel: string;
  /** Missing on a read-only item. */
  onAdd?: (button: HTMLElement) => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  // The state shown when the primary button went down on the title. Pressing
  // it can blur an empty name field, which folds the card before the click
  // lands; the click must still fold it, not reopen it. Keyboard clicks act
  // on the current state.
  const openAtPress = useRef<boolean | null>(null);
  return (
    <section className="backlog-item-card" aria-label={label}>
      <div className="backlog-item-card-header">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            className="backlog-item-card-toggle"
            onPointerDown={(event) => {
              openAtPress.current = event.button === 0 ? open : null;
            }}
            onPointerLeave={() => {
              openAtPress.current = null;
            }}
            onClick={(event) => {
              const wasOpen =
                event.detail > 0 ? (openAtPress.current ?? open) : open;
              openAtPress.current = null;
              onOpenChange(!wasOpen);
            }}
          >
            <ChevronIcon
              aria-hidden="true"
              className={cn("size-4 shrink-0", open && "rotate-90")}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing !== undefined ? (
              <span className="shrink-0 font-normal">{trailing}</span>
            ) : null}
          </button>
        </h2>
        {onAdd ? (
          <TooltipButton
            label={addLabel}
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
              />
            }
            onClick={(event) => onAdd(event.currentTarget)}
          >
            <AddIcon className="size-4" />
          </TooltipButton>
        ) : null}
      </div>
      <div
        id={contentId}
        className={
          open ? "backlog-item-card-body" : "backlog-item-card-summary"
        }
      >
        {open ? children : summary}
      </div>
    </section>
  );
}

/**
 * The item's subitems. Closed, it shows one segment per subitem, filled when
 * done, and the hours left on the open ones. Adding opens it until the name
 * field closes, without changing the saved open state.
 */
function SubitemStateMark({
  subitem,
  states,
  fills,
}: {
  subitem: LocalWorkItem;
  states: LocalWorkflowState[];
  fills: Map<string, number>;
}) {
  const workflow = states.find((s) => s._id === subitem.workflowStateId);
  return (
    <span
      role="img"
      aria-label={workflow?.name ?? "No state"}
      className="backlog-state-dot"
      style={stateDotStyle(workflow?.color, fills.get(workflow?._id ?? ""))}
    />
  );
}

export function SubitemsCard({
  parent,
  subitems,
  workflowStates,
  iconData,
  from,
  open,
  onOpenChange,
  readOnly,
  adding,
  onAdd,
  onAddingClose,
}: {
  parent: LocalWorkItem;
  subitems: LocalWorkItem[];
  /** The workflow, for each subitem's leading state mark. */
  workflowStates: LocalWorkflowState[];
  iconData: ReturnType<typeof useWorkItemIconData>;
  /** The page the item page was opened from, which subitem links keep. */
  from: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
  adding: boolean;
  onAdd: () => void;
  /** `escaped` when Escape closed the name field, rather than a blur or a fold. */
  onAddingClose: (escaped: boolean) => void;
}) {
  const progress = getSubitemProgress(subitems);
  const fills = getWorkflowStateFills(workflowStates);
  const hoursLeft = getSubitemHoursLeft(subitems);
  const empty = <p className="text-xs text-muted-foreground">No subitems.</p>;

  return (
    <FoldingCard
      label="Subitems"
      trailing={
        progress ? (
          <>
            <Value>{progress.closed}</Value> of <Value>{progress.total}</Value>{" "}
            done
          </>
        ) : undefined
      }
      open={open || adding}
      onOpenChange={(next) => {
        if (!next && adding) onAddingClose(false);
        onOpenChange(next);
      }}
      addLabel="Add subitem"
      onAdd={readOnly ? undefined : onAdd}
      summary={
        progress ? (
          <>
            <div
              aria-hidden="true"
              className="backlog-item-card-progress"
              data-continuous={
                progress.total > MAX_PROGRESS_SEGMENTS || undefined
              }
            >
              {progress.total > MAX_PROGRESS_SEGMENTS ? (
                <i
                  data-done=""
                  style={{
                    width: `${(progress.closed / progress.total) * 100}%`,
                  }}
                />
              ) : (
                subitems.map((subitem) => (
                  <i
                    key={subitem._id}
                    data-done={subitem.status === "archived" || undefined}
                  />
                ))
              )}
            </div>
            {hoursLeft !== undefined ? (
              <span>
                <Value tone="muted">{formatHours(hoursLeft)}</Value> left
              </span>
            ) : null}
          </>
        ) : (
          empty
        )
      }
    >
      {subitems.length === 0 && !adding ? (
        empty
      ) : (
        <div className="backlog-item-rows">
          {subitems.map((subitem) => (
            <Link
              key={subitem._id}
              to="/backlog/$itemId"
              params={{ itemId: subitem._id }}
              search={{ from }}
              className="backlog-item-row is-subitem"
            >
              {/* Each row leads with its state mark, as list and sidebar
                  rows do; the project's own icon shows only when it differs
                  from the parent's (council round 28). */}
              <SubitemStateMark
                subitem={subitem}
                states={workflowStates}
                fills={fills}
              />
              {subitem.projectId !== parent.projectId ? (
                <WorkItemIcon icon={resolveWorkItemIcon(subitem, iconData)} />
              ) : null}
              <span
                className={cn(
                  "backlog-item-row-title",
                  subitem.status === "archived" && "text-muted-foreground",
                )}
              >
                {subitem.title}
              </span>
              {/* State, title and estimate: what picking the next subitem
                  needs; priority stays on the item itself (council round
                  30). */}
              <Value tone="muted" className="w-10 text-right">
                {/* A done subitem has nothing left: "–", as an empty cell
                    reads (council round 26). */}
                {subitem.status === "archived"
                  ? "–"
                  : formatHours(subitem.remainingEstimateHours)}
              </Value>
            </Link>
          ))}
        </div>
      )}
      {!readOnly ? (
        <AddSubitemRow
          parent={parent}
          adding={adding}
          onClose={onAddingClose}
        />
      ) : null}
    </FoldingCard>
  );
}

/**
 * The time logged on the item, newest first. Closed, it shows how many
 * entries there are and the last day one was logged.
 */
export function TimeEntriesCard({
  entries,
  loggedMs,
  open,
  onOpenChange,
  onAdd,
}: {
  /** Newest first. */
  entries: LocalTimesheetEntry[];
  loggedMs: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the new entry popover on the + button; missing when read-only. */
  onAdd?: (button: HTMLElement) => void;
}) {
  const last = entries[0];
  const empty = (
    <p className="text-xs text-muted-foreground">No time logged yet.</p>
  );
  return (
    <FoldingCard
      label="Time entries"
      trailing={
        entries.length ? (
          <Value>{formatClockDuration(loggedMs)}</Value>
        ) : undefined
      }
      open={open}
      onOpenChange={onOpenChange}
      addLabel="Add time entry"
      onAdd={onAdd}
      summary={
        last ? (
          <span>
            <Value tone="muted">{entries.length}</Value>{" "}
            {entries.length === 1 ? "entry" : "entries"} · last on{" "}
            {formatEntryDay(last.localDate)}
          </span>
        ) : (
          empty
        )
      }
    >
      {entries.length === 0 ? (
        empty
      ) : (
        <div className="backlog-item-rows">
          {entries.map((entry) => (
            <Link
              key={entry._id}
              to="/time/$date"
              params={{ date: entry.localDate }}
              className="backlog-item-row"
            >
              <span className="w-20 shrink-0 text-muted-foreground">
                {formatEntryDay(entry.localDate)}
              </span>
              <span className="backlog-item-row-title">
                {entry.note ?? (
                  <span className="text-muted-foreground">No note</span>
                )}
              </span>
              <Value>{formatClockDuration(entry.durationMs)}</Value>
            </Link>
          ))}
        </div>
      )}
    </FoldingCard>
  );
}

/** "#12" for a pull request link without a title, else the link's last part. */
function pullRequestLabel(pullRequest: { url: string; title?: string }) {
  if (pullRequest.title) return pullRequest.title;
  const number = /\/(?:pull|pullrequest|merge_requests)\/(\d+)/i.exec(
    pullRequest.url,
  )?.[1];
  return number ? `#${number}` : pullRequest.url;
}

/**
 * The threads the item was handed off to, newest change first. Each shows
 * its tool, title and state chip (the tool's own words in its tooltip), its
 * branch, pull requests and last change, Open, and a menu with Refresh and
 * Remove from item. Closed, it counts the threads and says which wait.
 * Under them, the threads a tool listed whose title names the item's key,
 * each with Link and Not this one. Once one leaves the list, focus moves to
 * the Link of the offer that took its place, else the last one, else the
 * card's heading.
 */
export function HandoffsCard({
  handoffs,
  tools,
  offers = NO_OFFERS,
  onLink,
  onDismiss,
  pending = NO_OFFERS,
  now,
  open,
  onOpenChange,
}: {
  handoffs: readonly Handoff[];
  /** For each thread's tool name and icon. */
  tools: readonly HandoffTool[];
  /** Threads found in the tools that name the item's key. */
  offers?: readonly HandoffThreadOffer[];
  /** Resolve true once the offer has left the list. */
  onLink?: (offer: HandoffThreadOffer) => Promise<boolean>;
  onDismiss?: (offer: HandoffThreadOffer) => Promise<boolean>;
  /** Offers whose Link or Not this one is under way. */
  pending?: readonly HandoffThreadOffer[];
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sorted = sortHandoffs(handoffs);
  const waiting = handoffs.filter(
    (handoff) => !handoff.paused && handoff.state === "needs-you",
  ).length;
  const found = offers.length
    ? `${offers.length} ${offers.length === 1 ? "thread" : "threads"} found`
    : "";
  const empty = (
    <p className="text-xs text-muted-foreground">
      Not handed off yet.{found ? ` ${found}.` : ""}
    </p>
  );
  const toolOf = (pluginId: string, toolId: string) =>
    tools.find((tool) => tool.pluginId === pluginId && tool.toolId === toolId);
  // Where focus goes once a settled offer has left the list, after the
  // render that removes it.
  const refocus = useRef<{ card: HTMLElement; index: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    const request = refocus.current;
    refocus.current = null;
    if (!request?.card.isConnected) return;
    const links =
      request.card.querySelectorAll<HTMLElement>("[data-offer-link]");
    const target =
      links[Math.min(request.index, links.length - 1)] ??
      request.card.querySelector<HTMLElement>(".backlog-item-card-toggle");
    target?.focus();
  }, [focusRequest]);
  const settle = async (
    offer: HandoffThreadOffer,
    run: ((offer: HandoffThreadOffer) => Promise<boolean>) | undefined,
    from: HTMLElement,
  ) => {
    const card = from.closest("section");
    const index = offers.indexOf(offer);
    if (!run || !(await run(offer)) || !card) return;
    refocus.current = { card, index };
    setFocusRequest((count) => count + 1);
  };
  return (
    <FoldingCard
      label="Handoffs"
      trailing={handoffs.length ? <Value>{handoffs.length}</Value> : undefined}
      open={open}
      onOpenChange={onOpenChange}
      addLabel="Hand off"
      summary={
        sorted[0] ? (
          <span>
            <Value tone="muted">{handoffs.length}</Value>{" "}
            {handoffs.length === 1 ? "thread" : "threads"}
            {waiting ? ` · ${waiting} needs you` : ""} · changed{" "}
            {syncAge(sorted[0].changedAt, now)}
            {found ? ` · ${found}` : ""}
          </span>
        ) : (
          empty
        )
      }
    >
      {sorted.length ? (
        <ul className="handoff-rows" aria-label="Handoffs">
          {sorted.map((handoff) => (
            <HandoffRow
              key={handoff.id}
              handoff={handoff}
              tool={toolOf(handoff.pluginId, handoff.toolId)}
              now={now}
            />
          ))}
        </ul>
      ) : offers.length ? null : (
        empty
      )}
      {offers.length ? (
        <ul className="handoff-rows" aria-label="Threads found">
          {offers.map((offer) => (
            <ThreadOfferRow
              key={offerKey(offer)}
              offer={offer}
              tool={toolOf(offer.pluginId, offer.toolId)}
              busy={pending.some(
                (candidate) => offerKey(candidate) === offerKey(offer),
              )}
              now={now}
              onLink={
                onLink && ((offer, from) => void settle(offer, onLink, from))
              }
              onDismiss={
                onDismiss &&
                ((offer, from) => void settle(offer, onDismiss, from))
              }
            />
          ))}
        </ul>
      ) : null}
    </FoldingCard>
  );
}

const NO_OFFERS: readonly HandoffThreadOffer[] = [];

const offerKey = (offer: HandoffThreadOffer) =>
  JSON.stringify([
    offer.pluginId,
    offer.toolId,
    offer.connectionId ?? null,
    offer.folderId,
    offer.threadId,
  ]);

/**
 * A thread a tool listed whose title names the item's key, laid out as a
 * thread: its title with Link in the head where a thread has Open, and
 * "Found in <tool>" and Not this one under it. The title's hover text adds
 * its last change, which the narrow card has no room for. Its name reads
 * "Found in <tool>: "<title>", changed <age>".
 */
function ThreadOfferRow({
  offer,
  tool,
  busy,
  now,
  onLink,
  onDismiss,
}: {
  offer: HandoffThreadOffer;
  tool: HandoffTool | undefined;
  busy: boolean;
  now: number;
  onLink?: (offer: HandoffThreadOffer, from: HTMLElement) => void;
  onDismiss?: (offer: HandoffThreadOffer, from: HTMLElement) => void;
}) {
  const found = `Found in ${tool?.label ?? offer.toolId}`;
  const changed =
    offer.updatedAt === undefined ? undefined : syncAge(offer.updatedAt, now);
  const label = `${found}: "${offer.title}"${changed ? `, changed ${changed}` : ""}`;
  return (
    <li className="handoff-row" aria-label={label}>
      <div className="handoff-row-head">
        {tool ? (
          <HandoffToolIcon tool={tool} className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span
          className="handoff-row-title"
          title={
            changed === undefined
              ? offer.title
              : `${offer.title}\nChanged ${changed}`
          }
        >
          {offer.title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !onLink}
          aria-label={`Link "${offer.title}" to this item`}
          data-offer-link=""
          onClick={(event) => onLink?.(offer, event.currentTarget)}
        >
          Link
        </Button>
      </div>
      <div className="handoff-row-meta">
        <span className="truncate">{found}</span>
        <span aria-hidden="true">·</span>
        <Button
          variant="ghost"
          size="xs"
          className="-ml-1.5 shrink-0 text-muted-foreground"
          disabled={busy || !onDismiss}
          aria-label={`Not this one: "${offer.title}"`}
          onClick={(event) => onDismiss?.(offer, event.currentTarget)}
        >
          Not this one
        </Button>
      </div>
    </li>
  );
}

function HandoffRow({
  handoff,
  tool,
  now,
}: {
  handoff: Handoff;
  tool: HandoffTool | undefined;
  now: number;
}) {
  const chip = getHandoffChip(handoff);
  const toolLabel = tool?.label ?? handoff.toolId;
  return (
    <li className="handoff-row" aria-label={handoff.title}>
      <div className="handoff-row-head">
        {tool ? (
          <HandoffToolIcon tool={tool} className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="handoff-row-title" title={handoff.title}>
          {handoff.title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open ${handoff.title} in ${toolLabel}`}
          onClick={() => void openHandoffThread(handoff.id)}
        >
          Open
        </Button>
        <DropdownMenu>
          <TooltipButton
            label="Handoff actions"
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                  />
                }
              />
            }
          >
            <MoreIcon className="size-4" />
          </TooltipButton>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => void refreshHandoffThread(handoff.id)}
            >
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void removeHandoffFromItem(handoff.id, toolLabel)}
            >
              Remove from item
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="handoff-row-meta">
        <Tooltip>
          <TooltipTrigger
            render={
              <Chip
                tone={chip.tone === "muted" ? "neutral" : chip.tone}
                className={cn(chip.tone === "muted" && "opacity-70")}
                tabIndex={0}
                aria-label={
                  chip.detail ? `${chip.label}: ${chip.detail}` : chip.label
                }
              />
            }
          >
            {chip.label}
          </TooltipTrigger>
          <TooltipContent>
            {chip.detail ?? `${toolLabel} gave no status`}
          </TooltipContent>
        </Tooltip>
        <span className="truncate">{toolLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{syncAge(handoff.changedAt, now)}</span>
      </div>
      {handoff.branch ? (
        <div className="handoff-row-meta">
          <BranchIcon aria-label="Branch" className="size-3 shrink-0" />
          <span className="truncate font-mono" title={handoff.branch}>
            {handoff.branch}
          </span>
        </div>
      ) : null}
      {handoff.pullRequests?.length ? (
        <div className="handoff-row-meta flex-wrap">
          <PullRequestIcon
            aria-label="Pull requests"
            className="size-3 shrink-0"
          />
          {handoff.pullRequests.map((pullRequest) =>
            // Only an https link opens; any other shows as text.
            isHttpsUrl(pullRequest.url) ? (
              <a
                key={pullRequest.url}
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-full truncate"
              >
                {pullRequestLabel(pullRequest)}
              </a>
            ) : (
              <span key={pullRequest.url} className="max-w-full truncate">
                {pullRequestLabel(pullRequest)}
              </span>
            ),
          )}
        </div>
      ) : null}
    </li>
  );
}
