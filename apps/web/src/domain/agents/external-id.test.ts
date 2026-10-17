import { describe, expect, it } from "vitest";
import {
  externalEntryId,
  timesheetChangeVersion,
} from "@/domain/agents/external-id";
import type { TimesheetChange } from "@/domain/time/timesheet-commit";

describe("externalEntryId", () => {
  it("is ajour: and 8 hex characters of the FNV-1a hash of the entry id", () => {
    expect(externalEntryId("a")).toBe("ajour:e40c292c");
    expect(externalEntryId("timesheet-123")).toMatch(/^ajour:[0-9a-f]{8}$/);
  });

  it("tells entries apart", () => {
    expect(externalEntryId("a")).not.toBe(externalEntryId("b"));
  });
});

describe("timesheetChangeVersion", () => {
  const values = {
    localDate: "2026-10-13",
    projectId: "p1",
    taskId: "t1",
    note: "Standup",
    durationMs: 3_600_000,
  };
  const committed = { at: 1, ...values };
  const updated: TimesheetChange = {
    kind: "updated",
    entryId: "e1",
    current: { ...values, durationMs: 7_200_000 },
    committed,
    changedFields: ["durationMs"],
  };

  it("is v: and 8 hex characters of the FNV-1a hash of the change", () => {
    const added: TimesheetChange = {
      kind: "added",
      entryId: "e1",
      current: values,
    };
    const tuple = ["2026-10-13", "p1", "t1", "Standup", 3_600_000];

    expect(timesheetChangeVersion(added)).toBe(
      fnv1a(JSON.stringify(["added", tuple, null])),
    );
  });

  it("is stable for an unchanged change", () => {
    expect(timesheetChangeVersion(updated)).toBe(
      timesheetChangeVersion(structuredClone(updated)),
    );
  });

  it("ignores what a commit does not compare", () => {
    expect(
      timesheetChangeVersion({
        ...updated,
        current: { ...updated.current, note: "  Standup " },
        committed: { ...committed, at: 99 },
      }),
    ).toBe(timesheetChangeVersion(updated));
  });

  it("changes when the entry is edited", () => {
    expect(
      timesheetChangeVersion({
        ...updated,
        current: { ...updated.current, note: "Review" },
      }),
    ).not.toBe(timesheetChangeVersion(updated));
  });

  it("changes when the entry is deleted", () => {
    expect(
      timesheetChangeVersion({ kind: "deleted", entryId: "e1", committed }),
    ).not.toBe(timesheetChangeVersion(updated));
  });

  it("changes when the committed copy changes", () => {
    expect(
      timesheetChangeVersion({
        ...updated,
        committed: { ...committed, durationMs: 1_800_000 },
      }),
    ).not.toBe(timesheetChangeVersion(updated));
  });
});

/** The reference hash, written out apart from the code under test. */
function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
