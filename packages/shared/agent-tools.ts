import { z } from "zod";

/**
 * Contracts between the local API's MCP endpoint and the renderer that runs
 * Ajour's data tools. See docs/superpowers/specs/2026-10-14-ajour-mcp-design.md.
 */

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A real local calendar date, such as 2026-10-14. 2026-02-29 is refused. */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_SHAPE, "Use a date such as 2026-10-14.")
  .refine(isRealCalendarDate, "That day does not exist in the calendar.");

/**
 * True when the date survives a parse and format round trip in UTC. A value
 * that is not shaped like a date passes: the regex above already reports it.
 */
function isRealCalendarDate(value: string) {
  if (!ISO_DATE_SHAPE.test(value)) return true;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

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

/**
 * What the renderer posts back. A refusal carries a sentence for the agent.
 * `failed` marks an unexpected exception in the renderer, which the API logs
 * as an error instead of a refusal.
 */
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
    failed: z.literal(true).optional(),
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

const minutesSchema = z
  .number()
  .int()
  .min(1)
  .max(24 * 60);
const noteSchema = z.string().max(2000);

/** 1 Urgent to 4 Low. Null clears it to No priority. */
const priorityInputSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .nullable();
const workItemIdInput = z.object({ workItemId: z.string() });
/** A state name in the item's source, such as "In QA". */
const sourceStateInputSchema = z.string().trim().min(1).max(120);

/** Input schemas of the write tools, by MCP tool name. */
export const writeToolInputSchemas = {
  start_timer: z.object({
    workItemId: z.string().optional(),
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    note: noteSchema.optional(),
  }),
  stop_timer: z.object({}),
  edit_running_entry: z.object({
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    note: noteSchema.optional(),
    countedMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
  }),
  create_entry: z.object({
    date: isoDateSchema,
    projectId: z.string(),
    taskId: z.string().optional(),
    workItemId: z.string().optional(),
    note: noteSchema.optional(),
    minutes: minutesSchema,
  }),
  edit_entry: z.object({
    entryId: z.string(),
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    note: noteSchema.optional(),
    minutes: minutesSchema.optional(),
  }),
  move_entry: z.object({ entryId: z.string(), date: isoDateSchema }),
  duplicate_entry: z.object({
    entryId: z.string(),
    date: isoDateSchema.optional(),
  }),
  mark_entries_submitted: z.object({
    entryIds: z.array(z.string()).min(1).max(500),
  }),
  mark_entries_not_submitted: z.object({
    entryIds: z.array(z.string()).min(1).max(500),
  }),
  create_work_item: z.object({
    title: z.string().trim().min(1).max(500),
    note: z.string().max(10_000).optional(),
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    priority: priorityInputSchema.optional(),
    workflowStateId: z.string().optional(),
    parentWorkItemId: z.string().optional(),
    remainingEstimateHours: z.number().min(0).max(1000).optional(),
  }),
  edit_work_item: z.object({
    workItemId: z.string(),
    title: z.string().trim().min(1).max(500).optional(),
    note: z.string().max(10_000).optional(),
    priority: priorityInputSchema.optional(),
    remainingEstimateHours: z.number().min(0).max(1000).nullable().optional(),
    projectId: z.string().nullable().optional(),
    taskId: z.string().nullable().optional(),
  }),
  move_work_item: z.object({
    workItemId: z.string(),
    workflowStateId: z.string(),
    includeSubitems: z.boolean().optional(),
    /** Read only when Ajour must pick among the item's source states. */
    sourceState: sourceStateInputSchema.optional(),
  }),
  settle_work_item: z.object({
    workItemId: z.string(),
    includeSubitems: z.boolean().optional(),
    /** For a synced item: the source state it settles in. */
    sourceState: sourceStateInputSchema.optional(),
  }),
  unsettle_work_item: workItemIdInput,
  snooze_work_item: z.object({
    workItemId: z.string(),
    until: z.string().datetime({ offset: true }),
  }),
  unsnooze_work_item: workItemIdInput,
  archive_work_item: workItemIdInput,
  restore_work_item: workItemIdInput,
} as const;
export type WriteToolName = keyof typeof writeToolInputSchemas;
export type WriteToolInput<Name extends WriteToolName> = z.infer<
  (typeof writeToolInputSchemas)[Name]
>;

/** The project and task an entry or item is on, with their names. */
const agentProjectRefShape = {
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  taskId: z.string().optional(),
  taskName: z.string().optional(),
};

export const agentRunningTimerSchema = z.object({
  ...agentProjectRefShape,
  timerId: z.string(),
  date: z.string(),
  countedMinutes: z.number(),
  note: z.string().optional(),
  workItemId: z.string().optional(),
  workItemTitle: z.string().optional(),
});
export type AgentRunningTimer = z.infer<typeof agentRunningTimerSchema>;

export const agentTimeEntrySchema = z.object({
  ...agentProjectRefShape,
  entryId: z.string(),
  date: z.string(),
  /** Running when the running entry continues this saved entry. */
  state: z.enum(["saved", "submitted", "running"]),
  minutes: z.number(),
  note: z.string().optional(),
  workItemId: z.string().optional(),
});
export type AgentTimeEntry = z.infer<typeof agentTimeEntrySchema>;

export const agentWorkItemSchema = z.object({
  ...agentProjectRefShape,
  workItemId: z.string(),
  title: z.string(),
  status: z.enum(["active", "settled", "archived"]),
  workflowState: z.string().optional(),
  workflowStateId: z.string().optional(),
  /** 1 Urgent to 4 Low. Null is No priority. */
  priority: z.number().nullable(),
  remainingEstimateHours: z.number().optional(),
  parentWorkItemId: z.string().optional(),
  source: z.string(),
  sourceProjectName: z.string().optional(),
  snoozedUntil: z.string().optional(),
});
export type AgentWorkItem = z.infer<typeof agentWorkItemSchema>;

const submitWarningSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("day-under-target"),
    localDate: z.string(),
    loggedMs: z.number(),
    targetMs: z.number(),
  }),
  z.object({ kind: z.literal("missing-task"), entryCount: z.number() }),
]);

/**
 * Output schemas of the read and write tools, by MCP tool name. The API
 * checks each renderer result against its schema before the agent sees it.
 */
export const dataToolOutputSchemas = {
  get_running_timer: z.object({ running: agentRunningTimerSchema.nullable() }),
  list_time_entries: z.object({
    entries: z.array(agentTimeEntrySchema),
    running: agentRunningTimerSchema.nullable(),
  }),
  list_projects: z.object({
    projects: z.array(
      z.object({
        projectId: z.string(),
        name: z.string(),
        code: z.string().optional(),
        tasks: z.array(z.object({ taskId: z.string(), name: z.string() })),
      }),
    ),
  }),
  list_work_items: z.object({ workItems: z.array(agentWorkItemSchema) }),
  get_work_item: agentWorkItemSchema.extend({
    note: z.string().optional(),
    sourceUrl: z.string().optional(),
    subitems: z.array(
      z.object({
        workItemId: z.string(),
        title: z.string(),
        status: agentWorkItemSchema.shape.status,
      }),
    ),
  }),
  get_submit_lines: z.object({
    sections: z.array(
      z.object({
        date: z.string().optional(),
        lines: z.array(
          z.object({
            projectName: z.string().optional(),
            taskName: z.string().optional(),
            hours: z.number(),
            comments: z.string(),
            entryIds: z.array(z.string()),
            unsubmittedEntryIds: z.array(z.string()),
          }),
        ),
      }),
    ),
    summary: z.object({
      totalHours: z.number(),
      targetHours: z.number(),
      warnings: z.array(submitWarningSchema),
    }),
  }),
  start_timer: z.object({ running: agentRunningTimerSchema }),
  stop_timer: z.object({
    stopped: z.literal(true),
    countedMinutes: z.number(),
  }),
  edit_running_entry: z.object({ running: agentRunningTimerSchema }),
  create_entry: agentTimeEntrySchema,
  edit_entry: agentTimeEntrySchema,
  move_entry: agentTimeEntrySchema,
  duplicate_entry: agentTimeEntrySchema,
  mark_entries_submitted: z.object({ marked: z.number() }),
  mark_entries_not_submitted: z.object({ unmarked: z.number() }),
  create_work_item: agentWorkItemSchema,
  edit_work_item: agentWorkItemSchema,
  move_work_item: agentWorkItemSchema,
  settle_work_item: agentWorkItemSchema,
  unsettle_work_item: agentWorkItemSchema,
  snooze_work_item: agentWorkItemSchema,
  unsnooze_work_item: agentWorkItemSchema,
  archive_work_item: agentWorkItemSchema,
  restore_work_item: agentWorkItemSchema,
} as const satisfies Record<ReadToolName | WriteToolName, z.AnyZodObject>;
export type DataToolOutput<Name extends ReadToolName | WriteToolName> = z.infer<
  (typeof dataToolOutputSchemas)[Name]
>;

/** How an agent session ended. */
export const agentSessionOutcomeSchema = z.enum([
  "done",
  "failed",
  "cancelled",
]);
export type AgentSessionOutcome = z.infer<typeof agentSessionOutcomeSchema>;

export const agentSessionMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("update"), at: z.number(), text: z.string() }),
  z.object({
    kind: z.literal("question"),
    at: z.number(),
    questionId: z.string(),
    text: z.string(),
    choices: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("answer"),
    at: z.number(),
    questionId: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("end"),
    at: z.number(),
    outcome: agentSessionOutcomeSchema,
    summary: z.string(),
  }),
]);
export type AgentSessionMessage = z.infer<typeof agentSessionMessageSchema>;

/** A stretch of work an agent announced. See the glossary's "Agent session". */
export const agentSessionSchema = z.object({
  id: z.string(),
  client: agentClientRefSchema,
  title: z.string(),
  state: z.enum(["active", "stalled", ...agentSessionOutcomeSchema.options]),
  startedAt: z.number(),
  /** Unset while a question pauses the session, and once it ends. */
  deadlineAt: z.number().optional(),
  pausedRemainingMs: z.number().optional(),
  endedAt: z.number().optional(),
  messages: z.array(agentSessionMessageSchema),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;

const agentQuestionBaseShape = {
  id: z.string(),
  client: agentClientRefSchema,
  sessionId: z.string().optional(),
  text: z.string(),
  choices: z.array(z.string()).optional(),
  askedAt: z.number(),
};

/** A question waiting for the user, as the indicator and panel show it. */
export const openAgentQuestionSchema = z.object({
  ...agentQuestionBaseShape,
  status: z.literal("open"),
});
export type OpenAgentQuestion = z.infer<typeof openAgentQuestionSchema>;

/**
 * A question an agent asked. Ending its session withdraws it while it is
 * still open.
 */
export const agentQuestionSchema = z.discriminatedUnion("status", [
  openAgentQuestionSchema,
  z.object({
    ...agentQuestionBaseShape,
    status: z.literal("answered"),
    answer: z.string(),
    answeredAt: z.number(),
  }),
  z.object({ ...agentQuestionBaseShape, status: z.literal("withdrawn") }),
]);
export type AgentQuestion = z.infer<typeof agentQuestionSchema>;

const agentActivityBaseShape = {
  at: z.number(),
  client: agentClientRefSchema,
  sessionId: z.string().optional(),
  tool: z.string(),
};

/**
 * One agent write, done or refused. Never a note or a tool input. A write
 * that failed with an exception is an AgentError instead.
 */
export const agentActivitySchema = z.discriminatedUnion("outcome", [
  z.object({
    ...agentActivityBaseShape,
    outcome: z.literal("ok"),
    action: z.string(),
    objectId: z.string(),
    objectTitle: z.string(),
  }),
  z.object({
    ...agentActivityBaseShape,
    outcome: z.literal("refused"),
    /** Ajour's sentence to the agent, such as "Restore the item first". */
    reason: z.string(),
  }),
]);
export type AgentActivity = z.infer<typeof agentActivitySchema>;

export const agentErrorSchema = z.object({
  at: z.number(),
  client: agentClientRefSchema.optional(),
  message: z.string(),
});
export type AgentError = z.infer<typeof agentErrorSchema>;

/** Everything the agent indicator and panel show, newest first. */
export const agentsSnapshotSchema = z.object({
  sessions: z.array(agentSessionSchema),
  openQuestions: z.array(openAgentQuestionSchema),
  activity: z.array(agentActivitySchema),
  errors: z.array(agentErrorSchema),
  /** When the user last opened the panel. Older errors and failures are seen. */
  seenAt: z.number(),
});
export type AgentsSnapshot = z.infer<typeof agentsSnapshotSchema>;

export const sessionToolInputSchemas = {
  begin_session: z.object({
    title: z.string().trim().min(1).max(200),
    estimateMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  }),
  update_session: z.object({
    sessionId: z.string(),
    message: z.string().trim().min(1).max(2000),
    extraMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
  }),
  end_session: z.object({
    sessionId: z.string(),
    outcome: agentSessionOutcomeSchema,
    summary: z.string().trim().min(1).max(4000),
  }),
  ask: z.object({
    question: z.string().trim().min(1).max(2000),
    choices: z
      .array(z.string().trim().min(1).max(200))
      .min(2)
      .max(6)
      .optional(),
    sessionId: z.string().optional(),
  }),
  wait_for_answer: z.object({ questionId: z.string() }),
} as const;
export type SessionToolName = keyof typeof sessionToolInputSchemas;

/** Output schemas of the session tools, which run in the API. */
export const sessionToolOutputSchemas = {
  begin_session: z.object({ sessionId: z.string(), deadline: z.string() }),
  update_session: z.object({
    state: agentSessionSchema.shape.state,
    deadline: z.string().nullable(),
  }),
  end_session: z.object({ ended: z.literal(true) }),
  ask: z.object({ questionId: z.string() }),
  /** MCP output schemas are objects, so this is not a union. */
  wait_for_answer: z.object({
    status: z.enum(["answered", "waiting", "withdrawn"]),
    /** Set when the status is answered. */
    answer: z.string().optional(),
  }),
} as const satisfies Record<SessionToolName, z.AnyZodObject>;
export type SessionToolOutput<Name extends SessionToolName> = z.infer<
  (typeof sessionToolOutputSchemas)[Name]
>;

export const agentAnswerRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
