import { z } from "zod";
import { allowedTaskSlots, listTemplateSlots } from "./agent-task-templates.ts";

export const CONNECTOR_PLUGIN_API_VERSION = 3;
export const CONNECTOR_PLUGIN_ARCHIVE_EXTENSION = ".ajour-connector";

export const connectorSourceSchema = z.string().trim().min(1).max(120);
export type ConnectorBacklogSource = z.infer<typeof connectorSourceSchema>;

export const connectorPluginIdSchema = connectorSourceSchema.regex(
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  "Connector plugin identifiers must use lowercase letters, numbers, dots, underscores, or hyphens.",
);

export function normalizeConnectorStatusKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export const azureDevOpsQueryScopes = [
  "assigned_to_me",
  "project_open_tasks",
] as const;
export type AzureDevOpsQueryScope = (typeof azureDevOpsQueryScopes)[number];

export const jiraQueryScopes = [
  "assigned_to_me",
  "project_open_issues",
] as const;
export type JiraQueryScope = (typeof jiraQueryScopes)[number];

export const connectorTaskIconDisplayModes = [
  "always",
  "fallback",
  "never",
] as const;
export const connectorTaskIconDisplayModeSchema = z.enum(
  connectorTaskIconDisplayModes,
);
export type ConnectorTaskIconDisplayMode = z.infer<
  typeof connectorTaskIconDisplayModeSchema
>;
export const DEFAULT_CONNECTOR_TASK_ICON_DISPLAY_MODE: ConnectorTaskIconDisplayMode =
  "always";

export const connectorImportDepthSchema = z.union([z.literal(0), z.literal(1)]);
export type ConnectorImportDepth = z.infer<typeof connectorImportDepthSchema>;

export const connectorFieldValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
]);
export type ConnectorFieldValue = z.infer<typeof connectorFieldValueSchema>;

export const connectorFieldValuesSchema = z.record(
  z.string().min(1).max(120),
  connectorFieldValueSchema,
);
export type ConnectorFieldValues = z.infer<typeof connectorFieldValuesSchema>;

export const connectorSummaryValueSchema = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
]);
export type ConnectorSummaryValue = z.infer<typeof connectorSummaryValueSchema>;

export const connectorSummaryValuesSchema = z.record(
  z.string().min(1).max(120),
  connectorSummaryValueSchema,
);
export type ConnectorSummaryValues = z.infer<
  typeof connectorSummaryValuesSchema
>;

export const connectorFieldTypeSchema = z.enum([
  "text",
  "password",
  "url",
  "select",
  "number",
  "checkbox",
]);
export type ConnectorFieldType = z.infer<typeof connectorFieldTypeSchema>;

export const connectorFieldOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
});
export type ConnectorFieldOption = z.infer<typeof connectorFieldOptionSchema>;

export const connectorFieldSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  type: connectorFieldTypeSchema,
  placeholder: z.string().trim().max(240).optional(),
  helpText: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  defaultValue: connectorFieldValueSchema.optional(),
  options: z.array(connectorFieldOptionSchema).max(50).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().optional(),
});
export type ConnectorField = z.infer<typeof connectorFieldSchema>;

/**
 * Ajour's priority levels. Each plugin maps its source's priority values to
 * these levels on sync, and back to a source value on a settle write. An item
 * without a level has No priority.
 */
export const connectorPriorityLevelSchema = z.enum([
  "urgent",
  "high",
  "medium",
  "low",
]);
export type ConnectorPriorityLevel = z.infer<
  typeof connectorPriorityLevelSchema
>;

/**
 * A task an agent runs for the plugin, from a prompt file. No plugin code
 * runs. See docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */
export const agentTaskSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    label: z.string().trim().min(1).max(60),
    /** Where Ajour shows the task's button: next to Mark as committed on the Commit page. */
    placement: z.literal("commit-week"),
    /** A Markdown file inside the plugin folder, at most 64 KB. */
    prompt: z.string().trim().min(1).max(240),
    estimateMinutes: z.number().int().min(1).max(240),
    /** URL template for the week in the external tool. Must give https. */
    weekLink: z.string().trim().min(1).max(500).optional(),
    settings: z.array(connectorFieldSchema).max(20).default([]),
  })
  .superRefine((task, context) => {
    if (!task.weekLink) return;
    const allowed = allowedTaskSlots(task.settings.map((field) => field.id));
    for (const slot of listTemplateSlots(task.weekLink)) {
      if (!allowed.has(slot)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekLink"],
          message: `The week link uses {{${slot}}}, which Ajour does not fill.`,
        });
      }
    }
  });
export type AgentTask = z.infer<typeof agentTaskSchema>;

/**
 * Text properties a plugin adds to every project, shown in a section of the
 * project properties card. See
 * docs/superpowers/specs/2026-10-15-plugin-project-properties-design.md.
 */
export const projectPropertyFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  label: z.string().trim().min(1).max(60),
  /** The Ajour project value shown while the user has typed none. */
  defaultFrom: z.enum(["fullName", "code"]).optional(),
});
export type ProjectPropertyField = z.infer<typeof projectPropertyFieldSchema>;

export const projectPropertiesSchema = z
  .object({
    section: z.string().trim().min(1).max(60),
    fields: z.array(projectPropertyFieldSchema).min(1).max(10),
  })
  .superRefine((capability, context) => {
    const seen = new Set<string>();
    capability.fields.forEach((field, index) => {
      if (seen.has(field.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields", index, "id"],
          message: `Two project properties use the id ${field.id}.`,
        });
      }
      seen.add(field.id);
    });
  });
export type ProjectPropertiesCapability = z.infer<
  typeof projectPropertiesSchema
>;

/**
 * What a plugin provides. A plugin declares at least one capability, and its
 * connections serve all of them. A connector without `settle` keeps working:
 * Ajour settles its items locally, with no write. See ADR 0001, ADR 0003 and,
 * for `calendar`, ADR 0005.
 */
export const connectorPluginCapabilitiesSchema = z
  .object({
    connector: z
      .object({
        settle: z.boolean().optional(),
      })
      .optional(),
    codeHost: z.object({}).optional(),
    calendar: z.object({}).optional(),
    agentTask: z
      .object({ tasks: z.array(agentTaskSchema).min(1).max(10) })
      .optional(),
    projectProperties: projectPropertiesSchema.optional(),
  })
  .refine(
    (capabilities) =>
      capabilities.connector !== undefined ||
      capabilities.codeHost !== undefined ||
      capabilities.calendar !== undefined ||
      capabilities.agentTask !== undefined ||
      capabilities.projectProperties !== undefined,
    "A plugin must declare at least one capability: connector, codeHost, calendar, agentTask or projectProperties.",
  );
export type ConnectorPluginCapabilities = z.infer<
  typeof connectorPluginCapabilitiesSchema
>;

export function pluginHasConnector(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.connector !== undefined;
}

export function pluginHasCodeHost(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.codeHost !== undefined;
}

export function pluginHasCalendar(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.calendar !== undefined;
}

export function pluginHasAgentTasks(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.agentTask !== undefined;
}

export function pluginHasProjectProperties(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.projectProperties !== undefined;
}

/** Whether the plugin runs code: it syncs items, serves pull requests or reads a calendar. */
export function pluginRunsCode(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return (
    pluginHasConnector(manifest) ||
    pluginHasCodeHost(manifest) ||
    pluginHasCalendar(manifest)
  );
}

/** The manifest fields, before the cross-field rules. The overview extends it. */
const connectorPluginManifestObjectSchema = z.object({
  id: connectorPluginIdSchema,
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  apiVersion: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  iconSvg: z.string().min(1).max(20000),
  /** Absent for a plugin that only declares agent tasks: it runs no code. */
  entrypoint: z.string().trim().min(1).max(240).optional(),
  connectionFields: z.array(connectorFieldSchema).max(50).default([]),
  capabilities: connectorPluginCapabilitiesSchema,
});

export const connectorPluginManifestSchema =
  connectorPluginManifestObjectSchema.superRefine((manifest, context) => {
    if (!pluginRunsCode(manifest)) return;
    if (!manifest.entrypoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entrypoint"],
        message:
          "A connector, code host or calendar plugin needs an entrypoint.",
      });
    }
    if (manifest.connectionFields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionFields"],
        message:
          "A connector, code host or calendar plugin needs connection fields.",
      });
    }
  });
export type ConnectorPluginManifest = z.infer<
  typeof connectorPluginManifestSchema
>;

export const connectorConnectionSummarySchema = z.object({
  id: z.string().min(1).max(120),
  pluginId: connectorSourceSchema,
  label: z.string().min(1).max(120),
  tenantLabel: z.string().min(1).max(120),
  autoSync: z.boolean(),
  autoSyncIntervalMinutes: z.number().int().min(1).max(1440),
  connectedAt: z.number().int().positive(),
  lastSyncAt: z.number().int().positive().optional(),
  lastError: z.string().max(1000).optional(),
  /** When the sync that set `lastError` failed. */
  lastErrorAt: z.number().int().positive().optional(),
  pendingImportCount: z.number().int().nonnegative(),
  selectedImportCount: z.number().int().nonnegative(),
  configSummary: connectorSummaryValuesSchema,
  editableValues: connectorFieldValuesSchema,
});
export type ConnectorConnectionSummary = z.infer<
  typeof connectorConnectionSummarySchema
>;

/**
 * A plugin as the overview reports it. Saved connections can outlive their
 * plugin (uninstalled, or rejected for another plugin API version), so the API
 * fills the gap with a placeholder, and `unavailableReason` tells the user
 * why. An unavailable plugin is the one with `unavailableReason`; an absent
 * entrypoint only means the plugin runs no code. Plugin packages still go
 * through the strict manifest schema.
 */
const connectorOverviewPluginSchema =
  connectorPluginManifestObjectSchema.extend({
    entrypoint: z.string().trim().max(240).optional(),
    unavailableReason: z.string().max(1000).optional(),
  });
export type ConnectorOverviewPlugin = z.infer<
  typeof connectorOverviewPluginSchema
>;

export const connectorOverviewGroupSchema = z.object({
  plugin: connectorOverviewPluginSchema,
  enabled: z.boolean(),
  connections: z.array(connectorConnectionSummarySchema),
});
export type ConnectorOverviewGroup = z.infer<
  typeof connectorOverviewGroupSchema
>;

export const connectorsOverviewSchema = z.object({
  pluginsEnabled: z.boolean(),
  plugins: z.array(connectorOverviewPluginSchema),
  connectionGroups: z.array(connectorOverviewGroupSchema),
  totalPendingImportCount: z.number().int().nonnegative(),
  totalSelectedImportCount: z.number().int().nonnegative(),
});
export type ConnectorsOverview = z.infer<typeof connectorsOverviewSchema>;

export const pluginSystemActivationUpdateSchema = z.object({
  enabled: z.boolean(),
});

export const connectorPluginActivationUpdateSchema = z.object({
  enabled: z.boolean(),
});
export type ConnectorPluginActivationUpdate = z.infer<
  typeof connectorPluginActivationUpdateSchema
>;

export const connectorPluginInstallResponseSchema = z.object({
  plugin: connectorPluginManifestSchema,
  replaced: z.boolean(),
  overview: connectorsOverviewSchema,
});
export type ConnectorPluginInstallResponse = z.infer<
  typeof connectorPluginInstallResponseSchema
>;

export const connectorPluginUninstallResponseSchema = z.object({
  pluginId: connectorPluginIdSchema,
  overview: connectorsOverviewSchema,
});
export type ConnectorPluginUninstallResponse = z.infer<
  typeof connectorPluginUninstallResponseSchema
>;

export const connectorBacklogStatusInputSchema = z.object({
  source: connectorSourceSchema,
  connectionId: z.string().trim().min(1).max(120),
  connectionLabel: z.string().trim().min(1).max(120),
  tenantLabel: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
});
export type ConnectorBacklogStatusInput = z.infer<
  typeof connectorBacklogStatusInputSchema
>;

export const connectorBacklogStatusSchema =
  connectorBacklogStatusInputSchema.extend({
    key: z.string().trim().min(1).max(160),
    lastSeenAt: z.number().int().positive(),
  });
export type ConnectorBacklogStatus = z.infer<
  typeof connectorBacklogStatusSchema
>;

export const connectorBacklogStatusListResponseSchema = z.object({
  items: z.array(connectorBacklogStatusSchema),
});
export type ConnectorBacklogStatusListResponse = z.infer<
  typeof connectorBacklogStatusListResponseSchema
>;

export const connectorBacklogStatusUpsertRequestSchema = z.object({
  items: z.array(connectorBacklogStatusInputSchema).min(1).max(200),
});
export type ConnectorBacklogStatusUpsertRequest = z.infer<
  typeof connectorBacklogStatusUpsertRequestSchema
>;

export const connectorBacklogStatusUpsertResponseSchema =
  connectorBacklogStatusListResponseSchema;
export type ConnectorBacklogStatusUpsertResponse = z.infer<
  typeof connectorBacklogStatusUpsertResponseSchema
>;

export const connectorEstimateFieldKeySchema = z.enum([
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
]);
export type ConnectorEstimateFieldKey = z.infer<
  typeof connectorEstimateFieldKeySchema
>;

export const connectorSyncEstimateFieldStateSchema = z.object({
  baselineValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  resolution: z.enum(["keep_local"]).optional(),
});
export type ConnectorSyncEstimateFieldState = z.infer<
  typeof connectorSyncEstimateFieldStateSchema
>;

export const connectorSyncEstimateStateSchema = z.object({
  originalEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
  remainingEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
  completedEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
});
export type ConnectorSyncEstimateState = z.infer<
  typeof connectorSyncEstimateStateSchema
>;

export const connectorSyncWorkItemSchema = z.object({
  localWorkItemId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(400),
  originalEstimateHours: z.number().finite().nonnegative().optional(),
  remainingEstimateHours: z.number().finite().nonnegative().optional(),
  completedEstimateHours: z.number().finite().nonnegative().optional(),
  estimateSync: connectorSyncEstimateStateSchema.optional(),
});
export type ConnectorSyncWorkItem = z.infer<typeof connectorSyncWorkItemSchema>;

export const connectorSyncRequestSchema = z.object({
  trigger: z.enum(["manual", "auto", "source_write"]).default("manual"),
  workItems: z.array(connectorSyncWorkItemSchema).max(1000).default([]),
});
export type ConnectorSyncRequest = z.infer<typeof connectorSyncRequestSchema>;

export const connectorConnectionSaveRequestSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  values: connectorFieldValuesSchema,
});
export type ConnectorConnectionSaveRequest = z.infer<
  typeof connectorConnectionSaveRequestSchema
>;

export const connectorConnectionSaveResponseSchema = z.object({
  overview: connectorsOverviewSchema,
  connection: connectorConnectionSummarySchema,
});
export type ConnectorConnectionSaveResponse = z.infer<
  typeof connectorConnectionSaveResponseSchema
>;

export const connectorPluginValidationResultSchema = z.object({
  normalizedConfig: connectorFieldValuesSchema,
  connectionSummary: connectorSummaryValuesSchema.default({}),
});
export type ConnectorPluginValidationResult = z.infer<
  typeof connectorPluginValidationResultSchema
>;

export const connectorImportCandidateInputSchema = z.object({
  source: connectorSourceSchema,
  connectionId: z.string().trim().min(1).max(120),
  connectionLabel: z.string().trim().min(1).max(120),
  tenantLabel: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(400),
  externalId: z.string().trim().min(1).max(120),
  sourceUrl: z.string().url().optional(),
  title: z.string().trim().min(1).max(240),
  note: z.string().trim().max(4000).optional(),
  projectName: z.string().trim().max(120).optional(),
  workItemType: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).optional(),
  /** The source's category for `state`, such as Azure DevOps "Resolved". */
  stateCategory: z.string().trim().max(120).optional(),
  /**
   * Whether `state` is in a done category, such as Azure DevOps Completed or
   * Removed, or Jira Done. The plugin decides, so Ajour never names source
   * states. Ajour archives a backlog item that reaches a done category.
   */
  stateDone: z.boolean().optional(),
  assignedTo: z.string().trim().max(240).optional(),
  priority: connectorPriorityLevelSchema.optional(),
  originalEstimateHours: z.number().finite().nonnegative().optional(),
  remainingEstimateHours: z.number().finite().nonnegative().optional(),
  completedEstimateHours: z.number().finite().nonnegative().optional(),
  parentSourceId: z.string().trim().min(1).max(400).optional(),
  parentTitle: z.string().trim().max(240).optional(),
  depth: connectorImportDepthSchema,
  selectable: z.boolean().default(true),
  selected: z.boolean().optional(),
  childCount: z.number().int().nonnegative().default(0),
  pushedAt: z.number().int().positive().optional(),
});
export type ConnectorImportCandidateInput = z.infer<
  typeof connectorImportCandidateInputSchema
>;

export const connectorImportCandidateSchema =
  connectorImportCandidateInputSchema.extend({
    id: z.string().min(1).max(200),
    selected: z.boolean(),
    pushedAt: z.number().int().positive(),
  });
export type ConnectorImportCandidate = z.infer<
  typeof connectorImportCandidateSchema
>;

export const connectorSyncFieldUpdateSchema = z.object({
  status: z.enum(["noop", "pushed", "pulled", "conflict", "error"]),
  localValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  baselineValue: z.number().finite().nonnegative().optional(),
  nextBaselineValue: z.number().finite().nonnegative().optional(),
  message: z.string().trim().max(1000).optional(),
});
export type ConnectorSyncFieldUpdate = z.infer<
  typeof connectorSyncFieldUpdateSchema
>;

export const connectorSyncWorkItemUpdateSchema = z.object({
  localWorkItemId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(400),
  fields: z.object({
    originalEstimateHours: connectorSyncFieldUpdateSchema.optional(),
    remainingEstimateHours: connectorSyncFieldUpdateSchema.optional(),
    completedEstimateHours: connectorSyncFieldUpdateSchema.optional(),
  }),
});
export type ConnectorSyncWorkItemUpdate = z.infer<
  typeof connectorSyncWorkItemUpdateSchema
>;

/** A state a backlog item can move to when it is settled. */
export const connectorSettleStateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Groups the state in the settle dialog, in the order the plugin lists. */
  category: z.string().trim().min(1).max(120),
  done: z.boolean(),
});
export type ConnectorSettleState = z.infer<typeof connectorSettleStateSchema>;

export const connectorSettleStatesRequestSchema = z.object({
  sourceId: z.string().trim().min(1).max(400),
});
export type ConnectorSettleStatesRequest = z.infer<
  typeof connectorSettleStatesRequestSchema
>;

export const connectorSettleStatesResultSchema = z.object({
  states: z.array(connectorSettleStateSchema).max(200),
});
export type ConnectorSettleStatesResult = z.infer<
  typeof connectorSettleStatesResultSchema
>;

/**
 * Writes a settle to one backlog item. Only changed fields are sent. The
 * plugin turns the priority level into a value of its source priority field.
 */
export const connectorSettleWriteRequestSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(400),
    state: z.string().trim().min(1).max(120).optional(),
    priority: connectorPriorityLevelSchema.optional(),
  })
  .refine(
    (request) => request.state !== undefined || request.priority !== undefined,
    "A settle write needs a state, a priority or both.",
  );
export type ConnectorSettleWriteRequest = z.infer<
  typeof connectorSettleWriteRequestSchema
>;

/** The item's values in the source after the write. */
export const connectorSettleWriteResultSchema = z.object({
  state: z.string().trim().max(120).optional(),
  stateCategory: z.string().trim().max(120).optional(),
  stateDone: z.boolean().optional(),
  priority: connectorPriorityLevelSchema.optional(),
});
export type ConnectorSettleWriteResult = z.infer<
  typeof connectorSettleWriteResultSchema
>;

/** A synced backlog item that reached a done category in its source. */
export const connectorDoneWorkItemSchema = z.object({
  source: connectorSourceSchema,
  connectionId: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(400),
  state: z.string().trim().max(120).optional(),
});
export type ConnectorDoneWorkItem = z.infer<typeof connectorDoneWorkItemSchema>;

export const connectorPluginSyncResultSchema = z.object({
  items: z.array(connectorImportCandidateInputSchema),
  workItemUpdates: z.array(connectorSyncWorkItemUpdateSchema).default([]),
});
export type ConnectorPluginSyncResult = z.infer<
  typeof connectorPluginSyncResultSchema
>;

export const connectorImportPushRequestSchema = z.object({
  items: z.array(connectorImportCandidateInputSchema).min(1).max(200),
});
export type ConnectorImportPushRequest = z.infer<
  typeof connectorImportPushRequestSchema
>;

export const connectorImportPushResponseSchema = z.object({
  queuedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type ConnectorImportPushResponse = z.infer<
  typeof connectorImportPushResponseSchema
>;

export const connectorImportListResponseSchema = z.object({
  items: z.array(connectorImportCandidateSchema),
  totalCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
});
export type ConnectorImportListResponse = z.infer<
  typeof connectorImportListResponseSchema
>;

export const connectorImportSelectionUpdateSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
  selected: z.boolean(),
});
export type ConnectorImportSelectionUpdate = z.infer<
  typeof connectorImportSelectionUpdateSchema
>;

export const connectorImportSelectionResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type ConnectorImportSelectionResponse = z.infer<
  typeof connectorImportSelectionResponseSchema
>;

export const connectorImportDismissRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
});
export type ConnectorImportDismissRequest = z.infer<
  typeof connectorImportDismissRequestSchema
>;

export const connectorImportDismissResponseSchema = z.object({
  dismissedCount: z.number().int().nonnegative(),
  /** Present when items were dismissed. Undo passes it back to restore them. */
  undoToken: z.string().min(1).max(200).optional(),
});
export type ConnectorImportDismissResponse = z.infer<
  typeof connectorImportDismissResponseSchema
>;

export const connectorImportRestoreRequestSchema = z.object({
  undoToken: z.string().min(1).max(200),
});
export type ConnectorImportRestoreRequest = z.infer<
  typeof connectorImportRestoreRequestSchema
>;

/**
 * `stale` means a dismissed item was staged again or un-dismissed since.
 * `expired` means a later dismissal replaced this one, its connection was
 * deleted, or the API restarted.
 */
export const connectorImportRestoreResponseSchema = z.object({
  result: z.enum(["restored", "stale", "expired"]),
});
export type ConnectorImportRestoreResponse = z.infer<
  typeof connectorImportRestoreResponseSchema
>;

export const connectorImportCommitResponseSchema = z.object({
  items: z.array(connectorImportCandidateSchema),
  committedCount: z.number().int().nonnegative(),
});
export type ConnectorImportCommitResponse = z.infer<
  typeof connectorImportCommitResponseSchema
>;

export const connectorSyncResultSchema = z.object({
  connection: connectorConnectionSummarySchema,
  mode: z.enum(["review", "backlog"]),
  items: z.array(connectorImportCandidateSchema),
  stagedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  workItemUpdates: z.array(connectorSyncWorkItemUpdateSchema).default([]),
  /** Items that reached a done category. They are never staged for review. */
  doneItems: z.array(connectorDoneWorkItemSchema).default([]),
});
export type ConnectorSyncResult = z.infer<typeof connectorSyncResultSchema>;
