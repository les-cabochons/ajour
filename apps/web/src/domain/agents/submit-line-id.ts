/**
 * A short stable ID for a Submit line, from its entry IDs. The agent writes
 * it at the end of the external timesheet's comment, so a rerun can tell its
 * own entries from the user's. It only tells lines apart within a week, so a
 * 32-bit FNV-1a hash is enough. Web Crypto's SHA-256 would need an await the
 * read tools cannot make.
 */
export function submitLineId(entryIds: readonly string[]): string {
  const text = [...entryIds].sort().join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ajour:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
