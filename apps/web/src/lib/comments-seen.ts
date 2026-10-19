/**
 * When the user last saw each item's comments, per device, so the item page
 * can mark the comments that arrived since with a New divider (ADR 0008). It
 * lives outside the local app state: opening an item never writes the store,
 * and the times are never exported.
 */
export const COMMENTS_SEEN_STORAGE_KEY = "ajour.comments-seen";

/** The most items remembered; the oldest visits are forgotten first. */
export const COMMENTS_SEEN_LIMIT = 500;

export type CommentsSeen = Record<string, number>;

/** Broken values are dropped. */
export function parseCommentsSeen(value: string | null): CommentsSeen {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const seen: CommentsSeen = {};
    for (const [itemId, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) seen[itemId] = at;
    }
    return seen;
  } catch {
    return {};
  }
}

/** Records a visit, keeping at most `limit` items, the most recent ones. */
export function withCommentsSeen(
  seen: CommentsSeen,
  itemId: string,
  at: number,
  limit = COMMENTS_SEEN_LIMIT,
): CommentsSeen {
  const entries = Object.entries({ ...seen, [itemId]: at })
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit);
  return Object.fromEntries(entries);
}

function read(): CommentsSeen {
  try {
    return parseCommentsSeen(
      window.localStorage.getItem(COMMENTS_SEEN_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return {};
  }
}

/** When the user last saw the item's comments on this device. */
export function getCommentsSeenAt(itemId: string): number | undefined {
  return read()[itemId];
}

/** Records that the user saw the item's comments at `at`. */
export function markCommentsSeen(itemId: string, at: number) {
  try {
    window.localStorage.setItem(
      COMMENTS_SEEN_STORAGE_KEY,
      JSON.stringify(withCommentsSeen(read(), itemId, at)),
    );
  } catch {
    // The divider then shows again on the next visit.
  }
}
