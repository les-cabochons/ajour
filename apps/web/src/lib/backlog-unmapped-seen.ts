/**
 * The unmapped source state count at the last Backlog visit, per device. A
 * count that is the same on every visit is a condition, not news: the link
 * shows amber only when the count rose since (council round 15, chosen by the
 * product owner).
 */
const STORAGE_KEY = "ajour.backlog-unmapped-seen";

export function isUnmappedRising(count: number, seen: number | undefined) {
  return count > (seen ?? 0);
}

export function readUnmappedSeen(): number | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value === null ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeUnmappedSeen(count: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(count));
  } catch {
    // Storage can be unavailable; the link then warns again next visit.
  }
}
