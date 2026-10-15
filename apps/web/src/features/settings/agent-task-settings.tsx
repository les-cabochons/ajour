import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AgentTask, ConnectorFieldValues } from "@ajour/shared";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { ConnectorFieldInput } from "@/features/settings/connector-settings-ui";
import { saveAgentTaskSettings } from "@/lib/app-api";
import {
  refreshAgentRunner,
  setAgentRunner,
  useAgentRunner,
} from "@/lib/agent-runner";

/**
 * The Tasks section of a plugin's settings page: each agent task with what
 * blocks it and its settings form. The runner only lists tasks of enabled
 * plugins, so an inactive plugin shows the task names alone.
 */
export function PluginAgentTasks({
  pluginId,
  tasks,
}: {
  pluginId: string;
  tasks: readonly AgentTask[];
}) {
  const state = useAgentRunner();
  const [error, setError] = useState<string | null>(null);

  // A plugin installed or activated since the last load shows its tasks.
  useEffect(() => {
    void refreshAgentRunner();
  }, [pluginId]);

  const statuses =
    state.kind === "ready"
      ? state.overview.tasks.filter((task) => task.pluginId === pluginId)
      : [];

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Tasks</h2>
      <p className="settings-section-desc">
        An agent runs these tasks from a prompt. Pick the agent in{" "}
        <Link to="/settings/agents" className="underline">
          Settings &gt; Agents
        </Link>
        .
      </p>
      {statuses.length > 0 ? (
        statuses.map((task) => (
          <TaskSettings
            key={task.taskId}
            task={task}
            onSave={async (values) => {
              setError(null);
              try {
                setAgentRunner(
                  await saveAgentTaskSettings(pluginId, task.taskId, values),
                );
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Unknown error",
                );
              }
            }}
          />
        ))
      ) : (
        <AppPanel>
          {tasks.map((task) => (
            <SettingRow key={task.id} label={task.label} />
          ))}
        </AppPanel>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function TaskSettings({
  task,
  onSave,
}: {
  task: AgentTaskStatus;
  onSave: (values: ConnectorFieldValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ConnectorFieldValues>(task.values);
  return (
    <AppPanel className="pb-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{task.label}</h3>
        {task.blockers.length > 0 ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            <p>This task cannot run yet:</p>
            <ul className="list-disc pl-5">
              {task.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Ready to run from the Commit page.
          </p>
        )}
      </div>
      {task.settings.length > 0 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(values);
          }}
        >
          <FieldGroup className="desktop:grid desktop:grid-cols-2 desktop:gap-x-6 desktop:gap-y-5">
            {task.settings.map((field) => (
              <ConnectorFieldInput
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(next) => setValues({ ...values, [field.id]: next })}
              />
            ))}
          </FieldGroup>
          <Button type="submit" className="self-start">
            Save
          </Button>
        </form>
      ) : null}
    </AppPanel>
  );
}
