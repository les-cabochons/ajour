import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  RiAddLine as AddIcon,
  RiArchiveLine as ArchiveIcon,
  RiArrowGoBackLine as UnsettleIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiExternalLinkLine as ExternalIcon,
  RiPlayLine as PlayIcon,
  RiStopLine as StopIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import { PageHeader, type PageBreadcrumbItem } from "@/components/page-header";
import {
  PropertyAction,
  PropertyActions,
  PropertyRow,
} from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Figure, FigureRow, Value } from "@/components/ui/value";
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
  AddSubitemRow,
  EstimateFigure,
  InlineTitle,
  DescriptionSection,
} from "@/features/backlog/backlog-item-inline-edit";
import { BacklogItemProperties } from "@/features/backlog/backlog-item-properties";
import {
  ESTIMATE_FIGURES,
  formatHours,
} from "@/features/backlog/backlog-estimates";
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
import { useActionRequest } from "@/lib/action-request";
import { BACKLOG_ITEM_ACTION_KEYS, handleItemKeyDown } from "@/lib/item-keys";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import {
  BacklogItemComments,
  useCommentSource,
} from "@/features/backlog/backlog-item-comments";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

/**
 * The backlog item page at /backlog/$itemId, from "Backlog item page" in
 * docs/agents/ux-spec.md. The top bar holds the breadcrumb and the item's
 * actions; the page holds the back link, title, estimate figures and progress,
 * then the description, subitems and time entries beside the properties card.
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [addingSubitem, setAddingSubitem] = useState(false);
  const workItem = state.workItems.find((item) => item._id === itemId);
  const commentSource = useCommentSource(workItem);

  /** Edit and Add subitem have no panel here: they open the inline fields. */
  function runHosted(action: "edit" | "add-subitem") {
    if (action === "edit") setEditingTitle(true);
    else setAddingSubitem(true);
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
  // Add subitem opens the name field under its subitems.
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
  const progress =
    item.originalEstimateHours && item.completedEstimateHours !== undefined
      ? Math.min(1, item.completedEstimateHours / item.originalEstimateHours)
      : 0;
  const notice = getVisitNotice(item, now, returnNotice);

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
      options,
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
        {startAction ? (
          <Button
            variant="outline"
            onClick={() => runAction("start-entry")}
            disabled={Boolean(startAction.disabledReason)}
            title={startAction.disabledReason}
          >
            <PlayIcon data-icon="inline-start" /> Start entry
          </Button>
        ) : (
          // Stop takes Start entry's slot while the item's entry runs.
          <Button variant="outline" onClick={() => runAction("stop-entry")}>
            <StopIcon data-icon="inline-start" /> Stop
          </Button>
        )}
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
          <PageHeader
            breadcrumb={breadcrumb}
            backLink={backLink}
            actions={
              <>
                {headerButtons}
                {!readOnly ? (
                  <Button
                    variant="ghost"
                    onClick={(event) => openNewEntry(event.currentTarget)}
                  >
                    <AddIcon data-icon="inline-start" /> New entry
                  </Button>
                ) : null}
              </>
            }
          />

          <header className="flex min-w-0 items-start gap-3">
            <WorkItemIcon
              icon={resolveWorkItemIcon(item, iconData)}
              className="mt-1.5"
            />
            <div className="min-w-0 flex-1">
              <InlineTitle
                item={item}
                editing={editingTitle}
                readOnly={readOnly}
                onEditingChange={(editing) => {
                  setEditingTitle(editing);
                  // Enter and Escape give the keys back to the page.
                  if (!editing)
                    focusRef.current?.focus({ preventScroll: true });
                }}
              />
              <div className="backlog-item-page-meta">
                {item.sourceWorkItemType ? (
                  <Chip>{item.sourceWorkItemType}</Chip>
                ) : null}
                {project ? (
                  <Chip color={project.color}>
                    {getLocalProjectDisplayName(project)}
                  </Chip>
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
                    ↳ {parent.title}
                  </Link>
                ) : null}
              </div>
            </div>
          </header>

          {notice ? (
            <p className="text-xs text-muted-foreground">{notice}</p>
          ) : null}

          <div className="flex flex-col gap-2.5">
            <FigureRow>
              {ESTIMATE_FIGURES.map((figure) => (
                <EstimateFigure
                  key={figure.key}
                  item={item}
                  field={figure.key}
                  label={figure.label}
                  conflict={Boolean(item.estimateSync?.[figure.key]?.conflict)}
                  readOnly={readOnly}
                />
              ))}
              <Figure label="Logged in Ajour">
                {formatClockDuration(loggedMs)}
              </Figure>
            </FigureRow>
            <div
              className="backlog-item-progress"
              role="progressbar"
              aria-label="Completed over original estimate"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          </div>

          <div className="backlog-item-page-columns">
            {/* The key resets the description editor and the comment drafts
                when another item opens. It sits on the column, not on each
                child: siblings sharing a key leave the old item's description
                on the page. */}
            <div key={item._id} className="flex min-w-0 flex-col">
              <DescriptionSection item={item} readOnly={readOnly} />
              {commentSource ? (
                <BacklogItemComments itemId={item._id} source={commentSource} />
              ) : null}
            </div>
            <div className="backlog-item-properties-card">
              <section
                className="backlog-item-card-properties"
                aria-label="Properties"
              >
                <BacklogItemProperties item={item} state={state}>
                  <PropertyRow label="Source">
                    {item.source === "manual"
                      ? "Ajour"
                      : (item.sourceProjectName ??
                        item.sourceConnectionLabel ??
                        "–")}
                  </PropertyRow>
                </BacklogItemProperties>
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
                <section
                  className="backlog-item-card-section"
                  aria-label="Subitems"
                >
                  <SectionHeading
                    trailing={
                      subitems.length
                        ? `${subitems.filter((subitem) => subitem.status === "archived").length} of ${subitems.length} done`
                        : undefined
                    }
                  >
                    Subitems
                  </SectionHeading>
                  {subitems.length === 0 && !addingSubitem ? (
                    <p className="text-sm text-muted-foreground">
                      No subitems.
                    </p>
                  ) : (
                    <div className="backlog-item-rows">
                      {subitems.map((subitem) => (
                        <Link
                          key={subitem._id}
                          to="/backlog/$itemId"
                          params={{ itemId: subitem._id }}
                          search={{ from }}
                          className="backlog-item-row"
                        >
                          <WorkItemIcon
                            icon={resolveWorkItemIcon(subitem, iconData)}
                          />
                          <span
                            className={cn(
                              "backlog-item-row-title",
                              subitem.status === "archived" &&
                                "text-muted-foreground",
                            )}
                          >
                            {subitem.title}
                          </span>
                          {subitem.priority !== undefined ? (
                            <PriorityIcon priority={subitem.priority} />
                          ) : null}
                          <Value tone="muted" className="w-10 text-right">
                            {formatHours(subitem.remainingEstimateHours)}
                          </Value>
                        </Link>
                      ))}
                    </div>
                  )}
                  {!readOnly ? (
                    <AddSubitemRow
                      parent={item}
                      adding={addingSubitem}
                      onAddingChange={setAddingSubitem}
                    />
                  ) : null}
                </section>
              ) : null}
              <section
                className="backlog-item-card-section"
                aria-label="Time entries"
              >
                <SectionHeading
                  trailing={
                    entries.length ? (
                      <Value>{formatClockDuration(loggedMs)}</Value>
                    ) : undefined
                  }
                >
                  Time entries
                </SectionHeading>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No time logged yet.
                  </p>
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
                          {new Date(
                            `${entry.localDate}T12:00:00`,
                          ).toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="backlog-item-row-title">
                          {entry.note ?? (
                            <span className="text-muted-foreground">
                              No note
                            </span>
                          )}
                        </span>
                        <Value>{formatClockDuration(entry.durationMs)}</Value>
                      </Link>
                    ))}
                  </div>
                )}
                {!readOnly ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 w-fit text-muted-foreground"
                    onClick={(event) => openNewEntry(event.currentTarget)}
                  >
                    <AddIcon data-icon="inline-start" />
                    Add time entry
                  </Button>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
