import { describe, expect, it } from "vitest";
import { getTimerContributionMs, getTimerDurationsMs } from "./timer-totals";

describe("timer totals", () => {
  it("returns elapsed-only contribution when timer is linked to persisted entry", () => {
    const timer = {
      entryId: "entry-1",
      localDate: "2026-05-27",
      startedAt: 1_000,
      accumulatedDurationMs: 45 * 60_000,
    };
    const now = timer.startedAt + 5 * 60_000;
    const durations = getTimerDurationsMs(timer, now);

    const contributionMs = getTimerContributionMs({
      timer,
      timesheetEntries: [
        { _id: "entry-1", localDate: "2026-05-27", durationMs: 45 * 60_000 },
      ],
      runningDurationMs: durations.runningDurationMs,
    });

    expect(durations.runningDurationMs).toBe(50 * 60_000);
    expect(contributionMs).toBe(5 * 60_000);
  });

  it("returns full running contribution when timer has no linked persisted entry", () => {
    const timer = {
      entryId: "entry-1",
      localDate: "2026-05-27",
      startedAt: 2_000,
      accumulatedDurationMs: 30 * 60_000,
    };
    const now = timer.startedAt + 10 * 60_000;
    const durations = getTimerDurationsMs(timer, now);

    const contributionMs = getTimerContributionMs({
      timer,
      timesheetEntries: [
        { _id: "entry-2", localDate: "2026-05-27", durationMs: 15 * 60_000 },
      ],
      runningDurationMs: durations.runningDurationMs,
    });

    expect(contributionMs).toBe(40 * 60_000);
  });

  it("adds a counted time correction to a resumed entry's day", () => {
    // Resumed a 45 min entry, then corrected the count to 1 h five minutes ago.
    const timer = {
      entryId: "entry-1",
      localDate: "2026-05-27",
      startedAt: 1_000,
      accumulatedDurationMs: 60 * 60_000,
    };
    const durations = getTimerDurationsMs(timer, timer.startedAt + 5 * 60_000);

    const contributionMs = getTimerContributionMs({
      timer,
      timesheetEntries: [
        { _id: "entry-1", localDate: "2026-05-27", durationMs: 45 * 60_000 },
      ],
      runningDurationMs: durations.runningDurationMs,
    });

    expect(contributionMs).toBe(20 * 60_000);
  });
});
