import { describe, expect, it } from "vitest";
import type { PluginsOverview } from "@ajour/shared";
import { assigneeSourceOf } from "@/domain/backlog/assignees";

function overview(
  connector: object,
  options: {
    enabled?: boolean;
    inactive?: boolean;
    access?: string[];
  } = {},
): PluginsOverview {
  const plugin = {
    id: "azure_devops",
    displayName: "Azure DevOps",
    apiVersion: 3,
    capabilities: { connector },
  } as PluginsOverview["plugins"][number];
  return {
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: options.enabled ?? true,
        inactiveCapabilities: options.inactive ? ["connector"] : undefined,
        connectionAccess: [
          {
            id: "peopleSearch",
            label: "Search people across the organisation",
            always: false,
            operations: ["searchItemPeople", "searchAssignees"],
          },
        ],
        connections: [{ id: "conn-1", access: options.access ?? [] } as never],
      },
    ],
  } as unknown as PluginsOverview;
}

const synced = {
  source: "azure_devops",
  sourceId: "4821",
  sourceConnectionId: "conn-1",
};

describe("assignees", () => {
  it("finds the connection that assigns a synced item, and whether it may search the organisation", () => {
    const assigns = { settle: true, assign: true };

    expect(
      assigneeSourceOf(synced, overview(assigns, { access: ["peopleSearch"] })),
    ).toEqual({
      pluginId: "azure_devops",
      connectionId: "conn-1",
      sourceId: "4821",
    });
    expect(assigneeSourceOf(synced, overview(assigns))).toEqual({
      pluginId: "azure_devops",
      connectionId: "conn-1",
      sourceId: "4821",
      peopleSearchOff: true,
    });
  });

  it.each([
    ["a manual item", { source: "manual" }, overview({ assign: true })],
    ["a plugin that doesn't assign", synced, overview({ settle: true })],
    [
      "a turned-off plugin",
      synced,
      overview({ assign: true }, { enabled: false }),
    ],
    [
      "backlog items turned off",
      synced,
      overview({ assign: true }, { inactive: true }),
    ],
    [
      "a removed connection",
      { ...synced, sourceConnectionId: "conn-2" },
      overview({ assign: true }),
    ],
    ["no plugin overview yet", synced, null],
  ])("has no assignees for %s", (_label, item, current) => {
    expect(assigneeSourceOf(item, current)).toBeUndefined();
  });
});
