/**
 * Unsaved composer drafts, per target: a new entry, an entry, a backlog item,
 * a project or a task. Escape closes a composer and keeps its draft here, so
 * opening the same composer again brings the text back, as the comment
 * editor does. Save, Cancel and × end the draft. They live in memory, for
 * this window only, and are never exported.
 */

/** The most drafts kept; the oldest are dropped first. */
export const COMPOSER_DRAFTS_LIMIT = 50;

const drafts = new Map<string, unknown>();

/** The kept draft of the composer `key`, if any. */
export function getComposerDraft<Draft>(key: string): Draft | undefined {
  return drafts.get(key) as Draft | undefined;
}

/** Keeps the composer's draft, as the newest. */
export function keepComposerDraft(key: string, draft: unknown) {
  drafts.delete(key);
  drafts.set(key, draft);
  for (const oldest of drafts.keys()) {
    if (drafts.size <= COMPOSER_DRAFTS_LIMIT) break;
    drafts.delete(oldest);
  }
}

/** Ends the composer's draft: it was saved or discarded. */
export function dropComposerDraft(key: string) {
  drafts.delete(key);
}
