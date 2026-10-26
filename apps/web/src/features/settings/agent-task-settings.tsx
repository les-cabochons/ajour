import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  agentTaskSettingFields,
  type AgentTask,
  type PluginField,
  type PluginFieldValues,
  type SecretFieldSummary,
  type VaultStatusSummary,
} from "@ajour/shared";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { vaultBlockedReason } from "@/features/settings/connection-form";
import {
  areExpiryDraftsValid,
  buildExpiryDrafts,
  expiryForSave,
  secretFieldsKey,
} from "@/features/settings/plugin-form-state";
import { PluginFieldInput } from "@/features/settings/plugin-settings-ui";
import { getPluginsOverview, saveAgentTaskSettings } from "@/lib/app-api";
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
  replaceFieldId,
  vault,
}: {
  pluginId: string;
  tasks: readonly AgentTask[];
  /** The secret setting whose Replace opens at once, as when the Vault sent the user. */
  replaceFieldId?: string;
  vault?: VaultStatusSummary;
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
  // The tasks share their settings, so they share the secrets saved for them.
  const secretFields = statuses[0]?.secretFields ?? [];

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
          // A saved secret replaced, or its state or reminder date changing,
          // starts the form over. Its last use changes with each run and
          // doesn't.
          key={`${pluginId}/${secretFieldsKey(secretFields)}`}
          fields={fields}
          initialValues={sharedValues(statuses, fields)}
          secretFields={secretFields}
          replaceFieldId={replaceFieldId}
          vault={vault}
          onSave={async (values, change) => {
            setError(null);
            try {
              setAgentRunner(
                await saveAgentTaskSettings(
                  pluginId,
                  values,
                  change.removeSecrets,
                  change.secretExpiry,
                ),
              );
              // The Vault page lists these secrets too.
              void getPluginsOverview().catch(() => undefined);
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
  secretFields,
  replaceFieldId,
  vault,
  onSave,
}: {
  fields: readonly PluginField[];
  initialValues: PluginFieldValues;
  secretFields: readonly SecretFieldSummary[];
  replaceFieldId?: string;
  vault?: VaultStatusSummary;
  onSave: (
    values: PluginFieldValues,
    change: {
      removeSecrets?: string[];
      secretExpiry: Record<string, number | null>;
    },
  ) => Promise<void>;
}) {
  const [values, setValues] = useState<PluginFieldValues>(initialValues);
  const secretIds = fields
    .filter((field) => field.secret)
    .map((field) => field.id);
  const [initialExpiry] = useState(() =>
    buildExpiryDrafts(secretIds, secretFields),
  );
  const [expiry, setExpiry] = useState(initialExpiry);
  const blockedReason = vaultBlockedReason(vault);
  const now = Date.now();

  return (
    <AppPanel className="pb-4">
      <form
        className="flex flex-col gap-4"
        aria-label="Task settings"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(values, {
            secretExpiry: expiryForSave(
              expiry,
              initialExpiry,
              secretIds.filter((id) => String(values[id] ?? "").trim() !== ""),
            ),
          });
        }}
      >
        <FieldGroup className="desktop:grid desktop:grid-cols-2 desktop:gap-x-6 desktop:gap-y-5">
          {fields.map((field) => (
            <PluginFieldInput
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={(next) => setValues({ ...values, [field.id]: next })}
              secret={
                field.secret
                  ? {
                      existing: true,
                      summary: secretFields.find(
                        (secret) => secret.id === field.id,
                      ),
                      expiry: expiry[field.id] ?? "",
                      onExpiryChange: (next) =>
                        setExpiry({ ...expiry, [field.id]: next }),
                      // The settings that aren't secret are kept as they are.
                      onRemove: () =>
                        void onSave(
                          Object.fromEntries(
                            Object.entries(initialValues).filter(
                              ([id]) => !secretIds.includes(id),
                            ),
                          ),
                          { removeSecrets: [field.id], secretExpiry: {} },
                        ),
                      startReplacing: replaceFieldId === field.id,
                      blockedReason,
                      now,
                      removeEffect: field.required
                        ? "The agent tasks that need it can't run until you add a new one."
                        : "Ajour deletes it from this computer.",
                    }
                  : undefined
              }
            />
          ))}
        </FieldGroup>
        <Button
          type="submit"
          className="self-start"
          disabled={!areExpiryDraftsValid(expiry)}
        >
          Save
        </Button>
      </form>
    </AppPanel>
  );
}
