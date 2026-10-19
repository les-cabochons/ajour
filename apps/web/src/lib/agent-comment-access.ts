import { connectionAgentAccess, type AgentAccess } from "@ajour/shared";
import { commentSourceOf, type CommentSource } from "@/domain/backlog/comments";
import type { LocalWorkItem } from "@/domain/local-state";
import { fetchPluginsOverview } from "@/lib/app-api";

/** What agents may do with an item's comments, and where they come from. */
export interface AgentCommentAccess {
  /** Absent when the item has no comments in Ajour. */
  source?: CommentSource;
  access: AgentAccess;
  connectionLabel?: string;
}

/**
 * What agents may do with the item's comments, as the local API has it at
 * this moment. A check that lets comments leave the machine never reads a
 * cached overview: the user may have just revoked access (ADR 0004).
 */
export async function readAgentCommentAccess(
  item: Pick<LocalWorkItem, "source" | "sourceId" | "sourceConnectionId">,
): Promise<AgentCommentAccess> {
  const overview = await fetchPluginsOverview();
  const source = commentSourceOf(item, overview);
  const connection = source
    ? overview.connectionGroups
        .find((group) => group.plugin.id === source.pluginId)
        ?.connections.find((candidate) => candidate.id === source.connectionId)
    : undefined;
  return {
    source,
    access: connection ? connectionAgentAccess(connection) : "none",
    connectionLabel: connection?.label,
  };
}

export function agentAccessAllows(
  access: AgentAccess,
  need: "read" | "readWrite",
) {
  return need === "read" ? access !== "none" : access === "readWrite";
}
