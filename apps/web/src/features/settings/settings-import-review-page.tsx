import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import {
  RiAlarmWarningLine as AlertTriangle,
  RiArrowRightLine as ArrowRight,
  RiCloseLine as X,
  RiMoreLine as More,
  RiNodeTree as FolderTree,
  RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import { Markdown } from "@/components/markdown";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { showToast, showUndoToast } from "@/components/ui/toast";
import {
  buildImportHierarchy,
  commitSelectedBacklogImportsToLocalStore,
  dismissBacklogImportCandidates,
  getPluginsOverview,
  isPluginApiMissing,
  listBacklogImportCandidates,
  restoreDismissedBacklogImports,
  updateBacklogImportSelection,
} from "@/lib/app-api";
import { useRetryWhilePluginApiMissing } from "@/lib/use-plugin-api-retry";
import { useLocalWorkItems } from "@/lib/local-hooks";
import {
  hasWorkItemEstimateSyncIssue,
  type LocalWorkItem,
  type LocalWorkItemEstimateFieldKey,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
import type { BacklogImportCandidate, PluginsOverview } from "@ajour/shared";
import { cn } from "@/lib/utils";
import { DescriptionText } from "@/features/backlog/description-links";
import type { SyncReviewSearch } from "@/features/backlog/sync-conflicts";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  lossyConversionAllowedFor,
} from "@/domain/backlog/description-sync";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import {
  confirmDescriptionLoss,
  useDescriptionSaving,
} from "@/features/backlog/synced-description";
import { saveSyncedDescription } from "@/lib/description-save";
import { HeldEditsReview } from "@/features/settings/held-edits-review";

interface ImportConnectionGroup {
  connectionId: string;
  connectionLabel: string;
  tenantLabel: string;
  items: BacklogImportCandidate[];
}

function groupImportCandidatesByConnection(
  items: BacklogImportCandidate[],
): ImportConnectionGroup[] {
  const groups = new Map<string, ImportConnectionGroup>();

  for (const item of items) {
    const existing = groups.get(item.connectionId);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(item.connectionId, {
      connectionId: item.connectionId,
      connectionLabel: item.connectionLabel,
      tenantLabel: item.tenantLabel,
      items: [item],
    });
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      left.tenantLabel.localeCompare(right.tenantLabel) ||
      left.connectionLabel.localeCompare(right.connectionLabel),
  );
}

function formatImportMeta(item: BacklogImportCandidate) {
  const parts = [
    typeof item.priority === "number" ? `P${item.priority}` : undefined,
    item.projectName,
    `${item.workItemType} #${item.externalId}`,
    item.state,
    item.assignedTo,
  ].filter(Boolean);

  return parts.join(" · ");
}

const ESTIMATE_FIELD_LABELS: Record<LocalWorkItemEstimateFieldKey, string> = {
  originalEstimateHours: "Original",
  remainingEstimateHours: "Remaining",
  completedEstimateHours: "Completed",
};

export function SettingsImportReviewPage() {
  const localWorkItems = useLocalWorkItems();
  const [overview, setOverview] = useState<PluginsOverview | null>(null);
  const [items, setItems] = useState<BacklogImportCandidate[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const selectableCount = items.filter((item) => item.selectable).length;
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Staged imports live in the app API, so the web build hides them.
  const [pluginApiMissing, setPluginApiMissing] = useState(false);

  /** Shows an operation error inline, or hides the plugin sections when the API is missing. */
  const showFailure = (nextError: unknown, fallback: string) => {
    if (isPluginApiMissing(nextError)) {
      setPluginApiMissing(true);
      setError(null);
      return;
    }
    setError(nextError instanceof Error ? nextError.message : fallback);
  };

  const refresh = async () => {
    setIsLoading(true);
    try {
      const [nextOverview, nextImports] = await Promise.all([
        getPluginsOverview(),
        listBacklogImportCandidates(),
      ]);
      setOverview(nextOverview);
      setItems(nextImports.items);
      setSelectedCount(nextImports.selectedCount);
      setPluginApiMissing(false);
      setError(null);
    } catch (nextError) {
      showFailure(nextError, "Unable to load staged imports.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useRetryWhilePluginApiMissing(pluginApiMissing, refresh);

  const connectionGroups = useMemo(
    () => groupImportCandidatesByConnection(items),
    [items],
  );
  const syncIssues = useMemo(
    () =>
      localWorkItems.flatMap((workItem) =>
        (Object.keys(ESTIMATE_FIELD_LABELS) as LocalWorkItemEstimateFieldKey[])
          .map((fieldKey) => ({
            workItem,
            fieldKey,
            fieldState: workItem.estimateSync?.[fieldKey],
          }))
          .filter(
            (issue) => issue.fieldState?.conflict || issue.fieldState?.error,
          ),
      ),
    [localWorkItems],
  );
  // Opened from an item's conflict mark or a toast: that item's issues
  // come into view, highlighted.
  const { item: focusedItemId, held: focusedHeldConnectionId } = useSearch({
    strict: false,
  }) as SyncReviewSearch;
  const descriptionConflicts = useMemo(
    () =>
      localWorkItems.filter((workItem) => workItem.descriptionSync?.conflict),
    [localWorkItems],
  );
  useEffect(() => {
    if (!focusedItemId) return;
    document
      .querySelector(`[data-sync-issue-item="${CSS.escape(focusedItemId)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [focusedItemId, descriptionConflicts.length, syncIssues.length]);
  const existingWorkItemsByImportKey = useMemo(
    () =>
      new Map(
        localWorkItems
          .filter(
            (workItem): workItem is LocalWorkItem & { sourceId: string } =>
              Boolean(workItem.sourceId),
          )
          .map(
            (workItem) =>
              [`${workItem.source}:${workItem.sourceId}`, workItem] as const,
          ),
      ),
    [localWorkItems],
  );

  const toggleItems = async (ids: string[], selected: boolean) => {
    if (ids.length === 0) {
      return;
    }

    setIsMutating(true);
    setStatusMessage(null);
    setError(null);
    try {
      await updateBacklogImportSelection(ids, selected);
      await refresh();
    } catch (nextError) {
      showFailure(nextError, "Unable to update staged import selection.");
    } finally {
      setIsMutating(false);
    }
  };

  /** Puts the items of the last dismissal back in review, for its Undo toast. */
  const undoDismissal = async (undoToken: string) => {
    try {
      if ((await restoreDismissedBacklogImports(undoToken)) !== "restored") {
        showToast("Can't undo. The staged items changed after that action.");
      }
      await refresh();
    } catch (nextError) {
      showFailure(nextError, "Unable to restore dismissed import items.");
    }
  };

  /** Dismisses staged items at once and offers Undo in a toast. */
  const dismissItems = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    setIsMutating(true);
    setStatusMessage(null);
    setError(null);
    try {
      const { dismissedCount, undoToken } =
        await dismissBacklogImportCandidates(ids);
      await refresh();
      if (undoToken) {
        showUndoToast({
          title: `${dismissedCount} staged ${dismissedCount === 1 ? "item" : "items"} dismissed`,
          onUndo: () => void undoDismissal(undoToken),
        });
      }
    } catch (nextError) {
      showFailure(nextError, "Unable to dismiss staged import items.");
    } finally {
      setIsMutating(false);
    }
  };

  const handleCommitSelected = async () => {
    setIsMutating(true);
    setStatusMessage(null);
    setError(null);
    try {
      const result = await commitSelectedBacklogImportsToLocalStore();
      await refresh();
      const parts = [];
      if (result.importedCount > 0) {
        parts.push(`${result.importedCount} imported`);
      }
      if (result.updatedCount > 0) {
        parts.push(`${result.updatedCount} updated`);
      }

      setStatusMessage(
        parts.length > 0
          ? `${parts.join(" · ")} backlog item${result.importedCount + result.updatedCount === 1 ? "" : "s"} applied.`
          : "No backlog items changed.",
      );
    } catch (nextError) {
      showFailure(nextError, "Unable to import selected backlog items.");
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="settings-sections settings-measure">
      <section className="settings-section">
        <p className="settings-section-desc">
          Review staged backlog imports and resolve description and estimate
          conflicts before the next sync pass. Child items stay one level deep
          and inherit their parent context when needed.
        </p>

        <HeldEditsReview focusedConnectionId={focusedHeldConnectionId} />

        {descriptionConflicts.length > 0 ? (
          <AppPanel>
            <h3 className="settings-subsection-title">
              {descriptionConflicts.length} description conflict
              {descriptionConflicts.length === 1 ? "" : "s"}
            </h3>
            {descriptionConflicts.map((workItem) => {
              const conflict = workItem.descriptionSync!.conflict!;
              return (
                <section
                  key={workItem._id}
                  aria-label={`Description conflict on ${workItem.title}`}
                  data-sync-issue-item={workItem._id}
                  data-highlighted={
                    workItem._id === focusedItemId ? "" : undefined
                  }
                  className={cn(
                    "flex flex-col gap-3 rounded-md p-2",
                    workItem._id === focusedItemId && "bg-[var(--hover-bg)]",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      to="/backlog/$itemId"
                      params={{ itemId: workItem._id }}
                      className="text-sm font-medium break-words text-foreground"
                    >
                      {workItem.title}
                    </Link>
                    <DescriptionConflictActions workItem={workItem} />
                  </div>
                  <div className="grid gap-3 desktop:grid-cols-2">
                    <div className="min-w-0 space-y-1">
                      <div className="text-xs text-muted-foreground">
                        In Ajour
                      </div>
                      {/* The text as it is now, edited since the conflict or not. */}
                      {workItem.description ? (
                        <DescriptionText body={workItem.description} />
                      ) : (
                        <p className="text-sm text-muted-foreground">Empty</p>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="text-xs text-muted-foreground">
                        In {workItem.sourceConnectionLabel ?? "the source"}
                      </div>
                      {conflict.remoteText ? (
                        <DescriptionText body={conflict.remoteText} />
                      ) : (
                        <p className="text-sm text-muted-foreground">Empty</p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </AppPanel>
        ) : null}

        {syncIssues.length > 0 ? (
          <AppPanel>
            <h3 className="settings-subsection-title">
              {syncIssues.length} estimate issue
              {syncIssues.length === 1 ? "" : "s"}
            </h3>
            {syncIssues.map(({ workItem, fieldKey, fieldState }) => (
              <div
                key={`${workItem._id}:${fieldKey}`}
                data-sync-issue-item={workItem._id}
                className={cn(
                  "flex flex-col gap-3 desktop:flex-row desktop:items-start desktop:justify-between",
                  workItem._id === focusedItemId &&
                    "rounded-md bg-[var(--hover-bg)] p-2",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium break-words text-foreground">
                        {workItem.title}
                      </span>
                      <Badge className="bg-muted">
                        {ESTIMATE_FIELD_LABELS[fieldKey]}
                      </Badge>
                    </div>
                    {fieldState?.conflict ? (
                      <div className="text-[13px] leading-5 text-muted-foreground">
                        Local: {fieldState.conflict.localValue ?? "empty"} ·
                        Remote: {fieldState.conflict.remoteValue ?? "empty"} ·
                        Last synced:{" "}
                        {fieldState.conflict.baselineValue ?? "empty"}
                      </div>
                    ) : null}
                    {fieldState?.error ? (
                      <div className="text-[13px] leading-5 text-muted-foreground">
                        {fieldState.error.message}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 pl-7 desktop:pl-0">
                  {fieldState?.conflict ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() =>
                          localStore.keepLocalEstimateConflict(
                            workItem._id,
                            fieldKey,
                          )
                        }
                      >
                        Keep local
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          localStore.acceptRemoteEstimateValue(
                            workItem._id,
                            fieldKey,
                          )
                        }
                      >
                        Accept remote
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() =>
                      localStore.dismissEstimateIssue(workItem._id, fieldKey)
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </AppPanel>
        ) : pluginApiMissing && descriptionConflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to review.</p>
        ) : null}

        {pluginApiMissing ? null : (
          // One toolbar, as Linear's and Vercel's lists: a select-all box with
          // the counts, then Refresh, Dismiss and the one primary action
          // (forms council round 4).
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Checkbox
                aria-label="Select every staged item"
                checked={
                  selectableCount > 0 && selectedCount === selectableCount
                }
                indeterminate={
                  selectedCount > 0 && selectedCount < selectableCount
                }
                disabled={isLoading || isMutating || selectableCount === 0}
                onCheckedChange={(checked) =>
                  void toggleItems(
                    items
                      .filter((item) => item.selectable)
                      .map((item) => item.id),
                    checked,
                  )
                }
              />
              <span>
                <span className="font-medium text-foreground">
                  {overview?.totalPendingImportCount ?? items.length} staged
                </span>
                {" · "}
                {selectedCount} selected
              </span>
            </label>
            <span className="flex-1" />
            {/* Status on the left, one cluster of actions on the right. */}
            <div className="flex items-center gap-1">
              <TooltipButton
                label="Refresh"
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isLoading || isMutating}
                    onClick={() => void refresh()}
                  />
                }
              >
                <RefreshCw />
              </TooltipButton>
              <Button
                variant="ghost"
                disabled={isLoading || isMutating || selectedCount === 0}
                onClick={() =>
                  void dismissItems(
                    items
                      .filter((item) => item.selectable && item.selected)
                      .map((item) => item.id),
                  )
                }
              >
                Dismiss selected
              </Button>
              <Button
                disabled={isLoading || isMutating || selectedCount === 0}
                onClick={() => void handleCommitSelected()}
              >
                Sync selected to backlog
              </Button>
            </div>
          </div>
        )}

        {statusMessage ? (
          <p className="text-sm text-foreground">{statusMessage}</p>
        ) : null}
        {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}

        {pluginApiMissing ? null : isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading staged imports…
          </p>
        ) : connectionGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No staged imports yet. Go to{" "}
            <Link
              to="/settings/plugins"
              replace
              className="font-medium text-foreground underline underline-offset-4"
            >
              Plugins
            </Link>{" "}
            and sync one of your plugin connections first.
          </p>
        ) : (
          <div className="import-review-groups">
            {connectionGroups.map((group) => {
              const hierarchy = buildImportHierarchy(group.items);
              const selectableIds = group.items
                .filter((item) => item.selectable)
                .map((item) => item.id);
              const selectedIds = group.items
                .filter((item) => item.selectable && item.selected)
                .map((item) => item.id);

              return (
                <section
                  key={group.connectionId}
                  className="import-review-group"
                >
                  <div className="import-review-group-header">
                    <div className="flex min-w-0 items-start gap-2">
                      <Checkbox
                        className="mt-1"
                        aria-label={`Select every staged item from ${group.connectionLabel}`}
                        checked={
                          selectableIds.length > 0 &&
                          selectedIds.length === selectableIds.length
                        }
                        indeterminate={
                          selectedIds.length > 0 &&
                          selectedIds.length < selectableIds.length
                        }
                        disabled={isMutating || selectableIds.length === 0}
                        onCheckedChange={(checked) =>
                          void toggleItems(selectableIds, checked)
                        }
                      />
                      <div className="import-review-group-title-wrap">
                        <h3 className="import-review-group-title">
                          {group.connectionLabel}
                        </h3>
                        {/* The tenant only when it says more than the label. */}
                        {group.tenantLabel &&
                        group.tenantLabel.trim().toLowerCase() !==
                          group.connectionLabel.trim().toLowerCase() ? (
                          <div className="import-review-group-kicker">
                            {group.tenantLabel}
                          </div>
                        ) : null}
                        <div className="import-review-group-meta">
                          {group.items.length} staged · {selectedIds.length}{" "}
                          selected
                        </div>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`More actions for ${group.connectionLabel}`}
                          />
                        }
                      >
                        <More />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isMutating || group.items.length === 0}
                          onClick={() =>
                            void dismissItems(
                              group.items.map((item) => item.id),
                            )
                          }
                        >
                          Dismiss all staged
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="import-review-list">
                    {hierarchy.map(
                      ({ item: rootItem, children: childItems }) => {
                        const existingRootItem =
                          existingWorkItemsByImportKey.get(
                            `${rootItem.source}:${rootItem.sourceId}`,
                          );

                        return (
                          <div key={rootItem.id} className="import-review-node">
                            <label
                              className={cn(
                                "import-review-item",
                                !rootItem.selectable && "is-context-only",
                              )}
                            >
                              <Checkbox
                                checked={
                                  rootItem.selectable
                                    ? rootItem.selected
                                    : childItems.some((child) => child.selected)
                                }
                                disabled={isMutating || !rootItem.selectable}
                                onCheckedChange={(checked) =>
                                  void toggleItems([rootItem.id], checked)
                                }
                              />
                              <div className="import-review-item-main">
                                <div className="import-review-item-title-row">
                                  {typeof rootItem.priority === "number" ? (
                                    <span
                                      className="import-review-item-priority"
                                      aria-label={`Priority ${rootItem.priority}`}
                                    >
                                      {rootItem.priority}
                                    </span>
                                  ) : null}
                                  <span className="import-review-item-title">
                                    {rootItem.title}
                                  </span>
                                  {existingRootItem &&
                                  hasWorkItemEstimateSyncIssue(
                                    existingRootItem,
                                  ) ? (
                                    <Badge className="bg-amber-500/15 text-amber-300">
                                      <AlertTriangle className="h-3 w-3" />
                                      Needs review
                                    </Badge>
                                  ) : null}
                                  {existingRootItem ? (
                                    <Badge className="bg-muted">
                                      {rootItem.selected
                                        ? "Update existing task"
                                        : "Existing task"}
                                    </Badge>
                                  ) : null}
                                  {!rootItem.selectable ? (
                                    <Badge className="bg-muted">
                                      <FolderTree className="h-3 w-3" />
                                      Context parent
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="import-review-item-meta">
                                  {formatImportMeta(rootItem)}
                                </div>
                                {existingRootItem ? (
                                  <div className="import-review-item-meta">
                                    Matches backlog task:{" "}
                                    {existingRootItem.title}
                                  </div>
                                ) : null}
                                {rootItem.note ? (
                                  <Markdown className="import-review-item-note text-xs">
                                    {rootItem.note}
                                  </Markdown>
                                ) : null}
                              </div>
                            </label>

                            {childItems.length > 0 ? (
                              <div className="import-review-children">
                                {childItems.map((childItem) => {
                                  const existingChildItem =
                                    existingWorkItemsByImportKey.get(
                                      `${childItem.source}:${childItem.sourceId}`,
                                    );

                                  return (
                                    <label
                                      key={childItem.id}
                                      className="import-review-item is-child"
                                    >
                                      <Checkbox
                                        checked={childItem.selected}
                                        disabled={
                                          isMutating || !childItem.selectable
                                        }
                                        onCheckedChange={(checked) =>
                                          void toggleItems(
                                            [childItem.id],
                                            checked,
                                          )
                                        }
                                      />
                                      <div className="import-review-item-main">
                                        <div className="import-review-item-title-row">
                                          {typeof childItem.priority ===
                                          "number" ? (
                                            <span
                                              className="import-review-item-priority"
                                              aria-label={`Priority ${childItem.priority}`}
                                            >
                                              {childItem.priority}
                                            </span>
                                          ) : null}
                                          <span className="import-review-item-title">
                                            {childItem.title}
                                          </span>
                                          {existingChildItem &&
                                          hasWorkItemEstimateSyncIssue(
                                            existingChildItem,
                                          ) ? (
                                            <Badge className="bg-amber-500/15 text-amber-300">
                                              <AlertTriangle className="h-3 w-3" />
                                              Needs review
                                            </Badge>
                                          ) : null}
                                          {existingChildItem ? (
                                            <Badge className="bg-muted">
                                              {childItem.selected
                                                ? "Update existing task"
                                                : "Existing task"}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="import-review-item-meta">
                                          {formatImportMeta(childItem)}
                                        </div>
                                        {existingChildItem ? (
                                          <div className="import-review-item-meta">
                                            Matches backlog task:{" "}
                                            {existingChildItem.title}
                                          </div>
                                        ) : null}
                                        {childItem.note ? (
                                          <Markdown className="import-review-item-note text-xs">
                                            {childItem.note}
                                          </Markdown>
                                        ) : null}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      },
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Keep mine writes the user's text to the source, when its plugin writes
 * descriptions; Take source applies the source's, with Undo.
 */
function DescriptionConflictActions({ workItem }: { workItem: LocalWorkItem }) {
  const overview = usePluginsOverview();
  const saving = useDescriptionSaving(workItem._id);
  const canWrite = descriptionAccess(
    workItem,
    descriptionCapabilityOf(workItem, overview),
    lossyConversionAllowedFor(workItem, overview),
  ).editable;
  return (
    <div className="flex flex-wrap gap-2">
      {canWrite ? (
        <Button
          variant="outline"
          disabled={saving}
          onClick={async () => {
            // Writing the user's text loses what its conversion lost: ask first.
            const allowedLoss = await confirmDescriptionLoss(workItem);
            if (allowedLoss)
              void saveSyncedDescription(workItem._id, "keepMine", allowedLoss);
          }}
        >
          {saving ? "Saving…" : "Keep mine"}
        </Button>
      ) : null}
      <Button
        variant="outline"
        disabled={saving}
        onClick={() =>
          offerUndo(localStore.takeSourceDescriptionWithUndo(workItem._id), {
            title: "Took the source's description",
            subject: workItem.title,
          })
        }
      >
        Take source
      </Button>
    </div>
  );
}
