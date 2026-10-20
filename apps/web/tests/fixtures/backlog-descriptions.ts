import type {
  BacklogDescriptionCapability,
  BacklogImportCandidate,
  BacklogSyncedDescription,
  BacklogSyncResult,
  PluginsOverview,
} from "@ajour/shared";
import { autoSyncOverview, syncWithAnaComment } from "./backlog-comments";

/** The fixture plugin syncing on its own, with this description support. */
export function descriptionOverview(
  description: BacklogDescriptionCapability,
): PluginsOverview {
  const connectionGroups = autoSyncOverview.connectionGroups.map((group) => ({
    ...group,
    plugin: {
      ...group.plugin,
      capabilities: {
        ...group.plugin.capabilities,
        connector: { ...group.plugin.capabilities.connector, description },
      },
    },
  }));
  return {
    ...autoSyncOverview,
    plugins: connectionGroups.map((group) => group.plugin),
    connectionGroups,
  };
}

/** A sync that brings the synced Backlog parent with this description. */
export function syncWithParentDescription(
  description: BacklogSyncedDescription,
): BacklogSyncResult {
  const parent: BacklogImportCandidate = {
    id: "candidate-parent",
    source: "example",
    connectionId: "fixture",
    connectionLabel: "Work",
    tenantLabel: "Contoso",
    sourceId: "source-parent",
    externalId: "42",
    sourceUrl: "https://example.test/items/42",
    title: "Backlog parent",
    workItemType: "Task",
    state: "Active",
    depth: 0,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: Date.parse("2026-10-19T09:00:00Z"),
    description,
  };
  return {
    ...syncWithAnaComment,
    mode: "backlog",
    items: [parent],
    commentFacts: [],
  };
}
