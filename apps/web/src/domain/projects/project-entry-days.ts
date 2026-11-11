import type { LocalTimesheetEntry } from "@/domain/local-state";

/** How many entries the project page's Time entries tab adds at a time. */
export const PROJECT_ENTRY_PAGE_SIZE = 50;

/** One day of the Time entries tab: its date and its entries, in list order. */
export interface ProjectEntryDay<Entry> {
  localDate: string;
  entries: Entry[];
}

/**
 * Groups a project's entries, sorted newest day first, into days, and keeps
 * the newest days until at least `limit` entries show. A day is never cut, so
 * its heading's total counts all of its entries; the list can run a few
 * entries past `limit` to finish the last day.
 *
 * @returns the days to show, how many entries wait behind "Show more", and
 * the limit "Show more" sets: a page past the entries shown, not past
 * `limit`, so a click after a day longer than a page still shows more.
 */
export function getProjectEntryDays<
  Entry extends Pick<LocalTimesheetEntry, "localDate">,
>(
  entries: readonly Entry[],
  limit: number,
): { days: ProjectEntryDay<Entry>[]; hiddenCount: number; nextLimit: number } {
  const days: ProjectEntryDay<Entry>[] = [];
  let shownCount = 0;
  for (const entry of entries) {
    const day = days.at(-1);
    if (day?.localDate === entry.localDate) {
      day.entries.push(entry);
    } else if (shownCount >= limit) {
      break;
    } else {
      days.push({ localDate: entry.localDate, entries: [entry] });
    }
    shownCount += 1;
  }
  return {
    days,
    hiddenCount: entries.length - shownCount,
    nextLimit: shownCount + PROJECT_ENTRY_PAGE_SIZE,
  };
}
