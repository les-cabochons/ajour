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

  const yamlLines = toYamlLines(lines.slice(0, closing));
  const map = yamlLines && parseMap(yamlLines, 0, 0);
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
  // A repeated key is invalid YAML; the first one counts.
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

/** Drops blank and comment lines. Null when a tab indents a line. */
function toYamlLines(lines: string[]): YamlLine[] | null {
  const yamlLines: YamlLine[] = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (line.slice(0, indent).includes("\t")) return null;
    yamlLines.push({ indent, text: line.slice(indent).trimEnd() });
  }
  return yamlLines;
}

function isListItem(text: string) {
  return text === "-" || text.startsWith("- ");
}

function parseMap(
  lines: YamlLine[],
  start: number,
  indent: number,
): Parsed<YamlMap> | null {
  const map: YamlMap = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent || isListItem(line.text)) return null;
    const entry = splitKey(line.text);
    if (!entry) return null;
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
          : parseMap(lines, index, child.indent)
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
    const item = line.text.slice(1).trim();
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
    return {
      key: quoted.value,
      value: text.slice(quoted.end + rest[0].length).trim(),
    };
  }
  const colon = /:(?=[ \t]|$)/.exec(text);
  if (!colon) return null;
  const key = text.slice(0, colon.index).trim();
  if (!key || /^[[\]{}#&*!|>%@`]/.test(key)) return null;
  return { key, value: text.slice(colon.index + 1).trim() };
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
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "[" || char === "{") {
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
  if (current.trim() || items.length > 0) items.push(current);

  const values: string[] = [];
  for (const item of items) {
    const value = parseScalar(item.trim());
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
  const value = (comment ? text.slice(0, comment.index) : text).trim();
  return value === "~" || value === "null" ? "" : value;
}

function isEmptyOrComment(text: string) {
  return /^(?:[ \t]*|[ \t]+#.*)$/.test(text);
}

/** A quoted string at the start of `text`, and where it ends. */
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
      const escaped = text[index + 1];
      if (escaped === undefined) return null;
      value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
      index += 1;
    } else if (char === '"') {
      return { value, end: index + 1 };
    } else {
      value += char;
    }
  }
  return null;
}
