import { describe, expect, it } from "vitest";
import {
  formatProjectTaskConsumedBadge,
  getProjectTaskConsumedTone,
  durationHoursValueToMs,
  normalizeProjectTaskBudgetMs,
} from "@/domain/projects/task-budget";

describe("formatProjectTaskConsumedBadge", () => {
  it("shows budget and tracked plus adjustment when a budget exists", () => {
    expect(
      formatProjectTaskConsumedBadge({
        budgetMs: 2 * 60 * 60 * 1000,
        trackedMs: 60 * 60 * 1000,
        adjustmentMs: 30 * 60 * 1000,
      }),
    ).toBe("2:00 | 1:30");
  });

  it("shows only tracked plus adjustment when there is no budget", () => {
    expect(
      formatProjectTaskConsumedBadge({
        trackedMs: 60 * 60 * 1000,
        adjustmentMs: -30 * 60 * 1000,
      }),
    ).toBe("0:30");
  });
});

describe("getProjectTaskConsumedTone", () => {
  it("returns success below eighty percent of budget", () => {
    expect(
      getProjectTaskConsumedTone({
        budgetMs: 5 * 60 * 60 * 1000,
        trackedMs: 3 * 60 * 60 * 1000,
        adjustmentMs: 30 * 60 * 1000,
      }),
    ).toBe("success");
  });

  it("returns warning from eighty to one hundred percent", () => {
    expect(
      getProjectTaskConsumedTone({
        budgetMs: 5 * 60 * 60 * 1000,
        trackedMs: 4 * 60 * 60 * 1000,
      }),
    ).toBe("warning");
  });

  it("returns danger up to twenty percent over budget", () => {
    expect(
      getProjectTaskConsumedTone({
        budgetMs: 5 * 60 * 60 * 1000,
        trackedMs: 5 * 60 * 60 * 1000,
        adjustmentMs: 60 * 60 * 1000,
      }),
    ).toBe("danger");
  });

  it("returns danger-strong above twenty percent over budget", () => {
    expect(
      getProjectTaskConsumedTone({
        budgetMs: 5 * 60 * 60 * 1000,
        trackedMs: 5 * 60 * 60 * 1000,
        adjustmentMs: (60 * 60 * 60 * 1000) / 50,
      }),
    ).toBe("danger-strong");
  });

  it("returns default when no budget exists", () => {
    expect(
      getProjectTaskConsumedTone({
        trackedMs: 60 * 60 * 1000,
      }),
    ).toBe("default");
  });
});

describe("task budget normalization", () => {
  it("drops values that round to zero or overflow milliseconds", () => {
    expect(normalizeProjectTaskBudgetMs(0.4)).toBeUndefined();
    expect(durationHoursValueToMs(1e308)).toBeUndefined();
  });
});
