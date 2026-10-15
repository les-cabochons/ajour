import { useEffect, useMemo, useState } from "react";
import type { ConnectorSettleState } from "@ajour/shared";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { OptionSelect } from "@/components/ui/option-select";
import { PRIORITY_LEVELS } from "@/domain/backlog/priority";
import {
  listSettleRuleSourceProjects,
  type SettleRuleSourceProject,
} from "@/domain/backlog/settle-rules";
import type { LocalSettleRule, LocalWorkItem } from "@/domain/local-state";
import { canWriteSettle } from "@/features/backlog/backlog-source-writes";
import {
  formatPriorityInput,
  parsePriorityInput,
} from "@/features/backlog/backlog-task-editor";
import {
  findSettleState,
  groupSettleStates,
} from "@/features/backlog/settle-draft";

import {
  getCachedConnectorsOverview,
  listConnectorSettleStates,
  subscribeConnectorsOverview,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";

/**
 * Settings > Backlog: the settle rule of each source project seen in syncs,
 * for connectors that can write a settle. Ask opens the settle dialog. Apply
 * settles at once with a fixed state, priority or both.
 */
export function SettleRulesSection({
  workItems,
  settleRules,
}: {
  workItems: readonly LocalWorkItem[];
  settleRules: readonly LocalSettleRule[] | undefined;
}) {
  // Re-render when the connector list changes, since it decides who can settle.
  const [, setOverviewRevision] = useState(0);
  useEffect(
    () =>
      subscribeConnectorsOverview(() =>
        setOverviewRevision((revision) => revision + 1),
      ),
    [],
  );
  const overview = getCachedConnectorsOverview();

  const groups = useMemo(() => {
    const byConnection = new Map<string, SettleRuleSourceProject[]>();
    for (const project of listSettleRuleSourceProjects(workItems)) {
      const sample = workItems.find(
        (workItem) =>
          workItem.source === project.source &&
          workItem.sourceId === project.sampleSourceId,
      );
      if (!sample || !canWriteSettle(sample)) continue;
      const key = `${project.source}:${project.connectionId}`;
      byConnection.set(key, [...(byConnection.get(key) ?? []), project]);
    }
    return Array.from(byConnection.entries());
    // `overview` decides `canWriteSettle`.
  }, [workItems, overview]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Settle rules</h2>
      <p className="settings-section-desc">
        Choose what Settle does for each source project. Ask opens the settle
        dialog. Apply settles at once with the state and priority set here, and
        Shift+E still opens the dialog.
      </p>

      <AppPanel>
        {groups.length === 0 ? (
          <MessagePanel>
            No source projects yet. Sync a connector that can settle items
            first.
          </MessagePanel>
        ) : (
          <div className="backlog-settings-source-groups">
            {groups.map(([key, projects]) => (
              <section key={key} className="backlog-settings-source-group">
                <div className="backlog-settings-source-header">
                  <h3 className="backlog-settings-source-title">
                    {projects[0]?.connectionLabel}
                  </h3>
                </div>
                <div className="backlog-settings-source-list">
                  {projects.map((project) => (
                    <SettleRuleRow
                      key={project.sourceProjectName}
                      project={project}
                      rule={settleRules?.find(
                        (rule) =>
                          rule.source === project.source &&
                          rule.connectionId === project.connectionId &&
                          rule.sourceProjectName === project.sourceProjectName,
                      )}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </AppPanel>
    </section>
  );
}

type StatesLoad =
  | { status: "idle" | "loading" }
  | { status: "ready"; states: ConnectorSettleState[] }
  | { status: "failed"; message: string };

function SettleRuleRow({
  project,
  rule,
}: {
  project: SettleRuleSourceProject;
  rule: LocalSettleRule | undefined;
}) {
  const [load, setLoad] = useState<StatesLoad>({ status: "idle" });
  const applies = Boolean(rule);
  const key = {
    source: project.source,
    connectionId: project.connectionId,
    sourceProjectName: project.sourceProjectName,
  };

  useEffect(() => {
    if (!applies || load.status !== "idle") return;
    setLoad({ status: "loading" });
    listConnectorSettleStates(
      project.source,
      project.connectionId,
      project.sampleSourceId,
    ).then(
      (result) => setLoad({ status: "ready", states: result.states }),
      (error: unknown) =>
        setLoad({
          status: "failed",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
    );
  }, [applies, load.status, project]);

  const states = load.status === "ready" ? load.states : [];

  function save(next: Partial<Pick<LocalSettleRule, "state" | "priority">>) {
    localStore.applySettleRule({
      ...key,
      state: rule?.state,
      priority: rule?.priority,
      ...next,
    });
  }

  const label = `Settle rule for ${project.sourceProjectName}`;
  return (
    <div className="backlog-settings-source-row">
      <div className="backlog-settings-source-label">
        {project.sourceProjectName}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <OptionSelect
          label={label}
          className="w-auto"
          value={applies ? "apply" : "ask"}
          onChange={(mode) =>
            mode === "apply" ? save({}) : localStore.askSettleRule(key)
          }
          options={[
            { value: "ask", label: "Ask" },
            { value: "apply", label: "Apply" },
          ]}
        />
        {applies ? (
          <>
            <OptionSelect
              label={`State for ${project.sourceProjectName}`}
              className="w-auto"
              value={rule?.state?.name ?? ""}
              disabled={load.status !== "ready"}
              onChange={(name) => {
                const state = findSettleState(states, name);
                save({
                  state: state
                    ? { name: state.name, done: state.done }
                    : undefined,
                });
              }}
              options={[
                {
                  value: "",
                  label:
                    load.status === "loading"
                      ? "Loading states…"
                      : "Keep the state",
                },
                ...(rule?.state && !findSettleState(states, rule.state.name)
                  ? [{ value: rule.state.name, label: rule.state.name }]
                  : []),
              ]}
              groups={groupSettleStates(states).map((group) => ({
                label: group.category,
                options: group.states.map((state) => ({
                  value: state.name,
                  label: state.name,
                })),
              }))}
            />
            <OptionSelect
              label={`Priority for ${project.sourceProjectName}`}
              className="w-auto"
              value={formatPriorityInput(rule?.priority)}
              onChange={(value) =>
                save({ priority: parsePriorityInput(value) ?? undefined })
              }
              options={[
                { value: "", label: "Keep the priority" },
                ...PRIORITY_LEVELS.map(({ level, name }) => ({
                  value: String(level),
                  label: name,
                })),
              ]}
            />
          </>
        ) : null}
      </div>
      {load.status === "failed" ? (
        <p className="text-[13px] text-destructive desktop:col-span-2">
          Couldn't load states: {load.message}
        </p>
      ) : null}
    </div>
  );
}
