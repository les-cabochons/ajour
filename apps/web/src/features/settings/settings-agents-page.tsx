import { useEffect, useState } from "react";
import type { ConnectorFieldValues } from "@ajour/shared";
import type {
  AgentBrowserMode,
  AgentCliId,
  AgentTaskStatus,
} from "@ajour/shared/agent-runs";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { ConnectorFieldInput } from "@/features/settings/connector-settings-ui";
import {
  saveAgentTaskSettings,
  updateAgentRunnerSettings,
} from "@/lib/app-api";
import {
  refreshAgentRunner,
  setAgentRunner,
  useAgentRunner,
} from "@/lib/agent-runner";

/**
 * Settings > Agents: which coding agent Ajour starts for plugin agent tasks,
 * which browser it drives, and each task's settings.
 */
export function SettingsAgentsPage() {
  const state = useAgentRunner();
  const [error, setError] = useState<string | null>(null);

  // The overview loads once per page load, so a CLI or plugin installed since
  // then shows up when this page opens.
  useEffect(() => {
    void refreshAgentRunner();
  }, []);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };

  if (state.kind === "loading") return null;
  if (state.kind === "unavailable") {
    return (
      <p className="settings-section-desc">
        Agents need the Ajour desktop app.
      </p>
    );
  }
  if (state.kind === "error") {
    return <p className="text-sm text-destructive">{state.message}</p>;
  }
  const { settings, clis, tasks } = state.overview;
  const cliOptions = clis
    .filter((cli) => cli.supported)
    .map((cli) => ({
      value: cli.id,
      label: cli.installed
        ? `${cli.label}${cli.version ? ` ${cli.version}` : ""}`
        : `${cli.label} (not installed)`,
      disabled: !cli.installed,
    }));

  const selectedCli = clis.find((cli) => cli.id === settings.cli);
  const noneInstalled = !cliOptions.some((option) => !option.disabled);
  const showInstallHint = noneInstalled || selectedCli?.installed === false;

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Agent</h2>
        <p className="settings-section-desc">
          Plugin tasks, such as entering your week in Workday, run in a coding
          agent you already have. Ajour starts it with its own instructions
          only, and gives it your Ajour data and a browser window.
        </p>
        <AppPanel>
          <SettingRow
            label="Agent"
            labelFor="agent-cli"
            description={
              showInstallHint ? (
                <>
                  Claude Code is not installed. Install it from{" "}
                  <a
                    href="https://claude.com/claude-code"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    claude.com/claude-code
                  </a>
                  , then reopen this page.
                </>
              ) : undefined
            }
            stacked
          >
            <OptionSelect<AgentCliId | "">
              id="agent-cli"
              value={settings.cli ?? ""}
              options={[{ value: "", label: "None" }, ...cliOptions]}
              onChange={(cli) =>
                void run(async () =>
                  setAgentRunner(
                    await updateAgentRunnerSettings({ cli: cli || null }),
                  ),
                )
              }
            />
          </SettingRow>
          <SettingRow
            label="Browser"
            labelFor="agent-browser"
            description={
              settings.browserMode === "my-chrome" ? (
                <>
                  The agent uses your whole Chrome profile, with every site you
                  are signed in to. It needs{" "}
                  <a
                    href="https://github.com/microsoft/playwright/tree/main/packages/extension#readme"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {"Playwright's Chrome extension"}
                  </a>
                  .
                </>
              ) : (
                "Ajour opens Chrome with its own profile. Sign in to your tools there the first time."
              )
            }
            stacked
          >
            <OptionSelect<AgentBrowserMode>
              id="agent-browser"
              value={settings.browserMode}
              options={[
                { value: "ajour-chrome", label: "Ajour's Chrome window" },
                { value: "my-chrome", label: "My Chrome" },
              ]}
              onChange={(browserMode) =>
                void run(async () =>
                  setAgentRunner(
                    await updateAgentRunnerSettings({ browserMode }),
                  ),
                )
              }
            />
          </SettingRow>
          <SettingRow
            label="Model"
            labelFor="agent-model"
            description="Leave empty to use the agent's default model."
          >
            <Input
              id="agent-model"
              defaultValue={settings.model}
              className="w-48"
              onBlur={(event) => {
                const model = event.target.value.trim();
                if (model !== settings.model) {
                  void run(async () =>
                    setAgentRunner(await updateAgentRunnerSettings({ model })),
                  );
                }
              }}
            />
          </SettingRow>
        </AppPanel>
      </section>

      {tasks.map((task) => (
        <TaskSettings
          key={`${task.pluginId}/${task.taskId}`}
          task={task}
          onSave={(values) =>
            run(async () =>
              setAgentRunner(
                await saveAgentTaskSettings(task.pluginId, task.taskId, values),
              ),
            )
          }
        />
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
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
  if (task.settings.length === 0 && task.blockers.length === 0) return null;
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{task.label}</h2>
      <p className="settings-section-desc">
        From the {task.pluginName} plugin.
      </p>
      {task.blockers.length > 0 ? (
        <div className="settings-section-desc">
          <p>This task cannot run yet:</p>
          <ul className="list-disc pl-5">
            {task.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {task.settings.length > 0 ? (
        <AppPanel>
          <form
            className="flex flex-col gap-3 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave(values);
            }}
          >
            {task.settings.map((field) => (
              <ConnectorFieldInput
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(next) => setValues({ ...values, [field.id]: next })}
              />
            ))}
            <Button type="submit" className="self-start">
              Save
            </Button>
          </form>
        </AppPanel>
      ) : null}
    </section>
  );
}
