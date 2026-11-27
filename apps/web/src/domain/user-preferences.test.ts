import { describe, expect, it } from "vitest";
import type { LocalAppState } from "@/domain/local-state";
import { DEFAULT_TIME_ROUNDING } from "@/domain/time/time-rounding";
import { updateUserPreferences } from "@/domain/user-preferences";

const MINUTE = 60_000;

function stateWithEntry(): LocalAppState {
  return {
    userPreferences: { timeRounding: DEFAULT_TIME_ROUNDING },
    lockedWeeks: [],
    projects: [],
    timesheetEntries: [
      {
        _id: "entry-1",
        localDate: "2026-11-24",
        label: "",
        durationMs: 7 * MINUTE,
        sourceBlockIds: [],
        committedAt: 1,
      },
    ],
  } as unknown as LocalAppState;
}

describe("updateUserPreferences", () => {
  it("leaves the state as it is when nothing changes", () => {
    const state = stateWithEntry();
    expect(
      updateUserPreferences(state, { timeRounding: DEFAULT_TIME_ROUNDING }),
    ).toBe(state);
  });

  it("re-rounds the entries when the rounding changes", () => {
    const next = updateUserPreferences(stateWithEntry(), {
      timeRounding: { ...DEFAULT_TIME_ROUNDING, mode: "up", stepMinutes: 15 },
    });
    expect(next.timesheetEntries[0]).toMatchObject({
      durationMs: 15 * MINUTE,
      exactDurationMs: 7 * MINUTE,
    });
  });

  it("leaves the entries alone when another preference changes", () => {
    const state = stateWithEntry();
    const next = updateUserPreferences(state, { hideNonWorkingDays: true });
    expect(next.userPreferences.hideNonWorkingDays).toBe(true);
    expect(next.timesheetEntries).toBe(state.timesheetEntries);
  });
});
