/**
 * How a plugin's text leaves the plugin host. A plugin may echo the values it
 * was given, and some are secrets: an API token, a calendar address, a team
 * secret. Every response, stored last error and log that carries a plugin
 * error takes its message from `pluginErrorMessage`. Text the plugin writes
 * in a successful result, such as a field's sync message or the connection
 * summary, goes through one `ConnectionRedaction` per connection and request.
 *
 * The redaction itself lives in the wide-events package, which its error
 * scrubber shares. This module decides which connection values are secret:
 * `connectionSecretValues` gives the redaction a connection's secret values.
 */

import { RESERVED_CONNECTION_FIELD_IDS } from "./connection-values.ts";
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

/** The part of a plugin manifest that says which connection fields are secret. */
export interface SecretConnectionFields {
  connectionFields: readonly { id: string; secret?: boolean }[];
}

type ConnectionValues = Readonly<Record<string, unknown>>;

/**
 * The plugin's secret field values in each config, as a message would show
 * them, without empty ones. A field may hold a string, a number or a boolean.
 * A stored key the manifest no longer declares counts as secret too: a plugin
 * update renamed or dropped its field, which may have been secret, and the
 * value stays until the connection is saved again. Ajour's own fields don't.
 * A value with spaces at its ends counts trimmed as well, because the host
 * trims a plugin's message before it is redacted.
 */
export function connectionSecretValues(
  plugin: SecretConnectionFields,
  configs: readonly (ConnectionValues | undefined)[],
): string[] {
  const declaredSecret = new Map(
    plugin.connectionFields.map((field) => [field.id, field.secret ?? false]),
  );
  const values = new Set<string>();
  for (const config of configs) {
    for (const [fieldId, value] of Object.entries(config ?? {})) {
      const secret =
        declaredSecret.get(fieldId) ??
        !RESERVED_CONNECTION_FIELD_IDS.has(fieldId);
      if (
        secret &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean")
      ) {
        const text = String(value);
        for (const form of [text, text.trim()]) {
          if (form.length > 0) values.add(form);
        }
      }
    }
  }
  return [...values];
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * The message a plugin error may carry out of the plugin host, for an
 * operation on a connection. Give every config the plugin could have seen. On
 * a save, that is the submitted values with the stored secrets merged in, and
 * the stored config.
 */
export function pluginErrorMessage(
  error: unknown,
  plugin: SecretConnectionFields,
  ...configs: (ConnectionValues | undefined)[]
): string {
  return redactPluginText(
    errorMessage(error),
    connectionSecretValues(plugin, configs),
  );
}

/**
 * The message a plugin error may carry out of the plugin host, for an
 * operation with no connection, such as a data shape's. The plugin holds no
 * secret of Ajour's, so the message is only bounded.
 */
export function connectionlessPluginErrorMessage(error: unknown): string {
  return boundConnectionError(errorMessage(error));
}
