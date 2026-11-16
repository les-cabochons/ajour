import { z } from "zod";
import {
  handoffTemplateSchema,
  isValidHandoffBranch,
} from "./handoff-templates.ts";

const id = z.string().min(1).max(200);
const text = z.string().max(20_000);
export const handoffStateSchema = z.enum([
  "working",
  "needs-you",
  "ready",
  "done",
  "failed",
  "gone",
  "unknown",
]);
// Opaque, bounded JSON supplied by the tool, including its own status and label.
export const handoffNativeSchema = z
  .record(z.unknown())
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096,
    "Native state exceeds 4 KB serialized.",
  );
export const startHandoffRequestSchema = z
  .object({
    tool: id,
    folder: z.object({ id, name: z.string().min(1).max(500) }).strict(),
    prompt: z.string().min(1).max(1_048_576),
    title: z.string().min(1).max(500),
    branch: z.string().max(500).optional(),
    item: z
      .object({ key: z.string().max(500), url: z.string().max(2000) })
      .strict(),
    settings: z.record(
      z.union([z.string().max(32_768), z.number().finite(), z.boolean()]),
    ),
  })
  .strict();
export const startHandoffResultSchema = z
  .object({
    threadId: id,
    link: z.string().max(2000).optional(),
    resume: z
      .object({
        command: id,
        args: z.record(z.union([z.string().max(32_768), z.number().finite()])),
      })
      .strict()
      .optional(),
    native: handoffNativeSchema,
  })
  .strict();
export const detectToolsResultSchema = z
  .object({
    tools: z
      .array(
        z
          .object({
            id,
            available: z.boolean(),
            version: z.string().max(200).optional(),
            reason: text.optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const readHandoffStatesRequestSchema = z
  .object({
    tool: id,
    handoffs: z
      .array(
        z
          .object({
            id,
            threadId: id,
            folderId: id,
            native: handoffNativeSchema,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export const handoffUpdateSchema = z
  .object({
    id,
    state: handoffStateSchema,
    link: z.string().max(2000).optional(),
    native: handoffNativeSchema,
    title: z.string().min(1).max(500).optional(),
    branch: z.string().max(500).optional(),
    pullRequests: z
      .array(
        z
          .object({
            url: z.string().max(2000),
            title: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export const readHandoffStatesResultSchema = z
  .array(handoffUpdateSchema)
  .max(1000);
export const handoffRecordSchema = startHandoffResultSchema.extend({
  id,
  pluginId: id,
  toolId: id,
  /**
   * The connection the handoff runs through, for a tool that uses one. A
   * session id is only meaningful on its own server, so every later read
   * goes through the same connection.
   */
  connectionId: id.optional(),
  workItemId: id,
  projectId: id,
  folderId: id,
  title: z.string().min(1).max(500),
  branch: z.string().max(500).optional(),
  pullRequests: handoffUpdateSchema.shape.pullRequests,
  startedAt: z.number().finite(),
  state: handoffStateSchema,
  checkedAt: z.number().finite(),
  paused: z
    .object({ reason: text, since: z.number().finite() })
    .strict()
    .optional(),
  changedAt: z.number().finite(),
  history: z
    .array(
      z
        .object({
          state: handoffStateSchema,
          status: z.string().max(64).optional(),
          label: z.string().max(200).optional(),
          at: z.number().finite(),
        })
        .strict(),
    )
    .max(50),
});
export const handoffsSnapshotSchema = z.array(handoffRecordSchema);
export const handoffRefreshResultSchema = z.object({
  handoffs: handoffsSnapshotSchema,
  failures: z.array(
    z.object({
      pluginId: id,
      toolId: id,
      projectId: id,
      connectionId: id.optional(),
      reason: z.string(),
    }),
  ),
});
export const handoffStartRouteSchema = z
  .object({
    pluginId: id,
    toolId: id,
    /**
     * The connection to hand off through, for a tool that uses one. Absent,
     * the connection the tool's settings picked.
     */
    connectionId: id.optional(),
    folderId: id,
    projectId: id,
    workItemId: id,
    projectName: z.string().max(500),
    item: z
      .object({
        key: z.string().max(500),
        title: z.string().min(1).max(500),
        description: z.string().max(1_048_576).optional(),
        url: z.string().max(2000),
        type: z.string().max(500),
        parent: z
          .object({ key: z.string().max(500), title: z.string().max(500) })
          .strict()
          .optional(),
      })
      .strict(),
    branchOverride: z
      .string()
      .max(500)
      .refine(
        (value) => value === "" || isValidHandoffBranch(value),
        "The branch template override must be a valid git branch, or empty for no worktree.",
      )
      .optional(),
    promptOverride: z.string().min(1).max(1_048_576).optional(),
    settings: startHandoffRequestSchema.shape.settings,
  })
  .strict();
/**
 * The connection each tool of one plugin hands off through, by tool id: the
 * tool's settings pick it, and detection runs for it.
 */
export const handoffToolConnectionsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), id)
  .refine((value) => Object.keys(value).length <= 50, "At most 50 tools.");
export type HandoffToolConnections = z.infer<
  typeof handoffToolConnectionsSchema
>;
/** Whether a tool hands off through one of its plugin's connections. */
export const handoffToolConnectionSchema = z
  .enum(["required", "none"])
  .default("none");
export type Handoff = z.infer<typeof handoffRecordSchema>;
export type StartHandoffRequest = z.infer<typeof startHandoffRequestSchema>;
export type StartHandoffResult = z.infer<typeof startHandoffResultSchema>;
export type DetectToolsResult = z.infer<typeof detectToolsResultSchema>;
export type ReadHandoffStatesRequest = z.infer<
  typeof readHandoffStatesRequestSchema
>;
export type ReadHandoffStatesResult = z.infer<
  typeof readHandoffStatesResultSchema
>;
export type HandoffUpdate = z.infer<typeof handoffUpdateSchema>;
export type HandoffStartRoute = z.infer<typeof handoffStartRouteSchema>;

export function handoffCapabilitySchema<
  T extends z.ZodType<{ secret?: boolean }>,
>(fieldSchema: T) {
  return z
    .object({
      promptTemplate: handoffTemplateSchema.optional(),
      tools: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
              label: z.string().min(1).max(120),
              iconSvg: z.string().min(1).max(20000),
              settings: z
                .array(fieldSchema)
                .max(50)
                .refine(
                  (fields) => fields.every((f) => !f.secret),
                  "Handoff settings cannot contain secrets.",
                ),
              /**
               * `required`: every operation for this tool runs through one
               * of the plugin's connections, which the tool's settings pick.
               */
              connection: handoffToolConnectionSchema,
            })
            .strict(),
        )
        .min(1)
        .max(50)
        .refine(
          (tools) => new Set(tools.map((t) => t.id)).size === tools.length,
          "Tool ids must be unique.",
        ),
    })
    .strict()
    .optional();
}
