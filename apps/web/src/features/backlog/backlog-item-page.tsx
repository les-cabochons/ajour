import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  RiArrowGoBackLine as UnsettleIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiExternalLinkLine as ExternalIcon,
  RiPlayLine as PlayIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import { Markdown } from "@/components/markdown";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { PageHeader } from "@/components/page-header";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import {
  getLocalProjectDisplayName,
  type LocalWorkItem,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import {
  runBacklogItemAction,
  type HostedBacklogItemActionId,
} from "@/features/backlog/backlog-item-actions";
import {
  BacklogItemEditorForm,
  type BacklogItemEditorFormHandle,
} from "@/features/backlog/backlog-item-editor-form";
import type { BacklogTaskEditorTarget } from "@/features/backlog/backlog-task-editor";
import {
  ESTIMATE_FIGURES,
  formatHours,
} from "@/features/backlog/backlog-estimates";
import { getBacklogItemNotice } from "@/features/backlog/backlog-item-notice";
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
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { getPriorityLevelName } from "@/domain/backlog/priority";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

/**
 * The backlog item page at /backlog/$itemId, from "Backlog item page" in
 * agents/ux-spec.md. The top bar holds the item's actions;
 * the page holds the back link, title, estimate figures and progress, then the note,
 * subitems and time entries beside the properties. Edit opens the backlog
 * item editor in a side panel over the page.
 *
 * The page itself is the focused object, so E settles, B snoozes and Enter
 * edits as soon as it opens.
 */
export function BacklogItemPage({ itemId }: { itemId: string }) {
  const state = useLocalState();
  const navigate = useNavigate();
  const now = useNow();
  const isNarrowLayout = useIsNarrowView();
  const iconData = useWorkItemIconData(state.projects);
  const focusRef = useRef<HTMLDivElement>(null);
  const editorFormRef = useRef<BacklogItemEditorFormHandle>(null);
  const [editor, setEditor] = useState<"edit" | "add-subitem" | null>(null);
  const workItem = state.workItems.find((item) => item._id === itemId);

  // Opening the item clears its Returned mark.
  useEffect(() => {
    localStore.markWorkItemOpened(itemId);
    setEditor(null);
    focusRef.current?.focus({ preventScroll: true });
  }, [itemId]);

  // The sidebar and the command palette ask for Edit and Add subitem with
  // `?action=`. Only enabled actions of the item run.
  useActionRequest(({ action }) => {
    if (action !== "edit" && action !== "add-subitem") return;
    const currentState = localStore.snapshot();
    const current = currentState.workItems.find(
      (candidate) => candidate._id === itemId,
    );
    if (!current) return;
    const isSubitem = isSubtaskWorkItem(current);
    const requested = getBacklogItemActions(current, {
      isRunning: currentState.timers.some(
        (timer) => timer.workItemId === current._id,
      ),
      isSubitem,
      subitemCount: 0,
      otherSourceStateCount: getOtherSourceStates(current).length,
    }).find((candidate) => candidate.id === action);
    if (requested && !requested.disabledReason) {
      setEditor(action);
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
        <PageHeader backLink={{ label: "Backlog", to: "/backlog" }} />
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
  const actions = getBacklogItemActions(item, {
    isRunning: state.timers.some((timer) => timer.workItemId === item._id),
    isSubitem,
    isSnoozed,
    subitemCount: isSubitem ? 0 : subitems.length,
    settleOpensDialog: settleOpensDialog(item),
    otherSourceStateCount: getOtherSourceStates(item).length,
  });
  const startAction = actions.find((action) => action.id === "start-entry");
  const parentKey = getWorkItemParentKey(item);
  const parent = parentKey
    ? state.workItems.find((candidate) =>
        getWorkItemLookupKeys(candidate).includes(parentKey),
      )
    : undefined;
  const project = state.projects.find((entry) => entry._id === item.projectId);
  const task = project?.tasks.find((entry) => entry._id === item.taskId);
  const workflowState = state.workflowStates.find(
    (status) => status._id === item.workflowStateId,
  );
  const reference =
    item.source === "azure_devops"
      ? parseWorkItemReference(item.sourceId)
      : item.sourceId;
  const loggedMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const progress =
    item.originalEstimateHours && item.completedEstimateHours !== undefined
      ? Math.min(1, item.completedEstimateHours / item.originalEstimateHours)
      : 0;
  const notice = getBacklogItemNotice(item, now);

  function runAction(
    actionId: BacklogItemActionId,
    options?: { askToSettle?: boolean },
  ) {
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action || action.disabledReason) return;

    if (actionId === "delete") {
      void navigate({ to: "/backlog" });
    }
    runBacklogItemAction(
      localStore
        .snapshot()
        .workItems.find((current) => current._id === item._id) ?? item,
      actionId,
      (hosted: HostedBacklogItemActionId) => setEditor(hosted),
      options,
    );
  }

  const editorTarget: BacklogTaskEditorTarget | null =
    editor === "edit"
      ? { kind: "edit", workItem: item }
      : editor === "add-subitem"
        ? { kind: "create", parent: item }
        : null;
  const renderEditor = (titleAs?: typeof DialogTitle) =>
    editorTarget ? (
      <BacklogItemEditorForm
        key={`${editor}-${item._id}`}
        ref={editorFormRef}
        target={editorTarget}
        titleAs={titleAs}
        onClose={() => setEditor(null)}
        onAction={(_saved, actionId) => runAction(actionId)}
      />
    ) : null;

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
        <Button
          variant="outline"
          onClick={() => runAction("start-entry")}
          disabled={Boolean(startAction?.disabledReason)}
          title={startAction?.disabledReason}
        >
          <PlayIcon data-icon="inline-start" /> Start entry
        </Button>
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
    <div
      className={cn(
        "backlog-page-stack",
        editorTarget && !isNarrowLayout && "has-side-panel",
      )}
    >
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
            backLink={{ label: "Backlog", to: "/backlog" }}
            actions={
              <>
                {headerButtons}
                <ObjectActionsButton
                  actions={actions}
                  keys={BACKLOG_ITEM_ACTION_KEYS}
                  onAction={runAction}
                  label={`Actions for ${item.title}`}
                />
              </>
            }
          />

          <header className="flex min-w-0 items-start gap-3">
            <WorkItemIcon
              icon={resolveWorkItemIcon(item, iconData)}
              className="mt-1.5"
            />
            <div className="min-w-0">
              <h1 className="backlog-item-page-title">{item.title}</h1>
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
              {ESTIMATE_FIGURES.map((figure) => {
                const fieldState = item.estimateSync?.[figure.key];
                return (
                  <Figure key={figure.key} label={figure.label}>
                    {formatHours(item[figure.key])}
                    {fieldState?.conflict ? (
                      <span className="ml-1.5 font-sans text-xs font-normal text-destructive">
                        Conflict
                      </span>
                    ) : null}
                  </Figure>
                );
              })}
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
            <div className="flex min-w-0 flex-col">
              <SectionHeading>Note</SectionHeading>
              {item.note ? (
                <Markdown>{item.note}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">No note.</p>
              )}
              {!isSubitem ? (
                <>
                  <SectionHeading
                    trailing={
                      subitems.length
                        ? `${subitems.filter((subitem) => subitem.status === "archived").length} of ${subitems.length} done`
                        : undefined
                    }
                  >
                    Subitems
                  </SectionHeading>
                  {subitems.length === 0 ? (
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
                          {subitem.sourceStatusLabel ? (
                            <span className="text-xs text-muted-foreground">
                              {subitem.sourceStatusLabel}
                            </span>
                          ) : null}
                          <Value tone="muted" className="w-10 text-right">
                            {formatHours(subitem.remainingEstimateHours)}
                          </Value>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
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
                      <span className="w-24 shrink-0 text-muted-foreground">
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
                          <span className="text-muted-foreground">No note</span>
                        )}
                      </span>
                      <Value>{formatClockDuration(entry.durationMs)}</Value>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <SectionHeading>Properties</SectionHeading>
              <PropertyList>
                <PropertyRow label="State">
                  {workflowState ? (
                    <>
                      <span
                        className="backlog-state-dot"
                        style={{ color: workflowState.color }}
                      />
                      {workflowState.name}
                    </>
                  ) : (
                    "–"
                  )}
                </PropertyRow>
                <PropertyRow label="Source state">
                  {item.sourceStatusLabel ?? "–"}
                </PropertyRow>
                <PropertyRow label="Priority">
                  <PriorityIcon priority={item.priority} decorative />
                  {getPriorityLevelName(item.priority)}
                </PropertyRow>
                <PropertyRow label="Lifecycle">
                  <span className="capitalize">{item.status}</span>
                </PropertyRow>
                <PropertyRow label="Project">
                  {project ? (
                    <Chip color={project.color}>
                      {getLocalProjectDisplayName(project)}
                    </Chip>
                  ) : (
                    "–"
                  )}
                </PropertyRow>
                <PropertyRow label="Task">{task?.name ?? "–"}</PropertyRow>
                <PropertyRow label="Source">
                  {item.source === "manual"
                    ? "Ajour"
                    : (item.sourceProjectName ??
                      item.sourceConnectionLabel ??
                      "–")}
                </PropertyRow>
              </PropertyList>
            </div>
          </div>
        </div>
      </div>

      {editorTarget && !isNarrowLayout ? (
        <SidePanel
          contentKey={`${editor}-${item._id}`}
          widthKey="backlog-item"
          className="backlog-side-panel"
          aria-label="Backlog item editor"
        >
          {renderEditor()}
        </SidePanel>
      ) : null}
      {editorTarget && isNarrowLayout ? (
        <Dialog
          open
          disablePointerDismissal
          onOpenChange={(open) => !open && setEditor(null)}
        >
          <DialogContent className="max-w-xl" showCloseButton={false}>
            {renderEditor(DialogTitle)}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
