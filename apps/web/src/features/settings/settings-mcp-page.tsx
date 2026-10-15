import { useState } from "react";
import type { McpClientCreateResponse } from "@ajour/shared/agent-tools";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createMcpClient,
  getAppApiBaseUrl,
  revokeMcpClient,
  updateMcpSettings,
} from "@/lib/app-api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { setMcpSettings, useMcpSettings } from "@/lib/mcp-settings";

/** Config snippets for a new client. The token appears only here, once. */
function clientCommands(token: string) {
  const url = `${getAppApiBaseUrl()}/mcp/ajour`;
  return {
    // User scope, so every Claude Code project sees Ajour. The default local scope ties it to one folder.
    claudeCode: `claude mcp add --scope user --transport http ajour ${url} --header "Authorization: Bearer ${token}"`,
    codex: [
      "[mcp_servers.ajour]",
      `url = "${url}"`,
      `http_headers = { Authorization = "Bearer ${token}" }`,
    ].join("\n"),
  };
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyTextToClipboard(value)}
        >
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-muted p-2 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

export function SettingsMcpPage() {
  const state = useMcpSettings();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<McpClientCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.kind === "loading") return null;
  if (state.kind !== "ready") {
    return (
      <div className="settings-sections">
        <p className="settings-section-desc">
          {state.kind === "unavailable"
            ? "MCP needs the Ajour desktop app or the local API."
            : state.message}
        </p>
      </div>
    );
  }

  const { settings } = state;
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">MCP</h2>
        <p className="settings-section-desc">
          Agents such as Claude Code and Codex can read and change your time
          entries, timers and backlog through MCP. Their model provider receives
          that data, notes included. Each agent needs its own client below.
        </p>
        <AppPanel>
          <SettingRow
            label="Allow agents"
            labelFor="mcp-enabled"
            description="Off by default. Turning it off disconnects every agent."
          >
            <Switch
              id="mcp-enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                void run(async () =>
                  setMcpSettings(await updateMcpSettings(checked)),
                )
              }
            />
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Clients</h2>
        <p className="settings-section-desc">
          One client per agent, so you can revoke one without the others.
        </p>
        <AppPanel>
          {settings.clients.map((client) => (
            <SettingRow
              key={client.id}
              label={client.name}
              description={
                client.lastUsedAt
                  ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}`
                  : "Not used yet"
              }
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    setMcpSettings(await revokeMcpClient(client.id));
                    if (created?.client.id === client.id) setCreated(null);
                  })
                }
              >
                Revoke
              </Button>
            </SettingRow>
          ))}
          <form
            className="flex items-end gap-2 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              void run(async () => {
                const response = await createMcpClient(trimmed);
                setCreated(response);
                setName("");
                setMcpSettings({
                  ...settings,
                  clients: [...settings.clients, response.client],
                });
              });
            }}
          >
            <Field className="flex-1">
              <FieldLabel htmlFor="mcp-client-name">Client name</FieldLabel>
              <Input
                id="mcp-client-name"
                value={name}
                placeholder="Claude Code on this Mac"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!name.trim()}>
              Add client
            </Button>
          </form>
        </AppPanel>

        {created ? (
          <AppPanel>
            <div className="flex flex-col gap-3 p-3">
              <p className="text-sm">
                Copy the token for {created.client.name} now. Ajour shows it
                only once.
              </p>
              <CopyBlock label="Token" value={created.token} />
              <CopyBlock
                label="Claude Code"
                value={clientCommands(created.token).claudeCode}
              />
              <CopyBlock
                label="Codex (~/.codex/config.toml)"
                value={clientCommands(created.token).codex}
              />
            </div>
          </AppPanel>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>
    </div>
  );
}
