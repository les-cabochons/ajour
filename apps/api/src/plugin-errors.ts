/**
 * How a plugin's error leaves the plugin host. A plugin may echo the values it
 * was given in an error, and some are secrets: an API token, a calendar
 * address, a team secret. Every response, stored last error and log that
 * carries a plugin error takes its message from `pluginErrorMessage`.
 *
 * `connectionSecretValues` and `redactSecretValues` import nothing, so the
 * wide-event error scrubber (#305) can reuse them in the browser and in Node.
 */

/** The longest last error a connection keeps, as its summary schema allows. */
export const MAX_CONNECTION_ERROR_CHARACTERS = 1_000;

/** The part of a plugin manifest that says which connection fields are secret. */
export interface SecretConnectionFields {
  connectionFields: readonly { id: string; secret?: boolean }[];
}

type ConnectionValues = Readonly<Record<string, unknown>>;

/** The plugin's secret field values in each config, without empty ones. */
export function connectionSecretValues(
  plugin: SecretConnectionFields | undefined,
  configs: readonly (ConnectionValues | undefined)[],
): string[] {
  const secretFieldIds = (plugin?.connectionFields ?? [])
    .filter((field) => field.secret)
    .map((field) => field.id);
  const values = new Set<string>();
  for (const config of configs) {
    for (const fieldId of secretFieldIds) {
      const value = config?.[fieldId];
      if (typeof value === "string" && value.length > 0) values.add(value);
    }
  }
  return [...values];
}

/**
 * Replaces each secret value in a message with `[secret]`. Every value is
 * replaced, however short, the longest first so one secret inside another
 * goes whole.
 */
export function redactSecretValues(
  message: string,
  secrets: readonly string[],
): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[secret]"),
      message,
    );
}

/**
 * Cuts a connection error to the length its summary allows. A plugin result
 * that breaks the contract can give a validation error of many kilobytes, and
 * storing it whole would make the overview fail to load.
 */
export function boundConnectionError(message: string): string {
  return message.length <= MAX_CONNECTION_ERROR_CHARACTERS
    ? message
    : `${message.slice(0, MAX_CONNECTION_ERROR_CHARACTERS - 1)}…`;
}

/**
 * The message a plugin error may carry out of the plugin host: every secret
 * value of the connection replaced, then the length bounded. Give every config
 * the plugin could have seen. On a save, that is the submitted values with the
 * stored secrets merged in, and the stored config.
 */
export function pluginErrorMessage(
  error: unknown,
  plugin?: SecretConnectionFields,
  ...configs: (ConnectionValues | undefined)[]
): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return boundConnectionError(
    redactSecretValues(message, connectionSecretValues(plugin, configs)),
  );
}
