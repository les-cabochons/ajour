/**
 * How a plugin's text leaves the plugin host. A plugin may echo the values it
 * was given, and some are secrets: an API token, a calendar address, a team
 * secret. Every response, stored last error and log that carries a plugin
 * error takes its message from `pluginErrorMessage`. Text the plugin writes
 * in a successful result, such as a field's sync message or the connection
 * summary, goes through `redactPluginText` or `redactConnectionSummary`.
 *
 * `redactSecretValues` and the helpers it calls use nothing outside this
 * file, so the wide-event error scrubber (#305) can move them as they are,
 * into a package that runs in the browser and in Node. The module itself
 * imports connection-values.ts, which brings in zod.
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

/** What replaces a secret. */
const SECRET_MARK = "[secret]";

/**
 * What a cut plugin error ends with. The plugin worker cuts a message before
 * the host can redact it, and `boundConnectionError` cuts one after.
 */
const CUT_MARK = "…";

/**
 * The most work one redaction call may do, counted in characters: each
 * secret's length once, then each text's length once per secret. Every step
 * is linear in that count, so it bounds the time. A text that would cost more
 * is replaced whole by `TOO_LONG_TO_CHECK`, which is safe.
 */
export const REDACTION_WORK_BUDGET = 1_000_000;

/** What replaces a text too long to check against a connection's secrets. */
export const TOO_LONG_TO_CHECK =
  "Hidden because it was too long to check for secrets.";

/**
 * A secret and its KMP prefix function: `fail[i]` is the length of the
 * longest start of `secret.slice(0, i + 1)` that is also its end, short of
 * all of it.
 */
interface Pattern {
  secret: string;
  fail: Int32Array;
}

function compilePattern(secret: string): Pattern {
  const fail = new Int32Array(secret.length);
  for (let index = 1, matched = 0; index < secret.length; index += 1) {
    while (
      matched > 0 &&
      secret.charCodeAt(index) !== secret.charCodeAt(matched)
    ) {
      matched = fail[matched - 1]!;
    }
    if (secret.charCodeAt(index) === secret.charCodeAt(matched)) matched += 1;
    fail[index] = matched;
  }
  return { secret, fail };
}

/**
 * Reads `text` through the pattern's automaton, in time linear in `text`.
 * After each character, `visit` gets how many characters were read and the
 * longest start of the secret that the text read so far ends with, which is
 * the whole secret where a match ends.
 */
function scan(
  pattern: Pattern,
  text: string,
  visit: (read: number, matched: number) => void,
) {
  const { secret, fail } = pattern;
  let matched = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    while (
      matched > 0 &&
      (matched === secret.length || code !== secret.charCodeAt(matched))
    ) {
      matched = fail[matched - 1]!;
    }
    if (code === secret.charCodeAt(matched)) matched += 1;
    visit(index + 1, matched);
  }
}

/**
 * The longest start of the secret, short of all of it, that a text ends
 * with when the automaton stands at `matched`: what a cut through the secret
 * would leave.
 */
function cutStart(pattern: Pattern, matched: number) {
  return matched === pattern.secret.length
    ? pattern.fail[matched - 1]!
    : matched;
}

/**
 * Redacts texts against one connection's secrets within one work budget.
 * Building it reads each secret once, and each text then costs its length
 * once per secret. `redact` and `bound` give undefined once the budget is
 * spent, and from then on.
 */
class SecretRedaction {
  private readonly patterns: Pattern[];
  private work: number;

  constructor(secrets: readonly string[]) {
    const values = [...new Set(secrets)].filter((secret) => secret.length > 0);
    this.work = values.reduce((sum, secret) => sum + secret.length, 0);
    this.patterns =
      this.work <= REDACTION_WORK_BUDGET ? values.map(compilePattern) : [];
  }

  /** Charges a read of `length` characters per secret. */
  private spend(length: number) {
    this.work += length * this.patterns.length;
    return this.work <= REDACTION_WORK_BUDGET;
  }

  redact(message: string): string | undefined {
    if (!this.spend(message.length)) return undefined;
    if (this.patterns.length === 0) return message;
    // The start of the mark that covers each character, or -1.
    const markAt = new Int32Array(message.length).fill(-1);
    for (
      let at = message.indexOf(SECRET_MARK);
      at !== -1;
      at = message.indexOf(SECRET_MARK, at + SECRET_MARK.length)
    ) {
      markAt.fill(at, at, at + SECRET_MARK.length);
    }
    // +1 where a range to replace starts, -1 where it ends.
    const coverage = new Int32Array(message.length + 1);
    const cover = (start: number, end: number) => {
      const first = markAt[start]!;
      const last = markAt[end - 1]!;
      // A match inside one mark leaves it as it is.
      if (first !== -1 && first === last) return;
      // A match across a mark's edge takes the whole mark in.
      const from = first === -1 ? start : first;
      const to = last === -1 ? end : last + SECRET_MARK.length;
      coverage[from] = coverage[from]! + 1;
      coverage[to] = coverage[to]! - 1;
    };
    const keptLength = message.endsWith(CUT_MARK)
      ? message.length - CUT_MARK.length
      : -1;
    let cutLength = 0;
    for (const pattern of this.patterns) {
      scan(pattern, message, (read, matched) => {
        if (matched === pattern.secret.length) cover(read - matched, read);
        if (read === keptLength) {
          cutLength = Math.max(cutLength, cutStart(pattern, matched));
        }
      });
    }
    if (cutLength > 0) cover(keptLength - cutLength, keptLength);
    let redacted = "";
    let depth = 0;
    let from = 0;
    for (let index = 0; index <= message.length; index += 1) {
      const next = depth + coverage[index]!;
      if (depth === 0 && next > 0) {
        redacted += `${message.slice(from, index)}${SECRET_MARK}`;
      } else if (depth > 0 && next === 0) {
        from = index;
      }
      depth = next;
    }
    return `${redacted}${message.slice(from)}`;
  }

  bound(message: string): string | undefined {
    if (message.length <= MAX_CONNECTION_ERROR_CHARACTERS) return message;
    const limit = MAX_CONNECTION_ERROR_CHARACTERS - CUT_MARK.length;
    if (!this.spend(limit)) return undefined;
    // Where the cut may not fall: inside a mark, or right after the start
    // of a secret.
    const blocked = new Uint8Array(limit + 1);
    for (
      let at = message.indexOf(SECRET_MARK);
      at !== -1 && at < limit;
      at = message.indexOf(SECRET_MARK, at + SECRET_MARK.length)
    ) {
      blocked.fill(1, at + 1, Math.min(at + SECRET_MARK.length, limit + 1));
    }
    const head = message.slice(0, limit);
    for (const pattern of this.patterns) {
      scan(pattern, head, (read, matched) => {
        if (cutStart(pattern, matched) > 0) blocked[read] = 1;
      });
    }
    let end = limit;
    while (blocked[end]) end -= 1;
    return `${message.slice(0, end)}${CUT_MARK}`;
  }
}

/**
 * Replaces each secret value in a message with `[secret]`, however short. It
 * finds every match in the original message first, so secrets that overlap or
 * sit inside each other go whole. A cut may split a secret, so in a message
 * that ends with "…" the longest end before it that starts a secret goes too.
 * A `[secret]` already in the message stays as it is, so redacting twice
 * changes nothing. The one exception is a secret that can match across the
 * edge of a `[secret]`: one that starts with its end, such as `]` or `t]`,
 * ends with its start, such as `[`, or holds `…`. A second pass then takes in
 * a little more. Nothing leaks either way. A message too long to check within
 * `REDACTION_WORK_BUDGET` becomes `TOO_LONG_TO_CHECK`.
 */
export function redactSecretValues(
  message: string,
  secrets: readonly string[],
): string {
  return new SecretRedaction(secrets).redact(message) ?? TOO_LONG_TO_CHECK;
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
  return new SecretRedaction(secrets).bound(message) ?? TOO_LONG_TO_CHECK;
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Text a plugin wrote for a connection, such as an error or a status message,
 * as it may be shown, stored or returned: every secret value of the
 * connection replaced, then the length bounded to 1,000 characters. Bounding
 * comes last because a short secret grows into `[secret]`.
 */
export function redactPluginText(
  text: string,
  secrets: readonly string[],
): string {
  const redaction = new SecretRedaction(secrets);
  const redacted = redaction.redact(text);
  return (
    (redacted === undefined ? undefined : redaction.bound(redacted)) ??
    TOO_LONG_TO_CHECK
  );
}

/**
 * The most entries a connection summary keeps. A summary is a few facts, such
 * as the account name, so a longer one is dropped rather than redacted entry
 * by entry against every secret.
 */
export const MAX_CONNECTION_SUMMARY_ENTRIES = 50;

/**
 * The summary a plugin wrote for a connection, with every value that holds a
 * secret redacted. A value that is all secret, such as a number, becomes
 * `[secret]`. An entry whose key holds a secret goes, so no two keys can
 * collide once redacted. The whole summary shares one work budget, and goes
 * if it is too long to check.
 */
export function redactConnectionSummary<
  Value extends string | number | boolean,
>(
  summary: Readonly<Record<string, Value>>,
  secrets: readonly string[],
): Record<string, Value | string> {
  const entries = Object.entries(summary);
  if (entries.length > MAX_CONNECTION_SUMMARY_ENTRIES) return {};
  const redaction = new SecretRedaction(secrets);
  const kept: [string, Value | string][] = [];
  for (const [key, value] of entries) {
    const redactedKey = redaction.redact(key);
    if (redactedKey === undefined) return {};
    if (redactedKey !== key) continue;
    const text = String(value);
    const redacted = redaction.redact(text);
    const bounded =
      redacted === undefined ? undefined : redaction.bound(redacted);
    if (bounded === undefined) return {};
    kept.push([key, bounded === text ? value : bounded]);
  }
  return Object.fromEntries(kept);
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
