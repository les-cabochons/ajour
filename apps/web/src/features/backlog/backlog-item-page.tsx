import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  RiArrowGoBackLine as UnsettleIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiExternalLinkLine as ExternalIcon,
  RiPlayLine as PlayIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import {
  isBacklogItemReturned,
  isBacklogItemSnoozed,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  type LocalWorkItem,
  type LocalWorkItemEstimateFieldKey,
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
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";
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

const ESTIMATE_TILES: { key: LocalWorkItemEstimateFieldKey; label: string }[] =
  [
    { key: "originalEstimateHours", label: "Original" },
    { key: "remainingEstimateHours", label: "Remaining" },
    { key: "completedEstimateHours", label: "Completed" },
  ];

function formatHours(hours?: number) {
  if (hours === undefined) return "–";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-baseline gap-2 py-1.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline text-[12px] font-medium text-muted-foreground">
        {title}
        {aside ? <span className="ml-auto tabular-nums">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** The notice under the header when the item is off the list or came back. */
function stateNotice(workItem: LocalWorkItem, now: number) {
  if (isBacklogItemSnoozed(workItem, now)) {
    return `Snoozed until ${formatSnoozeTime(workItem.snoozedUntil!, now)}`;
  }
  if (workItem.status === "settled") {
    const settled = workItem.settledAt
      ? `Settled ${formatSnoozeTime(workItem.settledAt, now).replace(
          /^(Today|Tomorrow)/,
          (word) => word.toLowerCase(),
        )}`
      : "Settled";
    return workItem.sourceStatusLabel
      ? `${settled} · waiting in "${workItem.sourceStatusLabel}"`
      : settled;
  }
  if (workItem.status === "archived") {
    return "Archived";
  }
  if (isBacklogItemReturned(workItem, now)) {
    return workItem.returnedAt
      ? "Changed in the source since you settled it"
      : "Back from snooze";
  }
  return null;
}

/**
 * The backlog item page at /backlog/$itemId, from "Backlog item page" in
 * agents/ux-spec.md: a header with the item's actions, the estimate tiles and
 * progress bar, then the note, subitems and time entries next to a properties
 * panel. Edit opens the backlog item editor in a side panel over the page.
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
    const current = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === itemId);
    if (!current) return;
    const isSubitem = isSubtaskWorkItem(current);
    const requested = getBacklogItemActions(current, {
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
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>This backlog item no longer exists</EmptyTitle>
          <EmptyDescription>
            <Link to="/backlog">Go to the backlog</Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const item = workItem;
  const isSubitem = isSubtaskWorkItem(item);
  const isSnoozed = isBacklogItemSnoozed(item, now);
  const actions = getBacklogItemActions(item, {
    isSubitem,
    isSnoozed,
    subitemCount: isSubitem ? 0 : subitems.length,
    settleOpensDialog: settleOpensDialog(item),
    otherSourceStateCount: getOtherSourceStates(item).length,
  });
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
  const notice = stateNotice(item, now);

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
      item,
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
      <Button size="sm" variant="outline" onClick={() => runAction("restore")}>
        Restore
      </Button>
    ) : item.status === "settled" ? (
      <Button size="sm" variant="outline" onClick={() => runAction("unsettle")}>
        <UnsettleIcon /> Unsettle
      </Button>
    ) : isSnoozed ? (
      <Button size="sm" variant="outline" onClick={() => runAction("unsnooze")}>
        Unsnooze
      </Button>
    ) : (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAction("start-entry")}
        >
          <PlayIcon /> Start entry
        </Button>
        <Button size="sm" variant="ghost" onClick={() => runAction("snooze")}>
          <SnoozeIcon /> Snooze
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) =>
            runAction("settle", { askToSettle: event.shiftKey })
          }
        >
          <SettleIcon /> Settle
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
          className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6 outline-none"
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
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <WorkItemIcon icon={resolveWorkItemIcon(item, iconData)} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">{item.title}</h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                  {reference ? (
                    item.sourceUrl ? (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        #{reference} <ExternalIcon className="size-3" />
                      </a>
                    ) : (
                      <span>#{reference}</span>
                    )
                  ) : (
                    <span>Manual item</span>
                  )}
                  {item.sourceProjectName ? (
                    <span>· {item.sourceProjectName}</span>
                  ) : null}
                  {item.sourceStatusLabel ? (
                    <span>· {item.sourceStatusLabel}</span>
                  ) : null}
                  {parent ? (
                    <Link
                      to="/backlog/$itemId"
                      params={{ itemId: parent._id }}
                      className="truncate hover:text-foreground"
                    >
                      · in {parent.title}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerButtons}
              <ObjectActionsButton
                actions={actions}
                keys={BACKLOG_ITEM_ACTION_KEYS}
                onAction={runAction}
                label={`Actions for ${item.title}`}
              />
            </div>
          </header>

          {notice ? (
            <div className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              {notice}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ESTIMATE_TILES.map((tile) => {
              const fieldState = item.estimateSync?.[tile.key];
              return (
                <div key={tile.key} className="rounded-lg border p-3">
                  <div className="text-[11px] text-muted-foreground">
                    {tile.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums">
                    {formatHours(item[tile.key])}
                    {fieldState?.conflict ? (
                      <span className="text-[11px] font-normal text-[var(--danger)]">
                        Conflict
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div className="rounded-lg border p-3">
              <div className="text-[11px] text-muted-foreground">
                Logged in Ajour
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatClockDuration(loggedMs)}
              </div>
            </div>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Completed over original estimate"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-[var(--success)]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className="grid gap-8 md:grid-cols-[1fr_16rem]">
            <div className="flex min-w-0 flex-col gap-6">
              <Section title="Note">
                <p className="text-[14px] leading-relaxed whitespace-pre-line">
                  {item.note ?? (
                    <span className="text-muted-foreground">No note.</span>
                  )}
                </p>
              </Section>
              {!isSubitem ? (
                <Section title="Subitems">
                  {subitems.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">
                      No subitems.
                    </p>
                  ) : (
                    <div className="flex flex-col divide-y rounded-md border">
                      {subitems.map((subitem) => (
                        <Link
                          key={subitem._id}
                          to="/backlog/$itemId"
                          params={{ itemId: subitem._id }}
                          className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-muted/60"
                        >
                          <WorkItemIcon
                            icon={resolveWorkItemIcon(subitem, iconData)}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {subitem.title}
                          </span>
                          {subitem.priority !== undefined ? (
                            <PriorityIcon priority={subitem.priority} />
                          ) : null}
                          {subitem.sourceStatusLabel ? (
                            <span className="text-[11px] text-muted-foreground">
                              {subitem.sourceStatusLabel}
                            </span>
                          ) : null}
                          <span className="w-12 text-right text-[12px] text-muted-foreground tabular-nums">
                            {formatHours(subitem.remainingEstimateHours)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </Section>
              ) : null}
              <Section
                title="Time entries"
                aside={entries.length ? formatClockDuration(loggedMs) : null}
              >
                {entries.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No time logged yet.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y rounded-md border">
                    {entries.map((entry) => (
                      <Link
                        key={entry._id}
                        to="/time/$date"
                        params={{ date: entry.localDate }}
                        className="flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted/60"
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
                        <span className="min-w-0 flex-1 truncate">
                          {entry.note ?? (
                            <span className="text-muted-foreground">
                              No note
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {formatClockDuration(entry.durationMs)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </Section>
            </div>
            <dl className="flex flex-col divide-y self-start rounded-lg border px-3 py-1">
              <div className="py-1">
                <Property label="State">
                  {item.sourceStatusLabel ?? "–"}
                </Property>
                <Property label="Workflow state">
                  {workflowState?.name ?? "–"}
                </Property>
                <Property label="Priority">
                  <span className="inline-flex items-center gap-1.5">
                    <PriorityIcon priority={item.priority} decorative />
                    {getPriorityLevelName(item.priority)}
                  </span>
                </Property>
              </div>
              <div className="py-1">
                <Property label="Project">
                  {project ? getLocalProjectDisplayName(project) : "–"}
                </Property>
                <Property label="Task">{task?.name ?? "–"}</Property>
                <Property label="Source">
                  {item.source === "manual"
                    ? "Ajour"
                    : (item.sourceProjectName ??
                      item.sourceConnectionLabel ??
                      "–")}
                </Property>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {editorTarget && !isNarrowLayout ? (
        <SidePanel
          contentKey={`${editor}-${item._id}`}
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
