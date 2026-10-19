/**
 * Frontmatter: a YAML block at the very start of a backlog item's
 * description, between two `---` lines, through which the description sends
 * data to Ajour (#281). Its `timelog` names the item's project and task, and
 * its other keys show in the item's properties.
 *
 * Ajour reads a small subset of YAML: `key: value`, maps nested by
 * indentation, quoted strings, `#` comments and lists of plain values. A block
 * outside the subset is not frontmatter, so the description shows as written.
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
 * included. An escape in a double-quoted string can still spell one.
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

  const block = lines.slice(0, closing);
  if (block.some((line) => FORBIDDEN_CHARACTER.test(line))) return unchanged;
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
 * Drops blank and comment lines. Null when a tab indents a line. Only spaces
 * and tabs are YAML whitespace; a non-breaking space is text.
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
  // A repeated key is invalid YAML, and keys match ignoring case, so one
  // that repeats in any case makes the block ambiguous.
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
      const value = parseInlineValue(entry.value);
      if (value === null) return null;
      map.push([entry.key, value]);
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
    const item = withoutComment(line.text.slice(1));
    // A map or a list inside a list is outside the subset.
    if (isListItem(item) || splitKey(item)) return null;
    const value = parseScalar(item);
    if (value === null) return null;
    values.push(value);
    index += 1;
  }
  if (lines[index] && lines[index]!.indent > indent) return null;
  return { value: values, next: index };
}

/** A `key: value` line, with a plain or quoted key. Null when it is not one. */
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
      key: quoted.value,
      value: withoutComment(text.slice(quoted.end + rest[0].length)),
    };
  }
  const colon = /:(?=[ \t]|$)/.exec(text);
  if (!colon) return null;
  // A comment runs to the end of the line, so a colon after it is not the
  // key's; `Owner#1` without a space before `#` is still a key.
  const comment = /[ \t]#/.exec(text);
  if (comment && comment.index < colon.index) return null;
  if (isTooLongKey(text.slice(0, colon.index))) return null;
  const key = trimSpaces(text.slice(0, colon.index));
  if (!key || !isPlainScalar(key)) return null;
  return { key, value: withoutComment(text.slice(colon.index + 1)) };
}

/** Whether the text before a key's `:` runs past what YAML reads ahead. */
function isTooLongKey(text: string) {
  return [...text].length > MAX_KEY_LENGTH;
}

/** A value that is only a comment, as in `timelog: # note`, is empty. */
function withoutComment(value: string) {
  const trimmed = trimSpaces(value);
  return trimmed.startsWith("#") ? "" : trimmed;
}

function parseInlineValue(text: string): YamlValue | null {
  if (text.startsWith("{")) return null;
  if (!text.startsWith("[")) return parseScalar(text);

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
    } else if (char === "#" && /[ \t]/.test(text[index - 1] ?? "")) {
      // A comment runs to the end of the line, so the list never closes.
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
  if (closed < 0 || !isEmptyOrComment(text.slice(closed + 1))) return null;
  items.push(current);
  // `[]` has no items, and one comma may follow the last item; any other
  // empty item is invalid YAML.
  if (items.length === 1 && !trimSpaces(items[0]!)) items.pop();
  else if (items.length > 1 && !trimSpaces(items.at(-1)!)) items.pop();
  if (items.some((item) => !trimSpaces(item))) return null;

  const values: string[] = [];
  for (const item of items) {
    const value = parseScalar(trimSpaces(item));
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function parseScalar(text: string): string | null {
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = readQuoted(text);
    if (!quoted || !isEmptyOrComment(text.slice(quoted.end))) return null;
    return quoted.value;
  }
  // A comment starts at a # after a space, so a link's # stays.
  const comment = /[ \t]#/.exec(text);
  const value = trimSpaces(comment ? text.slice(0, comment.index) : text);
  // A YAML null is not text, so it is outside what Ajour reads.
  if (!isPlainScalar(value) || /^(?:~|null|Null|NULL)$/.test(value)) {
    return null;
  }
  return value;
}

/**
 * Whether a plain value is one Ajour reads as text. YAML gives meaning to an
 * indicator up front, such as `*alias`, `&anchor`, `!tag` or `|`, and does not
 * allow `: ` inside a plain value; Ajour shows such a block as written.
 */
function isPlainScalar(value: string) {
  return (
    !/^[[\]{},#&*!|>'"%@`]/.test(value) &&
    !/^[-?:](?:[ \t]|$)/.test(value) &&
    !/:(?:[ \t]|$)/.test(value)
  );
}

function isEmptyOrComment(text: string) {
  return /^(?:[ \t]*|[ \t]+#.*)$/.test(text);
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
