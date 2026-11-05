import { isCapabilityActive, type PluginsOverview } from "@ajour/shared";
import { connectionAccessAllows } from "@ajour/shared/connection-access";
import type { LocalWorkItem } from "@/domain/local-state";

/**
 * Assignees of synced backlog items (ADR 0017): a plugin with
 * `connector.assign` sends each item's assignee, searches the people it can
 * be assigned to, and takes one with a settle.
 */

/** The connection that assigns a synced item. */
export interface AssigneeSource {
  pluginId: string;
  connectionId: string;
  sourceId: string;
  /**
   * The connection's access leaves people search off: a typed name would
   * look the whole organisation up, so only the item's likely assignees,
   * those an empty search returns, are offered.
   */
  peopleSearchOff?: true;
}

/**
 * The plugin connection that assigns the item, or undefined when the item is
 * manual, its plugin doesn't assign, or its backlog capability is off.
 */
export function assigneeSourceOf(
  item: Pick<LocalWorkItem, "source" | "sourceId" | "sourceConnectionId">,
  overview: PluginsOverview | null | undefined,
): AssigneeSource | undefined {
  if (
    item.source === "manual" ||
    !item.sourceId ||
    !item.sourceConnectionId ||
    !overview
  ) {
    return undefined;
  }
  const group = overview.connectionGroups.find(
    (candidate) => candidate.plugin.id === item.source,
  );
  const connection = group?.connections.find(
    (candidate) => candidate.id === item.sourceConnectionId,
  );
  if (
    !group?.plugin.capabilities.connector?.assign ||
    !isCapabilityActive(group, "connector") ||
    !connection
  ) {
    return undefined;
  }
  return {
    pluginId: item.source,
    connectionId: item.sourceConnectionId,
    sourceId: item.sourceId,
    ...(connectionAccessAllows(group, connection, "searchAssignees")
      ? {}
      : { peopleSearchOff: true as const }),
  };
}
