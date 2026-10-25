/**
 * Replaces a connection's secrets in a whole answer, as the credential
 * broker scrubs one before a plugin reads it (#338): every secret in the
 * forms a service may echo it in, found in one pass over the bytes,
 * whatever the content type, within a work budget.
 *
 * `secretEchoForms` gives the forms of one secret: URL-encoded, JSON- and
 * HTML-escaped, base64, and, for an address that is itself a secret, the
 * address after its scheme (which alone stays, as in `https://[secret]`),
 * its path and query alone, and each part of it that isn't a common word.
 * `SecretBytesRedaction` finds all of them
 * at once with an Aho-Corasick automaton, so the cost is the bytes read,
 * twice at most, however many forms there are, and its memory is linear in
 * the forms' bytes. Letters match in any case, so an uppercase host or hex
 * escape matches too; that can only redact more.
 */

import { SECRET_MARK } from "./secret-redaction.ts";

/**
 * The most bytes one redaction may read, across its calls: an 8 MB answer,
 * the broker's largest, and its headers fit eight times over. Past it,
 * `bytes` gives undefined, and the caller drops what it couldn't check.
 */
export const BYTES_WORK_BUDGET = 64 * 1024 * 1024;

/**
 * The most bytes the forms of one redaction may hold together, which bounds
 * its automaton's memory, about 17 bytes per form byte. A connection's
 * forms take tens of kilobytes; a redaction given more checks nothing.
 */
export const MAX_FORM_BYTES = 2 * 1024 * 1024;

const encoder = new TextEncoder();
const MARK = encoder.encode(SECRET_MARK);

function base64(text: string) {
  let binary = "";
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The base64 forms of a text: padded, unpadded, and base64url. */
function base64Forms(text: string): string[] {
  const padded = base64(text);
  const unpadded = padded.replace(/=+$/, "");
  return [padded, unpadded, unpadded.replaceAll("+", "-").replaceAll("/", "_")];
}

function html(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** JSON with `&`, `<` and `>` escaped as `\u00XX`, as Go's writer does. */
function jsonUnicodeEscaped(json: string) {
  return json.replace(
    /[&<>]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * The ways one text may be written back, but base64: as it is,
 * URL-encoded, JSON-escaped and HTML-escaped. Each escapes character by
 * character, so a text's form holds the form of each part of it.
 */
function escapes(text: string): string[] {
  const encoded = encodeURIComponent(text);
  const json = JSON.stringify(text).slice(1, -1);
  const slashes = json.replaceAll("/", "\\/");
  return [
    text,
    encoded,
    encoded.replaceAll("%20", "+"),
    encodeURI(text),
    json,
    slashes,
    jsonUnicodeEscaped(json),
    jsonUnicodeEscaped(slashes),
    html(text),
  ];
}

/** Query keys whose value is a credential, however short. */
const CREDENTIAL_KEY =
  /token|key|sig|secret|auth|pass|pwd|code|credential|session|ticket/i;

/**
 * Whether a part of a secret address, a path segment or a query value,
 * could carry the secret on its own: 8 characters or more and not a common
 * word, as one with a digit, mixed case, or 20 characters or more.
 */
function isMeaningfulPart(part: string) {
  return (
    part.length >= 8 &&
    (/\d/.test(part) ||
      (/[a-z]/.test(part) && /[A-Z]/.test(part)) ||
      part.length >= 20)
  );
}

function decoded(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** What an address that is a secret may be echoed as. */
interface AddressTexts {
  /** Escaped every way: the address without its scheme, its path and query, its telling parts. */
  escaped: string[];
  /** In base64 too: the address whole, as it was entered and as a URL. */
  whole: string[];
}

function addressTexts(value: string): AddressTexts | undefined {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (!["https:", "http:", "webcal:", "webcals:"].includes(url.protocol)) {
    return undefined;
  }
  const rest = url.href.slice(url.protocol.length + 2);
  const original = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Without a scheme: each escape goes character by character, so the
  // address with any scheme holds these, and only its scheme stays.
  const escaped = [rest, original];
  const parts: string[] = [];
  for (const segment of url.pathname.split("/")) {
    parts.push(segment, decoded(segment));
  }
  url.searchParams.forEach((part, key) => {
    if (CREDENTIAL_KEY.test(key) && part.length >= 4) escaped.push(part);
    parts.push(part);
  });
  const meaningful = parts.filter(isMeaningfulPart);
  escaped.push(...meaningful);
  // The path and query alone, as an error page shows them: only when they
  // hold a part that tells, or are long enough not to be a common path, so
  // `/feed.ics` alone isn't scrubbed everywhere.
  const pathAndQuery = `${url.pathname}${url.search}`;
  if (meaningful.length > 0 || pathAndQuery.length >= 16) {
    escaped.push(pathAndQuery, decoded(pathAndQuery));
    if (meaningful.some((part) => url.pathname.includes(part))) {
      escaped.push(url.pathname);
    }
  }
  return { escaped, whole: [url.href, trimmed, `https://${rest}`] };
}

/**
 * The forms of one secret to redact: the value, trimmed too, in each of its
 * escapes and in base64, and the forms and telling parts of an address
 * that is one.
 */
export function secretEchoForms(secret: string): string[] {
  if (secret.trim().length === 0) return [];
  const forms = new Set<string>();
  const add = (texts: readonly string[]) => {
    for (const form of texts) if (form.length > 0) forms.add(form);
  };
  for (const text of new Set([secret, secret.trim()])) {
    add(escapes(text));
    add(base64Forms(text));
  }
  const address = addressTexts(secret);
  if (address) {
    for (const text of address.escaped) add(escapes(text));
    for (const text of address.whole) add(base64Forms(text));
  }
  return [...forms];
}

/** ASCII letters fold to lowercase; every other byte stays. */
function folded(byte: number) {
  return byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte;
}

/**
 * Redacts every form it is given from bytes and texts, in one pass each.
 * Build one per answer: its automaton is built once. Each call charges the
 * bytes it reads to the budget, and once the budget is spent every call
 * gives undefined, so the caller drops what it couldn't check.
 */
export class SecretBytesRedaction {
  /** The root's child for each byte, or 0: the root is dense. */
  private readonly rootNext = new Int32Array(256);
  /** Each other node's first child, and each node's next sibling, or -1. */
  private readonly firstChild: Int32Array;
  private readonly nextSibling: Int32Array;
  /** The byte that leads to each node. */
  private readonly byteOf: Uint8Array;
  /** The longest end of each node's text that is also a start of a form. */
  private readonly fail: Int32Array;
  /** The longest form that ends at each node, in bytes, or 0. */
  private readonly longest: Int32Array;
  private readonly budget: number;
  private work = 0;
  private spent = false;
  /** Whether it was given no form, so it changes nothing. */
  readonly empty: boolean;

  constructor(
    forms: readonly string[],
    options: { budget?: number; maxFormBytes?: number } = {},
  ) {
    this.budget = options.budget ?? BYTES_WORK_BUDGET;
    const patterns = [...new Set(forms)]
      .filter((form) => form.length > 0)
      .map((form) => encoder.encode(form).map(folded));
    this.empty = patterns.length === 0;
    // There are at most as many nodes as the forms have bytes, so forms too
    // large to check cost nothing more.
    let nodes = 1;
    for (const pattern of patterns) nodes += pattern.length;
    if (nodes - 1 > (options.maxFormBytes ?? MAX_FORM_BYTES)) {
      this.spent = true;
      nodes = 1;
    }
    this.firstChild = new Int32Array(nodes).fill(-1);
    this.nextSibling = new Int32Array(nodes).fill(-1);
    this.byteOf = new Uint8Array(nodes);
    this.fail = new Int32Array(nodes);
    this.longest = new Int32Array(nodes);
    if (this.spent) return;
    // The trie.
    let count = 1;
    for (const pattern of patterns) {
      let node = 0;
      for (const byte of pattern) {
        let child = this.child(node, byte);
        if (child === -1) {
          child = count;
          count += 1;
          this.byteOf[child] = byte;
          if (node === 0) {
            this.rootNext[byte] = child;
          } else {
            this.nextSibling[child] = this.firstChild[node]!;
            this.firstChild[node] = child;
          }
        }
        node = child;
      }
      this.longest[node] = Math.max(this.longest[node]!, pattern.length);
    }
    // The failures, breadth first, so a node's failure is done before it.
    const queue = new Int32Array(count);
    let tail = 0;
    for (let byte = 0; byte < 256; byte += 1) {
      const child = this.rootNext[byte]!;
      if (child !== 0) queue[tail++] = child;
    }
    for (let head = 0; head < tail; head += 1) {
      const node = queue[head]!;
      for (
        let child = this.firstChild[node]!;
        child !== -1;
        child = this.nextSibling[child]!
      ) {
        const target = this.step(this.fail[node]!, this.byteOf[child]!);
        this.fail[child] = target;
        this.longest[child] = Math.max(
          this.longest[child]!,
          this.longest[target]!,
        );
        queue[tail++] = child;
      }
    }
  }

  /** The child of `node` by `byte`, or -1. */
  private child(node: number, byte: number) {
    if (node === 0) {
      const child = this.rootNext[byte]!;
      return child === 0 ? -1 : child;
    }
    let child = this.firstChild[node]!;
    while (child !== -1 && this.byteOf[child] !== byte) {
      child = this.nextSibling[child]!;
    }
    return child;
  }

  /** The node after reading `byte` at `node`, following failures. */
  private step(node: number, byte: number) {
    for (;;) {
      const child = this.child(node, byte);
      if (child !== -1) return child;
      if (node === 0) return 0;
      node = this.fail[node]!;
    }
  }

  private charge(work: number) {
    if (this.spent || this.work + work > this.budget) {
      this.spent = true;
      return false;
    }
    this.work += work;
    return true;
  }

  /** The ranges to replace, `[start, end)` pairs in order and apart, or undefined past the budget. */
  private ranges(bytes: Uint8Array): number[] | undefined {
    if (this.spent) return undefined;
    if (this.empty) return [];
    if (!this.charge(bytes.byteLength)) return undefined;
    const { rootNext, firstChild, nextSibling, byteOf, fail, longest } = this;
    const ranges: number[] = [];
    let node = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = folded(bytes[index]!);
      // Each failure shortens the match, which each byte lengthens by one
      // at most, so a text costs twice its length in steps at most.
      for (;;) {
        if (node === 0) {
          node = rootNext[byte]!;
          break;
        }
        let child = firstChild[node]!;
        while (child !== -1 && byteOf[child] !== byte) {
          child = nextSibling[child]!;
        }
        if (child !== -1) {
          node = child;
          break;
        }
        node = fail[node]!;
      }
      const length = longest[node]!;
      if (length === 0) continue;
      let start = index + 1 - length;
      // Ends only grow, so a match takes in every range it overlaps or touches.
      while (ranges.length > 0 && ranges[ranges.length - 1]! >= start) {
        ranges.pop();
        start = Math.min(start, ranges.pop()!);
      }
      ranges.push(start, index + 1);
    }
    return ranges;
  }

  /**
   * The bytes with each form replaced by `[secret]`, the same bytes when
   * none is in them, or undefined past the budget.
   */
  bytes(body: Uint8Array): Uint8Array | undefined {
    const ranges = this.ranges(body);
    if (ranges === undefined) return undefined;
    if (ranges.length === 0) return body;
    let size = body.byteLength;
    for (let at = 0; at < ranges.length; at += 2) {
      size += MARK.byteLength - (ranges[at + 1]! - ranges[at]!);
    }
    const result = new Uint8Array(size);
    let from = 0;
    let written = 0;
    for (let at = 0; at < ranges.length; at += 2) {
      const start = ranges[at]!;
      result.set(body.subarray(from, start), written);
      written += start - from;
      result.set(MARK, written);
      written += MARK.byteLength;
      from = ranges[at + 1]!;
    }
    result.set(body.subarray(from), written);
    return result;
  }

  /** Whether the text holds a form, or undefined past the budget. */
  holdsSecret(text: string): boolean | undefined {
    const ranges = this.ranges(encoder.encode(text));
    return ranges === undefined ? undefined : ranges.length > 0;
  }
}
