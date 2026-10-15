import { useMemo, useState } from "react";
import type { ConnectorBacklogStatus } from "@ajour/shared";
import {
  RiArrowRightSLine as ChevronRight,
  RiDownloadLine as LoadIcon,
} from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import {
  findWorkflowStateWriteRule,
  getSourceStatesMappedTo,
} from "@/domain/backlog/workflow-states";
import type { LocalAppState } from "@/domain/local-state";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  buildSourceConnectionGroups,
  countUnmappedStates,
  getEffectiveMapping,
  type SourceConnectionGroup,
  type SourceProjectGroup,
} from "@/features/settings/workflow-source-groups";
import {
  getCachedConnectorsOverview,
  listConnectorSettleStates,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";

const INHERIT = "__inherit";

/**
 * Settings > Workflow's source states: for each connection and source
 * project, how its source states map to workflow states and what moving an
 * item into each workflow state writes back.
 */
export function WorkflowSourceMapping({
  state,
  registered,
  onError,
}: {
  state: LocalAppState;
  registered: readonly ConnectorBacklogStatus[];
  onError: (message: string | null) => void;
}) {
  const [loaded, setLoaded] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const groups = useMemo(
    () => buildSourceConnectionGroups(registered, state.workItems, loaded),
    [registered, state.workItems, loaded],
  );

  async function loadStates(project: SourceProjectGroup) {
    setLoading(project.key);
    try {
      const results = await Promise.all(
        project.sampleSourceIds.map((sourceId) =>
          listConnectorSettleStates(
            project.source,
            project.connectionId,
            sourceId,
          ),
        ),
      );
      const states = results.flatMap((result) => result.states);
      localStore.autoMapSourceStates(
        states.map((sourceState) => ({
          source: project.source,
          connectionId: project.connectionId,
          sourceProjectName: project.sourceProjectName,
          label: sourceState.name,
          done: sourceState.done,
        })),
      );
      setLoaded((current) => ({
        ...current,
        [project.key]: states.map((sourceState) => sourceState.name),
      }));
      onError(null);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to load the states.",
      );
    } finally {
      setLoading(null);
    }
  }

  if (groups.length === 0) {
    return (
      <MessagePanel>
        No source states yet. Run a connector sync first.
      </MessagePanel>
    );
  }

  return (
    <div className="backlog-settings-source-groups">
      {groups.map((connection) => (
        <section key={connection.key} className="backlog-settings-source-group">
          <div className="backlog-settings-source-header">
            {connection.tenantLabel ? (
              <div className="backlog-settings-source-kicker">
                {connection.tenantLabel}
              </div>
            ) : null}
            <h3 className="backlog-settings-source-title">
              {connection.connectionLabel}
            </h3>
          </div>

          {connection.projects
            .filter(
              (project) =>
                project.sourceProjectName !== undefined ||
                project.states.length > 0,
            )
            .map((project) => (
              <SourceProjectMapping
                key={project.key}
                state={state}
                project={project}
                canLoad={
                  project.sampleSourceIds.length > 0 &&
                  canListStates(project.source)
                }
                loading={loading === project.key}
                onLoad={() => void loadStates(project)}
                onError={onError}
              />
            ))}
        </section>
      ))}
    </div>
  );
}

function canListStates(source: string) {
  const group = getCachedConnectorsOverview()?.connectionGroups.find(
    (candidate) => candidate.plugin.id === source,
  );
  return Boolean(group?.enabled && group.plugin.capabilities.connector?.settle);
}

function SourceProjectMapping({
  state,
  project,
  canLoad,
  loading,
  onLoad,
  onError,
}: {
  state: LocalAppState;
  project: SourceProjectGroup;
  canLoad: boolean;
  loading: boolean;
  onLoad: () => void;
  onError: (message: string | null) => void;
}) {
  const unmapped = countUnmappedStates(state.workflowStateMappings, project);
  const title = project.sourceProjectName ?? "All source projects";
  // Starts open when something needs mapping, then stays as the user leaves it.
  const [open, setOpen] = useState(unmapped > 0);

  function setMapping(sourceStatusKey: string, label: string, value: string) {
    try {
      const { closedCount, undoToken } = localStore.setWorkflowStateMapping({
        source: project.source,
        connectionId: project.connectionId,
        sourceProjectName: project.sourceProjectName,
        sourceStatusKey,
        sourceStatusLabel: label,
        workflowStateId: value === INHERIT ? undefined : value || null,
      });
      if (undoToken) {
        offerUndo(undoToken, {
          title: `${closedCount} ${closedCount === 1 ? "item" : "items"} closed`,
          subject: "mapping",
        });
      }
      onError(null);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Unable to update the mapping.",
      );
    }
  }

  function setWrite(workflowStateId: string, value: string) {
    localStore.setWorkflowStateWriteRule({
      source: project.source,
      connectionId: project.connectionId,
      sourceProjectName: project.sourceProjectName,
      workflowStateId,
      write:
        value === "ask"
          ? { kind: "ask" }
          : value === "none"
            ? { kind: "none" }
            : value.startsWith("state:")
              ? { kind: "state", sourceStatusLabel: value.slice(6) }
              : undefined,
    });
  }

  return (
    <details
      className="group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="-mx-2 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[var(--hover-bg)] [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="font-medium [overflow-wrap:anywhere] text-foreground">
            {title}
          </span>
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {project.states.length} source{" "}
            {project.states.length === 1 ? "state" : "states"}
            {unmapped > 0 ? ` · ${unmapped} not mapped` : ""}
          </span>
        </span>
        {canLoad ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={loading}
            onClick={(event) => {
              event.preventDefault();
              onLoad();
            }}
          >
            <LoadIcon data-icon="inline-start" />
            {loading ? "Loading…" : "Load all states"}
          </Button>
        ) : null}
      </summary>

      <div className="flex flex-col gap-5 pt-2 pb-3 pl-6">
        {project.states.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No source states seen in this project yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3 desktop:gap-1.5">
            <div className="text-[12px] text-muted-foreground">
              Items in this source state show in
            </div>
            {project.states.map((sourceState) => {
              const effective = getEffectiveMapping(
                state.workflowStateMappings,
                project,
                sourceState.key,
              );
              return (
                <div
                  key={sourceState.key}
                  className="backlog-settings-source-row"
                >
                  <div className="backlog-settings-source-label">
                    {sourceState.label}
                  </div>
                  <OptionSelect
                    label={`Map ${sourceState.label} to a workflow state`}
                    value={
                      effective.inherited
                        ? INHERIT
                        : (effective.workflowStateId ?? "")
                    }
                    onChange={(value) =>
                      setMapping(sourceState.key, sourceState.label, value)
                    }
                    options={[
                      ...(project.sourceProjectName
                        ? [
                            {
                              value: INHERIT,
                              label: effective.inherited
                                ? `Same as all projects (${
                                    state.workflowStates.find(
                                      (workflowState) =>
                                        workflowState._id ===
                                        effective.workflowStateId,
                                    )?.name ?? "No state"
                                  })`
                                : "Same as all projects",
                            },
                          ]
                        : []),
                      { value: "", label: "No state (not mapped)" },
                      ...state.workflowStates.map((workflowState) => ({
                        value: workflowState._id,
                        label: workflowState.name,
                      })),
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}

        <WriteRules state={state} project={project} onChange={setWrite} />
      </div>
    </details>
  );
}

function WriteRules({
  state,
  project,
  onChange,
}: {
  state: LocalAppState;
  project: SourceProjectGroup;
  onChange: (workflowStateId: string, value: string) => void;
}) {
  const rows = state.workflowStates.flatMap((workflowState) => {
    const mapped = getSourceStatesMappedTo(
      state.workflowStateMappings,
      project,
      workflowState._id,
      project.states.map((sourceState) => sourceState.label),
    );
    return mapped.length > 0 ? [{ workflowState, mapped }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 desktop:gap-1.5">
      <div className="text-[12px] text-muted-foreground">
        Moving an item into a workflow state writes
      </div>
      {rows.map(({ workflowState, mapped }) => {
        const rule = findWorkflowStateWriteRule(
          state.workflowStateWriteRules,
          project,
          workflowState._id,
        );
        const own =
          rule &&
          (rule.sourceProjectName ?? "") === (project.sourceProjectName ?? "");
        const value = !own
          ? ""
          : rule.write.kind === "state"
            ? `state:${rule.write.sourceStatusLabel}`
            : rule.write.kind;
        return (
          <div key={workflowState._id} className="backlog-settings-source-row">
            <div className="backlog-settings-source-label">
              {workflowState.name}
            </div>
            <OptionSelect
              label={`What moving an item to ${workflowState.name} writes`}
              value={value}
              onChange={(next) => onChange(workflowState._id, next)}
              options={[
                {
                  value: "",
                  label:
                    project.sourceProjectName && rule && !own
                      ? "Same as all projects"
                      : `${mapped[0]!.label} (default)`,
                },
                ...mapped.map((sourceState) => ({
                  value: `state:${sourceState.label}`,
                  label: sourceState.label,
                })),
                ...(mapped.length > 1 ? [{ value: "ask", label: "Ask" }] : []),
                { value: "none", label: "Don't write" },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}
