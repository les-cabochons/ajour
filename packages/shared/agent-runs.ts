import { z } from "zod";
import {
  agentTaskPlacementSchema,
  pluginFieldSchema,
  pluginFieldValuesSchema,
  removeSecretsSchema,
  secretExpirySchema,
  secretFieldSummarySchema,
} from "./plugins.ts";
import { isoDateSchema } from "./agent-tools.ts";

/**
 * Contracts for the agent runner: Settings > Agents, the agent tasks
 * plugins declare, and runs. See
 * docs/specs/2026-10-15-ajour-agent-runner-design.md.
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

/** A secret setting left empty keeps its saved value, as a connection's does. */
export const agentTaskSettingsUpdateSchema = z.object({
  values: pluginFieldValuesSchema,
  removeSecrets: removeSecretsSchema.optional(),
  secretExpiry: secretExpirySchema.optional(),
});

export const agentCliStatusSchema = z.object({
  id: agentCliIdSchema,
  label: z.string(),
  /** False when Ajour has no adapter for it yet. */
  supported: z.boolean(),
  installed: z.boolean(),
  version: z.string().optional(),
  refusalReason: z.string().optional(),
});
export type AgentCliStatus = z.infer<typeof agentCliStatusSchema>;

export const agentTaskStatusSchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  taskId: z.string(),
  label: z.string(),
  placement: agentTaskPlacementSchema,
  estimateMinutes: z.number().int(),
  settings: z.array(pluginFieldSchema),
  values: pluginFieldValuesSchema,
  /** The plugin's secret settings the vault holds, never a value. */
  secretFields: z.array(secretFieldSummarySchema).optional(),
  weekLink: z.string().optional(),
  /** Why the task has no week link, when its template uses a secret setting. */
  weekLinkRefusal: z.string().optional(),
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

/** A task a plugin declares, run for one week. */
export const pluginTaskRunRequestSchema = z.object({
  pluginId: z.string().min(1),
  taskId: z.string().min(1),
  weekOf: isoDateSchema,
});
export type PluginTaskRunRequest = z.infer<typeof pluginTaskRunRequestSchema>;

/**
 * Ajour's own agent tasks, about one pull request at one head. They run as
 * turns of the pull request's conversation, without the timesheet rules.
 */
export const coreAgentTaskSchema = z.enum([
  "deck.guide",
  "deck.ask",
  "deck.chat",
]);
export type CoreAgentTask = z.infer<typeof coreAgentTaskSchema>;

/** The longest message one turn carries, such as a typed question. */
export const AGENT_TURN_MESSAGE_MAX = 8000;

export const coreTaskRunRequestSchema = z.object({
  task: coreAgentTaskSchema,
  /** The pull request's Ajour ID. */
  pullRequest: z.string().trim().min(1).max(512),
  /** The head commit the turn is about. */
  head: z.string().regex(/^[0-9a-f]{7,64}$/i, "A head is a commit ID."),
  /** The user's own words, such as a typed question or a chat message. */
  message: z.string().trim().min(1).max(AGENT_TURN_MESSAGE_MAX).optional(),
});
export type CoreTaskRunRequest = z.infer<typeof coreTaskRunRequestSchema>;

/** A plugin task's run, or a turn of a core task. */
export const agentRunStartRequestSchema = z.union([
  coreTaskRunRequestSchema,
  pluginTaskRunRequestSchema,
]);
export type AgentRunStartRequest = z.infer<typeof agentRunStartRequestSchema>;

/**
 * One turn of a pull request's conversation, as its start answers: running,
 * or waiting for the one active turn the app allows.
 */
export const agentTurnSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  task: coreAgentTaskSchema,
  pullRequest: z.string(),
  head: z.string(),
  state: z.enum(["waiting", "running"]),
});
export type AgentTurn = z.infer<typeof agentTurnSchema>;

/** What a waiting turn waits for: a plugin task's agent run, or another turn. */
export const agentTurnBlockerSchema = z.enum(["agent-run", "turn"]);
export type AgentTurnBlocker = z.infer<typeof agentTurnBlockerSchema>;

/**
 * The `agent-turn` events on the window's event stream, in order for each
 * turn: `waiting` (only when it waits), `started`, any number of `text`, then
 * one `ended`. `text` carries the next piece of the answer, never all of it.
 * `conversation-closed` says the pull request's conversation went away.
 */
export const agentTurnEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("waiting"),
    turnId: z.string(),
    conversationId: z.string(),
    waitingFor: agentTurnBlockerSchema,
  }),
  z.object({
    type: z.literal("started"),
    turnId: z.string(),
    conversationId: z.string(),
  }),
  z.object({
    type: z.literal("text"),
    turnId: z.string(),
    conversationId: z.string(),
    /** 0 for a turn's first piece, then 1, 2 and so on. */
    index: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("ended"),
    turnId: z.string(),
    conversationId: z.string(),
    outcome: z.enum(["done", "cancelled", "failed"]),
    /** Why a failed turn failed. */
    error: z.string().optional(),
    /**
     * The provider couldn't resume the conversation, so the turn started a
     * new one: the agent no longer knows the earlier turns.
     */
    historyLost: z.literal(true).optional(),
  }),
  z.object({
    type: z.literal("conversation-closed"),
    conversationId: z.string(),
    reason: z.enum(["replaced", "idle", "shutdown", "failed", "revoked"]),
  }),
]);
export type AgentTurnEvent = z.infer<typeof agentTurnEventSchema>;
