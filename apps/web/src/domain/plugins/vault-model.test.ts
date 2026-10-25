import { describe, expect, it } from "vitest";
import type {
  PluginConnectionSummary,
  PluginOverviewGroup,
} from "@ajour/shared";
import { connectionStatus } from "./connection-status";
import { buildVaultGroups, vaultNotice } from "./vault-model";

const NOW = new Date(2026, 9, 25, 10, 0, 0).getTime();

function basePlugin(id: string, name: string) {
  return {
    id,
    displayName: name,
    version: "1.0.0",
    apiVersion: 3,
    iconSvg: "<svg />",
    capabilities: { connector: {} },
    connectionFields: [
      { id: "token", label: "Personal access token", type: "password" },
    ],
  };
}

function group(
  id: string,
  name: string,
  parts: Partial<PluginOverviewGroup> = {},
): PluginOverviewGroup {
  return {
    plugin: basePlugin(id, name),
    enabled: true,
    connections: [],
    ...parts,
  } as PluginOverviewGroup;
}

function connection(id: string, label: string, secretFields: object[]) {
  return { id, label, secretFields } as unknown as PluginConnectionSummary;
}

describe("buildVaultGroups", () => {
  it("groups secrets by plugin, and puts plugins that are not installed last", () => {
    const groups = buildVaultGroups(
      {
        connectionGroups: [
          group("jira", "Jira", {
            missing: true,
            connections: [
              connection("acme", "Acme", [{ id: "apiToken", state: "saved" }]),
            ],
          }),
          group("azure", "Azure DevOps", {
            connections: [
              connection("contoso", "Contoso", [
                {
                  id: "token",
                  state: "saved",
                  lastUsedAt: NOW - 2 * 3_600_000,
                },
              ]),
              connection("fabrikam", "Fabrikam", [
                { id: "token", state: "rejected" },
              ]),
            ],
          }),
          group("notes", "Notes", {
            connections: [connection("n", "Notes", [])],
          }),
          group("calendar", "Calendar (ICS)", {
            connections: [
              connection("work", "Work calendar", [
                { id: "token", state: "saved" },
              ]),
            ],
          }),
        ],
      },
      NOW,
    );

    expect(groups.map((entry) => entry.title)).toEqual([
      "Azure DevOps",
      "Calendar (ICS)",
      "Jira (not installed)",
    ]);
    expect(groups[0]!.rows).toMatchObject([
      {
        owner: "Contoso",
        kind: "Personal access token",
        lastUsed: "Last used 2 hours ago",
        state: { label: "Saved" },
        replace: { type: "connection", connectionId: "contoso" },
      },
      { owner: "Fabrikam", state: { label: "Token rejected" } },
    ]);
  });

  it("gives a missing plugin's rows no Replace, since only Remove clears them", () => {
    const [missing] = buildVaultGroups(
      {
        connectionGroups: [
          group("jira", "Jira", {
            missing: true,
            connections: [
              {
                ...connection("acme", "Acme", []),
                sealedConfig: { state: "saved" },
              },
            ],
          }),
        ],
      },
      NOW,
    );

    expect(missing!.rows).toMatchObject([
      { owner: "Acme", kind: "Saved settings and secrets" },
    ]);
    expect(missing!.rows[0]).not.toHaveProperty("replace");
  });

  it("lists agent task secrets under their plugin", () => {
    const [entry] = buildVaultGroups(
      {
        connectionGroups: [
          group("workday", "Workday", {
            plugin: {
              ...basePlugin("workday", "Workday"),
              capabilities: {
                agentTask: {
                  tasks: [
                    {
                      id: "enter",
                      label: "Enter",
                      placement: "commit-week",
                      prompt: "p.md",
                      estimateMinutes: 5,
                      settings: [
                        {
                          id: "apiKey",
                          label: "API key",
                          type: "password",
                          secret: true,
                        },
                      ],
                    },
                  ],
                },
              },
            } as never,
            agentTaskSecretFields: [{ id: "apiKey", state: "unreadable" }],
          }),
        ],
      },
      NOW,
    );

    expect(entry!.rows).toMatchObject([
      {
        owner: "Agent tasks",
        kind: "API key",
        state: { label: "Can't be read on this computer" },
        replace: { type: "agentTask", pluginId: "workday", fieldId: "apiKey" },
      },
    ]);
  });
});

describe("vaultNotice", () => {
  it("says nothing while the vault works", () => {
    expect(vaultNotice({ state: "available" })).toBeNull();
    expect(vaultNotice(undefined)).toBeNull();
  });

  it("offers Try again when encryption is unavailable, with the reason", () => {
    expect(
      vaultNotice({ state: "unavailable", reason: "No keyring (basic_text)." }),
    ).toMatchObject({
      title: "Ajour can't protect credentials on this computer",
      body: expect.stringContaining("No keyring (basic_text)."),
      retry: true,
    });
  });

  it("explains saved secrets that can't be read, without Try again", () => {
    expect(vaultNotice({ state: "unreadable" })).toMatchObject({
      title: "Saved secrets can't be read on this computer",
      retry: false,
    });
  });
});

describe("connectionStatus", () => {
  const base = {
    pluginName: "Azure DevOps",
    unavailable: false,
    inactive: false,
  };

  it("shows Token rejected with sync paused, in place of Error", () => {
    expect(
      connectionStatus({
        ...base,
        connection: {
          lastError: "Azure DevOps answered 401.",
          paused: { reason: "secret_rejected", message: "…" },
        },
      }),
    ).toMatchObject({
      label: "Token rejected",
      tone: "danger",
      note: "Azure DevOps refused the token. Sync is paused. Edit the connection to replace it.",
      needsSecret: true,
    });
  });

  it("shows a secret that can't be read, and a removed one", () => {
    expect(
      connectionStatus({
        ...base,
        connection: {
          paused: { reason: "secret_unreadable", message: "…" },
        },
      }),
    ).toMatchObject({ label: "Can't be read on this computer" });
    expect(
      connectionStatus({
        ...base,
        connection: { paused: { reason: "secret_removed", message: "…" } },
      }),
    ).toMatchObject({ label: "Paused", needsSecret: true });
  });

  it("keeps Error for a failure that isn't a refused token, and Connected otherwise", () => {
    expect(
      connectionStatus({ ...base, connection: { lastError: "Timeout." } }),
    ).toMatchObject({ label: "Error", tone: "danger" });
    expect(connectionStatus({ ...base, connection: {} })).toMatchObject({
      label: "Connected",
    });
  });

  it("puts a plugin that is off or unavailable before the secret", () => {
    const paused = { reason: "secret_rejected", message: "…" } as const;
    expect(
      connectionStatus({ ...base, inactive: true, connection: { paused } }),
    ).toMatchObject({ label: "Paused" });
    expect(
      connectionStatus({ ...base, unavailable: true, connection: { paused } }),
    ).toMatchObject({ label: "Unavailable" });
  });
});
