// Entry point: replaces a connection's secret values in a text or in an
// answer's bytes. The local API redacts plugin errors and plugin-written text
// with it, the wide-event scrubber redacts error messages with it, and the
// credential broker scrubs every answer with it, so there is one
// implementation. Only the pure redaction lives here: which values are
// secret, the request budget and the plugin wrappers stay in the local API.
export {
  boundConnectionError,
  ConnectionRedaction,
  MAX_CONNECTION_ERROR_CHARACTERS,
  redactSecretValues,
  SECRET_MARK,
  TEXT_WORK_BUDGET,
  UNCHECKED_TEXT,
} from "./lib/secret-redaction.ts";
export {
  BYTES_WORK_BUDGET,
  MAX_FORM_BYTES,
  SecretBytesRedaction,
  secretEchoForms,
} from "./lib/secret-bytes.ts";
