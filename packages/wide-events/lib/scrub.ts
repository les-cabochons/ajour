import { ConnectionRedaction, UNCHECKED_TEXT } from "./secret-redaction.ts";

/** What locates the user's data on this machine, and what unlocks it. */
export interface ScrubContext {
  /** The secret connection values the failed call could have echoed. */
  secrets?: readonly string[];
  homeDirectory?: string;
  userDataPath?: string;
}

/** The longest message an event keeps. */
export const MAX_MESSAGE_CHARACTERS = 512;

const SECRET_MARK = "[secret]";
const USER_DATA_MARK = "[user data]";
const URL_MARK = "[url]";
const HOME_MARK = "~";
const CUT_MARK = "…";
/** Marks a cut must not split. */
const MARKS = [SECRET_MARK, USER_DATA_MARK, URL_MARK];

// A scheme, "://", and everything up to a space or a quote, without the
// punctuation that ends a sentence. The scheme is bounded, so a long word
// before "://" costs no more than its last 20 letters.
const URL = /[a-z][a-z0-9+.-]{0,19}:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)\]}]/gi;

/** A part of the original message to replace, and with what. */
interface Range {
  start: number;
  end: number;
  /** Breaks a tie between two ranges of the same length: lower wins. */
  rank: number;
  mark: string;
}

/**
 * A message as an event may hold it: secret values, URLs, the user data path
 * and the home directory replaced, then cut to 512 characters. Each is found
 * on the original text, so one inside another can't hide it. Ranges that
 * overlap are replaced once, by the mark of the widest. What is left can
 * still name a file or a host, so a scrubbed message stays sensitive.
 */
export function scrubErrorMessage(
  message: string,
  context: ScrubContext = {},
): string {
  const secretRanges = context.secrets?.length
    ? new ConnectionRedaction(context.secrets).secretRanges(message)
    : [];
  if (secretRanges === undefined) return UNCHECKED_TEXT;
  const ranges: Range[] = [
    ...secretRanges.map(([start, end]) => ({
      start,
      end,
      rank: 0,
      mark: SECRET_MARK,
    })),
    ...pathRanges(message, context.userDataPath, 1, USER_DATA_MARK),
    ...matchRanges(message, URL, 2, URL_MARK),
    ...pathRanges(message, context.homeDirectory, 3, HOME_MARK),
  ];
  return cap(replaceRanges(message, ranges));
}

function matchRanges(
  text: string,
  pattern: RegExp,
  rank: number,
  mark: string,
): Range[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    rank,
    mark,
  }));
}

/**
 * Where `directory` is in `text`, whatever its case, with either separator,
 * with separators doubled as JSON escapes them, and ending where a path
 * segment ends: `C:\Users\Ana` is not in `C:\Users\Anabel`.
 */
function pathRanges(
  text: string,
  directory: string | undefined,
  rank: number,
  mark: string,
): Range[] {
  const parts = directory?.split(/[\\/]+/).filter((part) => part.length > 0);
  // A root such as "/" or "C:\" would replace every separator.
  if (
    !parts ||
    parts.length === 0 ||
    (parts.length === 1 && /^[a-z]:$/i.test(parts[0]!))
  ) {
    return [];
  }
  const leading = /^[\\/]/.test(directory!) ? "[\\\\/]+" : "";
  const pattern = new RegExp(
    `${leading}${parts.map(escapeRegExp).join("[\\\\/]+")}(?![\\w-])`,
    "gi",
  );
  return matchRanges(text, pattern, rank, mark);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces each group of overlapping ranges once, with its widest range's mark. */
function replaceRanges(text: string, ranges: Range[]) {
  if (ranges.length === 0) return text;
  ranges.sort((left, right) => left.start - right.start);
  let result = "";
  let from = 0;
  let group: { start: number; end: number; widest: Range } | undefined;
  const flush = () => {
    if (!group) return;
    result += `${text.slice(from, group.start)}${group.widest.mark}`;
    from = group.end;
  };
  for (const range of ranges) {
    if (group && range.start < group.end) {
      group.end = Math.max(group.end, range.end);
      const width = range.end - range.start;
      const widest = group.widest.end - group.widest.start;
      if (
        width > widest ||
        (width === widest && range.rank < group.widest.rank)
      ) {
        group.widest = range;
      }
      continue;
    }
    flush();
    group = { start: range.start, end: range.end, widest: range };
  }
  flush();
  return `${result}${text.slice(from)}`;
}

/** Cuts a long message, never inside a mark or a surrogate pair. */
function cap(text: string) {
  if (text.length <= MAX_MESSAGE_CHARACTERS) return text;
  let end = MAX_MESSAGE_CHARACTERS - CUT_MARK.length;
  for (const mark of MARKS) {
    const at = text.indexOf(mark, Math.max(0, end - mark.length + 1));
    if (at !== -1 && at < end && at + mark.length > end) end = at;
  }
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${CUT_MARK}`;
}
