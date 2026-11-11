import { describe, expect, it } from "vitest";
import { getProjectEntryDays } from "@/domain/projects/project-entry-days";

/** `count` entries on each of the given days, newest day first, as the page sorts them. */
function entriesOn(days: string[], count: number) {
  return days.flatMap((localDate) =>
    Array.from({ length: count }, (_, index) => ({
      _id: `${localDate}-${index}`,
      localDate,
    })),
  );
}

const ids = (days: { entries: { _id: string }[] }[]) =>
  days.flatMap((day) => day.entries.map((entry) => entry._id));

describe("getProjectEntryDays", () => {
  it("groups entries by day in list order", () => {
    const entries = entriesOn(["2026-11-06", "2026-11-05"], 2);

    const { days, hiddenCount } = getProjectEntryDays(entries, 50);

    expect(days.map((day) => day.localDate)).toEqual([
      "2026-11-06",
      "2026-11-05",
    ]);
    expect(ids(days)).toEqual(entries.map((entry) => entry._id));
    expect(hiddenCount).toBe(0);
  });

  it("stops at the first day that starts past the limit", () => {
    const entries = entriesOn(["2026-11-06", "2026-11-05", "2026-11-04"], 2);

    const { days, hiddenCount } = getProjectEntryDays(entries, 4);

    expect(days.map((day) => day.localDate)).toEqual([
      "2026-11-06",
      "2026-11-05",
    ]);
    expect(hiddenCount).toBe(2);
  });

  it("finishes the day the limit falls in, so its total stays whole", () => {
    const entries = entriesOn(["2026-11-06", "2026-11-05", "2026-11-04"], 3);

    const { days, hiddenCount } = getProjectEntryDays(entries, 4);

    expect(days.map((day) => day.entries.length)).toEqual([3, 3]);
    expect(hiddenCount).toBe(3);
  });

  it("shows nothing for a project without entries", () => {
    expect(getProjectEntryDays([], 50)).toEqual({ days: [], hiddenCount: 0 });
  });
});
