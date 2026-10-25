import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpClientCreateResponse } from "../../../packages/shared/agent-tools.ts";
import type { AgentTaskMcpTool } from "../../../packages/shared/plugin-api-4.ts";
import type { AppApiStorage, StoredMcpClient } from "./storage.ts";

/**
 * Agent client tokens. A token is 32 random bytes, shown once when the client
 * is created. Ajour stores its SHA-256 hash and compares hashes.
 */

export type McpAuthentication =
  | { kind: "ok"; client: StoredMcpClient }
  | { kind: "missing" }
  | { kind: "unknown" }
  | { kind: "revoked"; client: StoredMcpClient };

function hashMcpToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a client. `tools` limits it to those data tools, as an agent task
 * run's client is limited to its task's. Without it, the client has every
 * tool.
 */
export async function createMcpClient(
  storage: AppApiStorage,
  name: string,
  {
    now = Date.now(),
    tools,
  }: { now?: number; tools?: readonly AgentTaskMcpTool[] } = {},
): Promise<McpClientCreateResponse> {
  const token = `ajour_${randomBytes(32).toString("base64url")}`;
  const client: StoredMcpClient = {
    id: randomUUID(),
    name,
    tokenHash: hashMcpToken(token),
    createdAt: now,
    ...(tools ? { tools: [...tools] } : {}),
  };
  await storage.addMcpClient(client);
  return { client: { id: client.id, name, createdAt: now }, token };
}

/** Reads `Authorization: Bearer <token>` and finds the client it belongs to. */
export async function authenticateMcpRequest(
  storage: AppApiStorage,
  authorization: string | undefined,
  now = Date.now(),
): Promise<McpAuthentication> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { kind: "missing" };

  const client = await storage.findMcpClientByTokenHash(hashMcpToken(token));
  if (!client) return { kind: "unknown" };
  if (client.revokedAt !== undefined) return { kind: "revoked", client };

  await storage.touchMcpClient(client.id, now);
  return { kind: "ok", client };
}
