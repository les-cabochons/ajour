import { z } from "zod";
import { allowedTaskSlots, listTemplateSlots } from "./agent-task-templates.ts";
import { teamCapabilitySchema, teamCreateRequestSchema } from "./team-sync.ts";
import {
  backlogCommentsCapabilitySchema,
  backlogItemCommentFactsSchema,
  backlogPersonSchema,
} from "./backlog-comments.ts";

export const PLUGIN_API_VERSION = 3;
export const PLUGIN_ARCHIVE_EXTENSION = ".ajour-connector";

export const backlogSourceSchema = z.string().trim().min(1).max(120);
export type BacklogSource = z.infer<typeof backlogSourceSchema>;

export const pluginIdSchema = backlogSourceSchema.regex(
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  "Plugin identifiers must use lowercase letters, numbers, dots, underscores, or hyphens.",
);

export function normalizeSourceStatusKey(value: string) {
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

export const backlogTaskIconDisplayModes = [
  "always",
  "fallback",
  "never",
] as const;
export const backlogTaskIconDisplayModeSchema = z.enum(
  backlogTaskIconDisplayModes,
);
export type BacklogTaskIconDisplayMode = z.infer<
  typeof backlogTaskIconDisplayModeSchema
>;
export const DEFAULT_BACKLOG_TASK_ICON_DISPLAY_MODE: BacklogTaskIconDisplayMode =
  "always";

export const backlogImportDepthSchema = z.union([z.literal(0), z.literal(1)]);
export type BacklogImportDepth = z.infer<typeof backlogImportDepthSchema>;

export const pluginFieldValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
]);
export type PluginFieldValue = z.infer<typeof pluginFieldValueSchema>;

export const pluginFieldValuesSchema = z.record(
  z.string().min(1).max(120),
  pluginFieldValueSchema,
);
export type PluginFieldValues = z.infer<typeof pluginFieldValuesSchema>;

export const pluginSummaryValueSchema = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
]);
export type PluginSummaryValue = z.infer<typeof pluginSummaryValueSchema>;

export const pluginSummaryValuesSchema = z.record(
  z.string().min(1).max(120),
  pluginSummaryValueSchema,
);
export type PluginSummaryValues = z.infer<typeof pluginSummaryValuesSchema>;

export const pluginFieldTypeSchema = z.enum([
  "text",
  "password",
  "url",
  "select",
  "number",
  "checkbox",
]);
export type PluginFieldType = z.infer<typeof pluginFieldTypeSchema>;

export const pluginFieldOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
});
export type PluginFieldOption = z.infer<typeof pluginFieldOptionSchema>;

/**
 * The capabilities a user turns on and off separately when a plugin declares
 * more than one. Agent tasks and project properties follow the plugin's own
 * switch.
 */
export const switchableCapabilitySchema = z.enum([
  "connector",
  "codeHost",
  "calendar",
  "team",
]);
export type SwitchableCapability = z.infer<typeof switchableCapabilitySchema>;

/** How people see each switchable capability, on its switch and in messages. */
export const switchableCapabilityLabels: Record<SwitchableCapability, string> =
  {
    connector: "Backlog items",
    codeHost: "Pull requests",
    calendar: "Calendar events",
    team: "Projects",
  };

export const pluginFieldSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  type: pluginFieldTypeSchema,
  placeholder: z.string().trim().max(240).optional(),
  helpText: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  defaultValue: pluginFieldValueSchema.optional(),
  options: z.array(pluginFieldOptionSchema).max(50).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().optional(),
  /**
   * The capability the field configures. The connection form hides it, and
   * skips its required check, while that capability is off. Absent for a
   * field every capability uses, such as the token.
   */
  capability: switchableCapabilitySchema.optional(),
});
export type PluginField = z.infer<typeof pluginFieldSchema>;

/**
 * Ajour's priority levels. Each plugin maps its source's priority values to
 * these levels on sync, and back to a source value on a settle write. An item
 * without a level has No priority.
 */
export const backlogPriorityLevelSchema = z.enum([
  "urgent",
  "high",
  "medium",
  "low",
]);
export type BacklogPriorityLevel = z.infer<typeof backlogPriorityLevelSchema>;

/**
 * A task an agent runs for the plugin, from a prompt file. No plugin code
 * runs. See docs/specs/2026-10-15-ajour-agent-runner-design.md.
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
    settings: z.array(pluginFieldSchema).max(20).default([]),
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
 * docs/specs/2026-10-15-plugin-project-properties-design.md.
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
 * connections serve all of them. A backlog plugin without `settle` keeps working:
 * Ajour settles its items locally, with no write. See ADR 0001, ADR 0003 and,
 * for `calendar`, ADR 0005.
 */
export const pluginCapabilitiesSchema = z
  .object({
    connector: z
      .object({
        settle: z.boolean().optional(),
        /** Comments on synced items. See ADR 0008. */
        comments: backlogCommentsCapabilitySchema.optional(),
      })
      .optional(),
    codeHost: z.object({}).optional(),
    calendar: z.object({}).optional(),
    /** Keeps a team's shared projects in step. See ADR 0006. */
    team: teamCapabilitySchema.optional(),
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
      capabilities.team !== undefined ||
      capabilities.agentTask !== undefined ||
      capabilities.projectProperties !== undefined,
    "A plugin must declare at least one capability: connector, codeHost, calendar, team, agentTask or projectProperties.",
  );
export type PluginCapabilities = z.infer<typeof pluginCapabilitiesSchema>;

export function pluginHasBacklog(manifest: {
  capabilities: PluginCapabilities;
}) {
  return manifest.capabilities.connector !== undefined;
}

export function pluginHasCodeHost(manifest: {
  capabilities: PluginCapabilities;
}) {
  return manifest.capabilities.codeHost !== undefined;
}

export function pluginHasCalendar(manifest: {
  capabilities: PluginCapabilities;
}) {
  return manifest.capabilities.calendar !== undefined;
}

export function pluginHasTeam(manifest: { capabilities: PluginCapabilities }) {
  return manifest.capabilities.team !== undefined;
}

export function pluginHasAgentTasks(manifest: {
  capabilities: PluginCapabilities;
}) {
  return manifest.capabilities.agentTask !== undefined;
}

export function pluginHasProjectProperties(manifest: {
  capabilities: PluginCapabilities;
}) {
  return manifest.capabilities.projectProperties !== undefined;
}

export function pluginHasCapability(
  manifest: { capabilities: PluginCapabilities },
  capability: SwitchableCapability,
) {
  return manifest.capabilities[capability] !== undefined;
}

/** The switchable capabilities the plugin declares, in switch order. */
export function pluginSwitchableCapabilities(manifest: {
  capabilities: PluginCapabilities;
}): SwitchableCapability[] {
  return switchableCapabilitySchema.options.filter((capability) =>
    pluginHasCapability(manifest, capability),
  );
}

/** The plugin declares more than one, so each gets its own switch. */
export function pluginHasSwitchableCapabilities(manifest: {
  capabilities: PluginCapabilities;
}) {
  return pluginSwitchableCapabilities(manifest).length > 1;
}

/**
 * Whether the plugin runs code: it syncs items, serves pull requests, reads
 * a calendar or syncs a team's projects.
 */
export function pluginRunsCode(manifest: { capabilities: PluginCapabilities }) {
  return pluginSwitchableCapabilities(manifest).length > 0;
}

/** The manifest fields, before the cross-field rules. The overview extends it. */
const pluginManifestObjectSchema = z.object({
  id: pluginIdSchema,
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
  connectionFields: z.array(pluginFieldSchema).max(50).default([]),
  capabilities: pluginCapabilitiesSchema,
});

export const pluginManifestSchema = pluginManifestObjectSchema.superRefine(
  (manifest, context) => {
    if (!pluginRunsCode(manifest)) return;
    if (!manifest.entrypoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entrypoint"],
        message:
          "A backlog, code host, calendar or team plugin needs an entrypoint.",
      });
    }
    if (manifest.connectionFields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionFields"],
        message:
          "A backlog, code host, calendar or team plugin needs connection fields.",
      });
    }
  },
);
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * What connected agents may do with a connection's comments (map #234): None,
 * the default, Read, or Read and post. Agents' models run at their provider,
 * so comments they read leave the machine (ADR 0004). Ajour owns the setting:
 * a plugin cannot declare it or set its default.
 */
export const agentAccessSchema = z.enum(["none", "read", "readWrite"]);
export type AgentAccess = z.infer<typeof agentAccessSchema>;

export const AGENT_ACCESS_FIELD_ID = "agentAccess";

const agentAccessField: PluginField = {
  id: AGENT_ACCESS_FIELD_ID,
  label: "Agent access to comments",
  type: "select",
  helpText:
    "What connected agents may do with this connection's comments. Comments an agent reads go to its model provider.",
  required: true,
  secret: false,
  defaultValue: "none",
  options: [
    { value: "none", label: "None" },
    { value: "read", label: "Read" },
    { value: "readWrite", label: "Read and post" },
  ],
  capability: "connector",
};

/**
 * The connection form's fields: the plugin's own, then the ones Ajour adds
 * for what the plugin provides. A plugin field with an id Ajour owns is
 * dropped.
 */
export function pluginConnectionFormFields(
  plugin: Pick<PluginManifest, "connectionFields" | "capabilities">,
): PluginField[] {
  const fields = plugin.connectionFields.filter(
    (field) => field.id !== AGENT_ACCESS_FIELD_ID,
  );
  return plugin.capabilities.connector?.comments
    ? [...fields, agentAccessField]
    : fields;
}

export const pluginConnectionSummarySchema = z.object({
  id: z.string().min(1).max(120),
  pluginId: backlogSourceSchema,
  label: z.string().min(1).max(120),
  tenantLabel: z.string().min(1).max(120),
  autoSync: z.boolean(),
  autoSyncIntervalMinutes: z.number().int().min(1).max(1440),
  /** Pull requests sync on the interval. Absent until the connection saves it. */
  pullRequestAutoSync: z.boolean().optional(),
  /** Absent means None. See `connectionAgentAccess`. */
  agentAccess: agentAccessSchema.optional(),
  connectedAt: z.number().int().positive(),
  lastSyncAt: z.number().int().positive().optional(),
  lastError: z.string().max(1000).optional(),
  /** When the sync that set `lastError` failed. */
  lastErrorAt: z.number().int().positive().optional(),
  pendingImportCount: z.number().int().nonnegative(),
  selectedImportCount: z.number().int().nonnegative(),
  configSummary: pluginSummaryValuesSchema,
  editableValues: pluginFieldValuesSchema,
});
export type PluginConnectionSummary = z.infer<
  typeof pluginConnectionSummarySchema
>;

/**
 * A plugin as the overview reports it. Saved connections can outlive their
 * plugin (uninstalled, or rejected for another plugin API version), so the API
 * fills the gap with a placeholder, and `unavailableReason` tells the user
 * why. An unavailable plugin is the one with `unavailableReason`; an absent
 * entrypoint only means the plugin runs no code. Plugin packages still go
 * through the strict manifest schema.
 */
const pluginOverviewItemSchema = pluginManifestObjectSchema.extend({
  entrypoint: z.string().trim().max(240).optional(),
  unavailableReason: z.string().max(1000).optional(),
});
export type PluginOverviewItem = z.infer<typeof pluginOverviewItemSchema>;

export const pluginOverviewGroupSchema = z.object({
  plugin: pluginOverviewItemSchema,
  enabled: z.boolean(),
  /** Declared capabilities the user turned off. `enabled` still gates all. */
  inactiveCapabilities: z.array(switchableCapabilitySchema).optional(),
  connections: z.array(pluginConnectionSummarySchema),
});
export type PluginOverviewGroup = z.infer<typeof pluginOverviewGroupSchema>;

/**
 * Whether the connection syncs pull requests on its interval. For backlog
 * items, auto sync means importing straight to the backlog, so pull requests
 * have their own setting. A connection saved before it existed keeps following
 * auto sync, which is what auto sync meant for its pull requests then.
 */
export function syncsPullRequestsAutomatically(
  connection: Pick<PluginConnectionSummary, "autoSync" | "pullRequestAutoSync">,
) {
  return connection.pullRequestAutoSync ?? connection.autoSync;
}

/** Whether the access level lets agents read, or read and post, comments. */
export function agentAccessAllows(
  access: AgentAccess,
  need: "read" | "readWrite",
) {
  return need === "read" ? access !== "none" : access === "readWrite";
}

/** What agents may do with the connection's comments. None until the user allows more. */
export function connectionAgentAccess(
  connection: Pick<PluginConnectionSummary, "agentAccess">,
): AgentAccess {
  return connection.agentAccess ?? "none";
}

/** Whether the plugin declares the capability and the user left it on. */
export function isCapabilitySwitchedOn(
  group: {
    plugin: { capabilities: PluginCapabilities };
    inactiveCapabilities?: readonly SwitchableCapability[];
  },
  capability: SwitchableCapability,
) {
  return (
    pluginHasCapability(group.plugin, capability) &&
    !group.inactiveCapabilities?.includes(capability)
  );
}

/** Whether the capability can run: its plugin is on and so is the capability. */
export function isCapabilityActive(
  group: Pick<
    PluginOverviewGroup,
    "plugin" | "enabled" | "inactiveCapabilities"
  >,
  capability: SwitchableCapability,
) {
  return group.enabled && isCapabilitySwitchedOn(group, capability);
}

export const pluginsOverviewSchema = z.object({
  pluginsEnabled: z.boolean(),
  plugins: z.array(pluginOverviewItemSchema),
  connectionGroups: z.array(pluginOverviewGroupSchema),
  totalPendingImportCount: z.number().int().nonnegative(),
  totalSelectedImportCount: z.number().int().nonnegative(),
});
export type PluginsOverview = z.infer<typeof pluginsOverviewSchema>;

export const pluginSystemActivationUpdateSchema = z.object({
  enabled: z.boolean(),
});

/** Turns the plugin on or off, or only one of its capabilities. */
export const pluginActivationUpdateSchema = z.object({
  enabled: z.boolean(),
  capability: switchableCapabilitySchema.optional(),
});
export type PluginActivationUpdate = z.infer<
  typeof pluginActivationUpdateSchema
>;

export const pluginInstallResponseSchema = z.object({
  plugin: pluginManifestSchema,
  replaced: z.boolean(),
  overview: pluginsOverviewSchema,
});
export type PluginInstallResponse = z.infer<typeof pluginInstallResponseSchema>;

export const pluginUninstallResponseSchema = z.object({
  pluginId: pluginIdSchema,
  overview: pluginsOverviewSchema,
});
export type PluginUninstallResponse = z.infer<
  typeof pluginUninstallResponseSchema
>;

export const backlogSourceStatusInputSchema = z.object({
  source: backlogSourceSchema,
  connectionId: z.string().trim().min(1).max(120),
  connectionLabel: z.string().trim().min(1).max(120),
  tenantLabel: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
});
export type BacklogSourceStatusInput = z.infer<
  typeof backlogSourceStatusInputSchema
>;

export const backlogSourceStatusSchema = backlogSourceStatusInputSchema.extend({
  key: z.string().trim().min(1).max(160),
  lastSeenAt: z.number().int().positive(),
});
export type BacklogSourceStatus = z.infer<typeof backlogSourceStatusSchema>;

export const backlogSourceStatusListResponseSchema = z.object({
  items: z.array(backlogSourceStatusSchema),
});
export type BacklogSourceStatusListResponse = z.infer<
  typeof backlogSourceStatusListResponseSchema
>;

export const backlogSourceStatusUpsertRequestSchema = z.object({
  items: z.array(backlogSourceStatusInputSchema).min(1).max(200),
});
export type BacklogSourceStatusUpsertRequest = z.infer<
  typeof backlogSourceStatusUpsertRequestSchema
>;

export const backlogSourceStatusUpsertResponseSchema =
  backlogSourceStatusListResponseSchema;
export type BacklogSourceStatusUpsertResponse = z.infer<
  typeof backlogSourceStatusUpsertResponseSchema
>;

export const backlogEstimateFieldKeySchema = z.enum([
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
]);
export type BacklogEstimateFieldKey = z.infer<
  typeof backlogEstimateFieldKeySchema
>;

export const backlogSyncEstimateFieldStateSchema = z.object({
  baselineValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  resolution: z.enum(["keep_local"]).optional(),
});
export type BacklogSyncEstimateFieldState = z.infer<
  typeof backlogSyncEstimateFieldStateSchema
>;

export const backlogSyncEstimateStateSchema = z.object({
  originalEstimateHours: backlogSyncEstimateFieldStateSchema.optional(),
  remainingEstimateHours: backlogSyncEstimateFieldStateSchema.optional(),
  completedEstimateHours: backlogSyncEstimateFieldStateSchema.optional(),
});
export type BacklogSyncEstimateState = z.infer<
  typeof backlogSyncEstimateStateSchema
>;

export const backlogSyncWorkItemSchema = z.object({
  localWorkItemId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(400),
  originalEstimateHours: z.number().finite().nonnegative().optional(),
  remainingEstimateHours: z.number().finite().nonnegative().optional(),
  completedEstimateHours: z.number().finite().nonnegative().optional(),
  estimateSync: backlogSyncEstimateStateSchema.optional(),
  /**
   * Set on settled items: report the comments posted after this time
   * (ISO 8601) as `commentFacts`. See ADR 0008.
   */
  commentsSince: z.string().min(1).max(40).optional(),
});
export type BacklogSyncWorkItem = z.infer<typeof backlogSyncWorkItemSchema>;

export const backlogSyncRequestSchema = z.object({
  trigger: z.enum(["manual", "auto", "source_write"]).default("manual"),
  workItems: z.array(backlogSyncWorkItemSchema).max(1000).default([]),
});
export type BacklogSyncRequest = z.infer<typeof backlogSyncRequestSchema>;

export const pluginConnectionSaveRequestSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  values: pluginFieldValuesSchema,
});
export type PluginConnectionSaveRequest = z.infer<
  typeof pluginConnectionSaveRequestSchema
>;

export const pluginConnectionSaveResponseSchema = z.object({
  overview: pluginsOverviewSchema,
  connection: pluginConnectionSummarySchema,
});
export type PluginConnectionSaveResponse = z.infer<
  typeof pluginConnectionSaveResponseSchema
>;

export const pluginValidationResultSchema = z.object({
  normalizedConfig: pluginFieldValuesSchema,
  connectionSummary: pluginSummaryValuesSchema.default({}),
});
export type PluginValidationResult = z.infer<
  typeof pluginValidationResultSchema
>;

/**
 * The second argument of `validateConnection`: the switchable capabilities
 * that are on, so a plugin checks only the access they need. Plugins written
 * before it ignore it.
 */
export const pluginValidationContextSchema = z.object({
  capabilities: z.array(switchableCapabilitySchema),
});
export type PluginValidationContext = z.infer<
  typeof pluginValidationContextSchema
>;

/**
 * What a team plugin's `createTeam` returns: the connection field values that
 * join the new team, such as its ID and secret, for the form to fill in.
 */
export const teamCreateResultSchema = z.object({
  values: pluginFieldValuesSchema,
});
export type TeamCreateResult = z.infer<typeof teamCreateResultSchema>;

/**
 * The body of `POST /api/teams/:pluginId/create`: what the connection form
 * holds so far, such as the deployment URL, and the new team's name.
 */
export const teamCreateRouteRequestSchema = z.object({
  values: pluginFieldValuesSchema,
  team: teamCreateRequestSchema,
});
export type TeamCreateRouteRequest = z.infer<
  typeof teamCreateRouteRequestSchema
>;

export const backlogImportCandidateInputSchema = z.object({
  source: backlogSourceSchema,
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
  priority: backlogPriorityLevelSchema.optional(),
  originalEstimateHours: z.number().finite().nonnegative().optional(),
  remainingEstimateHours: z.number().finite().nonnegative().optional(),
  completedEstimateHours: z.number().finite().nonnegative().optional(),
  parentSourceId: z.string().trim().min(1).max(400).optional(),
  parentTitle: z.string().trim().max(240).optional(),
  depth: backlogImportDepthSchema,
  selectable: z.boolean().default(true),
  selected: z.boolean().optional(),
  childCount: z.number().int().nonnegative().default(0),
  pushedAt: z.number().int().positive().optional(),
});
export type BacklogImportCandidateInput = z.infer<
  typeof backlogImportCandidateInputSchema
>;

export const backlogImportCandidateSchema =
  backlogImportCandidateInputSchema.extend({
    id: z.string().min(1).max(200),
    selected: z.boolean(),
    pushedAt: z.number().int().positive(),
  });
export type BacklogImportCandidate = z.infer<
  typeof backlogImportCandidateSchema
>;

export const backlogSyncFieldUpdateSchema = z.object({
  status: z.enum(["noop", "pushed", "pulled", "conflict", "error"]),
  localValue: z.number().finite().nonnegative().optional(),
  remoteValue: z.number().finite().nonnegative().optional(),
  baselineValue: z.number().finite().nonnegative().optional(),
  nextBaselineValue: z.number().finite().nonnegative().optional(),
  message: z.string().trim().max(1000).optional(),
});
export type BacklogSyncFieldUpdate = z.infer<
  typeof backlogSyncFieldUpdateSchema
>;

export const backlogSyncWorkItemUpdateSchema = z.object({
  localWorkItemId: z.string().trim().min(1).max(200),
  sourceId: z.string().trim().min(1).max(400),
  fields: z.object({
    originalEstimateHours: backlogSyncFieldUpdateSchema.optional(),
    remainingEstimateHours: backlogSyncFieldUpdateSchema.optional(),
    completedEstimateHours: backlogSyncFieldUpdateSchema.optional(),
  }),
});
export type BacklogSyncWorkItemUpdate = z.infer<
  typeof backlogSyncWorkItemUpdateSchema
>;

/** A state a backlog item can move to when it is settled. */
export const backlogSettleStateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Groups the state in the settle dialog, in the order the plugin lists. */
  category: z.string().trim().min(1).max(120),
  done: z.boolean(),
});
export type BacklogSettleState = z.infer<typeof backlogSettleStateSchema>;

export const backlogSettleStatesRequestSchema = z.object({
  sourceId: z.string().trim().min(1).max(400),
});
export type BacklogSettleStatesRequest = z.infer<
  typeof backlogSettleStatesRequestSchema
>;

export const backlogSettleStatesResultSchema = z.object({
  states: z.array(backlogSettleStateSchema).max(200),
});
export type BacklogSettleStatesResult = z.infer<
  typeof backlogSettleStatesResultSchema
>;

/**
 * Writes a settle to one backlog item. Only changed fields are sent. The
 * plugin turns the priority level into a value of its source priority field.
 */
export const backlogSettleWriteRequestSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(400),
    state: z.string().trim().min(1).max(120).optional(),
    priority: backlogPriorityLevelSchema.optional(),
  })
  .refine(
    (request) => request.state !== undefined || request.priority !== undefined,
    "A settle write needs a state, a priority or both.",
  );
export type BacklogSettleWriteRequest = z.infer<
  typeof backlogSettleWriteRequestSchema
>;

/** The item's values in the source after the write. */
export const backlogSettleWriteResultSchema = z.object({
  state: z.string().trim().max(120).optional(),
  stateCategory: z.string().trim().max(120).optional(),
  stateDone: z.boolean().optional(),
  priority: backlogPriorityLevelSchema.optional(),
});
export type BacklogSettleWriteResult = z.infer<
  typeof backlogSettleWriteResultSchema
>;

/** A synced backlog item that reached a done category in its source. */
export const backlogDoneWorkItemSchema = z.object({
  source: backlogSourceSchema,
  connectionId: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(400),
  state: z.string().trim().max(120).optional(),
});
export type BacklogDoneWorkItem = z.infer<typeof backlogDoneWorkItemSchema>;

export const backlogPluginSyncResultSchema = z.object({
  items: z.array(backlogImportCandidateInputSchema),
  workItemUpdates: z.array(backlogSyncWorkItemUpdateSchema).default([]),
  /** The user, in the id space of comment authors. Needed with `commentFacts`. */
  viewer: backlogPersonSchema.optional(),
  /** New comments on the settled items that had `commentsSince`. */
  commentFacts: z.array(backlogItemCommentFactsSchema).max(1000).default([]),
});
export type BacklogPluginSyncResult = z.infer<
  typeof backlogPluginSyncResultSchema
>;

export const backlogImportPushRequestSchema = z.object({
  items: z.array(backlogImportCandidateInputSchema).min(1).max(200),
});
export type BacklogImportPushRequest = z.infer<
  typeof backlogImportPushRequestSchema
>;

export const backlogImportPushResponseSchema = z.object({
  queuedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type BacklogImportPushResponse = z.infer<
  typeof backlogImportPushResponseSchema
>;

export const backlogImportListResponseSchema = z.object({
  items: z.array(backlogImportCandidateSchema),
  totalCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
});
export type BacklogImportListResponse = z.infer<
  typeof backlogImportListResponseSchema
>;

export const backlogImportSelectionUpdateSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
  selected: z.boolean(),
});
export type BacklogImportSelectionUpdate = z.infer<
  typeof backlogImportSelectionUpdateSchema
>;

export const backlogImportSelectionResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type BacklogImportSelectionResponse = z.infer<
  typeof backlogImportSelectionResponseSchema
>;

export const backlogImportDismissRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200),
});
export type BacklogImportDismissRequest = z.infer<
  typeof backlogImportDismissRequestSchema
>;

export const backlogImportDismissResponseSchema = z.object({
  dismissedCount: z.number().int().nonnegative(),
  /** Present when items were dismissed. Undo passes it back to restore them. */
  undoToken: z.string().min(1).max(200).optional(),
});
export type BacklogImportDismissResponse = z.infer<
  typeof backlogImportDismissResponseSchema
>;

export const backlogImportRestoreRequestSchema = z.object({
  undoToken: z.string().min(1).max(200),
});
export type BacklogImportRestoreRequest = z.infer<
  typeof backlogImportRestoreRequestSchema
>;

/**
 * `stale` means a dismissed item was staged again or un-dismissed since.
 * `expired` means a later dismissal replaced this one, its connection was
 * deleted, or the API restarted.
 */
export const backlogImportRestoreResponseSchema = z.object({
  result: z.enum(["restored", "stale", "expired"]),
});
export type BacklogImportRestoreResponse = z.infer<
  typeof backlogImportRestoreResponseSchema
>;

export const backlogImportCommitResponseSchema = z.object({
  items: z.array(backlogImportCandidateSchema),
  committedCount: z.number().int().nonnegative(),
});
export type BacklogImportCommitResponse = z.infer<
  typeof backlogImportCommitResponseSchema
>;

export const backlogSyncResultSchema = z.object({
  connection: pluginConnectionSummarySchema,
  mode: z.enum(["review", "backlog"]),
  items: z.array(backlogImportCandidateSchema),
  stagedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  workItemUpdates: z.array(backlogSyncWorkItemUpdateSchema).default([]),
  /** Items that reached a done category. They are never staged for review. */
  doneItems: z.array(backlogDoneWorkItemSchema).default([]),
  viewer: backlogPersonSchema.optional(),
  commentFacts: z.array(backlogItemCommentFactsSchema).max(1000).default([]),
});
export type BacklogSyncResult = z.infer<typeof backlogSyncResultSchema>;
