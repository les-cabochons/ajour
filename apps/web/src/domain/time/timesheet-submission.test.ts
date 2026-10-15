import { describe, expect, it } from "vitest";
import type { LocalProject, LocalTimesheetEntry } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  getSubmitButtonLabel,
  getSubmitSelectionState,
  getSubmitWeekStatus,
  groupSubmitLines,
  mergeSubmitComments,
  reconcileSubmitSelection,
  setSubmitSelection,
  summarizeSubmitSelection,
} from "@/domain/time/timesheet-submission";

const HOUR = 60 * 60 * 1000;

const weekDates = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];

const capacityTargets = {
  monday: 8 * HOUR,
  tuesday: 8 * HOUR,
  wednesday: 8 * HOUR,
  thursday: 8 * HOUR,
  friday: 8 * HOUR,
  saturday: 0,
  sunday: 0,
};

const projects: LocalProject[] = [
  {
    _id: "atlas",
    name: "Atlas",
    displayName: "Client Atlas",
    color: "#000",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    tasks: [
      { _id: "dev", name: "Development", status: "active", createdAt: 1 },
      { _id: "review", name: "Code review", status: "active", createdAt: 1 },
    ],
  },
];

let committedAt = 0;
function entry(
  id: string,
  values: Partial<LocalTimesheetEntry> & { localDate: string },
): LocalTimesheetEntry {
  committedAt += 1;
  return {
    _id: id,
    label: "",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt,
    projectId: "atlas",
    taskId: "dev",
    ...values,
  };
}

describe("submit lines", () => {
  const entries = [
    entry("mon-dev-1", { localDate: "2026-10-05", note: "Login form" }),
    entry("mon-review", { localDate: "2026-10-05", taskId: "review" }),
    entry("mon-dev-2", {
      localDate: "2026-10-05",
      durationMs: 2 * HOUR,
      note: "API ",
    }),
    entry("tue-dev", { localDate: "2026-10-06", note: "Login form" }),
    entry("next-week", { localDate: "2026-10-12" }),
  ];

  it("adds up hours and merges comments per task and day by default", () => {
    const sections = groupSubmitLines({
      entries,
      groupBy: "day-task",
      projects,
      weekDates,
    });

    expect(sections.map((section) => section.localDate)).toEqual([
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(sections[0]!.lines).toEqual([
      {
        key: "2026-10-05::atlas::dev",
        entryIds: ["mon-dev-1", "mon-dev-2"],
        unsubmittedEntryIds: ["mon-dev-1", "mon-dev-2"],
        projectId: "atlas",
        projectName: "Client Atlas",
        taskName: "Development",
        durationMs: 3 * HOUR,
        comments: "Login form | API",
      },
      expect.objectContaining({
        entryIds: ["mon-review"],
        taskName: "Code review",
        comments: "",
      }),
    ]);
  });

  it("lists one line per entry when grouping by day", () => {
    const sections = groupSubmitLines({
      entries,
      groupBy: "day",
      projects,
      weekDates,
    });

    expect(
      sections.map((section) => section.lines.map((line) => line.entryIds)),
    ).toEqual([[["mon-dev-1"], ["mon-review"], ["mon-dev-2"]], [["tue-dev"]]]);
  });

  it("merges the whole week per task when grouping by task", () => {
    const sections = groupSubmitLines({
      entries,
      groupBy: "task",
      projects,
      weekDates,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.localDate).toBeUndefined();
    expect(sections[0]!.lines).toEqual([
      expect.objectContaining({ taskName: "Code review", durationMs: HOUR }),
      expect.objectContaining({
        taskName: "Development",
        durationMs: 4 * HOUR,
        // The repeated "Login form" note appears once.
        comments: "Login form | API",
        entryIds: ["mon-dev-1", "mon-dev-2", "tue-dev"],
      }),
    ]);
  });

  it("keeps submitted entries in the totals of lines that still need submitting", () => {
    const sections = groupSubmitLines({
      entries: [
        entry("changed", { localDate: "2026-10-05", note: "Edited" }),
        entry("kept", {
          localDate: "2026-10-05",
          note: "Kept",
          submittedAt: 10,
        }),
        entry("done", {
          localDate: "2026-10-06",
          taskId: "review",
          submittedAt: 10,
        }),
      ],
      groupBy: "day-task",
      onlyUnsubmitted: true,
      projects,
      weekDates,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.lines).toEqual([
      expect.objectContaining({
        entryIds: ["changed", "kept"],
        unsubmittedEntryIds: ["changed"],
        durationMs: 2 * HOUR,
        comments: "Edited | Kept",
      }),
    ]);
  });

  it("leaves project and task empty instead of inventing names", () => {
    const sections = groupSubmitLines({
      entries: [
        entry("bare", {
          localDate: "2026-10-05",
          projectId: undefined,
          taskId: undefined,
        }),
      ],
      groupBy: "day",
      projects,
      weekDates,
    });

    expect(sections[0]!.lines[0]).toMatchObject({
      projectName: undefined,
      taskName: undefined,
    });
  });

  it("joins trimmed, non-blank comments with a pipe", () => {
    expect(mergeSubmitComments([" a ", undefined, "", "b", "a"])).toBe("a | b");
  });
});

describe("submit selection", () => {
  it("reports whether a line is fully, partly or not selected", () => {
    const selected = new Set(["a", "b"]);

    expect(getSubmitSelectionState(selected, ["a", "b"])).toBe("all");
    expect(getSubmitSelectionState(selected, ["a", "c"])).toBe("some");
    expect(getSubmitSelectionState(selected, ["c"])).toBe("none");
  });

  it("adds or drops every entry behind a line or day", () => {
    const selected = new Set(["a", "b", "c"]);

    expect([...setSubmitSelection(selected, ["b", "c"], false)]).toEqual(["a"]);
    expect([...setSubmitSelection(new Set(["a"]), ["c"], true)]).toEqual([
      "a",
      "c",
    ]);
  });

  it("selects entries that join the list and drops entries that leave it", () => {
    const next = reconcileSubmitSelection(
      new Set(["a"]),
      new Set(["a", "b", "c"]),
      ["a", "b", "d"],
    );

    // "b" stays unselected, "c" left the list, "d" is new.
    expect([...next]).toEqual(["a", "d"]);
  });

  it("names the number of entries, or changes when only changes are selected", () => {
    const changed = {
      kind: "changed" as const,
      submittedAt: 1,
      changedEntryIds: ["a", "b"],
    };

    expect(
      getSubmitButtonLabel({ kind: "not-submitted" }, new Set(["a"])),
    ).toBe("Mark 1 entry as submitted");
    expect(
      getSubmitButtonLabel({ kind: "not-submitted" }, new Set(["a", "b"])),
    ).toBe("Mark 2 entries as submitted");
    expect(getSubmitButtonLabel(changed, new Set(["a", "b"]))).toBe(
      "Mark changes as submitted",
    );
    expect(getSubmitButtonLabel(changed, new Set(["a", "z"]))).toBe(
      "Mark 2 entries as submitted",
    );
  });
});

describe("submit summary", () => {
  const weekEntries = [
    entry("mon", { localDate: "2026-10-05", durationMs: 8 * HOUR }),
    entry("tue", { localDate: "2026-10-06", durationMs: 8 * HOUR }),
    entry("wed", {
      localDate: "2026-10-07",
      durationMs: 6 * HOUR,
      taskId: undefined,
    }),
    entry("thu-submitted", {
      localDate: "2026-10-08",
      durationMs: 8 * HOUR,
      submittedAt: 10,
    }),
  ];

  it("follows the selection and counts entries already submitted", () => {
    const summary = summarizeSubmitSelection({
      capacityTargets,
      selectedIds: new Set(["mon", "wed"]),
      weekDates,
      weekEntries,
    });

    expect(summary).toMatchObject({
      totalMs: 22 * HOUR,
      targetMs: 40 * HOUR,
      isUnderTarget: true,
    });
    expect(summary.warnings).toEqual([
      {
        kind: "day-under-target",
        localDate: "2026-10-06",
        loggedMs: 0,
        targetMs: 8 * HOUR,
      },
      {
        kind: "day-under-target",
        localDate: "2026-10-07",
        loggedMs: 6 * HOUR,
        targetMs: 8 * HOUR,
      },
      {
        kind: "day-under-target",
        localDate: "2026-10-09",
        loggedMs: 0,
        targetMs: 8 * HOUR,
      },
      { kind: "missing-task", entryCount: 1 },
    ]);
  });

  it("is not under target once the target is met", () => {
    const summary = summarizeSubmitSelection({
      capacityTargets,
      selectedIds: new Set(["mon", "tue", "wed", "fri"]),
      weekDates,
      weekEntries: [
        ...weekEntries,
        entry("fri", { localDate: "2026-10-09", durationMs: 10 * HOUR }),
      ],
    });

    expect(summary.isUnderTarget).toBe(false);
  });
});

describe("submit week status", () => {
  it("is not submitted when no entry was ever submitted", () => {
    expect(
      getSubmitWeekStatus([entry("a", { localDate: "2026-10-05" })]),
    ).toEqual({ kind: "not-submitted" });
  });

  it("is submitted when every entry is submitted", () => {
    expect(
      getSubmitWeekStatus([
        entry("a", { localDate: "2026-10-05", submittedAt: 10 }),
        entry("b", { localDate: "2026-10-06", submittedAt: 20 }),
      ]),
    ).toEqual({
      kind: "submitted",
      submittedAt: 20,
      entryCount: 2,
      totalMs: 2 * HOUR,
    });
  });

  it("is partly submitted when the rest was never submitted", () => {
    expect(
      getSubmitWeekStatus([
        entry("a", { localDate: "2026-10-05", submittedAt: 10 }),
        entry("b", { localDate: "2026-10-06" }),
      ]),
    ).toMatchObject({ kind: "partly-submitted", entryCount: 1 });
  });

  it("lists entries edited since they were submitted", () => {
    expect(
      getSubmitWeekStatus([
        entry("a", { localDate: "2026-10-05", submittedAt: 10 }),
        entry("b", { localDate: "2026-10-06", previousSubmittedAt: 10 }),
        entry("c", { localDate: "2026-10-06" }),
      ]),
    ).toEqual({ kind: "changed", submittedAt: 10, changedEntryIds: ["b"] });
  });
});
