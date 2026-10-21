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

const HOME_MARK = "~";
const USER_DATA_MARK = "[user data]";
const URL_MARK = "[url]";
const CUT_MARK = "…";
/** Marks a cut must not split. */
const MARKS = ["[secret]", USER_DATA_MARK, URL_MARK];

// A scheme, "://", and everything up to a space or a quote, without the
// punctuation that ends a sentence. The scheme is bounded, so a long word
// before "://" costs no more than its last 20 letters.
const URL = /[a-z][a-z0-9+.-]{0,19}:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)\]}]/gi;

/**
 * A message as an event may hold it: secret values, URLs, the user data path
 * and the home directory replaced, then cut to 512 characters. What is left
 * can still name a file or a host, so a scrubbed message stays sensitive.
 */
export function scrubErrorMessage(
  message: string,
  context: ScrubContext = {},
): string {
  // Secrets first, on the original text: a secret may hold a URL or a path.
  const redacted = context.secrets?.length
    ? new ConnectionRedaction(context.secrets).redact(message)
    : message;
  if (redacted === undefined) return UNCHECKED_TEXT;
  // The user data path usually sits inside the home directory.
  const scrubbed = replacePath(
    replacePath(
      redacted.replace(URL, URL_MARK),
      context.userDataPath,
      USER_DATA_MARK,
    ),
    context.homeDirectory,
    HOME_MARK,
  );
  return cap(scrubbed);
}

/**
 * Replaces `directory` in `text`, whatever its case, with either separator,
 * and with separators doubled as JSON escapes them.
 */
function replacePath(
  text: string,
  directory: string | undefined,
  mark: string,
) {
  const parts = directory?.split(/[\\/]+/).filter((part) => part.length > 0);
  // A root such as "/" or "C:\" would replace every separator.
  if (
    !parts ||
    parts.length === 0 ||
    (parts.length === 1 && /^[a-z]:$/i.test(parts[0]!))
  ) {
    return text;
  }
  const leading = /^[\\/]/.test(directory!) ? "[\\\\/]+" : "";
  const pattern = new RegExp(
    leading + parts.map(escapeRegExp).join("[\\\\/]+"),
    "gi",
  );
  return text.replace(pattern, mark);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
