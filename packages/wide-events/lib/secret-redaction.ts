/**
 * Replaces a connection's secret values in a text: the redaction every
 * plugin error, plugin-written text and wide-event error message goes
 * through. Moved from the local API's plugin-errors.ts (#305), which still
 * owns which connection values are secret, the request budget and the
 * plugin-specific wrappers.
 */

/** The longest last error a connection keeps, as its summary schema allows. */
export const MAX_CONNECTION_ERROR_CHARACTERS = 1_000;

/** What replaces a secret. */
export const SECRET_MARK = "[secret]";

/**
 * What a cut plugin error ends with. The plugin worker cuts a message before
 * the host can redact it, and `boundConnectionError` cuts one after.
 */
const CUT_MARK = "…";

/**
 * The most one text may cost to redact: one step for each secret it is
 * checked against, plus the characters read, which are the text's length for
 * each secret that could be in it whole and, in a cut text, the text before
 * the "…" for each longer secret. A text is dropped as soon as its count
 * passes this, and replaced whole by `UNCHECKED_TEXT`, which is safe.
 */
export const TEXT_WORK_BUDGET = 250_000;

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
 * when a text first needs it. A text shorter than every secret and not cut
 * costs `redact` one comparison, though cutting it to 1,000 characters, when
 * it is longer, still reads each secret. A secret longer than a text is read
 * only for the cut rule. Each text has its own budget, `TEXT_WORK_BUDGET`, and
 * all of them together the request budget the caller gives, if any: the local
 * API gives `REQUEST_WORK_BUDGET` (apps/api/src/plugin-errors.ts).
 */
export class ConnectionRedaction {
  /** The connection's secrets, shortest first, without empty ones or repeats. */
  private readonly secrets: string[];
  /** The shortest secret's length, so a text shorter than it is skipped at once. */
  private readonly shortest: number;
  private readonly patterns = new Map<string, Pattern>();
  /** The most all of this redaction's texts may cost together. */
  private readonly requestBudget: number;
  private work = 0;
  private spent = false;

  constructor(
    secrets: readonly string[],
    options: { requestBudget?: number } = {},
  ) {
    this.requestBudget = options.requestBudget ?? Infinity;
    this.secrets = [...new Set(secrets)]
      .filter((secret) => secret.length > 0)
      .sort((left, right) => left.length - right.length);
    this.shortest = this.secrets[0]?.length ?? Infinity;
  }

  /** Charges `work` to the request. False, from then on, once it would pass its budget. */
  private spend(work: number) {
    if (this.spent || this.work + work > this.requestBudget) {
      this.spent = true;
      return false;
    }
    this.work += work;
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
    const ranges = this.secretRanges(message);
    if (ranges === undefined) return undefined;
    let redacted = "";
    let from = 0;
    for (const [start, end] of ranges) {
      redacted += `${message.slice(from, start)}${SECRET_MARK}`;
      from = end;
    }
    return `${redacted}${message.slice(from)}`;
  }

  /**
   * The ranges of `message` that `redact` replaces, each `[start, end)`, in
   * order and apart, or undefined past a budget. The wide-event scrubber
   * merges them with the URLs and paths it finds in the same text.
   */
  secretRanges(message: string): [number, number][] | undefined {
    const keptLength = message.endsWith(CUT_MARK)
      ? message.length - CUT_MARK.length
      : -1;
    // No secret fits in the text, and no cut can have split one.
    if (message.length < this.shortest && keptLength <= 0) return [];
    if (this.spent) return undefined;
    // A secret longer than the text can't be in it whole. It matters only
    // where a cut may have split it, and then the whole text before the "…"
    // is read.
    const whole: string[] = [];
    const cutOnly: string[] = [];
    let steps = 0;
    let reads = 0;
    let tables = 0;
    for (const secret of this.secrets) {
      if (secret.length <= message.length) {
        whole.push(secret);
        reads += message.length;
      } else if (keptLength > 0) {
        cutOnly.push(secret);
        reads += keptLength;
      } else {
        break;
      }
      steps += 1;
      if (!this.patterns.has(secret)) tables += secret.length;
      if (steps + reads > TEXT_WORK_BUDGET) {
        this.spend(steps);
        return undefined;
      }
    }
    if (whole.length === 0 && cutOnly.length === 0) return [];
    if (!this.spend(steps + reads + tables)) return undefined;
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
    const kept = message.slice(0, keptLength);
    for (const secret of cutOnly) {
      const pattern = this.pattern(secret);
      let matched = 0;
      scan(pattern, kept, (_, state) => {
        matched = state;
      });
      cutLength = Math.max(cutLength, cutStart(pattern, matched));
    }
    if (cutLength > 0) cover(keptLength - cutLength, keptLength);
    const ranges: [number, number][] = [];
    let depth = 0;
    let from = 0;
    for (let index = 0; index <= message.length; index += 1) {
      const next = depth + coverage[index]!;
      if (depth === 0 && next > 0) {
        from = index;
      } else if (depth > 0 && next === 0) {
        ranges.push([from, index]);
      }
      depth = next;
    }
    return ranges;
  }

  /**
   * `message` cut to 1,000 characters, never inside a `[secret]` or right
   * after the start of a secret, or undefined past a budget.
   */
  bound(message: string): string | undefined {
    if (message.length <= MAX_CONNECTION_ERROR_CHARACTERS) return message;
    if (this.spent) return undefined;
    const limit = MAX_CONNECTION_ERROR_CHARACTERS - CUT_MARK.length;
    // A secret of any length can start right before the cut.
    const steps = this.secrets.length;
    const reads = limit * steps;
    if (steps + reads > TEXT_WORK_BUDGET) {
      this.spend(1);
      return undefined;
    }
    let tables = 0;
    for (const secret of this.secrets) {
      if (!this.patterns.has(secret)) tables += secret.length;
    }
    if (!this.spend(steps + reads + tables)) return undefined;
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
