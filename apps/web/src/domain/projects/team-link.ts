import { teamProjectFieldsSchema, teamTaskFieldsSchema } from "@ajour/shared";
import type {
  LocalProjectTeamLink,
  LocalTaskTeamLink,
  LocalTeamConnection,
} from "@/domain/local-state";

/*
 * Reads stored team links back. A link whose shape is wrong is dropped, which
 * turns its project local, or its task new to the team. Kept apart from
 * team-sync.ts so project normalization does not depend on the sync rules.
 */

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeProjectTeamLink(
  value: unknown,
): LocalProjectTeamLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const link = value as Record<string, unknown>;
  if (!nonEmptyString(link.connectionId)) return undefined;
  if (link.remoteId === undefined) {
    return { connectionId: link.connectionId };
  }
  const synced = teamProjectFieldsSchema.safeParse(link.synced);
  if (!nonEmptyString(link.remoteId) || !synced.success) return undefined;
  return {
    connectionId: link.connectionId,
    remoteId: link.remoteId,
    synced: synced.data,
  };
}

export function normalizeTaskTeamLink(
  value: unknown,
): LocalTaskTeamLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const link = value as Record<string, unknown>;
  const synced = teamTaskFieldsSchema.safeParse(link.synced);
  if (!nonEmptyString(link.remoteId) || !synced.success) return undefined;
  return { remoteId: link.remoteId, synced: synced.data };
}

export function normalizeTeamConnections(
  value: unknown,
): Record<string, LocalTeamConnection> {
  if (!value || typeof value !== "object") return {};
  const connections: Record<string, LocalTeamConnection> = {};
  for (const [connectionId, candidate] of Object.entries(value)) {
    if (!nonEmptyString(connectionId) || !candidate) continue;
    if (typeof candidate !== "object") continue;
    const connection = candidate as Record<string, unknown>;
    connections[connectionId] = {
      ...(nonEmptyString(connection.cursor)
        ? { cursor: connection.cursor }
        : {}),
      unsharedRemoteIds: Array.isArray(connection.unsharedRemoteIds)
        ? connection.unsharedRemoteIds.filter(nonEmptyString)
        : [],
    };
  }
  return connections;
}
