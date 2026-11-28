import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalTimesheetEntry,
  TimeRoundingRule,
  TimeRoundingSettings,
} from "@/domain/local-state";
import {
  DEFAULT_TIME_ROUNDING,
  describeTimeRoundingStep,
  findTimeRoundingPreset,
  formatTimeRoundingMinimum,
  normalizeTimeRounding,
  reroundTimesheetEntries,
  roundEntryDuration,
  roundEntryTime,
  setProjectTimeRounding,
} from "@/domain/time/time-rounding";

const SECOND = 1_000;
const NO_PROJECT = { projectId: undefined };
const MINUTE = 60 * SECOND;
const rule = (
  mode: TimeRoundingRule["mode"],
  stepMinutes: number,
  minimumMinutes = 0,
): TimeRoundingRule => ({ mode, stepMinutes, minimumMinutes });
const settings = (
  value: Partial<TimeRoundingSettings>,
): TimeRoundingSettings => ({ ...DEFAULT_TIME_ROUNDING, ...value });

describe("roundEntryDuration", () => {
  it.each([
    // mode, step, exact, rounded
    ["nearest", 1, 7 * MINUTE + 29 * SECOND, 7 * MINUTE],
    ["nearest", 1, 7 * MINUTE + 30 * SECOND, 8 * MINUTE],
    ["nearest", 15, 7 * MINUTE + 29 * SECOND, 0],
    ["nearest", 15, 7 * MINUTE + 30 * SECOND, 15 * MINUTE],
    ["up", 5, 1, 5 * MINUTE],
    ["up", 5, 5 * MINUTE, 5 * MINUTE],
    ["up", 5, 5 * MINUTE + 1, 10 * MINUTE],
    ["up", 15, 52 * MINUTE, 60 * MINUTE],
    ["down", 10, 19 * MINUTE + 59 * SECOND, 10 * MINUTE],
    ["down", 15, 14 * MINUTE + 59 * SECOND, 0],
    ["off", 15, 7 * MINUTE + 3 * SECOND + 120, 7 * MINUTE + 3 * SECOND + 120],
  ] as const)(
    "%s to %i min: %i ms saves %i ms",
    (mode, step, exact, rounded) => {
      expect(roundEntryDuration(exact, rule(mode, step))).toBe(rounded);
    },
  );

  it("applies the step first, then the minimum", () => {
    expect(roundEntryDuration(3 * MINUTE, rule("up", 15, 30))).toBe(
      30 * MINUTE,
    );
    expect(roundEntryDuration(40 * MINUTE, rule("up", 15, 30))).toBe(
      45 * MINUTE,
    );
    expect(roundEntryDuration(7 * MINUTE, rule("down", 15, 15))).toBe(
      15 * MINUTE,
    );
    expect(roundEntryDuration(20 * SECOND, rule("off", 1, 5))).toBe(5 * MINUTE);
  });

  it("keeps 0 at 0, so the minimum never makes time out of nothing", () => {
    expect(roundEntryDuration(0, rule("up", 15, 60))).toBe(0);
  });
});

describe("the presets", () => {
  it("names a rule by its preset, and leaves a custom one unnamed", () => {
    expect(findTimeRoundingPreset(rule("up", 15))?.label).toBe(
      "Up to 15 minutes",
    );
    expect(findTimeRoundingPreset(rule("off", 10))?.label).toBe(
      "Exact, to the second",
    );
    expect(findTimeRoundingPreset(rule("up", 10))).toBeUndefined();
  });

  it("names a rule's step, and a minimum, as the menus show them", () => {
    expect(describeTimeRoundingStep(rule("up", 10))).toBe("Up to 10 minutes");
    expect(describeTimeRoundingStep(rule("nearest", 1))).toBe("Nearest minute");
    expect(describeTimeRoundingStep(rule("down", 1))).toBe(
      "Down to the minute",
    );
    expect(describeTimeRoundingStep(rule("off", 15))).toBe("Exact");
    expect(formatTimeRoundingMinimum(0)).toBe("None");
    expect(formatTimeRoundingMinimum(30)).toBe("30 min");
    expect(formatTimeRoundingMinimum(60)).toBe("1 h");
  });
});

describe("normalizeTimeRounding", () => {
  it("defaults to the nearest minute, with typed hours rounding too", () => {
    expect(normalizeTimeRounding(undefined)).toEqual({
      mode: "nearest",
      stepMinutes: 1,
      minimumMinutes: 0,
      roundTypedHours: true,
    });
  });

  it("keeps known values and puts back unknown ones", () => {
    expect(
      normalizeTimeRounding({
        mode: "up",
        stepMinutes: 15,
        minimumMinutes: 30,
        roundTypedHours: false,
      }),
    ).toEqual({
      mode: "up",
      stepMinutes: 15,
      minimumMinutes: 30,
      roundTypedHours: false,
    });
    expect(
      normalizeTimeRounding({
        mode: "sideways",
        stepMinutes: 7,
        minimumMinutes: -5,
        roundTypedHours: "yes",
      }),
    ).toEqual(DEFAULT_TIME_ROUNDING);
  });
});

describe("roundEntryTime", () => {
  const up15 = { userPreferences: { timeRounding: settings(rule("up", 15)) } };

  it("stores the rounded time, and the exact time when they differ", () => {
    expect(roundEntryTime(up15, 7 * MINUTE, NO_PROJECT)).toEqual({
      durationMs: 15 * MINUTE,
      exactDurationMs: 7 * MINUTE,
    });
    expect(roundEntryTime(up15, 15 * MINUTE, NO_PROJECT)).toEqual({
      durationMs: 15 * MINUTE,
    });
  });

  it("rounds a typed time only while Round typed hours too is on", () => {
    expect(
      roundEntryTime(up15, 7 * MINUTE, { typed: true, projectId: undefined }),
    ).toEqual({
      durationMs: 15 * MINUTE,
      exactDurationMs: 7 * MINUTE,
      durationTyped: true,
    });
    const typedOff = {
      userPreferences: {
        timeRounding: settings({ ...rule("up", 15), roundTypedHours: false }),
      },
    };
    expect(
      roundEntryTime(typedOff, 7 * MINUTE, {
        typed: true,
        projectId: undefined,
      }),
    ).toEqual({
      durationMs: 7 * MINUTE,
      durationTyped: true,
    });
  });

  it("rounds to the nearest minute without preferences", () => {
    expect(
      roundEntryTime({}, 7 * MINUTE + 20 * SECOND, NO_PROJECT).durationMs,
    ).toBe(7 * MINUTE);
  });
});

describe("re-rounding after a rule change", () => {
  const entry = (
    id: string,
    localDate: string,
    value: Partial<LocalTimesheetEntry>,
  ): LocalTimesheetEntry => ({
    _id: id,
    localDate,
    label: "",
    durationMs: 7 * MINUTE,
    sourceBlockIds: [],
    committedAt: 1,
    ...value,
  });
  const state = {
    userPreferences: { timeRounding: DEFAULT_TIME_ROUNDING },
    lockedWeeks: [{ weekOf: "2026-11-16", lockedAt: 1 }],
    timesheetEntries: [
      entry("open", "2026-11-24", {
        durationMs: 7 * MINUTE,
        exactDurationMs: 7 * MINUTE + 10 * SECOND,
      }),
      entry("committed", "2026-11-25", {
        commit: { at: 1, localDate: "2026-11-25", durationMs: 7 * MINUTE },
      }),
      entry("submitted", "2026-11-18", {}),
    ],
  };

  const withRule = <State extends typeof state>(
    from: State,
    value: TimeRoundingSettings,
  ) =>
    reroundTimesheetEntries({
      ...from,
      userPreferences: { timeRounding: value },
    });

  it("re-rounds the open weeks' entries from their exact time, and never a submitted week", () => {
    const next = withRule(state, settings(rule("up", 15)));

    expect(
      next.timesheetEntries.map(({ _id, durationMs, exactDurationMs }) => ({
        _id,
        durationMs,
        exactDurationMs,
      })),
    ).toEqual([
      {
        _id: "open",
        durationMs: 15 * MINUTE,
        exactDurationMs: 7 * MINUTE + 10 * SECOND,
      },
      {
        _id: "committed",
        durationMs: 15 * MINUTE,
        exactDurationMs: 7 * MINUTE,
      },
      { _id: "submitted", durationMs: 7 * MINUTE, exactDurationMs: undefined },
    ]);
    // The committed copy keeps what was committed, so the entry shows as updated.
    expect(next.timesheetEntries[1]!.commit?.durationMs).toBe(7 * MINUTE);
  });

  it("drops the exact time once the rounded time is exact again", () => {
    const rounded = withRule(state, settings(rule("up", 15)));
    const exact = withRule(rounded, settings(rule("off", 1)));

    expect(exact.timesheetEntries[0]).toMatchObject({
      durationMs: 7 * MINUTE + 10 * SECOND,
    });
    expect(exact.timesheetEntries[0]).not.toHaveProperty("exactDurationMs");
  });

  it("leaves typed entries alone while Round typed hours too is off", () => {
    const typed = {
      ...state,
      timesheetEntries: [
        entry("typed", "2026-11-24", {
          durationMs: 7 * MINUTE,
          durationTyped: true,
        }),
      ],
    };
    const next = reroundTimesheetEntries({
      ...typed,
      userPreferences: {
        timeRounding: settings({ ...rule("up", 15), roundTypedHours: false }),
      },
    });

    expect(next.timesheetEntries[0]!.durationMs).toBe(7 * MINUTE);
  });
});

describe("a project's own rule", () => {
  const atlasRule = rule("up", 15);
  const projects = [
    { _id: "atlas", timeRounding: atlasRule },
    { _id: "globex" },
  ];
  const userNearest = {
    userPreferences: { timeRounding: DEFAULT_TIME_ROUNDING },
    projects,
  };

  it("rounds an entry by its project's rule, else the user's", () => {
    expect(
      roundEntryTime(userNearest, 7 * MINUTE, { projectId: "atlas" })
        .durationMs,
    ).toBe(15 * MINUTE);
    expect(
      roundEntryTime(userNearest, 7 * MINUTE, { projectId: "globex" })
        .durationMs,
    ).toBe(7 * MINUTE);
    expect(roundEntryTime(userNearest, 7 * MINUTE, NO_PROJECT).durationMs).toBe(
      7 * MINUTE,
    );
  });

  it("re-rounds only the project's entries when its rule changes, and back with the user's", () => {
    const entry = (id: string, projectId: string): LocalTimesheetEntry => ({
      _id: id,
      localDate: "2026-11-24",
      projectId,
      label: "",
      durationMs: 7 * MINUTE,
      sourceBlockIds: [],
      committedAt: 1,
    });
    const state = {
      userPreferences: {
        ...({} as LocalAppState["userPreferences"]),
        timeRounding: DEFAULT_TIME_ROUNDING,
      },
      lockedWeeks: [],
      projects: [
        { _id: "atlas" } as LocalAppState["projects"][number],
        { _id: "globex" } as LocalAppState["projects"][number],
      ],
      timesheetEntries: [entry("a", "atlas"), entry("g", "globex")],
    };

    const rounded = setProjectTimeRounding(state, "atlas", atlasRule);
    expect(rounded.projects[0]!.timeRounding).toEqual(atlasRule);
    expect(rounded.timesheetEntries.map((item) => item.durationMs)).toEqual([
      15 * MINUTE,
      7 * MINUTE,
    ]);

    const back = setProjectTimeRounding(rounded, "atlas", undefined);
    expect(back.projects[0]).not.toHaveProperty("timeRounding");
    expect(back.timesheetEntries.map((item) => item.durationMs)).toEqual([
      7 * MINUTE,
      7 * MINUTE,
    ]);
  });
});
