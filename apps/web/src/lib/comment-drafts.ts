/**
 * Unsent comments, per item and per device, so leaving the page or
 * restarting Ajour keeps what the user typed until they send or discard it
 * (map #234). Like the last visits in `comments-seen.ts`, they live outside
 * the local app state and are never exported. Pasted files are not kept.
 */
export const COMMENT_DRAFTS_STORAGE_KEY = "ajour.comment-drafts";

/** The most drafts kept; the oldest edits are dropped first. */
export const COMMENT_DRAFTS_LIMIT = 100;

export type CommentDrafts = Record<string, { text: string; at: number }>;

/** Broken entries are dropped. */
export function parseCommentDrafts(value: string | null): CommentDrafts {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const drafts: CommentDrafts = {};
    for (const [itemId, draft] of Object.entries(parsed)) {
      if (
        draft &&
        typeof draft === "object" &&
        typeof (draft as { text?: unknown }).text === "string" &&
        typeof (draft as { at?: unknown }).at === "number"
      ) {
        drafts[itemId] = draft as { text: string; at: number };
      }
    }
    return drafts;
  } catch {
    return {};
  }
}

/** Sets or clears an item's draft, keeping at most `limit`, the newest. */
export function withCommentDraft(
  drafts: CommentDrafts,
  itemId: string,
  text: string,
  at: number,
  limit = COMMENT_DRAFTS_LIMIT,
): CommentDrafts {
  const next = { ...drafts };
  if (text.trim()) next[itemId] = { text, at };
  else delete next[itemId];
  return Object.fromEntries(
    Object.entries(next)
      .sort(([, left], [, right]) => right.at - left.at)
      .slice(0, limit),
  );
}

function read(): CommentDrafts {
  try {
    return parseCommentDrafts(
      window.localStorage.getItem(COMMENT_DRAFTS_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return {};
  }
}

export function getCommentDraft(itemId: string): string | undefined {
  return read()[itemId]?.text;
}

/** Saves the item's unsent comment; empty text clears it. */
export function setCommentDraft(itemId: string, text: string) {
  try {
    window.localStorage.setItem(
      COMMENT_DRAFTS_STORAGE_KEY,
      JSON.stringify(withCommentDraft(read(), itemId, text, Date.now())),
    );
  } catch {
    // The draft then lasts only while the page stays open.
  }
}
