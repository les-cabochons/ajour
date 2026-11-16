import { decodeNamedCharacterReference } from "decode-named-character-reference";

/**
 * Frontmatter: a YAML-like block at the very start of a backlog item's
 * description, between two `---` lines, through which the description sends
 * data to Ajour (#281). Its `timelog` names the item's project and task, and
 * its other keys show in the item's properties.
 *
 * Ajour reads `key: value` lines, maps nested by indentation, `#` comment
 * lines and lists. Unlike YAML, a value is the rest of its line as written,
 * so `Task: Billet #12: Site` is all text; one quoted string from end to end
 * loses its quotes. Character references such as `&amp;` read as the
 * character, as the description's Markdown shows them. A block of other
 * lines is not frontmatter, so the description shows as written.
 */

/**
 * A key of the block other than `timelog`, with a plain value, a list of
 * plain values, or the fields nested under it. Empty ones are left out.
 */
export type FrontmatterField =
  | { kind: "value"; key: string; value: string }
  | { kind: "list"; key: string; values: string[] }
  | { kind: "map"; key: string; fields: FrontmatterField[] };

/** The project and task a description's `timelog` names, trimmed. */
export interface DescriptionTimelog {
  project?: string;
  task?: string;
}

export interface DescriptionFrontmatter {
  fields: FrontmatterField[];
  timelog?: DescriptionTimelog;
}

export interface SplitDescription {
  frontmatter: DescriptionFrontmatter | null;
  /** The text after the block, or the whole description without one. */
  body: string;
}

type YamlValue = string | string[] | YamlMap;
/** Entries in the order they are written. */
type YamlMap = [key: string, value: YamlValue][];

interface YamlLine {
  indent: number;
  text: string;
}

interface Parsed<T> {
  value: T;
  next: number;
}

/** How deep keys may nest. A deeper block is not frontmatter. */
const MAX_NESTING = 16;

/** YAML reads at most 1,024 characters ahead for a key's `:`. */
const MAX_KEY_LENGTH = 1024;

/**
 * A character YAML does not allow written raw, a bare carriage return
 * included, once references are decoded. An escape in a double-quoted string
 * can still spell one.
 */
const FORBIDDEN_CHARACTER =
  /[^\t\x20-\x7E\x85\xA0-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

const OPENING = /^---[ \t]*\r?\n/;
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/;

/** Splits a description into its frontmatter and the text to render. */
export function splitDescription(description: string): SplitDescription {
  const unchanged = { frontmatter: null, body: description };
  const opening = OPENING.exec(description);
  if (!opening) return unchanged;

  const lines = description.slice(opening[0].length).split(/\r?\n/);
  const closing = lines.findIndex((line) => CLOSING.test(line));
  if (closing < 0) return unchanged;

  // Keys and values decode their references once read, so an encoded quote
  // never ends a quoted string; a line must not spell a forbidden one either.
  const block = lines.slice(0, closing);
  if (
    block.some((line) =>
      FORBIDDEN_CHARACTER.test(decodeCharacterReferences(line)),
    )
  ) {
    return unchanged;
  }
  const yamlLines = toYamlLines(block);
  const map = yamlLines && parseMap(yamlLines, 0, 0, 1);
  if (!map) return unchanged;

  return {
    frontmatter: toFrontmatter(map.value),
    body: lines
      .slice(closing + 1)
      .join("\n")
      .replace(/^(?:[ \t]*\n)+/, ""),
  };
}

/** The timelog of a description, or undefined when it names no project or task. */
export function getDescriptionTimelog(
  description: string | undefined,
): DescriptionTimelog | undefined {
  return description
    ? splitDescription(description).frontmatter?.timelog
    : undefined;
}

const CHARACTER_REFERENCE =
  /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{0,31}));/g;

/**
 * Text with its character references decoded, as Markdown reads them. A
 * source tool can write `&amp;` or `&quot;` for a character, as Azure DevOps
 * keeps a Markdown description Teamwork wrote. An unknown name stays as written.
 */
function decodeCharacterReferences(text: string) {
  return text.replace(
    CHARACTER_REFERENCE,
    (reference, decimal?: string, hex?: string, name?: string) => {
      if (name) return decodeNamedCharacterReference(name) || reference;
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex!, 16);
      const valid =
        codePoint > 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff);
      return valid ? String.fromCodePoint(codePoint) : reference;
    },
  );
}

/** Whether a field value is an http or https address, which shows as a link. */
export function isFrontmatterLink(value: string) {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether two timelogs name the same project and task, ignoring case. */
export function isSameTimelog(
  left: DescriptionTimelog | undefined,
  right: DescriptionTimelog | undefined,
) {
  const same = (a: string | undefined, b: string | undefined) =>
    (a?.toLowerCase() ?? "") === (b?.toLowerCase() ?? "");
  return same(left?.project, right?.project) && same(left?.task, right?.task);
}

function toFrontmatter(map: YamlMap): DescriptionFrontmatter {
  const timelogEntry = map.find(([key]) => key.toLowerCase() === "timelog");
  const timelog = timelogEntry ? readTimelog(timelogEntry[1]) : undefined;
  const fields = toFields(
    map.filter(([key]) => key.toLowerCase() !== "timelog"),
  );
  return timelog ? { fields, timelog } : { fields };
}

function readTimelog(value: YamlValue): DescriptionTimelog | undefined {
  if (!isYamlMap(value)) return undefined;
  const read = (name: string) => {
    const entry = value.find(([key]) => key.toLowerCase() === name);
    return typeof entry?.[1] === "string"
      ? entry[1].trim() || undefined
      : undefined;
  };
  const project = read("project");
  const task = read("task");
  if (!project && !task) return undefined;
  return {
    ...(project ? { project } : {}),
    ...(task ? { task } : {}),
  };
}

function toFields(map: YamlMap): FrontmatterField[] {
  return map.flatMap(([key, value]): FrontmatterField[] => {
    if (typeof value === "string") {
      return value ? [{ kind: "value", key, value }] : [];
    }
    if (isYamlMap(value)) {
      const fields = toFields(value);
      return fields.length > 0 ? [{ kind: "map", key, fields }] : [];
    }
    const values = value.filter(Boolean);
    return values.length > 0 ? [{ kind: "list", key, values }] : [];
  });
}

function isYamlMap(value: YamlValue): value is YamlMap {
  return Array.isArray(value) && value.some((entry) => Array.isArray(entry));
}

/**
 * Drops blank lines and lines that start with `#`. Null when a tab indents a
 * line. Only spaces and tabs are whitespace; a non-breaking space is text.
 */
function toYamlLines(lines: string[]): YamlLine[] | null {
  const yamlLines: YamlLine[] = [];
  for (const line of lines) {
    if (/^[ \t]*(?:#.*)?$/.test(line)) continue;
    const indent = /^[ \t]*/.exec(line)![0].length;
    if (line.slice(0, indent).includes("\t")) return null;
    yamlLines.push({ indent, text: trimSpaces(line.slice(indent)) });
  }
  return yamlLines;
}

/** Trims YAML whitespace, spaces and tabs, and nothing else. */
function trimSpaces(text: string) {
  return text.replace(/^[ \t]+|[ \t]+$/g, "");
}

function isListItem(text: string) {
  return text === "-" || text.startsWith("- ");
}

function parseMap(
  lines: YamlLine[],
  start: number,
  indent: number,
  depth: number,
): Parsed<YamlMap> | null {
  if (depth > MAX_NESTING) return null;
  const map: YamlMap = [];
  // Keys match ignoring case, so one that repeats in any case makes the
  // block ambiguous.
  const seen = new Set<string>();
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent || isListItem(line.text)) return null;
    const entry = splitKey(line.text);
    if (!entry || seen.has(entry.key.toLowerCase())) return null;
    seen.add(entry.key.toLowerCase());
    index += 1;

    if (entry.value) {
      map.push([entry.key, parseInlineValue(entry.value)]);
      continue;
    }

    // An empty value opens a nested map or a list, which YAML also allows at
    // the key's own indentation.
    const child = lines[index];
    const nested =
      child && child.indent > indent
        ? isListItem(child.text)
          ? parseList(lines, index, child.indent)
          : parseMap(lines, index, child.indent, depth + 1)
        : child && child.indent === indent && isListItem(child.text)
          ? parseList(lines, index, indent)
          : { value: "", next: index };
    if (!nested) return null;
    map.push([entry.key, nested.value]);
    index = nested.next;
  }
  return { value: map, next: index };
}

function parseList(
  lines: YamlLine[],
  start: number,
  indent: number,
): Parsed<string[]> | null {
  const values: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent !== indent || !isListItem(line.text)) break;
    values.push(parseScalar(trimSpaces(line.text.slice(1))));
    index += 1;
  }
  if (lines[index] && lines[index]!.indent > indent) return null;
  return { value: values, next: index };
}

/**
 * A `key: value` line, with a plain or quoted key, split at the key's first
 * `:` followed by a space. Null when it is not one.
 */
function splitKey(text: string): { key: string; value: string } | null {
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = readQuoted(text);
    if (!quoted) return null;
    const rest = /^[ \t]*:(?=[ \t]|$)/.exec(text.slice(quoted.end));
    if (!rest || !quoted.value) return null;
    if (isTooLongKey(text.slice(0, quoted.end + rest[0].length - 1))) {
      return null;
    }
    return {
      key: decodeCharacterReferences(quoted.value),
      value: trimSpaces(text.slice(quoted.end + rest[0].length)),
    };
  }
  const colon = /:(?=[ \t]|$)/.exec(text);
  if (!colon) return null;
  if (isTooLongKey(text.slice(0, colon.index))) return null;
  const key = trimSpaces(text.slice(0, colon.index));
  if (!key || !isPlainKey(key)) return null;
  return {
    key: decodeCharacterReferences(key),
    value: trimSpaces(text.slice(colon.index + 1)),
  };
}

/** Whether the text before a key's `:` runs past what YAML reads ahead. */
function isTooLongKey(text: string) {
  return [...text].length > MAX_KEY_LENGTH;
}

/** A value: an inline list such as `[a, b]`, else the text of `parseScalar`. */
function parseInlineValue(text: string): YamlValue {
  return (text.startsWith("[") && parseFlowList(text)) || parseScalar(text);
}

/** The items of `[a, 'b', "c"]`, or null when the text is not only that list. */
function parseFlowList(text: string): string[] | null {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  let closed = -1;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      current += char;
      // An escaped character, `\"` or `''`, never ends the string.
      if (quote === '"' && char === "\\") {
        current += text[index + 1] ?? "";
        index += 1;
      } else if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          current += "'";
          index += 1;
        } else {
          quote = null;
        }
      }
    } else if ((char === '"' || char === "'") && !trimSpaces(current)) {
      // Only a quote that starts an item opens a quoted string; one inside a
      // plain item, as in `Bob's`, is text.
      quote = char;
      current += char;
    } else if (char === "[" || char === "{" || char === "}") {
      return null;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else if (char === "]") {
      closed = index;
      break;
    } else {
      current += char;
    }
  }
  if (closed < 0 || trimSpaces(text.slice(closed + 1))) return null;
  items.push(current);
  // `[]` has no items, and one comma may follow the last item; any other
  // empty item makes it text.
  if (items.length === 1 && !trimSpaces(items[0]!)) items.pop();
  else if (items.length > 1 && !trimSpaces(items.at(-1)!)) items.pop();
  if (items.some((item) => !trimSpaces(item))) return null;
  return items.map((item) => parseScalar(trimSpaces(item)));
}

/**
 * A value as written, `#`, `: ` and YAML's indicators included, with its
 * character references decoded. One quoted string from end to end loses its
 * quotes and reads its escapes. Written quotes come first, so `'Bob&apos;s'`
 * reads `Bob's`, then encoded ones, so `&quot;Billet&quot;` reads `Billet`.
 */
function parseScalar(text: string): string {
  const unquoted = readWholeQuoted(text);
  if (unquoted !== null) return decodeCharacterReferences(unquoted);
  const decoded = decodeCharacterReferences(text);
  return readWholeQuoted(decoded) ?? decoded;
}

/** The value of a quoted string that is all of `text`, else null. */
function readWholeQuoted(text: string) {
  if (!text.startsWith('"') && !text.startsWith("'")) return null;
  const quoted = readQuoted(text);
  return quoted && quoted.end === text.length ? quoted.value : null;
}

/** Whether a key is plain text, not a YAML indicator such as `&anchor`. */
function isPlainKey(key: string) {
  return !/^[[\]{},#&*!|>'"%@`]/.test(key) && !/^[-?:](?:[ \t]|$)/.test(key);
}

/** YAML's one-character escapes in double-quoted strings. */
const ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: " ",
  L: " ",
  P: " ",
};

/** How many hex digits follow `\x`, `\u` and `\U`. */
const HEX_ESCAPE_LENGTHS: Record<string, number> = { x: 2, u: 4, U: 8 };

/**
 * A quoted string at the start of `text`, and where it ends. An escape YAML
 * does not define makes it null, so the block shows as written.
 */
function readQuoted(text: string): { value: string; end: number } | null {
  const quote = text[0];
  let value = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote === "'") {
      if (char !== "'") {
        value += char;
      } else if (text[index + 1] === "'") {
        value += "'";
        index += 1;
      } else {
        return { value, end: index + 1 };
      }
    } else if (char === "\\") {
      const escaped = text[index + 1] ?? "";
      const hexLength = HEX_ESCAPE_LENGTHS[escaped];
      if (hexLength) {
        const hex = text.slice(index + 2, index + 2 + hexLength);
        if (hex.length !== hexLength || !/^[0-9a-fA-F]+$/.test(hex)) {
          return null;
        }
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10ffff) return null;
        value += String.fromCodePoint(codePoint);
        index += 1 + hexLength;
      } else {
        const decoded = ESCAPES[escaped];
        if (decoded === undefined) return null;
        value += decoded;
        index += 1;
      }
    } else if (char === '"') {
      return { value, end: index + 1 };
    } else {
      value += char;
    }
  }
  return null;
}
