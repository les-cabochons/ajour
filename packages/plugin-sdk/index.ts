// The SDK for Ajour plugins on plugin API 4: the manifest and contract types,
// and the types of the `ajour` global. See README.md.
export type * from "./lib/contract.js";
export type {
  Ajour,
  AjourHttpRequest,
  AjourProcessRequest,
  AjourProcessError,
  AjourProcessResult,
  AjourProcessSessions,
  AjourSessionOpenRequest,
  AjourSessionRead,
  AjourSessionReadOptions,
  AjourLogFields,
  AjourLogLevel,
  AjourPublicFetchInit,
  AjourQueryValue,
  AjourRequestError,
  AjourRequestErrorCode,
  AjourResponse,
  DataShapeModule,
  HandoffArguments,
  PluginModule,
} from "./lib/runtime.js";

/** The plugin API this SDK describes. */
export const PLUGIN_API_VERSION = 4;

export {
  formatTypeOverrides,
  parseTypeOverrides,
  typeOverrideFor,
  type TypeOverrides,
} from "./lib/type-overrides.js";
