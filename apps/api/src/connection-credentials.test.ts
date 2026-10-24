import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/shared/plugins.ts";
import {
  connectionCredentials,
  editableValues,
  mergeSecretsForSave,
  pluginConnection,
  SecretSaveError,
} from "./connection-credentials.ts";

const plugin: PluginManifest = {
  id: "azure_devops",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Azure DevOps",
  description: "Test plugin",
  iconSvg: "<svg />",
  entrypoint: "plugin.js",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "label",
      label: "Label",
      type: "text",
      required: true,
      secret: false,
    },
    {
      id: "personalAccessToken",
      label: "PAT",
      type: "password",
      required: true,
      secret: true,
    },
    {
      id: "taskIconDisplayMode",
      label: "Task icon",
      type: "select",
      required: true,
      secret: false,
    },
  ],
};

const fields = plugin.connectionFields;

describe("saving a connection's secrets", () => {
  it("keeps the saved secret when the save leaves it empty", () => {
    for (const empty of ["", "   ", undefined]) {
      expect(
        mergeSecretsForSave(
          fields,
          {
            taskIconDisplayMode: "fallback",
            ...(empty === undefined ? {} : { personalAccessToken: empty }),
          },
          {
            personalAccessToken: "persisted-secret",
            taskIconDisplayMode: "always",
          },
        ),
      ).toEqual({
        taskIconDisplayMode: "fallback",
        personalAccessToken: "persisted-secret",
      });
    }
  });

  it("replaces the saved secret with a new value", () => {
    expect(
      mergeSecretsForSave(
        fields,
        { personalAccessToken: "new-secret", taskIconDisplayMode: "never" },
        {
          personalAccessToken: "persisted-secret",
          taskIconDisplayMode: "always",
        },
      ),
    ).toEqual({
      personalAccessToken: "new-secret",
      taskIconDisplayMode: "never",
    });
  });

  it("deletes a saved secret the save asks to remove", () => {
    expect(
      mergeSecretsForSave(
        fields,
        { personalAccessToken: "", taskIconDisplayMode: "never" },
        {
          personalAccessToken: "persisted-secret",
          taskIconDisplayMode: "always",
        },
        ["personalAccessToken"],
      ),
    ).toEqual({ taskIconDisplayMode: "never" });
  });

  it("refuses to remove a field that isn't secret, or one the save also replaces", () => {
    const existing = { personalAccessToken: "persisted-secret" };
    expect(() =>
      mergeSecretsForSave(fields, {}, existing, ["taskIconDisplayMode"]),
    ).toThrow(SecretSaveError);
    expect(() =>
      mergeSecretsForSave(fields, {}, existing, ["unknown"]),
    ).toThrow(SecretSaveError);
    let refusal: unknown;
    try {
      mergeSecretsForSave(
        fields,
        { personalAccessToken: "new-secret" },
        existing,
        ["personalAccessToken"],
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(SecretSaveError);
    // The refusal names the field, never a value.
    expect(String((refusal as Error).message)).not.toContain("new-secret");
    expect(String((refusal as Error).message)).toContain("personalAccessToken");
  });

  it("leaves a new connection's values as they were submitted", () => {
    expect(
      mergeSecretsForSave(fields, {
        personalAccessToken: "",
        taskIconDisplayMode: "always",
      }),
    ).toEqual({
      personalAccessToken: "",
      taskIconDisplayMode: "always",
    });
  });
});

describe("a connection's editable values", () => {
  it("holds the declared fields that aren't secret, and no stored key the manifest dropped", () => {
    expect(
      editableValues(fields, {
        personalAccessToken: "persisted-secret",
        taskIconDisplayMode: "always",
        droppedKey: "old-value",
      }),
    ).toEqual({ taskIconDisplayMode: "always" });
  });
});

describe("a connection's credentials for one request", () => {
  it("collects every config's secrets, a dropped field's included, and redacts a plugin error with them", () => {
    const credentials = connectionCredentials(
      plugin,
      { personalAccessToken: "submitted-pat" },
      {
        personalAccessToken: "stored-pat",
        oldToken: "old-pat",
        label: "Main",
        taskIconDisplayMode: "always",
      },
    );
    expect([...credentials.secrets].sort()).toEqual([
      "old-pat",
      "stored-pat",
      "submitted-pat",
    ]);
    expect(
      credentials.errorMessage(
        new Error("submitted-pat, stored-pat and old-pat failed for Main."),
      ),
    ).toBe("[secret], [secret] and [secret] failed for Main.");
    expect(credentials.redaction.text("Bearer stored-pat")).toBe(
      "Bearer [secret]",
    );
  });
});

describe("the connection a plugin receives", () => {
  it("carries the plugin's config and Ajour's own fields, not its other settings", () => {
    // A saved connection as storage keeps it.
    const saved = {
      id: "c1",
      pluginId: "azure_devops",
      label: "Main",
      tenantLabel: "Contoso",
      autoSync: true,
      autoSyncIntervalMinutes: 15,
      pullRequestAutoSync: false,
      agentAccess: "read",
      allowLossyConversion: true,
      config: { personalAccessToken: "persisted-secret" },
      configSummary: { site: "Contoso" },
      connectedAt: 1,
      lastSyncAt: 2,
      lastError: "Failed",
      lastErrorAt: 3,
    };
    expect(pluginConnection(saved)).toEqual({
      id: "c1",
      pluginId: "azure_devops",
      label: "Main",
      tenantLabel: "Contoso",
      autoSync: true,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      lastSyncAt: 2,
      lastError: "Failed",
      config: { personalAccessToken: "persisted-secret" },
    });
  });
});
