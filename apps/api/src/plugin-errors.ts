/**
 * How a plugin's text leaves the plugin host. A plugin may echo the values it
 * was given, and some are secrets: an API token, a calendar address, a team
 * secret. Every response, stored last error and log that carries a plugin
 * error takes its message from `pluginErrorMessage`. Text the plugin writes
 * in a successful result, such as a field's sync message or the connection
 * summary, goes through one `ConnectionRedaction` per connection and request.
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
 * The most one text may cost to redact, counted in characters read: the
 * text's length once for each secret that could be in it whole, and in a cut
 * text, its end once for each longer secret. Every step is linear in that
 * count. A text that would cost more is replaced whole by `UNCHECKED_TEXT`,
 * which is safe.
 */
export const TEXT_WORK_BUDGET = 250_000;

/**
 * The most one `ConnectionRedaction` may cost, across all the texts of a
 * request and the secrets' tables, so a request's time stays bounded however
 * many texts it carries. Once it is spent, every later text that needs
 * checking is replaced by `UNCHECKED_TEXT`.
 */
export const REQUEST_WORK_BUDGET = 5_000_000;

/**
 * What replaces a text that couldn't be checked for a connection's secrets
 * within the budgets, whether the text or the secrets made it too costly.
 */
export const UNCHECKED_TEXT =
  "Hidden because it couldn't be checked for secrets.";

/**
 * The most entries a connection summary keeps. A summary is a few facts, such
 * as the account name, so a longer one is dropped rather than redacted entry
 * by entry against every secret.
 */
export const MAX_CONNECTION_SUMMARY_ENTRIES = 50;

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
 * Redacts the texts of one connection within one request, such as its field
 * messages, its summary and its last error. Build one per connection and
 * request, and reuse it for every text. Each secret's table is built once,
 * when a text first needs it, and a secret that can't be in a text costs that
 * text nothing. Each text has its own budget, `TEXT_WORK_BUDGET`, and all of
 * them together `REQUEST_WORK_BUDGET`.
 */
export class ConnectionRedaction {
  /** The connection's secrets, shortest first, without empty ones or repeats. */
  private readonly secrets: string[];
  private readonly patterns = new Map<string, Pattern>();
  private work = 0;
  private spent = false;

  constructor(secrets: readonly string[]) {
    this.secrets = [...new Set(secrets)]
      .filter((secret) => secret.length > 0)
      .sort((left, right) => left.length - right.length);
  }

  /**
   * Charges a text's reads, and the tables of `needed` not built yet. False
   * when the text would pass its own budget, and from then on once the
   * request would pass its.
   */
  private charge(reads: number, needed: readonly string[]) {
    if (reads > TEXT_WORK_BUDGET) return false;
    const tables = needed.reduce(
      (sum, secret) => sum + (this.patterns.has(secret) ? 0 : secret.length),
      0,
    );
    if (this.spent || this.work + reads + tables > REQUEST_WORK_BUDGET) {
      this.spent = true;
      return false;
    }
    this.work += reads + tables;
    return true;
  }

  private pattern(secret: string) {
    let pattern = this.patterns.get(secret);
    if (!pattern) {
      pattern = compilePattern(secret);
      this.patterns.set(secret, pattern);
    }
    return pattern;
  }

  /** `message` with each secret replaced, or undefined past a budget. */
  redact(message: string): string | undefined {
    const keptLength = message.endsWith(CUT_MARK)
      ? message.length - CUT_MARK.length
      : -1;
    // A secret longer than the text can't be in it whole. It matters only
    // where a cut may have split it, and only the text's end can hold that.
    const whole: string[] = [];
    const cutOnly: string[] = [];
    let reads = 0;
    for (const secret of this.secrets) {
      if (secret.length <= message.length) {
        whole.push(secret);
        reads += message.length;
      } else if (keptLength > 0) {
        cutOnly.push(secret);
        reads += Math.min(secret.length - 1, keptLength);
      } else {
        break;
      }
    }
    if (whole.length === 0 && cutOnly.length === 0) return message;
    if (!this.charge(reads, [...whole, ...cutOnly])) return undefined;
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
    let cutLength = 0;
    for (const secret of whole) {
      const pattern = this.pattern(secret);
      scan(pattern, message, (read, matched) => {
        if (matched === pattern.secret.length) cover(read - matched, read);
        if (read === keptLength) {
          cutLength = Math.max(cutLength, cutStart(pattern, matched));
        }
      });
    }
    for (const secret of cutOnly) {
      const pattern = this.pattern(secret);
      const tail = message.slice(
        keptLength - Math.min(secret.length - 1, keptLength),
        keptLength,
      );
      let matched = 0;
      scan(pattern, tail, (_, state) => {
        matched = state;
      });
      cutLength = Math.max(cutLength, cutStart(pattern, matched));
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

  /**
   * `message` cut to 1,000 characters, never inside a `[secret]` or right
   * after the start of a secret, or undefined past a budget.
   */
  bound(message: string): string | undefined {
    if (message.length <= MAX_CONNECTION_ERROR_CHARACTERS) return message;
    const limit = MAX_CONNECTION_ERROR_CHARACTERS - CUT_MARK.length;
    // A secret of any length can start right before the cut.
    if (!this.charge(limit * this.secrets.length, this.secrets)) {
      return undefined;
    }
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
    for (const secret of this.secrets) {
      const pattern = this.pattern(secret);
      scan(pattern, head, (read, matched) => {
        if (cutStart(pattern, matched) > 0) blocked[read] = 1;
      });
    }
    let end = limit;
    while (blocked[end]) end -= 1;
    return `${message.slice(0, end)}${CUT_MARK}`;
  }

  /**
   * A text as it may be shown, stored or returned: each secret replaced,
   * then cut to 1,000 characters, or `UNCHECKED_TEXT` past a budget.
   */
  text(text: string): string {
    return this.checked(text) ?? UNCHECKED_TEXT;
  }

  /**
   * A summary with each value that holds a secret redacted. A value that is
   * all secret, such as a number, becomes `[secret]`. An entry whose key
   * holds a secret goes, so no two keys can collide once redacted. A summary
   * of more than 50 entries, or one that can't be checked, goes whole.
   */
  summary<Value extends string | number | boolean>(
    summary: Readonly<Record<string, Value>>,
  ): Record<string, Value | string> {
    const entries = Object.entries(summary);
    if (entries.length > MAX_CONNECTION_SUMMARY_ENTRIES) return {};
    const kept: [string, Value | string][] = [];
    for (const [key, value] of entries) {
      const redactedKey = this.redact(key);
      if (redactedKey === undefined) return {};
      if (redactedKey !== key) continue;
      const text = String(value);
      const checked = this.checked(text);
      if (checked === undefined) return {};
      kept.push([key, checked === text ? value : checked]);
    }
    return Object.fromEntries(kept);
  }

  private checked(text: string): string | undefined {
    const redacted = this.redact(text);
    return redacted === undefined ? undefined : this.bound(redacted);
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
 * a little more. Nothing leaks either way. A message that can't be checked
 * within `TEXT_WORK_BUDGET` becomes `UNCHECKED_TEXT`.
 */
export function redactSecretValues(
  message: string,
  secrets: readonly string[],
): string {
  return new ConnectionRedaction(secrets).redact(message) ?? UNCHECKED_TEXT;
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
  return new ConnectionRedaction(secrets).bound(message) ?? UNCHECKED_TEXT;
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Text a plugin wrote for a connection, such as an error or a status message,
 * as it may be shown, stored or returned: every secret value of the
 * connection replaced, then the length bounded to 1,000 characters. Bounding
 * comes last because a short secret grows into `[secret]`. For several texts
 * of one connection, build one `ConnectionRedaction` and reuse it.
 */
export function redactPluginText(
  text: string,
  secrets: readonly string[],
): string {
  return new ConnectionRedaction(secrets).text(text);
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
  return new ConnectionRedaction(secrets).summary(summary);
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
