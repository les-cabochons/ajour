/*
 * The contract types the SDK publishes, as aliases of Ajour's shared schemas.
 * `generate-contract.mjs` expands each alias into a plain type in
 * `lib/contract.ts`, so the published package needs neither zod nor
 * `@ajour/shared`. A plugin writes what Ajour reads, the schema's input, and
 * receives what Ajour sends, the schema's output.
 */
import type {
  pluginApi4ConnectionSchema,
  pluginApi4FieldSchema,
  pluginApi4ManifestSchema,
  pluginAuthSchema,
  pluginDerivedHostSchema,
  pluginEndpointSchema,
  pluginHttpMethodSchema,
  pluginNetworkSchema,
} from "../../shared/plugin-api-4.ts";
import type {
  backlogPluginSyncResultSchema,
  backlogReadDescriptionRequestSchema,
  backlogReadDescriptionResultSchema,
  backlogSettleStatesRequestSchema,
  backlogSettleStatesResultSchema,
  backlogSettleWriteRequestSchema,
  backlogSettleWriteResultSchema,
  backlogSyncWorkItemSchema,
  backlogWriteDescriptionRequestSchema,
  backlogWriteDescriptionResultSchema,
  pluginValidationContextSchema,
  pluginValidationResultSchema,
} from "../../shared/plugins.ts";
import type { codeHostOperations } from "../../shared/code-host.ts";
import type { calendarOperations } from "../../shared/calendar.ts";
import type { backlogCommentOperations } from "../../shared/backlog-comments.ts";
import type {
  projectDataShapeDatasetSchema,
  projectDataShapeExportProjectSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportResponseSchema,
} from "../../shared/project-data-shapes.ts";

type Input<Schema extends { _input: unknown }> = Schema["_input"];
type Output<Schema extends { _output: unknown }> = Schema["_output"];
type Operations<
  Table extends Record<
    string,
    { request: { _output: unknown }; result: { _input: unknown } }
  >,
> = {
  [Name in keyof Table]: {
    request: Output<Table[Name]["request"]>;
    result: Input<Table[Name]["result"]>;
  };
};

/** The `plugin.json` of a plugin API 4 package, as you write it. */
export type PluginManifest = Input<typeof pluginApi4ManifestSchema>;
/** A connection field or agent task setting. Secret fields never reach the plugin. */
export type PluginField = Input<typeof pluginApi4FieldSchema>;
/** How Ajour's broker attaches the connection's credential. */
export type PluginAuth = Input<typeof pluginAuthSchema>;
/** What the plugin reaches through `ajour.http` and `ajour.publicFetch`. */
export type PluginNetwork = Input<typeof pluginNetworkSchema>;
/** A host derived from the base address, such as `api.{host}`. */
export type PluginDerivedHost = Input<typeof pluginDerivedHostSchema>;
/** A method and path pattern: `*` matches one segment, `**` the rest. */
export type PluginEndpoint = Input<typeof pluginEndpointSchema>;
export type PluginHttpMethod = Output<typeof pluginHttpMethodSchema>;

/** The connection each operation receives, without its secret fields. */
export type PluginConnection = Output<typeof pluginApi4ConnectionSchema>;
export type ValidationContext = Output<typeof pluginValidationContextSchema>;
export type ValidationResult = Input<typeof pluginValidationResultSchema>;

export type BacklogSyncWorkItem = Output<typeof backlogSyncWorkItemSchema>;
export type BacklogSyncResult = Input<typeof backlogPluginSyncResultSchema>;
export type SettleStatesRequest = Output<
  typeof backlogSettleStatesRequestSchema
>;
export type SettleStatesResult = Input<typeof backlogSettleStatesResultSchema>;
export type SettleWriteRequest = Output<typeof backlogSettleWriteRequestSchema>;
export type SettleWriteResult = Input<typeof backlogSettleWriteResultSchema>;
export type ReadDescriptionRequest = Output<
  typeof backlogReadDescriptionRequestSchema
>;
export type ReadDescriptionResult = Input<
  typeof backlogReadDescriptionResultSchema
>;
export type WriteDescriptionRequest = Output<
  typeof backlogWriteDescriptionRequestSchema
>;
export type WriteDescriptionResult = Input<
  typeof backlogWriteDescriptionResultSchema
>;

/** Each code host operation's request and result, by the function name it exports. */
export type CodeHostOperations = Operations<typeof codeHostOperations>;
/** Each calendar operation's request and result, by the function name it exports. */
export type CalendarOperations = Operations<typeof calendarOperations>;
/** Each backlog comment operation's request and result, by the function name it exports. */
export type BacklogCommentOperations = Operations<
  typeof backlogCommentOperations
>;

/** A project as `exportProjects` receives it. */
export type DataShapeExportProject = Output<
  typeof projectDataShapeExportProjectSchema
>;
export type DataShapeExportResult = Input<
  typeof projectDataShapeExportResponseSchema
>;
/** A dataset as `importProjects` receives it. */
export type DataShapeDataset = Output<typeof projectDataShapeDatasetSchema>;
export type DataShapeImportResult = Input<
  typeof projectDataShapeImportResponseSchema
>;
