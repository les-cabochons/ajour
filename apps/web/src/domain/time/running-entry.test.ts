import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalTimer,
  LocalWorkItem,
} from "@/domain/local-state";
import {
  formatElapsedDuration,
  formatRemainingEstimate,
  summarizeRunningEntry,
} from "@/domain/time/running-entry";

const HOUR_MS = 3_600_000;

const project: LocalProject = {
  _id: "project-1",
  name: "Mercury",
  code: "MER",
  color: "#123456",
  icon: { kind: "preset", name: "dot" },
  status: "active",
  tasks: [{ _id: "task-1", name: "Build", status: "active", createdAt: 1 }],
};

const workItem = {
  _id: "item-1",
  title: "Fix export rounding",
  status: "active",
  source: "manual",
  remainingEstimateHours: 2,
} as LocalWorkItem;

function timer(patch: Partial<LocalTimer> = {}): LocalTimer {
  return {
    _id: "timer-1",
    startedAt: 0,
    localDate: "2026-10-13",
    accumulatedDurationMs: 0,
    ...patch,
  };
}

describe("summarizeRunningEntry", () => {
  it("uses the backlog item's title and measures its remaining estimate", () => {
    const summary = summarizeRunningEntry(
      timer({ workItemId: "item-1", projectId: "project-1", taskId: "task-1" }),
      {
        projects: [project],
        workItems: [workItem],
        unsavedDurationMs: HOUR_MS / 2,
      },
    );
    expect(summary.title).toBe("Fix export rounding");
    expect(summary.meta).toBe("MER · Build");
    expect(summary.remainingMs).toBe(1.5 * HOUR_MS);
    expect(summary.estimateUsed).toBe(0.25);
  });

  it("counts only the unsaved time of a continued entry", () => {
    // 3h remaining, 2h logged and saved: 1h remains. Continuing that entry
    // runs from 2h, but only the 30 minutes since are unsaved.
    const summary = summarizeRunningEntry(timer({ workItemId: "item-1" }), {
      projects: [],
      workItems: [{ ...workItem, remainingEstimateHours: 1 }],
      unsavedDurationMs: HOUR_MS / 2,
    });
    expect(summary.remainingMs).toBe(HOUR_MS / 2);
    expect(summary.estimateUsed).toBe(0.5);
  });

  it("keeps the bar empty when a continued entry is corrected below its saved time", () => {
    const summary = summarizeRunningEntry(timer({ workItemId: "item-1" }), {
      projects: [],
      workItems: [{ ...workItem, remainingEstimateHours: 1 }],
      unsavedDurationMs: -HOUR_MS / 4,
    });
    expect(summary.estimateUsed).toBe(0);
    expect(summary.remainingMs).toBe(1.25 * HOUR_MS);
  });

  it("starts from an overrun the item already logged", () => {
    const summary = summarizeRunningEntry(timer({ workItemId: "item-1" }), {
      projects: [],
      workItems: [
        {
          ...workItem,
          remainingEstimateHours: 0,
          remainingEstimateOverrunHours: 1,
        },
      ],
      unsavedDurationMs: HOUR_MS / 2,
    });
    expect(summary.remainingMs).toBe(-1.5 * HOUR_MS);
    expect(summary.estimateUsed).toBe(1);
  });

  it("goes past the estimate without capping the remaining time", () => {
    const summary = summarizeRunningEntry(timer({ workItemId: "item-1" }), {
      projects: [],
      workItems: [workItem],
      unsavedDurationMs: 3 * HOUR_MS,
    });
    expect(summary.remainingMs).toBe(-HOUR_MS);
    expect(summary.estimateUsed).toBe(1);
  });

  it("falls back to the note, the task, the project, then a placeholder", () => {
    const context = {
      projects: [project],
      workItems: [],
      unsavedDurationMs: 0,
    };
    expect(
      summarizeRunningEntry(
        timer({ note: " Standup ", taskId: "task-1", projectId: "project-1" }),
        context,
      ).title,
    ).toBe("Standup");
    expect(
      summarizeRunningEntry(
        timer({ taskId: "task-1", projectId: "project-1" }),
        context,
      ).title,
    ).toBe("Build");
    expect(
      summarizeRunningEntry(timer({ projectId: "project-1" }), context).title,
    ).toBe("Mercury");
    const empty = summarizeRunningEntry(timer(), context);
    expect(empty.title).toBe("Untitled entry");
    expect(empty.meta).toBe("");
    expect(empty.remainingMs).toBeUndefined();
  });
});

describe("running entry formats", () => {
  it("formats the remaining estimate in hours", () => {
    expect(formatRemainingEstimate(1.1 * HOUR_MS)).toBe("1.1h left");
    expect(formatRemainingEstimate(2 * HOUR_MS)).toBe("2h left");
    expect(formatRemainingEstimate(-0.4 * HOUR_MS)).toBe("0.4h over");
  });

  it("formats elapsed time with seconds", () => {
    expect(formatElapsedDuration(0)).toBe("0:00:00");
    expect(formatElapsedDuration(HOUR_MS + 24 * 60_000 + 7_000)).toBe(
      "1:24:07",
    );
  });
});
