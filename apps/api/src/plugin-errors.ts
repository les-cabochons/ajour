/**
 * How a plugin's text leaves the plugin host. A plugin may echo the values it
 * was given, and some are secrets: an API token, a calendar address, a team
 * secret. Every response, stored last error and log that carries a plugin
 * error takes its message from `connectionCredentials(...).errorMessage`, or
 * `pluginErrorMessage`, in `connection-credentials.ts`. Text the plugin writes
 * in a successful result, such as a field's sync message or the connection
 * summary, goes through one `ConnectionRedaction` per connection and request.
 *
 * The redaction itself lives in the wide-events package, which its error
 * scrubber shares. Which connection values are secret is the credentials
 * module's to say; this one keeps the request budget and bounds the text.
 */

import {
  boundConnectionError,
  ConnectionRedaction,
} from "../../../packages/wide-events/secret-redaction.ts";

export { boundConnectionError };
export type { ConnectionRedaction };

/**
 * The most one `ConnectionRedaction` may cost across all the texts of a
 * request: their steps and reads, a dropped text's steps included, and the
 * secrets' tables. Once it is spent, every later text that could hold a
 * secret is replaced by `UNCHECKED_TEXT` at once. A text no secret can be in,
 * shorter than every secret and not cut, costs `redact` one comparison. Such a
 * text longer than 1,000 characters is still cut, which reads up to 1,000
 * characters per secret and is charged like any other work, and once the
 * request is spent it becomes `UNCHECKED_TEXT` instead of being cut. So a
 * request costs at most this much, plus a constant per text.
 */
export const REQUEST_WORK_BUDGET = 5_000_000;

/**
 * The redaction for one connection's texts within one request, with the
 * request's budget. Build one per connection and request, and reuse it.
 */
export function connectionRedaction(
  secrets: readonly string[],
): ConnectionRedaction {
  return new ConnectionRedaction(secrets, {
    requestBudget: REQUEST_WORK_BUDGET,
  });
}

/**
 * Text a plugin wrote for a connection, such as an error or a status message,
 * as it may be shown, stored or returned: every secret value of the
 * connection replaced, then the length bounded to 1,000 characters. Bounding
 * comes last because a short secret grows into `[secret]`. For several texts
 * of one connection, build one `connectionRedaction` and reuse it.
 */
export function redactPluginText(
  text: string,
  secrets: readonly string[],
): string {
  return connectionRedaction(secrets).text(text);
}

/**
 * The summary a plugin wrote for a connection, redacted as
 * `ConnectionRedaction.summary` does.
 */
export function redactConnectionSummary<
  Value extends string | number | boolean,
>(
  summary: Readonly<Record<string, Value>>,
  secrets: readonly string[],
): Record<string, Value | string> {
  return connectionRedaction(secrets).summary(summary);
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * The message a plugin error may carry out of the plugin host, for an
 * operation with no connection, such as a data shape's. The plugin holds no
 * secret of Ajour's, so the message is only bounded.
 */
export function connectionlessPluginErrorMessage(error: unknown): string {
  return boundConnectionError(errorMessage(error));
}
