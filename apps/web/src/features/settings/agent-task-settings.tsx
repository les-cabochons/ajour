import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  agentTaskSettingFields,
  type AgentTask,
  type PluginField,
  type PluginFieldValues,
} from "@ajour/shared";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { PluginFieldInput } from "@/features/settings/plugin-settings-ui";
import { saveAgentTaskSettings } from "@/lib/app-api";
import {
  refreshAgentRunner,
  setAgentRunner,
  useAgentRunner,
} from "@/lib/agent-runner";

/**
 * The Tasks section of a plugin's settings page: each agent task with what
 * blocks it, then one form for the settings the tasks share by ID. The
 * runner only lists tasks of enabled plugins, so an inactive plugin shows
 * the task names alone.
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
  const fields = agentTaskSettingFields(statuses);

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
      <AppPanel>
        {statuses.length > 0
          ? statuses.map((task) => (
              <SettingRow
                key={task.taskId}
                label={task.label}
                description={<TaskReadiness blockers={task.blockers} />}
              />
            ))
          : tasks.map((task) => (
              <SettingRow key={task.id} label={task.label} />
            ))}
      </AppPanel>
      {fields.length > 0 ? (
        <TaskSettingsForm
          fields={fields}
          initialValues={sharedValues(statuses, fields)}
          onSave={async (values) => {
            setError(null);
            try {
              setAgentRunner(await saveAgentTaskSettings(pluginId, values));
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Unknown error",
              );
            }
          }}
        />
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function TaskReadiness({ blockers }: { blockers: readonly string[] }) {
  if (blockers.length === 0) return <p>Ready to run from the Commit page.</p>;
  return (
    <div>
      <p>This task cannot run yet:</p>
      <ul className="list-disc pl-5">
        {blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    </div>
  );
}

/** Each shared setting's value, from the first task that declares it. */
function sharedValues(
  statuses: readonly AgentTaskStatus[],
  fields: readonly PluginField[],
): PluginFieldValues {
  const values: PluginFieldValues = {};
  for (const field of fields) {
    const task = statuses.find((candidate) =>
      candidate.settings.some((setting) => setting.id === field.id),
    );
    const value = task?.values[field.id];
    if (value !== undefined) values[field.id] = value;
  }
  return values;
}

function TaskSettingsForm({
  fields,
  initialValues,
  onSave,
}: {
  fields: readonly PluginField[];
  initialValues: PluginFieldValues;
  onSave: (values: PluginFieldValues) => Promise<void>;
}) {
  const [values, setValues] = useState<PluginFieldValues>(initialValues);
  return (
    <AppPanel className="pb-4">
      <form
        className="flex flex-col gap-4"
        aria-label="Task settings"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(values);
        }}
      >
        <FieldGroup className="desktop:grid desktop:grid-cols-2 desktop:gap-x-6 desktop:gap-y-5">
          {fields.map((field) => (
            <PluginFieldInput
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
    </AppPanel>
  );
}
