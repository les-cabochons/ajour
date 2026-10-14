import { describe, expect, it } from "vitest";
import type { ConnectorPluginManifest } from "../../../packages/shared/connectors.ts";
import { mergeConnectionConfigForSave } from "./connection-values.ts";

const plugin: ConnectorPluginManifest = {
  id: "azure_devops",
  version: "1.0.0",
  apiVersion: 2,
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

describe("mergeConnectionConfigForSave", () => {
  it("preserves an existing secret when edit submissions leave it blank", () => {
    expect(
      mergeConnectionConfigForSave(
        plugin,
        {
          taskIconDisplayMode: "fallback",
          personalAccessToken: "",
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
  });

  it("keeps a newly entered secret when provided", () => {
    expect(
      mergeConnectionConfigForSave(
        plugin,
        {
          personalAccessToken: "new-secret",
          taskIconDisplayMode: "never",
        },
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

  it("leaves create submissions unchanged when there is no existing config", () => {
    expect(
      mergeConnectionConfigForSave(plugin, {
        personalAccessToken: "",
        taskIconDisplayMode: "always",
      }),
    ).toEqual({
      personalAccessToken: "",
      taskIconDisplayMode: "always",
    });
  });
});
