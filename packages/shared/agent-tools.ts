import { z } from "zod";

/**
 * Contracts between the local API's MCP endpoint and the renderer that runs
 * Ajour's data tools. See docs/superpowers/specs/2026-10-14-ajour-mcp-design.md.
 */

/** A local calendar date, such as 2026-10-14. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-10-14.");

/** An agent client as Settings lists it. The token is never part of it. */
export const mcpClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
});
export type McpClient = z.infer<typeof mcpClientSchema>;

export const mcpSettingsSchema = z.object({
  enabled: z.boolean(),
  clients: z.array(mcpClientSchema),
});
export type McpSettings = z.infer<typeof mcpSettingsSchema>;

export const mcpSettingsUpdateSchema = z.object({ enabled: z.boolean() });

export const mcpClientCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** The only place the token appears. Ajour keeps its hash. */
export const mcpClientCreateResponseSchema = z.object({
  client: mcpClientSchema,
  token: z.string().min(1),
});
export type McpClientCreateResponse = z.infer<
  typeof mcpClientCreateResponseSchema
>;

/** `ok` is false when the call had already timed out in the API. */
export const mcpBridgeResultAckSchema = z.object({ ok: z.boolean() });

/** The agent client behind a tool call, as the renderer and the panel see it. */
export const agentClientRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AgentClientRef = z.infer<typeof agentClientRefSchema>;

/** A data tool call the API sends to the renderer. */
export const bridgeToolCallSchema = z.object({
  requestId: z.string().min(1),
  tool: z.string().min(1),
  input: z.unknown(),
  client: agentClientRefSchema,
});
export type BridgeToolCall = z.infer<typeof bridgeToolCallSchema>;

/** What the renderer posts back. A refusal carries a sentence for the agent. */
export const bridgeToolResultSchema = z.discriminatedUnion("ok", [
  z.object({
    requestId: z.string().min(1),
    ok: z.literal(true),
    output: z.unknown(),
    /** Set by write tools, for the activity list. Never a note. */
    activity: z
      .object({
        action: z.string(),
        objectId: z.string(),
        objectTitle: z.string(),
      })
      .optional(),
  }),
  z.object({
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
]);
export type BridgeToolResult = z.infer<typeof bridgeToolResultSchema>;

/** Input schemas of the read tools, by MCP tool name. */
export const readToolInputSchemas = {
  get_running_timer: z.object({}),
  list_time_entries: z.object({ from: isoDateSchema, to: isoDateSchema }),
  list_projects: z.object({}),
  list_work_items: z.object({
    filter: z
      .enum(["sidebar", "active", "settled", "archived", "all"])
      .default("sidebar"),
    workflowStateId: z.string().optional(),
    projectId: z.string().optional(),
    text: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  get_work_item: z.object({ workItemId: z.string().min(1) }),
  get_submit_lines: z.object({
    weekOf: isoDateSchema,
    groupBy: z.enum(["day-task", "day", "task"]).default("day-task"),
    onlyUnsubmitted: z.boolean().default(true),
  }),
} as const;
export type ReadToolName = keyof typeof readToolInputSchemas;
export type ReadToolInput<Name extends ReadToolName> = z.infer<
  (typeof readToolInputSchemas)[Name]
>;
