import { useEffect, useState } from "react";
import {
  RiArrowDownLine as MoveDown,
  RiArrowUpLine as MoveUp,
  RiDeleteBinLine as Trash2,
  RiRefreshLine as RefreshCw,
  RiSaveLine as Save,
} from "@remixicon/react";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { TooltipButton } from "@/components/tooltip-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  getConnectorBacklogStatuses,
  isConnectorApiMissing,
} from "@/lib/app-api";
import { offerUndo } from "@/features/feedback/undo-toast";
import { useRetryWhileConnectorApiMissing } from "@/lib/use-connector-api-retry";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { WorkflowSourceMapping } from "@/features/settings/workflow-source-mapping";

const DEFAULT_NEW_STATE_COLOR = "#64748b";

/**
 * Settings > Workflow: the workflow states in board order, with their Done flag,
 * and how synced source states map onto them.
 */
export function SettingsWorkflowPage() {
  const state = useLocalState();
  const [sourceStatuses, setSourceStatuses] = useState<
    Awaited<ReturnType<typeof getConnectorBacklogStatuses>>["items"]
  >([]);
  const [statusDrafts, setStatusDrafts] = useState<
    Record<string, { name: string; color: string }>
  >({});
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState(DEFAULT_NEW_STATE_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Synced statuses come from connectors, so the web build hides that section.
  const [connectorApiMissing, setConnectorApiMissing] = useState(false);

  useEffect(() => {
    setStatusDrafts((current) => {
      const nextDrafts = { ...current };
      for (const status of state.workflowStates) {
        if (!(status._id in nextDrafts)) {
          nextDrafts[status._id] = {
            name: status.name,
            color: status.color,
          };
        }
      }

      for (const key of Object.keys(nextDrafts)) {
        if (!state.workflowStates.some((status) => status._id === key)) {
          delete nextDrafts[key];
        }
      }

      return nextDrafts;
    });
  }, [state.workflowStates]);

  useEffect(() => {
    void refreshSourceStatuses();
  }, []);

  useRetryWhileConnectorApiMissing(connectorApiMissing, refreshSourceStatuses);
  // Mappings are local, so synced items keep the section without the API.
  const hasSyncedItems = state.workItems.some(
    (workItem) => workItem.source !== "manual",
  );

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
          : "Unable to load source states.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleAddStatus() {
    try {
      localStore.addWorkflowState(newStatusName, newStatusColor);
      setNewStatusName("");
      setNewStatusColor(DEFAULT_NEW_STATE_COLOR);
      setError(null);
      setMessage("Workflow state added.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to add the workflow state.",
      );
    }
  }

  function handleSaveStatus(statusId: string) {
    try {
      localStore.updateWorkflowState(
        statusId,
        statusDrafts[statusId] ?? {
          name: "",
          color: DEFAULT_NEW_STATE_COLOR,
        },
      );
      setError(null);
      setMessage("Workflow state updated.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update the workflow state.",
      );
    }
  }

  function handleDeleteStatus(statusId: string) {
    try {
      offerUndo(localStore.deleteWorkflowState(statusId), {
        title: "Workflow state deleted",
        subject: "workflow state",
      });
      setError(null);
      setMessage(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to delete the workflow state.",
      );
    }
  }

  function handleDoneChange(statusId: string, done: boolean) {
    const status = state.workflowStates.find(
      (candidate) => candidate._id === statusId,
    );
    if (!status) return;
    try {
      localStore.updateWorkflowState(statusId, {
        name: status.name,
        color: status.color,
        done,
      });
      setError(null);
      setMessage(
        done
          ? `${status.name} now closes the items moved into it.`
          : `${status.name} no longer closes items.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update the workflow state.",
      );
    }
  }

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Workflow states</h2>
        <p className="settings-section-desc">
          The steps a backlog item goes through, in board order. Moving an item
          into a done state closes it, and moving it out reopens it.
        </p>

        <AppPanel className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{state.workflowStates.length} workflow states</Badge>
            {connectorApiMissing ? null : (
              <>
                <Badge className="bg-muted">
                  {sourceStatuses.length} source states
                </Badge>
                <Badge className="bg-muted">
                  {state.workflowStateMappings.length} mappings
                </Badge>
              </>
            )}
          </div>

          <div className="backlog-settings-status-create">
            <Input
              value={newStatusName}
              onChange={(event) => setNewStatusName(event.target.value)}
              placeholder="Add a workflow state"
              autoComplete="off"
            />
            <Input
              aria-label="New workflow state color"
              type="color"
              value={newStatusColor}
              onChange={(event) => setNewStatusColor(event.target.value)}
              className="w-14 p-1"
            />
            <Button
              onClick={handleAddStatus}
              disabled={newStatusName.trim().length === 0}
            >
              Add state
            </Button>
          </div>

          {state.workflowStates.length === 0 ? (
            <MessagePanel>
              Add at least one workflow state before mapping source states.
            </MessagePanel>
          ) : (
            <div className="backlog-settings-status-list">
              {state.workflowStates.map((status, index) => (
                <div key={status._id} className="backlog-settings-status-row">
                  <div className="flex items-center">
                    <TooltipButton
                      label={`Move ${status.name} up`}
                      render={
                        <Button type="button" variant="ghost" size="icon-sm" />
                      }
                      disabled={index === 0}
                      onClick={() =>
                        localStore.moveWorkflowState(status._id, -1)
                      }
                    >
                      <MoveUp />
                    </TooltipButton>
                    <TooltipButton
                      label={`Move ${status.name} down`}
                      render={
                        <Button type="button" variant="ghost" size="icon-sm" />
                      }
                      disabled={index === state.workflowStates.length - 1}
                      onClick={() =>
                        localStore.moveWorkflowState(status._id, 1)
                      }
                    >
                      <MoveDown />
                    </TooltipButton>
                  </div>
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
                  <label className="flex h-8 items-center gap-2 text-[13px]">
                    <Checkbox
                      checked={status.done === true}
                      onCheckedChange={(checked) =>
                        handleDoneChange(status._id, checked === true)
                      }
                    />
                    Done
                  </label>
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

      {connectorApiMissing && !hasSyncedItems ? null : (
        <section className="settings-section">
          <h2 className="settings-section-title">Source states</h2>
          <p className="settings-section-desc">
            Syncs find the states items have in their source tool. Map each one
            to the workflow state its items show in.
          </p>

          <AppPanel className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isRefreshing || connectorApiMissing}
                onClick={() => void refreshSourceStatuses()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh source states
              </Button>
            </div>

            <WorkflowSourceMapping
              state={state}
              registered={sourceStatuses}
              onError={setError}
            />
          </AppPanel>
        </section>
      )}

      {message ? <MessagePanel>{message}</MessagePanel> : null}
      {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}
    </div>
  );
}
