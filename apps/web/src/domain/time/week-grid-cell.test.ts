import { describe, expect, it } from "vitest";
import type { LocalTimesheetEntry } from "@/domain/local-state";
import { commitWeekGridCellText } from "@/domain/time/week-grid-cell";

const HOUR = 60 * 60 * 1000;
const row = { projectId: "project-1", taskId: "task-1" };
const localDate = "2026-10-06";

const entry: LocalTimesheetEntry = {
  _id: "entry-1",
  localDate,
  projectId: "project-1",
  taskId: "task-1",
  label: "Build",
  note: "Login form",
  // 1:00 plus a few seconds, as a stopped entry saves it.
  durationMs: HOUR + 4_321,
  sourceBlockIds: [],
  committedAt: 1,
};

describe("typing hours in a Week Grid cell", () => {
  it("creates an entry with the row's project and task in an empty cell", () => {
    expect(commitWeekGridCellText({ text: "1:30", row, localDate })).toEqual({
      kind: "create",
      values: {
        localDate,
        projectId: "project-1",
        taskId: "task-1",
        durationMs: 1.5 * HOUR,
      },
    });
  });

  it("writes nothing when an empty cell stays empty or gets zero", () => {
    expect(commitWeekGridCellText({ text: " ", row, localDate })).toEqual({
      kind: "unchanged",
    });
    expect(commitWeekGridCellText({ text: "0", row, localDate })).toEqual({
      kind: "unchanged",
    });
  });

  it("updates the cell's entry and keeps its project, task and note", () => {
    expect(
      commitWeekGridCellText({ text: "2.5", entry, row, localDate }),
    ).toEqual({
      kind: "update",
      entryId: "entry-1",
      values: {
        projectId: "project-1",
        taskId: "task-1",
        note: "Login form",
        durationMs: 2.5 * HOUR,
      },
    });
  });

  it("keeps the exact saved duration when the shown hours are left as they were", () => {
    expect(
      commitWeekGridCellText({ text: "01:00", entry, row, localDate }),
    ).toEqual({ kind: "unchanged" });
  });

  it("deletes the cell's entry when its hours are cleared or set to zero", () => {
    expect(commitWeekGridCellText({ text: "", entry, row, localDate })).toEqual(
      { kind: "delete", entryId: "entry-1" },
    );
    expect(
      commitWeekGridCellText({ text: "0:00", entry, row, localDate }),
    ).toEqual({ kind: "delete", entryId: "entry-1" });
  });

  it("rejects hours it cannot read", () => {
    expect(
      commitWeekGridCellText({ text: "1:75", entry, row, localDate }),
    ).toMatchObject({ kind: "invalid" });
    expect(
      commitWeekGridCellText({ text: "abc", row, localDate }),
    ).toMatchObject({ kind: "invalid" });
  });
});
