import {
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowGoBackLine as UndoIcon,
  RiPlayFill as PlayFillIcon,
  RiPlayLine as PlayIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import {
  isBacklogItemReturned,
  isBacklogItemSnoozed,
  selectSidebarBacklogItems,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  BACKLOG_ITEM_ROW_KEYS,
  OPEN_BACKLOG_ITEM_ACTION,
  handleItemKeyDown,
} from "@/lib/item-keys";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { openModifiedSourceClick } from "@/lib/source-navigation";
import {
  updateSidebarLayout,
  useSidebarLayout,
  type SidebarDensity,
} from "@/lib/sidebar-layout";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

const SETTLED_PAGE_SIZE = 20;

type IconData = ReturnType<typeof useWorkItemIconData>;

function formatHours(hours?: number) {
  if (hours === undefined) return undefined;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** "#48213 · Active · 2.5h left", or "Local" for a manual item. */
function getMetaLine(workItem: LocalWorkItem) {
  const reference =
    workItem.source === "azure_devops"
      ? parseWorkItemReference(workItem.sourceId)
      : workItem.sourceId;
  const hours = formatHours(workItem.remainingEstimateHours);
  return [
    workItem.source === "manual" ? "Local" : reference && `#${reference}`,
    workItem.sourceStatusLabel,
    hours && `${hours} left`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Shared by every row: actions, keys and navigation for one backlog item. */
function useBacklogItemRow(state: LocalAppState, now: number) {
  const navigate = useNavigate();

  function open(workItem: LocalWorkItem) {
    void navigate({ to: "/backlog/$itemId", params: { itemId: workItem._id } });
  }

  function actionsFor(workItem: LocalWorkItem) {
    const isSubitem = isSubtaskWorkItem(workItem);
    return getBacklogItemActions(workItem, {
      isRunning: state.timers.some(
        (timer) => timer.workItemId === workItem._id,
      ),
      isSubitem,
      isSnoozed: isBacklogItemSnoozed(workItem, now),
      subitemCount: isSubitem
        ? 0
        : getDirectChildWorkItems(workItem, state.workItems).length,
      settleOpensDialog: settleOpensDialog(workItem),
      otherSourceStateCount: getOtherSourceStates(workItem).length,
    });
  }

  function run(
    workItem: LocalWorkItem,
    actionId: BacklogItemActionId,
    options?: { askToSettle?: boolean },
  ) {
    const action = actionsFor(workItem).find((item) => item.id === actionId);
    if (!action || action.disabledReason) return;

    // Edit and Add subitem open the editor on the item's page.
    runBacklogItemAction(
      workItem,
      actionId,
      (hosted) =>
        navigate({
          to: "/backlog/$itemId",
          params: { itemId: workItem._id },
          search: { action: hosted },
        }),
      options,
    );
  }

  return { open, actionsFor, run };
}

type RowApi = ReturnType<typeof useBacklogItemRow>;

const iconButton =
  "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground";

/** Hover and focus swap the type icon for the settle circle. Shift asks first. */
function LeadingIcon({
  workItem,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  iconData: IconData;
  rows: RowApi;
}) {
  return (
    <span
      className="relative flex size-4 shrink-0 items-center justify-center"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex group-focus-within:hidden group-hover:hidden">
        <WorkItemIcon icon={resolveWorkItemIcon(workItem, iconData)} />
      </span>
      <TooltipButton
        label="Settle"
        shortcut="item.settle"
        className="hidden size-4 rounded-full border-[1.5px] border-foreground/50 group-focus-within:flex group-hover:flex hover:border-foreground hover:bg-foreground/10"
        onClick={(event) =>
          rows.run(workItem, "settle", { askToSettle: event.shiftKey })
        }
      />
    </span>
  );
}

function StartButton({
  workItem,
  rows,
  variant = "icon",
}: {
  workItem: LocalWorkItem;
  rows: RowApi;
  variant?: "icon" | "round";
}) {
  const disabledReason = rows
    .actionsFor(workItem)
    .find((action) => action.id === "start-entry")?.disabledReason;
  return (
    <TooltipButton
      label={disabledReason ? `Start entry. ${disabledReason}` : "Start entry"}
      aria-label="Start entry"
      aria-description={disabledReason}
      aria-disabled={Boolean(disabledReason)}
      className={cn(
        variant === "round"
          ? "flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-foreground hover:bg-foreground/10"
          : iconButton,
        "aria-disabled:opacity-50",
      )}
      onClick={() => {
        if (!disabledReason) rows.run(workItem, "start-entry");
      }}
    >
      {variant === "round" ? (
        <PlayFillIcon className="size-3" />
      ) : (
        <PlayIcon className="size-3.5" />
      )}
    </TooltipButton>
  );
}

/** Start entry, Snooze and "…". They replace the row's end on hover and focus. */
function RowActions({
  workItem,
  rows,
  showStart = true,
  className,
}: {
  workItem: LocalWorkItem;
  rows: RowApi;
  showStart?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("items-center gap-0.5", className)}
      onClick={(event) => event.stopPropagation()}
    >
      {showStart ? <StartButton workItem={workItem} rows={rows} /> : null}
      <TooltipButton
        label="Snooze…"
        shortcut="item.snooze"
        className={iconButton}
        onClick={() => rows.run(workItem, "snooze")}
      >
        <SnoozeIcon className="size-3.5" />
      </TooltipButton>
      <ObjectActionsButton
        actions={rows.actionsFor(workItem)}
        keys={BACKLOG_ITEM_ACTION_KEYS}
        onAction={(actionId) => rows.run(workItem, actionId)}
        label={`Actions for ${workItem.title}`}
        className="size-6"
      />
    </div>
  );
}

function Markers({
  workItem,
  isRunning,
  isReturned,
}: {
  workItem: LocalWorkItem;
  isRunning: boolean;
  isReturned: boolean;
}) {
  return (
    <>
      {isRunning ? (
        <span
          className="relative flex size-2 shrink-0"
          role="img"
          aria-label="Running entry"
        >
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
        </span>
      ) : null}
      {isReturned ? (
        <TooltipButton
          label="Returned. Click to clear"
          aria-label={`Clear the returned mark on ${workItem.title}`}
          className="flex size-4 shrink-0 items-center justify-center"
          onClick={(event) => {
            event.stopPropagation();
            localStore.markWorkItemOpened(workItem._id);
          }}
        >
          <span className="size-2 rounded-full bg-foreground" />
        </TooltipButton>
      ) : null}
    </>
  );
}

interface ItemRowProps {
  workItem: LocalWorkItem;
  parentTitle?: string;
  density: SidebarDensity;
  isActive: boolean;
  isRunning: boolean;
  isReturned: boolean;
  iconData: IconData;
  rows: RowApi;
}

/** Click, modified click, keys and the context menu, shared by the item rows. */
function useItemRowHandlers({ workItem, rows }: ItemRowProps) {
  const actions = rows.actionsFor(workItem);
  return {
    actions,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!openModifiedSourceClick(event, workItem.sourceUrl))
        rows.open(workItem);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
      handleItemKeyDown(event, {
        actions: [...actions, OPEN_BACKLOG_ITEM_ACTION],
        keys: BACKLOG_ITEM_ROW_KEYS,
        onAction: (actionId, { shortcutId }) =>
          actionId === "open"
            ? rows.open(workItem)
            : rows.run(workItem, actionId, {
                askToSettle: shortcutId === "item.settle-ask",
              }),
      }),
  };
}

/**
 * One line: the type icon, the title, then the markers and, in Comfortable,
 * the remaining estimate. A subitem shows its parent after its title.
 */
function BacklogItemRow(props: ItemRowProps) {
  const { workItem, parentTitle, density, isActive, iconData, rows } = props;
  const { actions, onClick, onKeyDown } = useItemRowHandlers(props);
  const hours =
    density === "comfortable"
      ? formatHours(workItem.remainingEstimateHours)
      : undefined;

  return (
    <ObjectContextMenu
      actions={actions}
      keys={BACKLOG_ITEM_ACTION_KEYS}
      onAction={(actionId) => rows.run(workItem, actionId)}
      render={
        <div
          role="link"
          tabIndex={0}
          data-focus-column="0"
          data-backlog-item-id={workItem._id}
          aria-current={isActive ? "page" : undefined}
          title={parentTitle ? `${workItem.title} · ${parentTitle}` : undefined}
          className={cn(
            "group flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
            density === "compact" ? "h-[26px]" : "h-7",
            isActive && "bg-foreground/[0.07]",
          )}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />
      }
    >
      <LeadingIcon workItem={workItem} iconData={iconData} rows={rows} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          props.isReturned && "font-semibold",
        )}
      >
        {workItem.title}
        {parentTitle ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {parentTitle}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 group-focus-within:hidden group-hover:hidden">
        <Markers
          workItem={workItem}
          isRunning={props.isRunning}
          isReturned={props.isReturned}
        />
        {hours ? (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {hours}
          </span>
        ) : null}
      </span>
      <RowActions
        workItem={workItem}
        rows={rows}
        className="hidden group-focus-within:flex group-hover:flex"
      />
    </ObjectContextMenu>
  );
}

/**
 * The first item, highlighted above the list with its meta line and a Start
 * entry button that is always visible.
 */
function UpNextRow(props: ItemRowProps) {
  const { workItem, parentTitle, isActive, iconData, rows } = props;
  const { actions, onClick, onKeyDown } = useItemRowHandlers(props);

  return (
    <ObjectContextMenu
      actions={actions}
      keys={BACKLOG_ITEM_ACTION_KEYS}
      onAction={(actionId) => rows.run(workItem, actionId)}
      render={
        <div
          role="link"
          tabIndex={0}
          data-focus-column="0"
          data-backlog-item-id={workItem._id}
          aria-current={isActive ? "page" : undefined}
          aria-label={`Up next: ${workItem.title}`}
          className={cn(
            "group flex shrink-0 cursor-pointer items-center gap-2 rounded-md bg-foreground/5 py-1.5 pr-1.5 pl-2 outline-none hover:bg-foreground/[0.08] focus-visible:ring-1 focus-visible:ring-ring",
            isActive && "bg-foreground/10",
          )}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />
      }
    >
      <LeadingIcon workItem={workItem} iconData={iconData} rows={rows} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] leading-snug font-semibold",
          )}
        >
          {workItem.title}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {parentTitle ? `↳ ${parentTitle}` : getMetaLine(workItem)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 group-focus-within:hidden group-hover:hidden">
        <Markers
          workItem={workItem}
          isRunning={props.isRunning}
          isReturned={props.isReturned}
        />
      </span>
      <RowActions
        workItem={workItem}
        rows={rows}
        showStart={false}
        className="hidden group-focus-within:flex group-hover:flex"
      />
      <span onClick={(event) => event.stopPropagation()}>
        <StartButton workItem={workItem} rows={rows} variant="round" />
      </span>
    </ObjectContextMenu>
  );
}

/** A collapsible section label: "Backlog 11", "Snoozed 3", "Settled". */
export function SidebarSectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full shrink-0 items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-[11.5px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ChevronDown
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          !open && "-rotate-90",
        )}
      />
      {label}
      {count !== undefined ? (
        <span className="font-normal tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

function OffListRow({
  workItem,
  detail,
  restoreLabel,
  onRestore,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  detail?: string;
  restoreLabel: string;
  onRestore: () => void;
  iconData: IconData;
  rows: RowApi;
}) {
  return (
    <div
      role="link"
      tabIndex={0}
      data-focus-column="0"
      data-backlog-item-id={workItem._id}
      className="group flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(event) => {
        if (!openModifiedSourceClick(event, workItem.sourceUrl))
          rows.open(workItem);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          rows.open(workItem);
        }
      }}
    >
      <WorkItemIcon
        icon={resolveWorkItemIcon(workItem, iconData)}
        className="opacity-70"
      />
      <span className="min-w-0 flex-1 truncate">{workItem.title}</span>
      {detail ? (
        <span className="shrink-0 text-[11.5px] group-focus-within:hidden group-hover:hidden">
          {detail}
        </span>
      ) : null}
      <span
        className="hidden group-focus-within:flex group-hover:flex"
        onClick={(event) => event.stopPropagation()}
      >
        <TooltipButton
          label={restoreLabel}
          className={iconButton}
          onClick={onRestore}
        >
          <UndoIcon className="size-3.5" />
        </TooltipButton>
      </span>
    </div>
  );
}

/**
 * The work list in the expanded app sidebar, from "Backlog sidebar" in
 * agents/ux-spec.md: the Up next row, the collapsible Backlog section with the
 * active items in the Backlog page's order, `children` (the Pull requests
 * section), then the collapsible Snoozed and Settled sections.
 */
export function SidebarBacklogList({
  pathname,
  children,
}: {
  pathname: string;
  children?: ReactNode;
}) {
  const state = useLocalState();
  const now = useNow();
  const layout = useSidebarLayout();
  const iconData = useWorkItemIconData(state.projects);
  const rows = useBacklogItemRow(state, now);
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE_SIZE);
  const activeItemId = pathname.startsWith("/backlog/")
    ? decodeURIComponent(pathname.slice("/backlog/".length))
    : undefined;
  const runningWorkItemId = state.timers[0]?.workItemId;

  const { listed, snoozed, settled, titleByLookupKey } = useMemo(() => {
    const titles = new Map(
      state.workItems.flatMap((workItem) =>
        getWorkItemLookupKeys(workItem).map(
          (key) => [key, workItem.title] as const,
        ),
      ),
    );
    return {
      listed: selectSidebarBacklogItems(state, now),
      snoozed: state.workItems
        .filter((workItem) => isBacklogItemSnoozed(workItem, now))
        .sort((left, right) => left.snoozedUntil! - right.snoozedUntil!),
      // Subitems settled along with their parent show on the parent's page.
      settled: state.workItems
        .filter(
          (workItem) =>
            workItem.status === "settled" && !workItem.settledWithParentId,
        )
        .sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0)),
      titleByLookupKey: titles,
    };
  }, [state, now]);

  const parentTitleOf = (workItem: LocalWorkItem) => {
    const key = getWorkItemParentKey(workItem);
    return key ? titleByLookupKey.get(key) : undefined;
  };
  const rowProps = (workItem: LocalWorkItem): ItemRowProps => ({
    workItem,
    parentTitle: parentTitleOf(workItem),
    density: layout.density,
    isActive: activeItemId === workItem._id,
    isRunning: runningWorkItemId === workItem._id,
    isReturned: isBacklogItemReturned(workItem, now),
    iconData,
    rows,
  });
  const [upNext, ...rest] = layout.showUpNext ? listed : [undefined, ...listed];

  let settledRows: ReactNode = null;
  if (layout.settledOpen) {
    settledRows = (
      <>
        {settled.slice(0, settledShown).map((workItem) => (
          <OffListRow
            key={workItem._id}
            workItem={workItem}
            detail={
              layout.density === "comfortable"
                ? workItem.sourceStatusLabel
                : undefined
            }
            restoreLabel="Unsettle"
            onRestore={() => rows.run(workItem, "unsettle")}
            iconData={iconData}
            rows={rows}
          />
        ))}
        {settled.length > settledShown ? (
          <button
            type="button"
            className="px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => setSettledShown(settledShown + SETTLED_PAGE_SIZE)}
          >
            Show more
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
      aria-label="Backlog items"
      data-focus-scope
    >
      {upNext ? (
        <>
          <div className="px-2 pt-3 pb-1 text-[11.5px] font-medium text-muted-foreground">
            Up next
          </div>
          <UpNextRow {...rowProps(upNext)} />
        </>
      ) : null}

      <SidebarSectionHeader
        label="Backlog"
        count={rest.length}
        open={layout.backlogOpen}
        onToggle={() =>
          updateSidebarLayout({ backlogOpen: !layout.backlogOpen })
        }
      />
      {layout.backlogOpen ? (
        <>
          {rest.map((workItem) =>
            workItem ? (
              <BacklogItemRow key={workItem._id} {...rowProps(workItem)} />
            ) : null,
          )}
          {listed.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-muted-foreground">
              Nothing on your plate.
            </p>
          ) : null}
        </>
      ) : null}

      {children}

      <SidebarSectionHeader
        label="Snoozed"
        count={snoozed.length}
        open={layout.snoozedOpen}
        onToggle={() =>
          updateSidebarLayout({ snoozedOpen: !layout.snoozedOpen })
        }
      />
      {layout.snoozedOpen
        ? snoozed.map((workItem) => (
            <OffListRow
              key={workItem._id}
              workItem={workItem}
              detail={formatSnoozeTime(workItem.snoozedUntil!, now)}
              restoreLabel="Unsnooze"
              onRestore={() => rows.run(workItem, "unsnooze")}
              iconData={iconData}
              rows={rows}
            />
          ))
        : null}

      <SidebarSectionHeader
        label="Settled"
        open={layout.settledOpen}
        onToggle={() =>
          updateSidebarLayout({ settledOpen: !layout.settledOpen })
        }
      />
      {settledRows}
    </div>
  );
}
