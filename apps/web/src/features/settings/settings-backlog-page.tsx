import { useEffect, useMemo, useState } from "react";
import {
  RiDeleteBinLine as Trash2,
  RiRefreshLine as RefreshCw,
  RiSaveLine as Save,
} from "@remixicon/react";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  buildBacklogStatusOptions,
  getBacklogStatusName,
} from "@/features/backlog/backlog-status";
import {
  getConnectorBacklogStatuses,
  isConnectorApiMissing,
} from "@/lib/app-api";
import { offerUndo } from "@/features/feedback/undo-toast";
import { useRetryWhileConnectorApiMissing } from "@/lib/use-connector-api-retry";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

const DEFAULT_NEW_BACKLOG_STATUS_COLOR = "#64748b";

export function SettingsBacklogPage() {
  const state = useLocalState();
  const [sourceStatuses, setSourceStatuses] = useState<
    Awaited<ReturnType<typeof getConnectorBacklogStatuses>>["items"]
  >([]);
  const [statusDrafts, setStatusDrafts] = useState<
    Record<string, { name: string; color: string }>
  >({});
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState(
    DEFAULT_NEW_BACKLOG_STATUS_COLOR,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Synced statuses come from connectors, so the web build hides that section.
  const [connectorApiMissing, setConnectorApiMissing] = useState(false);

  const backlogStatusOptions = useMemo(
    () => buildBacklogStatusOptions(state.backlogStatuses),
    [state.backlogStatuses],
  );
  const backlogStatusNameById = useMemo(
    () =>
      new Map(
        state.backlogStatuses.map(
          (status) => [status._id, status.name] as const,
        ),
      ),
    [state.backlogStatuses],
  );
  const mappingByKey = useMemo(
    () =>
      new Map(
        state.backlogStatusMappings.map((mapping) => [
          `${mapping.source}:${mapping.connectionId}:${mapping.sourceStatusKey}`,
          mapping.backlogStatusId,
        ]),
      ),
    [state.backlogStatusMappings],
  );

  const groupedSourceStatuses = useMemo(() => {
    const groups = new Map<
      string,
      {
        tenantLabel: string;
        connectionId: string;
        connectionLabel: string;
        statuses: typeof sourceStatuses;
      }
    >();

    for (const status of sourceStatuses) {
      const groupKey = `${status.tenantLabel}::${status.connectionId}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.statuses.push(status);
        continue;
      }

      groups.set(groupKey, {
        tenantLabel: status.tenantLabel,
        connectionId: status.connectionId,
        connectionLabel: status.connectionLabel,
        statuses: [status],
      });
    }

    return Array.from(groups.values()).sort(
      (left, right) =>
        left.tenantLabel.localeCompare(right.tenantLabel) ||
        left.connectionLabel.localeCompare(right.connectionLabel),
    );
  }, [sourceStatuses]);

  useEffect(() => {
    setStatusDrafts((current) => {
      const nextDrafts = { ...current };
      for (const status of state.backlogStatuses) {
        if (!(status._id in nextDrafts)) {
          nextDrafts[status._id] = {
            name: status.name,
            color: status.color,
          };
        }
      }

      for (const key of Object.keys(nextDrafts)) {
        if (!state.backlogStatuses.some((status) => status._id === key)) {
          delete nextDrafts[key];
        }
      }

      return nextDrafts;
    });
  }, [state.backlogStatuses]);

  useEffect(() => {
    void refreshSourceStatuses();
  }, []);

  useRetryWhileConnectorApiMissing(connectorApiMissing, refreshSourceStatuses);

  async function refreshSourceStatuses() {
    setIsRefreshing(true);
    try {
      const result = await getConnectorBacklogStatuses();
      setSourceStatuses(result.items);
      setConnectorApiMissing(false);
      setError(null);
    } catch (nextError) {
      if (isConnectorApiMissing(nextError)) {
        setConnectorApiMissing(true);
        return;
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load synced statuses.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleAddStatus() {
    try {
      localStore.addBacklogStatus(newStatusName, newStatusColor);
      setNewStatusName("");
      setNewStatusColor(DEFAULT_NEW_BACKLOG_STATUS_COLOR);
      setError(null);
      setMessage("Backlog status added.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to add backlog status.",
      );
    }
  }

  function handleSaveStatus(statusId: string) {
    try {
      localStore.updateBacklogStatus(
        statusId,
        statusDrafts[statusId] ?? {
          name: "",
          color: DEFAULT_NEW_BACKLOG_STATUS_COLOR,
        },
      );
      setError(null);
      setMessage("Backlog status updated.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update backlog status.",
      );
    }
  }

  function handleDeleteStatus(statusId: string) {
    offerUndo(localStore.deleteBacklogStatus(statusId), {
      title: "Status deleted",
      subject: "status",
    });
    setError(null);
    setMessage(null);
  }

  function handleMappingChange(
    source: (typeof sourceStatuses)[number],
    backlogStatusId: string,
  ) {
    try {
      localStore.setBacklogStatusMapping({
        source: source.source,
        connectionId: source.connectionId,
        sourceStatusKey: source.key,
        backlogStatusId: backlogStatusId || undefined,
      });
      setError(null);
      setMessage(
        backlogStatusId
          ? `Mapped ${source.label} to ${getBacklogStatusName(backlogStatusId, backlogStatusNameById)}.`
          : `Cleared the mapping for ${source.label}.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update status mapping.",
      );
    }
  }

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Backlog statuses</h2>
        <p className="settings-section-desc">
          Create the statuses the app should use in backlog, then map synced
          connector statuses onto them.
        </p>

        <AppPanel className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{state.backlogStatuses.length} app statuses</Badge>
            {connectorApiMissing ? null : (
              <>
                <Badge className="bg-muted">
                  {sourceStatuses.length} synced source statuses
                </Badge>
                <Badge className="bg-muted">
                  {state.backlogStatusMappings.length} mappings
                </Badge>
              </>
            )}
          </div>

          <div className="backlog-settings-status-create">
            <Input
              value={newStatusName}
              onChange={(event) => setNewStatusName(event.target.value)}
              placeholder="Add an app status"
              autoComplete="off"
            />
            <Input
              aria-label="New backlog status color"
              type="color"
              value={newStatusColor}
              onChange={(event) => setNewStatusColor(event.target.value)}
              className="w-14 p-1"
            />
            <Button
              onClick={handleAddStatus}
              disabled={newStatusName.trim().length === 0}
            >
              Add status
            </Button>
          </div>

          {state.backlogStatuses.length === 0 ? (
            <MessagePanel>
              Create at least one app status before mapping synced connector
              statuses.
            </MessagePanel>
          ) : (
            <div className="backlog-settings-status-list">
              {state.backlogStatuses.map((status) => (
                <div key={status._id} className="backlog-settings-status-row">
                  <span
                    className="status-dot"
                    aria-hidden="true"
                    style={{
                      background:
                        statusDrafts[status._id]?.color ?? status.color,
                    }}
                  />
                  <Input
                    value={statusDrafts[status._id]?.name ?? status.name}
                    onChange={(event) =>
                      setStatusDrafts((current) => ({
                        ...current,
                        [status._id]: {
                          name: event.target.value,
                          color: current[status._id]?.color ?? status.color,
                        },
                      }))
                    }
                    autoComplete="off"
                  />
                  <Input
                    aria-label={`${status.name} color`}
                    type="color"
                    value={statusDrafts[status._id]?.color ?? status.color}
                    onChange={(event) =>
                      setStatusDrafts((current) => ({
                        ...current,
                        [status._id]: {
                          name: current[status._id]?.name ?? status.name,
                          color: event.target.value,
                        },
                      }))
                    }
                    className="w-14 p-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleSaveStatus(status._id)}
                    disabled={
                      (statusDrafts[status._id]?.name ?? status.name).trim()
                        .length === 0
                    }
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleDeleteStatus(status._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </AppPanel>
      </section>

      {connectorApiMissing ? null : (
        <section className="settings-section">
          <h2 className="settings-section-title">Synced status mapping</h2>
          <p className="settings-section-desc">
            Connector sync registers raw statuses first. Mapping them here
            controls which backlog status imported items display.
          </p>

          <AppPanel className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isRefreshing}
                onClick={() => void refreshSourceStatuses()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh synced statuses
              </Button>
            </div>

            {groupedSourceStatuses.length === 0 ? (
              <MessagePanel>
                No synced connector statuses yet. Run a connector sync first.
              </MessagePanel>
            ) : (
              <div className="backlog-settings-source-groups">
                {groupedSourceStatuses.map((group) => (
                  <section
                    key={group.connectionId}
                    className="backlog-settings-source-group"
                  >
                    <div className="backlog-settings-source-header">
                      <div className="backlog-settings-source-kicker">
                        {group.tenantLabel}
                      </div>
                      <div className="backlog-settings-source-title">
                        {group.connectionLabel}
                      </div>
                    </div>

                    <div className="backlog-settings-source-list">
                      {group.statuses.map((status) => {
                        const mappingKey = `${status.source}:${status.connectionId}:${status.key}`;
                        const mappedBacklogStatusId =
                          mappingByKey.get(mappingKey) ?? "";

                        return (
                          <div
                            key={mappingKey}
                            className="backlog-settings-source-row"
                          >
                            <div>
                              <div className="backlog-settings-source-label">
                                {status.label}
                              </div>
                              <div className="backlog-settings-source-meta">
                                Last seen{" "}
                                {new Date(status.lastSeenAt).toLocaleString()}
                              </div>
                            </div>

                            <SearchableSelect
                              value={mappedBacklogStatusId}
                              options={backlogStatusOptions}
                              onChange={(nextValue) =>
                                handleMappingChange(status, nextValue)
                              }
                              placeholder={
                                state.backlogStatuses.length > 0
                                  ? "No mapping"
                                  : "Create app statuses first"
                              }
                              clearLabel={
                                state.backlogStatuses.length > 0
                                  ? "No mapping"
                                  : undefined
                              }
                              emptyMessage={
                                state.backlogStatuses.length > 0
                                  ? "No matching app statuses"
                                  : "Create app statuses first"
                              }
                              ariaLabel={`Map ${status.label} to an app backlog status`}
                              disabled={state.backlogStatuses.length === 0}
                              className="backlog-settings-source-select"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </AppPanel>
        </section>
      )}

      {message ? <MessagePanel>{message}</MessagePanel> : null}
      {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}
    </div>
  );
}
