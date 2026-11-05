import { describe, expect, it } from "vitest";
import { sumSavedDurationsByDate } from "@/domain/time/day-totals";

const entry = (localDate: string, durationMs: number) => ({
  localDate,
  durationMs,
});

describe("saved time per day", () => {
  it("adds each day's saved entries and gives an empty day zero", () => {
    const totals = sumSavedDurationsByDate(
      [
        entry("2026-11-02", 1_800_000),
        entry("2026-11-02", 600_000),
        entry("2026-11-04", 900_000),
      ],
      ["2026-11-02", "2026-11-03", "2026-11-04"],
    );
    expect([...totals]).toEqual([
      ["2026-11-02", 2_400_000],
      ["2026-11-03", 0],
      ["2026-11-04", 900_000],
    ]);
  });

  it("leaves out entries on days that were not asked for", () => {
    const totals = sumSavedDurationsByDate(
      [entry("2026-11-02", 60_000), entry("2026-11-09", 60_000)],
      ["2026-11-02"],
    );
    expect(totals.get("2026-11-02")).toBe(60_000);
    expect(totals.has("2026-11-09")).toBe(false);
  });
});
