import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpClientCreateResponse } from "../../../packages/shared/agent-tools.ts";
import type { AgentTaskMcpTool } from "../../../packages/shared/plugin-api-4.ts";
import type {
  AppApiStorage,
  McpClientPullRequestBinding,
  StoredMcpClient,
} from "./storage.ts";

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
 * tool. `pullRequest` binds a conversation's client to one pull request at
 * one head, with no data tool.
 */
export async function createMcpClient(
  storage: AppApiStorage,
  name: string,
  {
    now = Date.now(),
    tools,
    pullRequest,
  }: {
    now?: number;
    tools?: readonly AgentTaskMcpTool[];
    pullRequest?: McpClientPullRequestBinding;
  } = {},
): Promise<McpClientCreateResponse> {
  const token = `ajour_${randomBytes(32).toString("base64url")}`;
  const client: StoredMcpClient = {
    id: randomUUID(),
    name,
    tokenHash: hashMcpToken(token),
    createdAt: now,
    ...(tools ? { tools: [...tools] } : {}),
    ...(pullRequest
      ? {
          tools: [],
          pullRequest: {
            pullRequest: pullRequest.pullRequest,
            head: pullRequest.head,
          },
        }
      : {}),
  };
  await storage.addMcpClient(client);
  return { client: { id: client.id, name, createdAt: now }, token };
}

/**
 * Reads `Authorization: Bearer <token>` and finds the client it belongs to.
 * A client it finds counts as used, unless `counts` says the request won't
 * be answered, such as a user's client while MCP is off.
 */
export async function authenticateMcpRequest(
  storage: AppApiStorage,
  authorization: string | undefined,
  now = Date.now(),
  counts: (client: StoredMcpClient) => boolean = () => true,
): Promise<McpAuthentication> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { kind: "missing" };

  const client = await storage.findMcpClientByTokenHash(hashMcpToken(token));
  if (!client) return { kind: "unknown" };
  if (client.revokedAt !== undefined) return { kind: "revoked", client };

  if (counts(client)) await storage.touchMcpClient(client.id, now);
  return { kind: "ok", client };
}
