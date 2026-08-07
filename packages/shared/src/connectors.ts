import { z } from "zod";

export const CONNECTOR_PLUGIN_API_VERSION = 1;
export const CONNECTOR_PLUGIN_ARCHIVE_EXTENSION = ".harday-connector";

export const connectorSourceSchema = z.string().trim().min(1).max(120);
export type ConnectorBacklogSource = z.infer<typeof connectorSourceSchema>;

export const connectorPluginIdSchema = connectorSourceSchema.regex(
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  "Connector plugin identifiers must use lowercase letters, numbers, dots, underscores, or hyphens.",
);

export function normalizeConnectorStatusKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export const azureDevOpsQueryScopes = ["assigned_to_me", "project_open_tasks"] as const;
export type AzureDevOpsQueryScope = (typeof azureDevOpsQueryScopes)[number];

export const jiraQueryScopes = ["assigned_to_me", "project_open_issues"] as const;
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

export const connectorFieldValuesSchema = z.record(z.string().min(1).max(120), connectorFieldValueSchema);
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
export type ConnectorSummaryValues = z.infer<typeof connectorSummaryValuesSchema>;

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

export const connectorPluginManifestSchema = z.object({
  id: connectorPluginIdSchema,
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  apiVersion: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  iconSvg: z.string().min(1).max(20000),
  entrypoint: z.string().trim().min(1).max(240),
  connectionFields: z.array(connectorFieldSchema).min(1).max(50),
});
export type ConnectorPluginManifest = z.infer<typeof connectorPluginManifestSchema>;

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
  pendingImportCount: z.number().int().nonnegative(),
  selectedImportCount: z.number().int().nonnegative(),
  configSummary: connectorSummaryValuesSchema,
  editableValues: connectorFieldValuesSchema,
});
export type ConnectorConnectionSummary = z.infer<typeof connectorConnectionSummarySchema>;

export const connectorOverviewGroupSchema = z.object({
  plugin: connectorPluginManifestSchema,
  enabled: z.boolean(),
  connections: z.array(connectorConnectionSummarySchema),
});
export type ConnectorOverviewGroup = z.infer<typeof connectorOverviewGroupSchema>;

export const connectorsOverviewSchema = z.object({
  pluginsEnabled: z.boolean(),
  plugins: z.array(connectorPluginManifestSchema),
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
export type ConnectorBacklogStatusInput = z.infer<typeof connectorBacklogStatusInputSchema>;

export const connectorBacklogStatusSchema = connectorBacklogStatusInputSchema.extend({
  key: z.string().trim().min(1).max(160),
  lastSeenAt: z.number().int().positive(),
});
export type ConnectorBacklogStatus = z.infer<typeof connectorBacklogStatusSchema>;

export const connectorBacklogStatusListResponseSchema = z.object({
  items: z.array(connectorBacklogStatusSchema),
});
export type ConnectorBacklogStatusListResponse = z.infer<typeof connectorBacklogStatusListResponseSchema>;

export const connectorBacklogStatusUpsertRequestSchema = z.object({
  items: z.array(connectorBacklogStatusInputSchema).min(1).max(200),
});
export type ConnectorBacklogStatusUpsertRequest = z.infer<typeof connectorBacklogStatusUpsertRequestSchema>;

export const connectorBacklogStatusUpsertResponseSchema = connectorBacklogStatusListResponseSchema;
export type ConnectorBacklogStatusUpsertResponse = z.infer<typeof connectorBacklogStatusUpsertResponseSchema>;

export const connectorEstimateFieldKeySchema = z.enum([
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
]);
export type ConnectorEstimateFieldKey = z.infer<typeof connectorEstimateFieldKeySchema>;

export const connectorSyncEstimateFieldStateSchema = z.object({
  baselineValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  resolution: z.enum(["keep_local"]).optional(),
});
export type ConnectorSyncEstimateFieldState = z.infer<typeof connectorSyncEstimateFieldStateSchema>;

export const connectorSyncEstimateStateSchema = z.object({
  originalEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
  remainingEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
  completedEstimateHours: connectorSyncEstimateFieldStateSchema.optional(),
});
export type ConnectorSyncEstimateState = z.infer<typeof connectorSyncEstimateStateSchema>;

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
export type ConnectorConnectionSaveRequest = z.infer<typeof connectorConnectionSaveRequestSchema>;

export const connectorConnectionSaveResponseSchema = z.object({
  overview: connectorsOverviewSchema,
  connection: connectorConnectionSummarySchema,
});
export type ConnectorConnectionSaveResponse = z.infer<typeof connectorConnectionSaveResponseSchema>;

export const connectorPluginValidationResultSchema = z.object({
  normalizedConfig: connectorFieldValuesSchema,
  connectionSummary: connectorSummaryValuesSchema.default({}),
});
export type ConnectorPluginValidationResult = z.infer<typeof connectorPluginValidationResultSchema>;

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
  assignedTo: z.string().trim().max(240).optional(),
  priority: z.number().int().min(0).max(999).optional(),
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
export type ConnectorImportCandidateInput = z.infer<typeof connectorImportCandidateInputSchema>;

export const connectorImportCandidateSchema = connectorImportCandidateInputSchema.extend({
  id: z.string().min(1).max(200),
  selected: z.boolean(),
  pushedAt: z.number().int().positive(),
});
export type ConnectorImportCandidate = z.infer<typeof connectorImportCandidateSchema>;

export const connectorSyncFieldUpdateSchema = z.object({
  status: z.enum(["noop", "pushed", "pulled", "conflict", "error"]),
  localValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  baselineValue: z.number().finite().nonnegative().optional(),
  nextBaselineValue: z.number().finite().nonnegative().optional(),
  message: z.string().trim().max(1000).optional(),
});
export type ConnectorSyncFieldUpdate = z.infer<typeof connectorSyncFieldUpdateSchema>;

export const connectorSyncWorkItemUpdateSchema = z.object({
  localWorkItemId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(400),
  fields: z.object({
    originalEstimateHours: connectorSyncFieldUpdateSchema.optional(),
    remainingEstimateHours: connectorSyncFieldUpdateSchema.optional(),
    completedEstimateHours: connectorSyncFieldUpdateSchema.optional(),
  }),
});
export type ConnectorSyncWorkItemUpdate = z.infer<typeof connectorSyncWorkItemUpdateSchema>;

export const connectorPluginSyncResultSchema = z.object({
  items: z.array(connectorImportCandidateInputSchema),
  workItemUpdates: z.array(connectorSyncWorkItemUpdateSchema).default([]),
});
export type ConnectorPluginSyncResult = z.infer<typeof connectorPluginSyncResultSchema>;

export const connectorImportPushRequestSchema = z.object({
  items: z.array(connectorImportCandidateInputSchema).min(1).max(200),
});
export type ConnectorImportPushRequest = z.infer<typeof connectorImportPushRequestSchema>;

export const connectorImportPushResponseSchema = z.object({
  queuedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type ConnectorImportPushResponse = z.infer<typeof connectorImportPushResponseSchema>;

export const connectorImportListResponseSchema = z.object({
  items: z.array(connectorImportCandidateSchema),
  totalCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
});
export type ConnectorImportListResponse = z.infer<typeof connectorImportListResponseSchema>;

export const connectorImportSelectionUpdateSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
  selected: z.boolean(),
});
export type ConnectorImportSelectionUpdate = z.infer<typeof connectorImportSelectionUpdateSchema>;

export const connectorImportSelectionResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type ConnectorImportSelectionResponse = z.infer<typeof connectorImportSelectionResponseSchema>;

export const connectorImportDismissRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
});
export type ConnectorImportDismissRequest = z.infer<typeof connectorImportDismissRequestSchema>;

export const connectorImportDismissResponseSchema = z.object({
  dismissedCount: z.number().int().nonnegative(),
});
export type ConnectorImportDismissResponse = z.infer<typeof connectorImportDismissResponseSchema>;

export const connectorImportCommitResponseSchema = z.object({
  items: z.array(connectorImportCandidateSchema),
  committedCount: z.number().int().nonnegative(),
});
export type ConnectorImportCommitResponse = z.infer<typeof connectorImportCommitResponseSchema>;

export const connectorSyncResultSchema = z.object({
  connection: connectorConnectionSummarySchema,
  mode: z.enum(["review", "backlog"]),
  items: z.array(connectorImportCandidateSchema),
  stagedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  workItemUpdates: z.array(connectorSyncWorkItemUpdateSchema).default([]),
});
export type ConnectorSyncResult = z.infer<typeof connectorSyncResultSchema>;
