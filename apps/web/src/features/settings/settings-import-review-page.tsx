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
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildImportHierarchy,
  commitSelectedConnectorImportsToLocalStore,
  dismissConnectorImportCandidates,
  getConnectorsOverview,
  listConnectorImportCandidates,
  updateConnectorImportSelection,
} from "@/lib/app-api";
import { useLocalWorkItems } from "@/lib/local-hooks";
import {
  hasWorkItemEstimateSyncIssue,
  type LocalWorkItem,
  type LocalWorkItemEstimateFieldKey,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
import type { ConnectorImportCandidate, ConnectorsOverview } from "@timetracker/shared";
import { cn } from "@/lib/utils";

interface ImportConnectionGroup {
  connectionId: string;
  connectionLabel: string;
  tenantLabel: string;
  items: ConnectorImportCandidate[];
}

function groupImportCandidatesByConnection(items: ConnectorImportCandidate[]): ImportConnectionGroup[] {
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

function formatImportMeta(item: ConnectorImportCandidate) {
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
  const [overview, setOverview] = useState<ConnectorsOverview | null>(null);
  const [items, setItems] = useState<ConnectorImportCandidate[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const [nextOverview, nextImports] = await Promise.all([
        getConnectorsOverview(),
        listConnectorImportCandidates(),
      ]);
      setOverview(nextOverview);
      setItems(nextImports.items);
      setSelectedCount(nextImports.selectedCount);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load staged imports.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const connectionGroups = useMemo(() => groupImportCandidatesByConnection(items), [items]);
  const syncIssues = useMemo(
    () =>
      localWorkItems.flatMap((workItem) =>
        (Object.keys(ESTIMATE_FIELD_LABELS) as LocalWorkItemEstimateFieldKey[])
          .map((fieldKey) => ({
            workItem,
            fieldKey,
            fieldState: workItem.estimateSync?.[fieldKey],
          }))
          .filter((issue) => issue.fieldState?.conflict || issue.fieldState?.error),
      ),
    [localWorkItems],
  );
  const existingWorkItemsByImportKey = useMemo(
    () =>
      new Map(
        localWorkItems
          .filter((workItem): workItem is LocalWorkItem & { sourceId: string } => Boolean(workItem.sourceId))
          .map((workItem) => [`${workItem.source}:${workItem.sourceId}`, workItem] as const),
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
      await updateConnectorImportSelection(ids, selected);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update staged import selection.");
    } finally {
      setIsMutating(false);
    }
  };

  const dismissItems = async (ids: string[], successLabel: string) => {
    if (ids.length === 0) {
      return;
    }

    setIsMutating(true);
    setStatusMessage(null);
    setError(null);
    try {
      const result = await dismissConnectorImportCandidates(ids);
      await refresh();
      setStatusMessage(
        `${result.dismissedCount} staged item${result.dismissedCount === 1 ? "" : "s"} dismissed from ${successLabel}.`,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to dismiss staged import items.");
    } finally {
      setIsMutating(false);
    }
  };

  const handleCommitSelected = async () => {
    setIsMutating(true);
    setStatusMessage(null);
    setError(null);
    try {
      const result = await commitSelectedConnectorImportsToLocalStore();
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
      setError(nextError instanceof Error ? nextError.message : "Unable to import selected backlog items.");
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Sync Review</h2>
        <p className="settings-section-desc">
          Review staged connector imports and resolve estimate conflicts before the next sync pass. Child items stay one level deep and inherit their parent context when needed.
        </p>

        {syncIssues.length > 0 ? (
          <AppPanel className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{syncIssues.length} estimate issue{syncIssues.length === 1 ? "" : "s"}</Badge>
            </div>
            <div className="space-y-3">
              {syncIssues.map(({ workItem, fieldKey, fieldState }) => (
                <div key={`${workItem._id}:${fieldKey}`} className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <AlertTriangle className="h-4 w-4 text-amber-300" />
                        <span>{workItem.title}</span>
                        <Badge className="bg-muted">{ESTIMATE_FIELD_LABELS[fieldKey]}</Badge>
                      </div>
                      {fieldState?.conflict ? (
                        <div className="text-sm text-foreground/70">
                          Local: {fieldState.conflict.localValue ?? "empty"} · Remote: {fieldState.conflict.remoteValue ?? "empty"} · Last synced: {fieldState.conflict.baselineValue ?? "empty"}
                        </div>
                      ) : null}
                      {fieldState?.error ? (
                        <div className="text-sm text-foreground/70">{fieldState.error.message}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {fieldState?.conflict ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => localStore.keepLocalEstimateConflict(workItem._id, fieldKey)}
                          >
                            Keep Local
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => localStore.acceptRemoteEstimateValue(workItem._id, fieldKey)}
                          >
                            Accept Remote
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => localStore.dismissEstimateIssue(workItem._id, fieldKey)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </AppPanel>
        ) : null}

        <AppPanel className="import-review-toolbar">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{overview?.totalPendingImportCount ?? items.length} staged items</Badge>
            <Badge className="bg-muted">{selectedCount} selected</Badge>
            <Badge className="bg-muted">
              {overview?.connectionGroups.reduce((sum, group) => sum + group.connections.length, 0) ?? 0} connector connections
            </Badge>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isMutating}
              onClick={() => void refresh()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isMutating || items.every((item) => !item.selectable)}
              onClick={() =>
                void toggleItems(
                  items.filter((item) => item.selectable).map((item) => item.id),
                  true,
                )
              }
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Select All
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isMutating || selectedCount === 0}
              onClick={() =>
                void dismissItems(
                  items.filter((item) => item.selectable && item.selected).map((item) => item.id),
                  "review queue",
                )
              }
            >
              <X className="h-3.5 w-3.5" />
              Dismiss Selected
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isMutating || selectedCount === 0}
              onClick={() =>
                void toggleItems(
                  items.filter((item) => item.selectable && item.selected).map((item) => item.id),
                  false,
                )
              }
            >
              <MinusSquare className="h-3.5 w-3.5" />
              Clear Selection
            </Button>
            <Button
              size="sm"
              disabled={isLoading || isMutating || selectedCount === 0}
              onClick={() => void handleCommitSelected()}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Sync Selected To Backlog
            </Button>
          </div>
        </AppPanel>

        {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
        {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}

        {isLoading ? (
          <MessagePanel>Loading staged imports…</MessagePanel>
        ) : connectionGroups.length === 0 ? (
          <MessagePanel>
            No staged imports yet. Go to <Link to="/settings/plugins" replace>Plugins</Link> and sync one of your connector connections first.
          </MessagePanel>
        ) : (
          <div className="import-review-groups">
            {connectionGroups.map((group) => {
              const hierarchy = buildImportHierarchy(group.items);
              const selectableIds = group.items.filter((item) => item.selectable).map((item) => item.id);
              const selectedIds = group.items
                .filter((item) => item.selectable && item.selected)
                .map((item) => item.id);

              return (
                <AppPanel key={group.connectionId} as="section" className="import-review-panel">
                  <div className="import-review-panel-header">
                    <div className="import-review-panel-title-wrap">
                      <div className="import-review-panel-kicker">{group.tenantLabel}</div>
                      <h3 className="import-review-panel-title">{group.connectionLabel}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-muted">{group.items.length} staged</Badge>
                      <Badge className="bg-muted">{selectedIds.length} selected</Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || selectableIds.length === 0}
                      onClick={() => void toggleItems(selectableIds, true)}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      Select Connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || group.items.length === 0}
                      onClick={() => void dismissItems(group.items.map((item) => item.id), `${group.connectionLabel} sync`)}
                    >
                      <X className="h-3.5 w-3.5" />
                      Dismiss Connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || selectedIds.length === 0}
                      onClick={() => void toggleItems(selectedIds, false)}
                    >
                      <MinusSquare className="h-3.5 w-3.5" />
                      Clear Connection
                    </Button>
                  </div>

                  <div className="import-review-list">
                    {hierarchy.map(({ item: rootItem, children: childItems }) => {
                      const existingRootItem = existingWorkItemsByImportKey.get(
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
                              checked={rootItem.selectable ? rootItem.selected : childItems.some((child) => child.selected)}
                              disabled={isMutating || !rootItem.selectable}
                              onCheckedChange={(checked) =>
                                void toggleItems([rootItem.id], checked)
                              }
                            />
                            <div className="import-review-item-main">
                              <div className="import-review-item-title-row">
                                {typeof rootItem.priority === "number" ? (
                                  <span className="import-review-item-priority" aria-label={`Priority ${rootItem.priority}`}>
                                    {rootItem.priority}
                                  </span>
                                ) : null}
                                <span className="import-review-item-title">{rootItem.title}</span>
                                {existingRootItem && hasWorkItemEstimateSyncIssue(existingRootItem) ? (
                                  <Badge className="bg-amber-500/15 text-amber-300">
                                    <AlertTriangle className="h-3 w-3" />
                                    Needs review
                                  </Badge>
                                ) : null}
                                {existingRootItem ? (
                                  <Badge className="bg-muted">
                                    {rootItem.selected ? "Update existing task" : "Existing task"}
                                  </Badge>
                                ) : null}
                                {!rootItem.selectable ? (
                                  <Badge className="bg-muted">
                                    <FolderTree className="h-3 w-3" />
                                    Context parent
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="import-review-item-meta">{formatImportMeta(rootItem)}</div>
                              {existingRootItem ? (
                                <div className="import-review-item-meta">
                                  Matches backlog task: {existingRootItem.title}
                                </div>
                              ) : null}
                              {rootItem.note ? <div className="import-review-item-note">{rootItem.note}</div> : null}
                            </div>
                          </label>

                          {childItems.length > 0 ? (
                            <div className="import-review-children">
                              {childItems.map((childItem) => {
                                const existingChildItem = existingWorkItemsByImportKey.get(
                                  `${childItem.source}:${childItem.sourceId}`,
                                );

                                return (
                                  <label key={childItem.id} className="import-review-item is-child">
                                    <Checkbox
                                      checked={childItem.selected}
                                      disabled={isMutating || !childItem.selectable}
                                      onCheckedChange={(checked) =>
                                        void toggleItems([childItem.id], checked)
                                      }
                                    />
                                    <div className="import-review-item-main">
                                      <div className="import-review-item-title-row">
                                        {typeof childItem.priority === "number" ? (
                                          <span className="import-review-item-priority" aria-label={`Priority ${childItem.priority}`}>
                                            {childItem.priority}
                                          </span>
                                        ) : null}
                                        <span className="import-review-item-title">{childItem.title}</span>
                                        {existingChildItem && hasWorkItemEstimateSyncIssue(existingChildItem) ? (
                                          <Badge className="bg-amber-500/15 text-amber-300">
                                            <AlertTriangle className="h-3 w-3" />
                                            Needs review
                                          </Badge>
                                        ) : null}
                                        {existingChildItem ? (
                                          <Badge className="bg-muted">
                                            {childItem.selected ? "Update existing task" : "Existing task"}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <div className="import-review-item-meta">{formatImportMeta(childItem)}</div>
                                      {existingChildItem ? (
                                        <div className="import-review-item-meta">
                                          Matches backlog task: {existingChildItem.title}
                                        </div>
                                      ) : null}
                                      {childItem.note ? (
                                        <div className="import-review-item-note">{childItem.note}</div>
                                      ) : null}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </AppPanel>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
