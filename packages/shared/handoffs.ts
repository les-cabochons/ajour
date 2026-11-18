import { z } from "zod";
import {
  handoffTemplateSchema,
  isValidHandoffBranch,
} from "./handoff-templates.ts";

const id = z.string().min(1).max(200);
const text = z.string().max(20_000);

/** Whether a link is an https URL, the only kind a pull request may have. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
const pullRequestSchema = z
  .object({
    url: z.string().max(2000),
    title: z.string().max(500).optional(),
  })
  .strict();
/** The states a tool reports for its thread. */
export const handoffReportedStateSchema = z.enum([
  "working",
  "needs-you",
  "ready",
  "done",
  "failed",
  "gone",
  "unknown",
]);
/**
 * A handoff's common state. `started` is Ajour's own, never a tool's: the
 * thread started in a tool that doesn't report its state (`followsState:
 * false`), so Ajour never reads it again.
 */
export const handoffStateSchema = z.enum([
  ...handoffReportedStateSchema.options,
  "started",
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
    /**
     * Where the tool's hooks post when its thread changes (#726): Ajour's
     * loopback address with this handoff's own token. A post only makes
     * Ajour refresh the handoff. A declared command receives it only
     * through a `hook-url` argument, which the host fills.
     */
    hook: z
      .object({ url: z.string().min(1).max(500) })
      .strict()
      .optional(),
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
/**
 * A listing of a tool's recent threads in one repository folder, for
 * offering to link the ones whose title names an item's key. `since` is a
 * time in milliseconds; a tool may list threads changed after it only.
 */
export const listThreadsRequestSchema = z
  .object({
    tool: id,
    folder: z.object({ id }).strict(),
    since: z.number().finite().optional(),
    limit: z.number().int().min(1).max(200),
  })
  .strict();
/** One listed thread: what a start would have answered, with its title. */
export const listedThreadSchema = startHandoffResultSchema
  .extend({
    title: z.string().min(1).max(500),
    updatedAt: z.number().finite().optional(),
  })
  .strict();
export const listThreadsResultSchema = z
  .object({ threads: z.array(listedThreadSchema).max(200) })
  .strict();
export const handoffUpdateSchema = z
  .object({
    id,
    state: handoffReportedStateSchema,
    link: z.string().max(2000).optional(),
    native: handoffNativeSchema,
    title: z.string().min(1).max(500).optional(),
    branch: z.string().max(500).optional(),
    // A tool's answer may list any link: the API drops the ones that aren't
    // https before it stores them, and the record refuses them.
    pullRequests: z.array(pullRequestSchema).max(100).optional(),
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
  pullRequests: z
    .array(
      pullRequestSchema.extend({
        url: pullRequestSchema.shape.url.refine(
          isHttpsUrl,
          "A pull request link must be https.",
        ),
      }),
    )
    .max(100)
    .optional(),
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
 * Why the start route refused a start, beside the tool's reason (#819).
 * `branchExists`: the branch Ajour asked for already exists, so the window
 * looks for the item's listed thread to offer for linking. `setting`: the
 * tool refused the value of one of its own text settings, so the window asks
 * for it, with what the manifest says of it, and hands off again with the
 * answer. `value` is the value refused, when the start named one.
 */
export const handoffStartRefusalSchema = z.object({
  error: z.string(),
  branchExists: z.literal(true).optional(),
  setting: z
    .object({
      id: z.string().min(1).max(120),
      label: z.string().min(1).max(120),
      helpText: z.string().max(500).optional(),
      value: z.string().max(500).optional(),
    })
    .strict()
    .optional(),
});
export type HandoffStartRefusal = z.infer<typeof handoffStartRefusalSchema>;

/**
 * The tool settings a repository folder's starts use (#819), by setting id:
 * the answers a start in that folder sent and the tool accepted. A start's
 * own settings win over them.
 */
export const handoffFolderSettingsSchema =
  startHandoffRequestSchema.shape.settings.refine(
    (value) => Object.keys(value).length <= 50,
    "At most 50 settings.",
  );
export type HandoffFolderSettings = z.infer<typeof handoffFolderSettingsSchema>;

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
export type HandoffState = z.infer<typeof handoffStateSchema>;

/**
 * What a handoff tool can do, in the order the plugin's page lists them:
 * every tool starts threads; `followsState` reads their state; `listsThreads`
 * finds the user's own; `hooks` makes state change within seconds.
 */
export const handoffToolFeatureLabels = {
  "starts-threads": "Starts threads",
  "follows-state": "Follows state",
  "finds-threads": "Finds threads",
  "updates-within-seconds": "Updates within seconds",
} as const;
export type HandoffToolFeature = keyof typeof handoffToolFeatureLabels;

export function handoffToolFeatures(tool: {
  followsState?: boolean;
  listsThreads?: boolean;
  hooks?: boolean;
}): HandoffToolFeature[] {
  return [
    "starts-threads" as const,
    ...(tool.followsState !== false ? ["follows-state" as const] : []),
    ...(tool.listsThreads ? ["finds-threads" as const] : []),
    ...(tool.hooks ? ["updates-within-seconds" as const] : []),
  ];
}
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
export type ListThreadsRequest = z.infer<typeof listThreadsRequestSchema>;
export type ListThreadsResult = z.infer<typeof listThreadsResultSchema>;
export type HandoffStartRoute = z.infer<typeof handoffStartRouteSchema>;

/** A handoff tool's id, as its plugin's manifest declares it. */
export const handoffToolIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
/** Turns one of a plugin's handoff tools on or off on this device (#760). */
export const handoffToolSwitchSchema = z
  .object({ toolId: handoffToolIdSchema, enabled: z.boolean() })
  .strict();
/** The ids of a plugin's handoff tools that are on, on this device. */
export const handoffEnabledToolsSchema = z
  .object({ enabled: z.array(handoffToolIdSchema).max(50) })
  .strict();
export type HandoffToolSwitch = z.infer<typeof handoffToolSwitchSchema>;
export type HandoffEnabledTools = z.infer<typeof handoffEnabledToolsSchema>;

/** Saved tool ids as a list of distinct valid ids, in their saved order. */
export function normalizeEnabledHandoffTools(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          handoffToolIdSchema.safeParse(value).success,
      ),
    ),
  ].slice(0, 50);
}

/**
 * The tools on, of those the manifest declares, in manifest order. A saved
 * id the plugin no longer declares counts for nothing until it does again.
 */
export function enabledHandoffToolsOf(
  tools: readonly { id: string }[],
  enabled: readonly string[],
): string[] {
  return tools.filter((tool) => enabled.includes(tool.id)).map((t) => t.id);
}

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
              id: handoffToolIdSchema,
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
              /**
               * The plugin answers `listThreads` for this tool, so Ajour can
               * offer to link threads whose title names an item's key.
               */
              listsThreads: z.boolean().optional(),
              /**
               * The plugin answers `readHandoffStates` for this tool. False
               * for a tool that can only start a thread: its handoffs stay
               * `started`, and Ajour never reads or polls them.
               */
              followsState: z.boolean().default(true),
              /**
               * The tool's threads post the start's hook URL when their
               * state changes, so they update within seconds. Valid only
               * when the plugin declares a command with a `hook-url` slot
               * and the tool follows state.
               */
              hooks: z.boolean().default(false),
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
