import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiAlarmWarningLine as AlertTriangle,
  RiArrowRightLine as ArrowRight,
  RiCheckboxIndeterminateLine as MinusSquare,
  RiCheckboxMultipleLine as CheckSquare,
  RiCloseLine as X,
  RiNodeTree as FolderTree,
  RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import { Markdown } from "@/components/markdown";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Sync review</h2>
        <p className="settings-section-desc">
          Review staged backlog imports and resolve estimate conflicts before
          the next sync pass. Child items stay one level deep and inherit their
          parent context when needed.
        </p>

        {syncIssues.length > 0 ? (
          <AppPanel>
            <h3 className="settings-subsection-title">
              {syncIssues.length} estimate issue
              {syncIssues.length === 1 ? "" : "s"}
            </h3>
            {syncIssues.map(({ workItem, fieldKey, fieldState }) => (
              <div
                key={`${workItem._id}:${fieldKey}`}
                className="flex flex-col gap-3 desktop:flex-row desktop:items-start desktop:justify-between"
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
        ) : pluginApiMissing ? (
          <p className="text-sm text-muted-foreground">Nothing to review.</p>
        ) : null}

        {pluginApiMissing ? null : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {overview?.totalPendingImportCount ?? items.length} staged items
              </span>
              {" · "}
              {selectedCount} selected
              {" · "}
              {overview?.connectionGroups.reduce(
                (sum, group) => sum + group.connections.length,
                0,
              ) ?? 0}{" "}
              plugin connections
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"

                disabled={isLoading || isMutating}
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button
                variant="outline"

                disabled={
                  isLoading ||
                  isMutating ||
                  items.every((item) => !item.selectable)
                }
                onClick={() =>
                  void toggleItems(
                    items
                      .filter((item) => item.selectable)
                      .map((item) => item.id),
                    true,
                  )
                }
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Select all
              </Button>
              <Button
                variant="outline"

                disabled={isLoading || isMutating || selectedCount === 0}
                onClick={() =>
                  void dismissItems(
                    items
                      .filter((item) => item.selectable && item.selected)
                      .map((item) => item.id),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
                Dismiss selected
              </Button>
              <Button
                variant="outline"

                disabled={isLoading || isMutating || selectedCount === 0}
                onClick={() =>
                  void toggleItems(
                    items
                      .filter((item) => item.selectable && item.selected)
                      .map((item) => item.id),
                    false,
                  )
                }
              >
                <MinusSquare className="h-3.5 w-3.5" />
                Clear selection
              </Button>
              <Button
                disabled={isLoading || isMutating || selectedCount === 0}
                onClick={() => void handleCommitSelected()}
              >
                <ArrowRight className="h-3.5 w-3.5" />
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
                    <div className="import-review-group-title-wrap">
                      <div className="import-review-group-kicker">
                        {group.tenantLabel}
                      </div>
                      <h3 className="import-review-group-title">
                        {group.connectionLabel}
                      </h3>
                      <div className="import-review-group-meta">
                        {group.items.length} staged · {selectedIds.length}{" "}
                        selected
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"

                        disabled={isMutating || selectableIds.length === 0}
                        onClick={() => void toggleItems(selectableIds, true)}
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                        Select connection
                      </Button>
                      <Button
                        variant="outline"

                        disabled={isMutating || group.items.length === 0}
                        onClick={() =>
                          void dismissItems(group.items.map((item) => item.id))
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                        Dismiss connection
                      </Button>
                      <Button
                        variant="outline"

                        disabled={isMutating || selectedIds.length === 0}
                        onClick={() => void toggleItems(selectedIds, false)}
                      >
                        <MinusSquare className="h-3.5 w-3.5" />
                        Clear connection
                      </Button>
                    </div>
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
