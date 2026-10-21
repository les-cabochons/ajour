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
  redactPluginText,
} from "../../../packages/wide-events/secret-redaction.ts";

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
} from "../../../packages/wide-events/secret-redaction.ts";

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
