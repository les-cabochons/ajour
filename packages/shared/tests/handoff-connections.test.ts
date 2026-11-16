import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../plugin-api-4.ts";
import {
  commandArgvShape,
  pluginAccessDifference,
  summarizePluginAccess,
  widensAccess,
} from "../plugin-access.ts";
import {
  pluginAccessDifferenceSchema,
  pluginAccessSummarySchema,
} from "../plugin-access-schemas.ts";
import {
  handoffRecordSchema,
  handoffStartRouteSchema,
  handoffToolConnectionsSchema,
} from "../handoffs.ts";

const ICON = "<svg/>";

/** An OpenCode-like plugin: one tool on an on-premises loopback server. */
function openCodeManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "opencode",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "OpenCode",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    connectionFields: [
      { id: "serverUrl", label: "Server URL", type: "url", required: true },
    ],
    network: {
      baseAddress: { field: "serverUrl", allowOnPremises: true },
      endpoints: [{ method: "GET", path: "/session/*" }],
    },
    capabilities: {
      handoff: {
        tools: [
          {
            id: "opencode",
            label: "OpenCode",
            iconSvg: ICON,
            settings: [],
            connection: "required",
          },
        ],
      },
    },
    processes: {
      executables: { opencode: { names: ["opencode"] } },
      commands: [
        {
          id: "attach",
          executable: "opencode",
          args: ["attach", "{server:connection-url}", "-s", "{session:id}"],
          mode: "terminal",
        },
      ],
    },
    ...overrides,
  };
}

describe("a handoff tool that uses a connection", () => {
  it("defaults to no connection, so existing tools are unchanged", () => {
    const parsed = pluginApi4ManifestSchema.parse({
      ...openCodeManifest(),
      network: undefined,
      connectionFields: [],
      processes: undefined,
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: ICON, settings: [] }],
        },
      },
    });
    expect(parsed.capabilities.handoff?.tools[0]?.connection).toBe("none");
  });

  it("accepts a tool that requires one, with connection fields and a network", () => {
    const parsed = pluginApi4ManifestSchema.parse(openCodeManifest());
    expect(parsed.capabilities.handoff?.tools[0]?.connection).toBe("required");
    expect(parsed.processes?.commands[0]?.args[1]).toEqual({
      kind: "connection-url",
      name: "server",
    });
  });

  it("refuses a tool that requires one without connection fields", () => {
    const result = pluginApi4ManifestSchema.safeParse(
      openCodeManifest({ connectionFields: [], network: undefined }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "needs connection fields",
    );
  });

  it("refuses a tool that requires one without a network", () => {
    const result = pluginApi4ManifestSchema.safeParse(
      openCodeManifest({ network: undefined }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "needs a network declaration",
    );
  });

  it("refuses an unknown connection value", () => {
    const manifest = openCodeManifest();
    const tool = manifest.capabilities.handoff.tools[0]!;
    expect(
      pluginApi4ManifestSchema.safeParse({
        ...manifest,
        capabilities: {
          handoff: { tools: [{ ...tool, connection: "optional" }] },
        },
      }).success,
    ).toBe(false);
  });
});

describe("the connection-url argument kind", () => {
  it("needs a base address the host can fill it from", () => {
    const result = pluginApi4ManifestSchema.safeParse(
      openCodeManifest({ network: { endpoints: [] } }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "connection-url slot needs a base address",
    );
  });

  it("needs a handoff tool that uses a connection", () => {
    const manifest = openCodeManifest();
    const tool = manifest.capabilities.handoff.tools[0]!;
    const result = pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: {
        handoff: { tools: [{ ...tool, connection: "none" }] },
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "only a handoff tool that uses a connection",
    );
  });

  it("can't be what a conditional group tests, since the plugin never passes it", () => {
    const manifest = openCodeManifest();
    const result = pluginApi4ManifestSchema.safeParse({
      ...manifest,
      processes: {
        ...manifest.processes,
        commands: [
          {
            id: "attach",
            executable: "opencode",
            args: [
              "attach",
              { if: "server", args: ["{server:connection-url}"] },
            ],
            mode: "terminal",
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("shows in the command's argv shape and description", () => {
    const parsed = pluginApi4ManifestSchema.parse(openCodeManifest());
    const command = parsed.processes!.commands[0]!;
    expect(commandArgvShape(command, ["opencode"])).toBe(
      "opencode attach <connection-url> -s <id>",
    );
    const summary = summarizePluginAccess(parsed, { agentPrompts: {} });
    expect(summary.commands?.[0]?.description).toContain(
      "Receives the connection's address.",
    );
  });
});

describe("consent for a tool's connection", () => {
  it("lists the tools that use a connection, and widens when a tool starts to", () => {
    const parsed = pluginApi4ManifestSchema.parse(openCodeManifest());
    const after = summarizePluginAccess(parsed, { agentPrompts: {} });
    expect(after.handoffConnections).toEqual(["opencode"]);
    expect(pluginAccessSummarySchema.parse(after).handoffConnections).toEqual([
      "opencode",
    ]);

    const tool = parsed.capabilities.handoff!.tools[0]!;
    const before = summarizePluginAccess(
      {
        ...parsed,
        capabilities: {
          handoff: { tools: [{ ...tool, connection: "none" }] },
        },
      },
      { agentPrompts: {} },
    );
    expect(before.handoffConnections).toBeUndefined();
    const difference = pluginAccessDifference(before, after);
    expect(difference.handoffConnections).toEqual(["opencode"]);
    expect(pluginAccessDifferenceSchema.parse(difference)).toMatchObject({
      handoffConnections: ["opencode"],
    });
    expect(widensAccess(difference)).toBe(true);
    expect(widensAccess(pluginAccessDifference(after, before))).toBe(false);
  });

  it("reads a summary saved before tools had connections", () => {
    const parsed = pluginApi4ManifestSchema.parse(openCodeManifest());
    const { handoffConnections: _drop, ...saved } = summarizePluginAccess(
      parsed,
      { agentPrompts: {} },
    );
    expect(
      widensAccess(
        pluginAccessDifference(pluginAccessSummarySchema.parse(saved), {
          ...saved,
          handoffConnections: ["opencode"],
        }),
      ),
    ).toBe(true);
  });
});

describe("handoff records and the start route", () => {
  it("keep the handoff's connection, and older records without one still parse", () => {
    const record = {
      id: "h",
      pluginId: "opencode",
      toolId: "opencode",
      workItemId: "item",
      projectId: "p",
      folderId: "f",
      title: "Title",
      threadId: "session",
      native: {},
      startedAt: 1,
      state: "working",
      checkedAt: 1,
      changedAt: 1,
      history: [],
    };
    expect(handoffRecordSchema.parse(record).connectionId).toBeUndefined();
    expect(
      handoffRecordSchema.parse({ ...record, connectionId: "c1" }).connectionId,
    ).toBe("c1");
    expect(
      handoffStartRouteSchema.shape.connectionId.safeParse("c1").success,
    ).toBe(true);
  });

  it("bounds the tools' connection choices", () => {
    expect(handoffToolConnectionsSchema.parse({ opencode: "c1" })).toEqual({
      opencode: "c1",
    });
    expect(
      handoffToolConnectionsSchema.safeParse({ opencode: "" }).success,
    ).toBe(false);
  });
});
