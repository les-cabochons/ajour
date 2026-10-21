// Entry point: replaces a connection's secret values in a text. The local
// API redacts plugin errors and plugin-written text with it, and the
// wide-event scrubber redacts error messages with it, so there is one
// implementation. Only the pure redaction lives here: which values are
// secret, the request budget and the plugin wrappers stay in the local API.
export {
  boundConnectionError,
  ConnectionRedaction,
  MAX_CONNECTION_ERROR_CHARACTERS,
  redactSecretValues,
  TEXT_WORK_BUDGET,
  UNCHECKED_TEXT,
} from "./lib/secret-redaction.ts";
