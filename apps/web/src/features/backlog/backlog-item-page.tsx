import { getCompletedEstimateShare } from "@/domain/backlog/work-item-estimates";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  RiCornerDownRightLine,
  RiAddLine as AddIcon,
  RiArchiveLine as ArchiveIcon,
  RiArrowGoBackLine as UnsettleIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiExternalLinkLine as ExternalIcon,
  RiPlayFill as PlayIcon,
  RiStopLine as StopIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import { PageHeader, type PageBreadcrumbItem } from "@/components/page-header";
import {
  PropertyAction,
  PropertyActions,
  PropertyRow,
} from "@/components/property-list";
import { ObjectActionItems } from "@/components/object-actions-menu";
import { SplitButton } from "@/components/split-button";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Figure, FigureRow } from "@/components/ui/value";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import { isBacklogItemSnoozed } from "@/domain/backlog/backlog-item-lifecycle";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import {
  EstimateFigure,
  InlineTitle,
  DescriptionSection,
} from "@/features/backlog/backlog-item-inline-edit";
import { BacklogItemProperties } from "@/features/backlog/backlog-item-properties";
import { ESTIMATE_FIGURES } from "@/features/backlog/backlog-estimates";
import { getBacklogItemBackLink } from "@/features/backlog/backlog-item-search";
import { getWorkItemEntryValues } from "@/features/backlog/work-item-timer-comment";
import { openNewEntryEditor } from "@/features/time/new-entry-request";
import {
  captureReturnNotice,
  getVisitNotice,
  type BacklogItemReturnNotice,
} from "@/features/backlog/backlog-item-notice";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import { pickNextItemId } from "@/domain/backlog/next-item";
import { useActionRequest } from "@/lib/action-request";
import { BACKLOG_ITEM_ACTION_KEYS, handleItemKeyDown } from "@/lib/item-keys";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { getSidebarBacklogItemIds } from "@/lib/sidebar-order";
import { useNow } from "@/lib/use-now";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import {
  BacklogItemComments,
  useCommentSource,
} from "@/features/backlog/backlog-item-comments";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";
import {
  SubitemsCard,
  TimeEntriesCard,
} from "@/features/backlog/backlog-item-side-cards";
import {
  updateBacklogItemCards,
  useBacklogItemCards,
  resolveSubitemsOpen,
} from "@/lib/backlog-item-cards";

/**
 * The backlog item page at /backlog/$itemId, from "Backlog item page" in
 * docs/agents/ux-spec.md. The top bar holds the breadcrumb and the item's
 * actions; the page holds the back link, title, estimate figures and progress,
 * then the description beside the properties card and the folding Subitems
 * and Time entries cards.
 * Every field edits in place, so the page has no editor panel and no "…" menu.
 *
 * The page itself is the focused object, so E settles, B snoozes and Enter
 * renames as soon as it opens.
 */
export function BacklogItemPage({ itemId }: { itemId: string }) {
  const state = useLocalState();
  const navigate = useNavigate();
  // The page the item was opened from, such as a Time day, which the back
  // link and the item links below keep.
  const { from } = useSearch({ from: "/app/backlog/$itemId" });
  const backLink = getBacklogItemBackLink(from);
  const now = useNow();
  const iconData = useWorkItemIconData(state.projects);
  const focusRef = useRef<HTMLDivElement>(null);
  // The item on screen, so a settle or snooze that ends once the user left
  // its page opens nothing.
  const shownItemRef = useRef<string | undefined>(itemId);
  useEffect(() => {
    shownItemRef.current = itemId;
    return () => {
      shownItemRef.current = undefined;
    };
  }, [itemId]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [addingSubitem, setAddingSubitem] = useState(false);
  // The split Start entry button, which New entry… anchors its popover to.
  const splitRef = useRef<HTMLSpanElement>(null);
  const workItem = state.workItems.find((item) => item._id === itemId);
  const commentSource = useCommentSource(workItem);
  const cards = useBacklogItemCards();

  /**
   * Edit and Add subitem have no panel here: they open the inline fields. Add
   * subitem opens the Subitems card while its name field is open.
   */
  function runHosted(action: "edit" | "add-subitem") {
    if (action === "edit") {
      setEditingTitle(true);
    } else {
      setAddingSubitem(true);
    }
  }

  const [returnNotice, setReturnNotice] =
    useState<BacklogItemReturnNotice | null>(null);
  // Opening the item clears its Returned mark; the page keeps saying why it
  // came back until the user leaves.
  useEffect(() => {
    const opened = localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === itemId);
    const captured = opened ? captureReturnNotice(opened, Date.now()) : null;
    // A second run for the same item, as in StrictMode, finds the mark cleared.
    setReturnNotice(
      (previous) => captured ?? (previous?.itemId === itemId ? previous : null),
    );
    localStore.markWorkItemOpened(itemId);
    setEditingTitle(false);
    setAddingSubitem(false);
    focusRef.current?.focus({ preventScroll: true });
  }, [itemId]);

  // The sidebar and the command palette ask for Edit and Add subitem with
  // `?action=`. Only enabled actions of the item run: Edit renames the item,
  // Add subitem opens the Subitems card on its name field.
  useActionRequest(({ action }) => {
    if (action !== "edit" && action !== "add-subitem") return;
    const currentState = localStore.snapshot();
    const current = currentState.workItems.find(
      (candidate) => candidate._id === itemId,
    );
    if (!current) return;
    const isSubitem = isSubtaskWorkItem(current);
    const requested = getBacklogItemActions(current, {
      isRunning: Boolean(findWorkItemTimer(currentState.timers, current._id)),
      isSubitem,
      subitemCount: 0,
      otherSourceStateCount: getOtherSourceStates(current).length,
    }).find((candidate) => candidate.id === action);
    if (requested && !requested.disabledReason) {
      runHosted(action);
    }
  });

  const subitems = useMemo(
    () => (workItem ? getDirectChildWorkItems(workItem, state.workItems) : []),
    [workItem, state.workItems],
  );
  const entries = useMemo(
    () =>
      state.timesheetEntries
        .filter((entry) => entry.workItemId === itemId)
        .sort((left, right) => right.localDate.localeCompare(left.localDate)),
    [state.timesheetEntries, itemId],
  );

  if (!workItem) {
    return (
      <div className="backlog-item-page">
        <PageHeader backLink={backLink} />
        <Empty align="start" className="px-0">
          <EmptyHeader>
            <EmptyTitle>This backlog item no longer exists</EmptyTitle>
            <EmptyDescription>
              <Link to="/backlog">Go to the backlog</Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const item = workItem;
  const isSubitem = isSubtaskWorkItem(item);
  const isSnoozed = isBacklogItemSnoozed(item, now);
  // An archived item is read-only until Restore, like its Edit action.
  const readOnly = item.status === "archived";
  const actions = getBacklogItemActions(item, {
    isRunning: Boolean(findWorkItemTimer(state.timers, item._id)),
    isSubitem,
    isSnoozed,
    subitemCount: isSubitem ? 0 : subitems.length,
    settleOpensDialog: settleOpensDialog(item),
    otherSourceStateCount: getOtherSourceStates(item).length,
  });
  const startAction = actions.find((action) => action.id === "start-entry");
  /** The split Start entry button's menu: what each way of logging time does. */
  const timeActions = actions
    .filter(
      (action) =>
        action.id === "start-entry" ||
        action.id === "stop-entry" ||
        action.id === "new-entry",
    )
    .map((action) => ({
      ...action,
      hint:
        action.id === "new-entry"
          ? "Log time without the clock"
          : action.id === "stop-entry"
            ? "Stop the clock on this item"
            : "Start the clock on this item now",
    }));
  // Listed only for synced items: Archive leaves the source as it is.
  const archiveAction = actions.find((action) => action.id === "archive");
  const parentKey = getWorkItemParentKey(item);
  const parent = parentKey
    ? state.workItems.find((candidate) =>
        getWorkItemLookupKeys(candidate).includes(parentKey),
      )
    : undefined;
  const project = state.projects.find((entry) => entry._id === item.projectId);
  // The item's project, or Backlog without one, whichever page it was opened
  // from: the back link already returns there.
  const breadcrumb: PageBreadcrumbItem[] = [
    project
      ? {
          label: getLocalProjectDisplayName(project),
          icon: (
            <ProjectIcon
              icon={project.icon}
              color={project.color}
              className="ajour-sidebar-icon shrink-0"
            />
          ),
          to: "/projects/$projectId",
          params: { projectId: project._id },
        }
      : { label: "Backlog", to: "/backlog" },
    { label: item.title },
  ];
  const reference =
    item.source === "azure_devops"
      ? parseWorkItemReference(item.sourceId)
      : item.sourceId;
  const loggedMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const progress = getCompletedEstimateShare(item);
  const notice = getVisitNotice(item, now, returnNotice);

  /**
   * Captures the sidebar's list as a settle or snooze of this item starts,
   * and returns what opens the next row once it is made (#488): the row after
   * it, else the one before it, else the Backlog page. Undo stays where the
   * user is.
   */
  function prepareOpenNext() {
    const currentId = item._id;
    const before = getSidebarBacklogItemIds(localStore.snapshot(), Date.now());
    return () => {
      if (shownItemRef.current !== currentId) return;
      const next = pickNextItemId(
        before,
        getSidebarBacklogItemIds(localStore.snapshot(), Date.now()),
        currentId,
      );
      if (next) {
        void navigate({
          to: "/backlog/$itemId",
          params: { itemId: next },
          search: from ? { from } : {},
        });
      } else {
        void navigate({ to: "/backlog" });
      }
    };
  }

  function runAction(
    actionId: BacklogItemActionId,
    options?: { askToSettle?: boolean },
  ) {
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action || action.disabledReason) return;

    if (actionId === "delete") {
      void navigate({ to: backLink.to, search: backLink.search as never });
    }
    runBacklogItemAction(
      localStore
        .snapshot()
        .workItems.find((current) => current._id === item._id) ?? item,
      actionId,
      runHosted,
      {
        ...options,
        onSettledOrSnoozed:
          actionId === "settle" || actionId === "snooze"
            ? prepareOpenNext()
            : undefined,
      },
    );
  }

  /** New entry on this item, in the titlebar's popover anchored to `button`. */
  function openNewEntry(button: HTMLElement) {
    openNewEntryEditor(
      { kind: "backlog-item", workItemId: item._id },
      getWorkItemEntryValues(item),
      button,
    );
  }

  const headerButtons =
    item.status === "archived" ? (
      <Button variant="outline" onClick={() => runAction("restore")}>
        Restore
      </Button>
    ) : item.status === "settled" ? (
      <Button variant="outline" onClick={() => runAction("unsettle")}>
        <UnsettleIcon data-icon="inline-start" /> Unsettle
      </Button>
    ) : isSnoozed ? (
      <Button variant="outline" onClick={() => runAction("unsnooze")}>
        Unsnooze
      </Button>
    ) : (
      <>
        {/* Start entry (Stop while the item's entry runs) is split: its arrow
            offers New entry…, which logs time without the clock (#513). */}
        <SplitButton
          ref={splitRef}
          variant={startAction ? "default" : "outline"}
          onClick={() => runAction(startAction ? "start-entry" : "stop-entry")}
          disabled={Boolean(startAction?.disabledReason)}
          title={startAction?.disabledReason}
          menuLabel="Other ways to log time"
          menuClassName="min-w-64"
          menu={
            <ObjectActionItems
              surface="button"
              actions={timeActions}
              keys={BACKLOG_ITEM_ACTION_KEYS}
              onAction={(actionId) => {
                if (actionId === "new-entry" && splitRef.current) {
                  openNewEntry(splitRef.current);
                } else {
                  runAction(actionId);
                }
              }}
            />
          }
        >
          {startAction ? (
            <>
              <PlayIcon data-icon="inline-start" /> Start entry
            </>
          ) : (
            <>
              <StopIcon data-icon="inline-start" /> Stop
            </>
          )}
        </SplitButton>
        <Button variant="ghost" onClick={() => runAction("snooze")}>
          <SnoozeIcon data-icon="inline-start" /> Snooze
        </Button>
        <Button
          variant="ghost"
          onClick={(event) =>
            runAction("settle", { askToSettle: event.shiftKey })
          }
        >
          <SettleIcon data-icon="inline-start" /> Settle
        </Button>
      </>
    );

  return (
    <div className="backlog-page-stack">
      <div className="backlog-page-main overflow-y-auto">
        <div
          ref={focusRef}
          tabIndex={-1}
          data-focus-column="0"
          data-backlog-item-id={item._id}
          className="backlog-item-page"
          aria-label={item.title}
          onKeyDown={(event) =>
            handleItemKeyDown(event, {
              actions,
              keys: BACKLOG_ITEM_ACTION_KEYS,
              onAction: (actionId, { shortcutId }) =>
                runAction(actionId, {
                  askToSettle: shortcutId === "item.settle-ask",
                }),
            })
          }
        >
          <PageHeader breadcrumb={breadcrumb} backLink={backLink} />

          <header className="backlog-item-page-header">
            <WorkItemIcon
              icon={resolveWorkItemIcon(item, iconData)}
              className="mt-1.5"
            />
            <div className="min-w-0 flex-1">
              <InlineTitle
                item={item}
                editing={editingTitle}
                readOnly={readOnly}
                onEditingChange={setEditingTitle}
              />
              <div className="backlog-item-page-meta">
                {/* Plain text: the breadcrumb and the properties already name
                    the project, and a chip here only tagged (council round 9). */}
                {item.sourceWorkItemType ? (
                  <>
                    <span>{item.sourceWorkItemType}</span>
                    <span aria-hidden className="text-[var(--text-tertiary)]">
                      ·
                    </span>
                  </>
                ) : null}
                {reference ? (
                  item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1"
                    >
                      {item.sourceStatusLabel
                        ? `${item.sourceStatusLabel} in ${item.sourceProjectName ?? item.sourceConnectionLabel ?? "the source"}`
                        : "Open in source"}
                      <ExternalIcon className="size-3" />
                    </a>
                  ) : (
                    <span>
                      {[item.sourceProjectName, item.sourceStatusLabel]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )
                ) : (
                  <span>Manual item</span>
                )}
                {parent ? (
                  <Link
                    to="/backlog/$itemId"
                    params={{ itemId: parent._id }}
                    search={{ from }}
                    className="truncate"
                  >
                    <RiCornerDownRightLine
                      aria-hidden
                      className="mr-0.5 inline size-3 align-[-2px]"
                    />
                    {parent.title}
                  </Link>
                ) : null}
              </div>
            </div>
            {/* The item's actions sit beside its title, the content they act
                on, as on every page that edits in place (council round 3). */}
            <div
              role="group"
              aria-label="Item actions"
              className="backlog-item-page-actions"
            >
              {headerButtons}
              {!readOnly && (item.status === "settled" || isSnoozed) ? (
                <Button
                  variant="ghost"
                  onClick={(event) => openNewEntry(event.currentTarget)}
                >
                  <AddIcon data-icon="inline-start" /> New entry
                </Button>
              ) : null}
            </div>
          </header>

          {notice ? (
            <p className="text-xs text-muted-foreground">{notice}</p>
          ) : null}

          <div className="backlog-item-page-columns">
            {/* The key resets the description editor and the comment drafts
                when another item opens. It sits on the column, not on each
                child: siblings sharing a key leave the old item's description
                on the page. */}
            <div key={item._id} className="flex min-w-0 flex-col gap-6">
              {/* The figures open the main column, so the side cards start
                  level with them (council round 7). */}
              {/* The estimates and their bar form one group; logged time, a
                  clock and not part of the bar, sits beside it behind a
                  hairline (council rounds 11 and 12). */}
              <FigureRow className="items-end">
                <div className="flex w-fit max-w-full flex-col gap-2.5">
                  {/* Remaining leads, first and the page's one 28px
                      number: it is what the dock shows as "43m left"
                      (council rounds 14 and 23). */}
                  {/* Values share a baseline, as on the project page. */}
                  <FigureRow className="items-end">
                    {ESTIMATE_FIGURES.map((figure) => (
                      <EstimateFigure
                        key={figure.key}
                        item={item}
                        field={figure.key}
                        label={figure.label}
                        size={
                          figure.key === "remainingEstimateHours"
                            ? "figure"
                            : undefined
                        }
                        conflict={Boolean(
                          item.estimateSync?.[figure.key]?.conflict,
                        )}
                        readOnly={readOnly}
                      />
                    ))}
                  </FigureRow>
                  <div
                    className="backlog-item-progress"
                    role="progressbar"
                    aria-label="Completed of the original estimate"
                    aria-valuenow={Math.round(progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                {/* Lifted by the estimates' bar and its gap, so its value
                    shares their baseline. */}
                <Figure
                  label="Logged in Ajour"
                  className="backlog-item-logged mb-[13px] border-l border-border pl-8"
                >
                  {formatClockDuration(loggedMs)}
                </Figure>
              </FigureRow>
              <div className="flex min-w-0 flex-col">
                <DescriptionSection item={item} readOnly={readOnly} />
                {commentSource ? (
                  <BacklogItemComments
                    itemId={item._id}
                    source={commentSource}
                    prepareOpenNext={prepareOpenNext}
                  />
                ) : null}
              </div>
            </div>
            <div className="backlog-item-side-cards">
              <section
                className="backlog-item-card backlog-item-properties-card"
                aria-label="Properties"
              >
                {/* A synced item's source rows and its refresh are the
                    properties' source section (#653). */}
                <BacklogItemProperties item={item} state={state} />
                {archiveAction && !archiveAction.disabledReason ? (
                  <PropertyActions>
                    <PropertyAction onClick={() => runAction("archive")}>
                      <ArchiveIcon aria-hidden="true" />
                      {archiveAction.label}
                    </PropertyAction>
                  </PropertyActions>
                ) : null}
              </section>
              {!isSubitem ? (
                <SubitemsCard
                  parent={item}
                  subitems={subitems}
                  workflowStates={state.workflowStates}
                  iconData={iconData}
                  from={from}
                  open={resolveSubitemsOpen(
                    cards.subitemsOpen,
                    subitems.length,
                  )}
                  onOpenChange={(subitemsOpen) =>
                    updateBacklogItemCards({ subitemsOpen })
                  }
                  readOnly={readOnly}
                  adding={addingSubitem}
                  onAdd={() => runHosted("add-subitem")}
                  onAddingClose={(escaped) => {
                    setAddingSubitem(false);
                    // Escape gives the keys back to the page, as on the title.
                    if (escaped)
                      focusRef.current?.focus({ preventScroll: true });
                  }}
                />
              ) : null}
              <TimeEntriesCard
                entries={entries}
                loggedMs={loggedMs}
                open={cards.timeEntriesOpen}
                onOpenChange={(timeEntriesOpen) =>
                  updateBacklogItemCards({ timeEntriesOpen })
                }
                onAdd={readOnly ? undefined : openNewEntry}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
