// Entry point: replaces a connection's secret values in a text. The local
// API redacts plugin errors and plugin-written text with it, and the
// wide-event scrubber redacts error messages with it, so there is one
// implementation.
export {
  boundConnectionError,
  ConnectionRedaction,
  MAX_CONNECTION_ERROR_CHARACTERS,
  MAX_CONNECTION_SUMMARY_ENTRIES,
  redactConnectionSummary,
  redactPluginText,
  redactSecretValues,
  REQUEST_WORK_BUDGET,
  TEXT_WORK_BUDGET,
  UNCHECKED_TEXT,
} from "./lib/secret-redaction.ts";
