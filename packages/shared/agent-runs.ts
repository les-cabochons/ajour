import { z } from "zod";
import {
  connectorFieldSchema,
  connectorFieldValuesSchema,
} from "./connectors.ts";
import { isoDateSchema } from "./agent-tools.ts";

/**
 * Contracts for the agent runner: Settings > Agents, the agent tasks
 * plugins declare, and runs. See
 * docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */

export const agentCliIdSchema = z.enum(["claude-code", "codex", "opencode"]);
export type AgentCliId = z.infer<typeof agentCliIdSchema>;

/** Ajour's own Chrome profile, or the user's Chrome through Playwright's extension. */
export const agentBrowserModeSchema = z.enum(["ajour-chrome", "my-chrome"]);
export type AgentBrowserMode = z.infer<typeof agentBrowserModeSchema>;

export const agentRunnerSettingsSchema = z.object({
  cli: agentCliIdSchema.nullable(),
  browserMode: agentBrowserModeSchema,
  /** Empty means the CLI's default model. */
  model: z.string().trim().max(120),
});
export type AgentRunnerSettings = z.infer<typeof agentRunnerSettingsSchema>;

export const agentRunnerSettingsUpdateSchema =
  agentRunnerSettingsSchema.partial();

export const agentTaskSettingsUpdateSchema = z.object({
  values: connectorFieldValuesSchema,
});

export const agentCliStatusSchema = z.object({
  id: agentCliIdSchema,
  label: z.string(),
  /** False when Ajour has no adapter for it yet. */
  supported: z.boolean(),
  installed: z.boolean(),
  version: z.string().optional(),
});
export type AgentCliStatus = z.infer<typeof agentCliStatusSchema>;

export const agentTaskStatusSchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  taskId: z.string(),
  label: z.string(),
  placement: z.literal("commit-week"),
  estimateMinutes: z.number().int(),
  settings: z.array(connectorFieldSchema),
  values: connectorFieldValuesSchema,
  weekLink: z.string().optional(),
  /** Why the task cannot run now, such as "Fill in Workday timesheet URL". Empty when ready. */
  blockers: z.array(z.string()),
});
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;

export const agentRunSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  taskId: z.string(),
  weekOf: isoDateSchema,
  sessionId: z.string(),
  startedAt: z.number(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const agentRunnerOverviewSchema = z.object({
  settings: agentRunnerSettingsSchema,
  clis: z.array(agentCliStatusSchema),
  tasks: z.array(agentTaskStatusSchema),
  currentRun: agentRunSchema.nullable(),
});
export type AgentRunnerOverview = z.infer<typeof agentRunnerOverviewSchema>;

export const agentRunStartRequestSchema = z.object({
  pluginId: z.string().min(1),
  taskId: z.string().min(1),
  weekOf: isoDateSchema,
});
export type AgentRunStartRequest = z.infer<typeof agentRunStartRequestSchema>;
