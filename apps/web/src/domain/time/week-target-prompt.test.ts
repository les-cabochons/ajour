import { describe, expect, it } from "vitest";
import type {
  LocalTimer,
  LocalTimesheetEntry,
  WeeklyCapacityTargets,
} from "@/domain/local-state";
import {
  findWeekReachingTarget,
  listTouchedWeeks,
  markCommitPrompted,
  normalizeCommitPromptedWeeks,
  type WeekTargetState,
} from "@/domain/time/week-target-prompt";

const hour = 60 * 60 * 1000;

/** 37:30 over Monday to Friday, 7:30 a day. */
const targets: WeeklyCapacityTargets = {
  monday: 7.5 * hour,
  tuesday: 7.5 * hour,
  wednesday: 7.5 * hour,
  thursday: 7.5 * hour,
  friday: 7.5 * hour,
  saturday: 0,
  sunday: 0,
};

const noTargets: WeeklyCapacityTargets = {
  monday: 0,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 0,
  saturday: 0,
  sunday: 0,
};

function entry(
  _id: string,
  localDate: string,
  durationMs: number,
): LocalTimesheetEntry {
  return {
    _id,
    localDate,
    label: "",
    durationMs,
    sourceBlockIds: [],
    committedAt: 1,
  };
}

/** The week of Oct 12 to 18, 2026, with 30:00 saved Monday to Thursday. */
const fourDays = [
  entry("mon", "2026-10-12", 7.5 * hour),
  entry("tue", "2026-10-13", 7.5 * hour),
  entry("wed", "2026-10-14", 7.5 * hour),
  entry("thu", "2026-10-15", 7.5 * hour),
];

function state(
  timesheetEntries: LocalTimesheetEntry[],
  overrides: Partial<WeekTargetState> & { timers?: LocalTimer[] } = {},
): WeekTargetState {
  return {
    timesheetEntries,
    commitPromptedWeeks: [],
    userPreferences: { weeklyCapacityTargets: targets },
    ...overrides,
  };
}

function reach(before: WeekTargetState, after: WeekTargetState) {
  return findWeekReachingTarget({
    before,
    after,
    touchedWeeks: listTouchedWeeks(before, after),
  });
}

describe("findWeekReachingTarget", () => {
  it("returns the week whose saved total goes from below its target to the target", () => {
    const before = state(fourDays);
    const after = state([...fourDays, entry("fri", "2026-10-16", 7.5 * hour)]);

    expect(reach(before, after)).toEqual({
      weekOf: "2026-10-12",
      weekDates: [
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-18",
      ],
      totalMs: 37.5 * hour,
      targetMs: 37.5 * hour,
    });
  });

  it("counts an edit that pushes the total past the target", () => {
    const friday = entry("fri", "2026-10-16", 6 * hour);
    const before = state([...fourDays, friday]);
    const after = state([...fourDays, { ...friday, durationMs: 9 * hour }]);

    expect(reach(before, after)?.totalMs).toBe(39 * hour);
  });

  it("ignores a week that was already at its target before the write", () => {
    const full = [...fourDays, entry("fri", "2026-10-16", 7.5 * hour)];
    const before = state(full);
    const after = state([...full, entry("sat", "2026-10-17", hour)]);

    expect(reach(before, after)).toBeNull();
  });

  it("ignores a week with a target of 0", () => {
    const prefs = { weeklyCapacityTargets: noTargets };
    const before = state([], { userPreferences: prefs });
    const after = state([entry("mon", "2026-10-12", hour)], {
      userPreferences: prefs,
    });

    expect(reach(before, after)).toBeNull();
  });

  it("ignores a week it already asked about", () => {
    const before = state(fourDays, { commitPromptedWeeks: ["2026-10-12"] });
    const after = state([...fourDays, entry("fri", "2026-10-16", 7.5 * hour)], {
      commitPromptedWeeks: ["2026-10-12"],
    });

    expect(reach(before, after)).toBeNull();
  });

  it("ignores live running time, which is not saved", () => {
    const running: LocalTimer = {
      _id: "timer",
      startedAt: 1,
      localDate: "2026-10-16",
      accumulatedDurationMs: 10 * hour,
    };
    const before = state(fourDays);
    const after = state(fourDays, { timers: [running] });

    expect(reach(before, after)).toBeNull();
  });

  it("counts a stopped entry, which is saved", () => {
    const before = state(fourDays);
    const after = state([...fourDays, entry("fri", "2026-10-16", 8 * hour)]);

    expect(reach(before, after)?.weekOf).toBe("2026-10-12");
  });

  it("ignores a week the write did not touch, such as after a target change", () => {
    const full = [...fourDays, entry("fri", "2026-10-16", 6 * hour)];
    const before = state(full);
    const after = state(full, {
      userPreferences: {
        weeklyCapacityTargets: { ...targets, friday: 6 * hour },
      },
    });

    expect(reach(before, after)).toBeNull();
  });

  it("returns the earliest week when a write fills two", () => {
    const lastWeek = [
      entry("prev-mon", "2026-10-05", 30 * hour),
      entry("prev-tue", "2026-10-06", 7.5 * hour),
    ];
    const before = state([lastWeek[0]!, ...fourDays]);
    const after = state([
      ...lastWeek,
      ...fourDays,
      entry("fri", "2026-10-16", 7.5 * hour),
    ]);

    expect(reach(before, after)?.weekOf).toBe("2026-10-05");
  });
});

describe("listTouchedWeeks", () => {
  it("lists both weeks of an entry moved across weeks, Mondays in order", () => {
    const moved = entry("e", "2026-10-16", hour);
    const before = state([moved]);
    const after = state([{ ...moved, localDate: "2026-10-05" }]);

    expect(listTouchedWeeks(before, after)).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
  });

  it("lists the week of a deleted entry", () => {
    expect(
      listTouchedWeeks(state([entry("e", "2026-10-18", hour)]), state([])),
    ).toEqual(["2026-10-12"]);
  });

  it("ignores entries whose day and hours did not change", () => {
    const saved = entry("e", "2026-10-14", hour);
    expect(
      listTouchedWeeks(
        state([saved]),
        state([{ ...saved, note: "A new note" }]),
      ),
    ).toEqual([]);
  });
});

describe("markCommitPrompted", () => {
  it("adds the week once", () => {
    const marked = markCommitPrompted(state([]), "2026-10-12");
    expect(marked.commitPromptedWeeks).toEqual(["2026-10-12"]);
    expect(markCommitPrompted(marked, "2026-10-12")).toBe(marked);
  });
});

describe("normalizeCommitPromptedWeeks", () => {
  it("keeps strings once and drops anything else", () => {
    expect(
      normalizeCommitPromptedWeeks([
        "2026-10-12",
        42,
        null,
        "2026-10-05",
        "2026-10-12",
      ]),
    ).toEqual(["2026-10-12", "2026-10-05"]);
  });

  it("reads a missing or malformed list as empty", () => {
    expect(normalizeCommitPromptedWeeks(undefined)).toEqual([]);
    expect(normalizeCommitPromptedWeeks("2026-10-12")).toEqual([]);
  });
});
