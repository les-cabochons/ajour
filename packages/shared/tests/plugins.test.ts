import { describe, expect, it } from "vitest";
import {
  PLUGIN_API_VERSION,
  pluginManifestSchema,
  backlogSettleWriteRequestSchema,
  backlogSettleWriteResultSchema,
  isCapabilityActive,
  pluginHasAgentTasks,
  pluginHasSwitchableCapabilities,
  syncsPullRequestsAutomatically,
  pluginHasProjectProperties,
  pluginHasCalendar,
  pluginHasCodeHost,
  pluginHasBacklog,
  pluginRunsCode,
} from "../plugins";

const validManifest = {
  id: "example_connector",
  version: "1.2.3",
  apiVersion: PLUGIN_API_VERSION,
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

describe("plugin manifest", () => {
  it("accepts a versioned installable backlog plugin contract", () => {
    expect(pluginManifestSchema.parse(validManifest)).toMatchObject({
      id: "example_connector",
      version: "1.2.3",
      apiVersion: PLUGIN_API_VERSION,
    });
  });

  it("rejects identifiers that could create nested install paths", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        id: "../outside",
      }),
    ).toThrow();
  });

  it("rejects manifests without a semantic version", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        version: "latest",
      }),
    ).toThrow();
  });

  it("rejects manifests that declare no capability", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        capabilities: {},
      }),
    ).toThrow("at least one capability");
  });

  it("accepts a plugin that is both a backlog plugin and a code host", () => {
    const manifest = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: { settle: true }, codeHost: {} },
    });
    expect(pluginHasBacklog(manifest)).toBe(true);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });

  it("keeps the comment features a backlog plugin declares", () => {
    const manifest = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: {
        connector: {
          comments: {
            edit: true,
            delete: true,
            reactions: ["like", "heart"],
            mentions: true,
            maxLength: 32_767,
          },
        },
      },
    });
    expect(manifest.capabilities.connector?.comments).toEqual({
      edit: true,
      delete: true,
      reactions: ["like", "heart"],
      mentions: true,
      maxLength: 32_767,
    });
  });

  it("rejects a reaction outside Ajour's names", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        capabilities: { connector: { comments: { reactions: ["fire"] } } },
      }),
    ).toThrow();
  });

  it("keeps the capability a connection field configures", () => {
    const manifest = pluginManifestSchema.parse({
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

  it("gives a plugin with backlog items and a calendar a switch for each", () => {
    const both = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: {}, calendar: {} },
    });
    const calendarOnly = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: { calendar: {} },
    });
    expect(pluginHasSwitchableCapabilities(both)).toBe(true);
    expect(pluginHasSwitchableCapabilities(calendarOnly)).toBe(false);
  });

  it("reads a capability as active only while the plugin is on and the capability is not off", () => {
    const plugin = pluginManifestSchema.parse({
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

  it("accepts a code host without the backlog capability", () => {
    const manifest = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: { codeHost: {} },
    });
    expect(pluginHasBacklog(manifest)).toBe(false);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });

  it("accepts a calendar without the backlog capability", () => {
    const manifest = pluginManifestSchema.parse({
      ...validManifest,
      capabilities: { calendar: {} },
    });
    expect(pluginHasBacklog(manifest)).toBe(false);
    expect(pluginHasCalendar(manifest)).toBe(true);
    expect(pluginRunsCode(manifest)).toBe(true);
  });

  it("requires an entrypoint and connection fields for a calendar", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        entrypoint: undefined,
        capabilities: { calendar: {} },
      }),
    ).toThrow(/entrypoint/);
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        connectionFields: [],
        capabilities: { calendar: {} },
      }),
    ).toThrow(/connection fields/);
  });

  it("carries priority as an Ajour level, never a source value", () => {
    expect(
      backlogSettleWriteRequestSchema.parse({
        sourceId: "42",
        priority: "high",
      }).priority,
    ).toBe("high");
    expect(() =>
      backlogSettleWriteRequestSchema.parse({ sourceId: "42", priority: 2 }),
    ).toThrow();
    expect(() =>
      backlogSettleWriteResultSchema.parse({ priority: 25 }),
    ).toThrow();
  });
});

const agentTaskBase = {
  id: "ajp-workday",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
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
  it("places a task next to Mark as committed or in place of Submit week", () => {
    const parse = (placement: string) =>
      pluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: { agentTask: { tasks: [{ ...agentTask, placement }] } },
      });

    for (const placement of ["commit-week", "submit-week"]) {
      expect(parse(placement).capabilities.agentTask?.tasks[0]?.placement).toBe(
        placement,
      );
    }
    expect(() => parse("reset-sync")).toThrow(/placement/);
  });

  it("accepts a plugin with only agent tasks, without entrypoint or connection fields", () => {
    const manifest = pluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: { agentTask: { tasks: [agentTask] } },
    });
    expect(manifest.entrypoint).toBeUndefined();
    expect(manifest.connectionFields).toEqual([]);
    expect(pluginHasAgentTasks(manifest)).toBe(true);
  });

  it("still requires an entrypoint and connection fields for a backlog plugin", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: { connector: {} },
      }),
    ).toThrow(/entrypoint/);
  });

  it("refuses a week link slot that is not known", () => {
    expect(() =>
      pluginManifestSchema.parse({
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
      pluginManifestSchema.parse({
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
    const manifest = pluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: { projectProperties },
    });
    expect(pluginHasProjectProperties(manifest)).toBe(true);
    expect(manifest.entrypoint).toBeUndefined();
  });

  it("refuses two project property fields with the same id", () => {
    expect(() =>
      pluginManifestSchema.parse({
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
      pluginManifestSchema.parse({
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
