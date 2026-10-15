/**
 * The ID an agent writes at the end of an external timesheet entry's comment,
 * so later runs find the entry again: "ajour:" and the 32-bit FNV-1a hash of
 * the Ajour entry ID, as 8 hex characters. It depends on the ID only, so it
 * never changes, whatever the edit. FNV-1a is enough to tell a week's entries
 * apart, and Web Crypto's SHA-256 would need an await the read tools cannot
 * make.
 */
export function externalEntryId(entryId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < entryId.length; index += 1) {
    hash ^= entryId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ajour:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
