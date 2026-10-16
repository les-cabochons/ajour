import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorPluginManifestSchema,
  connectorSettleWriteRequestSchema,
  connectorSettleWriteResultSchema,
  isCapabilityActive,
  pluginHasAgentTasks,
  pluginHasSwitchableCapabilities,
  syncsPullRequestsAutomatically,
  pluginHasProjectProperties,
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

  it("keeps the capability a connection field configures", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: {}, codeHost: {} },
      connectionFields: [
        ...validManifest.connectionFields,
        {
          id: "hideDrafts",
          label: "Hide drafts",
          type: "checkbox",
          capability: "codeHost",
        },
      ],
    });
    expect(manifest.connectionFields.at(-1)?.capability).toBe("codeHost");
    expect(pluginHasSwitchableCapabilities(manifest)).toBe(true);
  });

  it("reads a capability as active only while the plugin is on and the capability is not off", () => {
    const plugin = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: {}, codeHost: {} },
    });
    expect(isCapabilityActive({ plugin, enabled: true }, "codeHost")).toBe(
      true,
    );
    expect(
      isCapabilityActive(
        { plugin, enabled: true, inactiveCapabilities: ["codeHost"] },
        "codeHost",
      ),
    ).toBe(false);
    expect(
      isCapabilityActive(
        { plugin, enabled: true, inactiveCapabilities: ["codeHost"] },
        "connector",
      ),
    ).toBe(true);
    expect(isCapabilityActive({ plugin, enabled: false }, "connector")).toBe(
      false,
    );
    expect(
      isCapabilityActive(
        {
          plugin: { ...plugin, capabilities: { codeHost: {} } },
          enabled: true,
        },
        "connector",
      ),
    ).toBe(false);
  });

  it("lets pull requests follow auto sync until the connection saves their own setting", () => {
    expect(syncsPullRequestsAutomatically({ autoSync: false })).toBe(false);
    expect(syncsPullRequestsAutomatically({ autoSync: true })).toBe(true);
    expect(
      syncsPullRequestsAutomatically({
        autoSync: true,
        pullRequestAutoSync: false,
      }),
    ).toBe(false);
    expect(
      syncsPullRequestsAutomatically({
        autoSync: false,
        pullRequestAutoSync: true,
      }),
    ).toBe(true);
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
  placement: "commit-week",
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
  it("refuses the old submit-week placement", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {
          agentTask: { tasks: [{ ...agentTask, placement: "submit-week" }] },
        },
      }),
    ).toThrow(/placement/);
  });

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

  const projectProperties = {
    section: "Workday",
    fields: [
      { id: "name", label: "Workday name", defaultFrom: "fullName" },
      { id: "code", label: "Workday code", defaultFrom: "code" },
    ],
  };

  it("accepts a plugin with only project properties", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: { projectProperties },
    });
    expect(pluginHasProjectProperties(manifest)).toBe(true);
    expect(manifest.entrypoint).toBeUndefined();
  });

  it("refuses two project property fields with the same id", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {
          projectProperties: {
            ...projectProperties,
            fields: [projectProperties.fields[0], projectProperties.fields[0]],
          },
        },
      }),
    ).toThrow(/name/);
  });

  it("refuses a default from an unknown project value", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {
          projectProperties: {
            ...projectProperties,
            fields: [
              { id: "name", label: "Workday name", defaultFrom: "color" },
            ],
          },
        },
      }),
    ).toThrow();
  });
});
