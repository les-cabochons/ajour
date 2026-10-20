/**
 * How a plugin's error leaves the plugin host. A plugin may echo the values it
 * was given in an error, and some are secrets: an API token, a calendar
 * address, a team secret. Every response, stored last error and log that
 * carries a plugin error takes its message from `pluginErrorMessage`, and the
 * overview shows a stored one through `redactConnectionError`.
 *
 * `redactSecretValues` depends on nothing else, so the wide-event error
 * scrubber (#305) can reuse it, or move it, in the browser and in Node.
 * `connectionSecretValues` gives it a connection's secret values.
 */

import { RESERVED_CONNECTION_FIELD_IDS } from "./connection-values.ts";

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
 * A stored key the manifest no longer declares counts as secret too: a plugin
 * update renamed or dropped its field, which may have been secret, and the
 * value stays until the connection is saved again. Ajour's own fields don't.
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
        if (text.length > 0) values.add(text);
      }
    }
  }
  return [...values];
}

/** What replaces a secret. */
const SECRET_MARK = "[secret]";

/**
 * What a cut plugin error ends with. The plugin worker cuts a message before
 * the host can redact it, and `boundConnectionError` cuts one after.
 */
const CUT_MARK = "…";

interface Span {
  start: number;
  end: number;
}

/** Every place `text` occurs in `message`, overlapping ones included. */
function occurrences(message: string, text: string): Span[] {
  const spans: Span[] = [];
  for (
    let at = message.indexOf(text);
    at !== -1;
    at = message.indexOf(text, at + 1)
  ) {
    spans.push({ start: at, end: at + text.length });
  }
  return spans;
}

/**
 * The length of the longest end of `text` that starts a secret without being
 * all of it, which is what a cut through that secret leaves. Zero if none.
 */
function cutSecretLength(text: string, secrets: readonly string[]): number {
  let longest = 0;
  for (const secret of secrets) {
    for (
      let length = Math.min(secret.length - 1, text.length);
      length > longest;
      length -= 1
    ) {
      if (text.endsWith(secret.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

/**
 * Replaces each secret value in a message with `[secret]`, however short. It
 * finds every match in the original message first, so secrets that overlap or
 * sit inside each other go whole. A cut may split a secret, so in a message
 * that ends with "…" the longest end before it that starts a secret goes too.
 * A `[secret]` already in the message stays as it is, so redacting twice
 * changes nothing.
 */
export function redactSecretValues(
  message: string,
  secrets: readonly string[],
): string {
  const values = secrets.filter((secret) => secret.length > 0);
  const spans = values.flatMap((secret) => occurrences(message, secret));
  if (message.endsWith(CUT_MARK)) {
    const end = message.length - CUT_MARK.length;
    const length = cutSecretLength(message.slice(0, end), values);
    if (length > 0) spans.push({ start: end - length, end });
  }
  const marks = occurrences(message, SECRET_MARK);
  const overlaps = (left: Span, right: Span) =>
    left.start < right.end && right.start < left.end;
  const merged: Span[] = [];
  for (const span of spans
    .filter(
      (span) =>
        !marks.some((mark) => mark.start <= span.start && span.end <= mark.end),
    )
    // A match across a mark's edge takes the whole mark in.
    .map((span) =>
      marks.reduce(
        (wide, mark) =>
          overlaps(wide, mark)
            ? {
                start: Math.min(wide.start, mark.start),
                end: Math.max(wide.end, mark.end),
              }
            : wide,
        span,
      ),
    )
    .sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let redacted = "";
  let at = 0;
  for (const span of merged) {
    redacted += `${message.slice(at, span.start)}${SECRET_MARK}`;
    at = span.end;
  }
  return `${redacted}${message.slice(at)}`;
}

/**
 * Cuts a connection error to the length its summary allows. A plugin result
 * that breaks the contract can give a validation error of many kilobytes, and
 * storing it whole would make the overview fail to load. The cut never splits
 * a `[secret]`, and never ends on the start of one of `secrets`, which a later
 * redaction would read as a secret cut in half.
 */
export function boundConnectionError(
  message: string,
  secrets: readonly string[] = [],
): string {
  if (message.length <= MAX_CONNECTION_ERROR_CHARACTERS) return message;
  let end = MAX_CONNECTION_ERROR_CHARACTERS - CUT_MARK.length;
  for (;;) {
    const markStart = message.lastIndexOf(SECRET_MARK, end - 1);
    if (
      markStart !== -1 &&
      markStart < end &&
      markStart + SECRET_MARK.length > end
    ) {
      end = markStart;
      continue;
    }
    const length = cutSecretLength(message.slice(0, end), secrets);
    if (length === 0) break;
    end -= length;
  }
  return `${message.slice(0, end)}${CUT_MARK}`;
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
  plugin: SecretConnectionFields,
  configs: readonly (ConnectionValues | undefined)[],
): string {
  const secrets = connectionSecretValues(plugin, configs);
  return boundConnectionError(redactSecretValues(message, secrets), secrets);
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
  return redactConnectionError(errorMessage(error), plugin, configs);
}

/**
 * The message a plugin error may carry out of the plugin host, for an
 * operation with no connection, such as a data shape's. The plugin holds no
 * secret of Ajour's, so the message is only bounded.
 */
export function connectionlessPluginErrorMessage(error: unknown): string {
  return boundConnectionError(errorMessage(error));
}
