import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorPluginManifestSchema,
  connectorSettleWriteRequestSchema,
  connectorSettleWriteResultSchema,
  pluginHasAgentTasks,
  pluginHasCodeHost,
  pluginHasConnector,
} from "../connectors";

const validManifest = {
  id: "example_connector",
  version: "1.2.3",
  apiVersion: CONNECTOR_PLUGIN_API_VERSION,
  displayName: "Example connector",
  iconSvg: "<svg viewBox='0 0 16 16' />",
  entrypoint: "dist/plugin.js",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "endpoint",
      label: "Endpoint",
      type: "url",
      required: true,
    },
  ],
};

describe("connector plugin manifest", () => {
  it("accepts a versioned installable connector contract", () => {
    expect(connectorPluginManifestSchema.parse(validManifest)).toMatchObject({
      id: "example_connector",
      version: "1.2.3",
      apiVersion: CONNECTOR_PLUGIN_API_VERSION,
    });
  });

  it("rejects identifiers that could create nested install paths", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        id: "../outside",
      }),
    ).toThrow();
  });

  it("rejects manifests without a semantic version", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        version: "latest",
      }),
    ).toThrow();
  });

  it("rejects manifests that declare no capability", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        capabilities: {},
      }),
    ).toThrow("at least one capability");
  });

  it("accepts a plugin that is both a connector and a code host", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: { settle: true }, codeHost: {} },
    });
    expect(pluginHasConnector(manifest)).toBe(true);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });

  it("accepts a code host without the connector capability", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { codeHost: {} },
    });
    expect(pluginHasConnector(manifest)).toBe(false);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });

  it("carries priority as an Ajour level, never a source value", () => {
    expect(
      connectorSettleWriteRequestSchema.parse({
        sourceId: "42",
        priority: "high",
      }).priority,
    ).toBe("high");
    expect(() =>
      connectorSettleWriteRequestSchema.parse({ sourceId: "42", priority: 2 }),
    ).toThrow();
    expect(() =>
      connectorSettleWriteResultSchema.parse({ priority: 25 }),
    ).toThrow();
  });
});

const agentTaskBase = {
  id: "ajp-workday",
  version: "1.0.0",
  apiVersion: CONNECTOR_PLUGIN_API_VERSION,
  displayName: "Workday",
  iconSvg: "<svg/>",
};
const agentTask = {
  id: "enter-week",
  label: "Enter in Workday",
  placement: "submit-week",
  prompt: "prompts/enter-week.md",
  estimateMinutes: 10,
  weekLink: "{{settings.timesheetUrl}}?date={{weekOf}}",
  settings: [
    {
      id: "timesheetUrl",
      label: "Workday timesheet URL",
      type: "url",
      required: true,
    },
  ],
};

describe("plugin manifest capabilities", () => {
  it("accepts a plugin with only agent tasks, without entrypoint or connection fields", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: { agentTask: { tasks: [agentTask] } },
    });
    expect(manifest.entrypoint).toBeUndefined();
    expect(manifest.connectionFields).toEqual([]);
    expect(pluginHasAgentTasks(manifest)).toBe(true);
  });

  it("still requires an entrypoint and connection fields for a connector", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: { connector: {} },
      }),
    ).toThrow(/entrypoint/);
  });

  it("refuses a week link slot that is not known", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {
          agentTask: {
            tasks: [{ ...agentTask, weekLink: "{{settings.nope}}" }],
          },
        },
      }),
    ).toThrow(/settings.nope/);
  });

  it("refuses a plugin with no capability", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {},
      }),
    ).toThrow();
  });
});
