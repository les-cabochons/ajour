/**
 * Comments typed in the settle dialog, waiting for the settle to stand (ADR
 * 0008): they go to the source tool after the settle's write lands, or when
 * the Undo toast closes for a settle with nothing to write. Kept per device,
 * outside the local state, so a quit during the Undo window still sends them
 * at the next launch.
 */
export const PENDING_SETTLE_COMMENTS_STORAGE_KEY =
  "ajour.pending-settle-comments";

export interface PendingSettleComment {
  itemId: string;
  pluginId: string;
  connectionId: string;
  sourceId: string;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
  at: number;
}

const isPendingComment = (value: unknown): value is PendingSettleComment => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    ["itemId", "pluginId", "connectionId", "sourceId", "body"].every(
      (key) => typeof entry[key] === "string",
    ) && typeof entry.at === "number"
  );
};

/** Broken entries are dropped. */
export function parsePendingSettleComments(
  value: string | null,
): PendingSettleComment[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(isPendingComment) : [];
  } catch {
    return [];
  }
}

function read() {
  try {
    return parsePendingSettleComments(
      window.localStorage.getItem(PENDING_SETTLE_COMMENTS_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function write(entries: PendingSettleComment[]) {
  try {
    window.localStorage.setItem(
      PENDING_SETTLE_COMMENTS_STORAGE_KEY,
      JSON.stringify(entries),
    );
  } catch {
    // The comment then only waits in this session.
  }
}

/** One comment per item: a new settle replaces the one before. */
export function queueSettleComment(entry: PendingSettleComment) {
  write([
    ...read().filter((pending) => pending.itemId !== entry.itemId),
    entry,
  ]);
}

export function getSettleComment(itemId: string) {
  return read().find((entry) => entry.itemId === itemId);
}

/** Takes the item's comment off the queue, so it is never sent twice. */
export function takeSettleComment(itemId: string) {
  const entries = read();
  const entry = entries.find((pending) => pending.itemId === itemId);
  if (entry) write(entries.filter((pending) => pending.itemId !== itemId));
  return entry;
}

export function settleCommentItemIds() {
  return read().map((entry) => entry.itemId);
}
