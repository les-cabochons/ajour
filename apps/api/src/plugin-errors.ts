/**
 * How a plugin's error leaves the plugin host. A plugin may echo the values it
 * was given in an error, and some are secrets: an API token, a calendar
 * address, a team secret. Every response, stored last error and log that
 * carries a plugin error takes its message from `pluginErrorMessage`, and the
 * overview shows a stored one through `redactConnectionError`.
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

/**
 * The plugin's secret field values in each config, as a message would show
 * them, without empty ones. A field may hold a string, a number or a boolean.
 * Without the plugin's manifest no field is known to be secret, so every
 * string and number value counts as one.
 */
export function connectionSecretValues(
  plugin: SecretConnectionFields | undefined,
  configs: readonly (ConnectionValues | undefined)[],
): string[] {
  const secretFieldIds = plugin?.connectionFields
    .filter((field) => field.secret)
    .map((field) => field.id);
  const values = new Set<string>();
  for (const config of configs) {
    for (const fieldId of secretFieldIds ?? Object.keys(config ?? {})) {
      const value = config?.[fieldId];
      // A boolean counts only where a field declares it secret: unknown
      // fields would otherwise turn every "true" in a message into [secret].
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        (typeof value === "boolean" && secretFieldIds !== undefined)
      ) {
        const text = String(value);
        if (text.length > 0) values.add(text);
      }
    }
  }
  return [...values];
}

/**
 * What a cut plugin error ends with. The plugin worker cuts a message before
 * the host can redact it, and `boundConnectionError` cuts one after.
 */
const CUT_MARK = "…";

/**
 * Replaces each secret value in a message with `[secret]`. Every value is
 * replaced, however short, the longest first so one secret inside another
 * goes whole. A cut may split a secret, so in a message that ends with "…"
 * the longest end before it that starts a secret is replaced too.
 */
export function redactSecretValues(
  message: string,
  secrets: readonly string[],
): string {
  const longestFirst = secrets
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
  return redactCutSecret(
    longestFirst.reduce(
      (redacted, secret) => redacted.split(secret).join("[secret]"),
      message,
    ),
    longestFirst,
  );
}

function redactCutSecret(message: string, secrets: readonly string[]) {
  if (!message.endsWith(CUT_MARK)) return message;
  const kept = message.slice(0, -CUT_MARK.length);
  let fragmentLength = 0;
  for (const secret of secrets) {
    for (
      let length = Math.min(secret.length - 1, kept.length);
      length > fragmentLength;
      length -= 1
    ) {
      if (kept.endsWith(secret.slice(0, length))) {
        fragmentLength = length;
        break;
      }
    }
  }
  return fragmentLength === 0
    ? message
    : `${kept.slice(0, -fragmentLength)}[secret]${CUT_MARK}`;
}

/**
 * Cuts a connection error to the length its summary allows. A plugin result
 * that breaks the contract can give a validation error of many kilobytes, and
 * storing it whole would make the overview fail to load.
 */
export function boundConnectionError(message: string): string {
  return message.length <= MAX_CONNECTION_ERROR_CHARACTERS
    ? message
    : `${message.slice(0, MAX_CONNECTION_ERROR_CHARACTERS - 1)}${CUT_MARK}`;
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * A connection error as it may be shown or stored: every secret value of the
 * connection replaced, then the length bounded. Bounding comes last because a
 * short secret grows into `[secret]`.
 */
export function redactConnectionError(
  message: string,
  plugin: SecretConnectionFields | undefined,
  configs: readonly (ConnectionValues | undefined)[],
): string {
  return boundConnectionError(
    redactSecretValues(message, connectionSecretValues(plugin, configs)),
  );
}

/**
 * The message a plugin error may carry out of the plugin host. Give every
 * config the plugin could have seen. On a save, that is the submitted values
 * with the stored secrets merged in, and the stored config.
 */
export function pluginErrorMessage(
  error: unknown,
  plugin?: SecretConnectionFields,
  ...configs: (ConnectionValues | undefined)[]
): string {
  return redactConnectionError(errorMessage(error), plugin, configs);
}
