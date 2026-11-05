import { describe, expect, it } from "vitest";
import {
  applyLoggedTimeToWorkItems,
  applyLoggedTimeToEstimateValues,
  createImportedEstimateSyncState,
  getWorkItemEstimateBadgeLabel,
  getWorkItemEstimateSummary,
  getCompletedEstimateShare,
} from "./work-item-estimates";

describe("applyLoggedTimeToEstimateValues", () => {
  it("increments completed and decrements remaining for mapped work", () => {
    expect(
      applyLoggedTimeToEstimateValues(
        {
          remainingEstimateHours: 2,
          completedEstimateHours: 0,
        },
        {
          projectId: "project-1",
          taskId: "task-1",
          durationMsDelta: 90 * 60 * 1000,
        },
      ),
    ).toEqual({
      remainingEstimateHours: 0.5,
      completedEstimateHours: 1.5,
    });
  });

  it("clamps remaining at zero when logged time overruns the estimate", () => {
    expect(
      applyLoggedTimeToEstimateValues(
        {
          remainingEstimateHours: 1,
          completedEstimateHours: 0.25,
        },
        {
          projectId: "project-1",
          taskId: "task-1",
          durationMsDelta: 2 * 60 * 60 * 1000,
        },
      ),
    ).toEqual({
      remainingEstimateHours: 0,
      remainingEstimateOverrunHours: 1,
      completedEstimateHours: 2.25,
    });
  });

  it("updates estimates even when the work item is not mapped", () => {
    expect(
      applyLoggedTimeToEstimateValues(
        {
          remainingEstimateHours: 2,
          completedEstimateHours: 1,
        },
        {
          durationMsDelta: 60 * 60 * 1000,
        },
      ),
    ).toEqual({
      remainingEstimateHours: 1,
      completedEstimateHours: 2,
    });
  });

  it("preserves original estimates and reverses removed logged time", () => {
    expect(
      applyLoggedTimeToEstimateValues(
        {
          originalEstimateHours: 8,
          remainingEstimateHours: 3,
          completedEstimateHours: 2,
        },
        {
          durationMsDelta: -60 * 60 * 1000,
        },
      ),
    ).toEqual({
      originalEstimateHours: 8,
      remainingEstimateHours: 4,
      completedEstimateHours: 1,
    });
  });

  it("restores remaining time after reversing an overrun", () => {
    const logged = applyLoggedTimeToEstimateValues(
      {
        remainingEstimateHours: 1,
        completedEstimateHours: 0,
      },
      { durationMsDelta: 3 * 60 * 60 * 1000 },
    );
    const reversed = applyLoggedTimeToEstimateValues(logged, {
      durationMsDelta: -3 * 60 * 60 * 1000,
    });

    expect(logged).toMatchObject({
      remainingEstimateHours: 0,
      remainingEstimateOverrunHours: 2,
      completedEstimateHours: 3,
    });
    expect(reversed).toEqual({
      remainingEstimateHours: 1,
      remainingEstimateOverrunHours: undefined,
      completedEstimateHours: 0,
    });
  });
});

describe("applyLoggedTimeToWorkItems", () => {
  it("updates a directly linked work item and supports reversing logged time", () => {
    const workItems = [
      {
        _id: "work-item-1",
        title: "Feature work",
        status: "active" as const,
        source: "manual" as const,
        remainingEstimateHours: 2,
        completedEstimateHours: 1,
        createdAt: 1,
      },
    ];

    const logged = applyLoggedTimeToWorkItems(workItems, {
      workItemId: "work-item-1",
      durationMsDelta: 60 * 60 * 1000,
    });
    const reversed = applyLoggedTimeToWorkItems(logged, {
      workItemId: "work-item-1",
      durationMsDelta: -60 * 60 * 1000,
    });

    expect(logged[0]).toMatchObject({
      remainingEstimateHours: 1,
      completedEstimateHours: 2,
    });
    expect(reversed[0]).toMatchObject({
      remainingEstimateHours: 2,
      completedEstimateHours: 1,
    });
  });
});

describe("createImportedEstimateSyncState", () => {
  it("creates baseline and remote values for imported estimates", () => {
    expect(
      createImportedEstimateSyncState({
        originalEstimateHours: 8,
        remainingEstimateHours: 3,
      }),
    ).toEqual({
      originalEstimateHours: {
        baselineValue: 8,
        remoteValue: 8,
      },
      remainingEstimateHours: {
        baselineValue: 3,
        remoteValue: 3,
      },
      completedEstimateHours: undefined,
    });
  });
});

describe("getWorkItemEstimateSummary", () => {
  it("returns a labeled triplet when any estimate value is non-zero", () => {
    expect(
      getWorkItemEstimateSummary({
        originalEstimateHours: 8,
        remainingEstimateHours: 1,
        completedEstimateHours: 1,
      }),
    ).toBe("Original 8:00 · Remaining 1:00 · Completed 1:00");
  });

  it("returns null when all estimate values are empty or zero", () => {
    expect(
      getWorkItemEstimateSummary({
        originalEstimateHours: 0,
        remainingEstimateHours: undefined,
        completedEstimateHours: 0,
      }),
    ).toBeNull();
  });
});

describe("getWorkItemEstimateBadgeLabel", () => {
  it("shows remaining and completed when remaining time exists", () => {
    expect(
      getWorkItemEstimateBadgeLabel({
        remainingEstimateHours: 1,
        completedEstimateHours: 1,
      }),
    ).toBe("1:00 | 1:00");
  });

  it("shows remaining and 0:00 when remaining exists but completed is missing", () => {
    expect(
      getWorkItemEstimateBadgeLabel({
        remainingEstimateHours: 1,
        completedEstimateHours: undefined,
      }),
    ).toBe("1:00 | 0:00");
  });

  it("shows completed only when no remaining time exists", () => {
    expect(
      getWorkItemEstimateBadgeLabel({
        remainingEstimateHours: 0,
        completedEstimateHours: 1.5,
      }),
    ).toBe("1:30");
  });

  it("shows 0:00 when completed is missing and no remaining time exists", () => {
    expect(
      getWorkItemEstimateBadgeLabel({
        originalEstimateHours: 2,
        remainingEstimateHours: 0,
        completedEstimateHours: undefined,
      }),
    ).toBe("0:00");
  });

  it("shows 0:00 when every estimate is zero", () => {
    expect(
      getWorkItemEstimateBadgeLabel({
        originalEstimateHours: 0,
        remainingEstimateHours: 0,
        completedEstimateHours: 0,
      }),
    ).toBe("0:00");
  });
});

describe("getCompletedEstimateShare", () => {
  it("is the completed estimate over the original", () => {
    expect(
      getCompletedEstimateShare({
        originalEstimateHours: 8,
        completedEstimateHours: 3,
      }),
    ).toBe(0.375);
  });

  it("stays within the bar when completed outgrows the original", () => {
    expect(
      getCompletedEstimateShare({
        originalEstimateHours: 2,
        completedEstimateHours: 3,
      }),
    ).toBe(1);
  });

  it("is empty without an original or a completed estimate", () => {
    expect(getCompletedEstimateShare({ completedEstimateHours: 3 })).toBe(0);
    expect(getCompletedEstimateShare({ originalEstimateHours: 3 })).toBe(0);
  });
});
