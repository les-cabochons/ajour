import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  getVisibleWeekDates,
  projectWeeklyTime,
  selectWeeklyGridCell,
} from "@/domain/time/weekly-time";

const capacityTargets = {
  monday: 8,
  tuesday: 8,
  wednesday: 8,
  thursday: 8,
  friday: 8,
  saturday: 0,
  sunday: 0,
};

const weekDates = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

const projects = [
  {
    _id: "project-1",
    name: "Ajour",
    color: "#000",
    icon: DEFAULT_PROJECT_ICON,
    status: "active" as const,
    tasks: [
      {
        _id: "task-1",
        name: "Build",
        status: "active" as const,
        createdAt: 1,
      },
    ],
  },
];

describe("weekly time projection", () => {
  it("hides zero-capacity weekdays and keeps working weekends aligned with their cells", () => {
    const targets = { ...capacityTargets, wednesday: 0, saturday: 4 };
    const entries = weekDates.map((localDate, index) => ({
      _id: `entry-${index}`,
      localDate,
      projectId: "project-1",
      taskId: "task-1",
      label: "Build",
      durationMs: index + 1,
      sourceBlockIds: [],
      committedAt: 1,
    }));
    const input = {
      capacityTargets: targets,
      entries,
      projects,
      weekDates,
      runningTime: {
        localDate: weekDates[2]!,
        durationMs: 2,
        projectId: "project-1",
        taskId: "task-1",
      },
    };
    const full = projectWeeklyTime(input);
    const hidden = projectWeeklyTime({ ...input, hideNonWorkingDays: true });
    const visibleDates = weekDates.filter(
      (_, index) => index !== 2 && index !== 6,
    );

    expect(getVisibleWeekDates(weekDates, targets)).toEqual(weekDates);
    expect(getVisibleWeekDates(weekDates, targets, true)).toEqual(visibleDates);
    expect(hidden.days.map((day) => day.localDate)).toEqual(visibleDates);
    expect(hidden.gridRows[0]!.dayTotalsMs).toEqual([1, 2, 4, 5, 6]);
    expect(
      hidden.gridRows[0]!.dayEntries.map((day) => day[0]!.localDate),
    ).toEqual(visibleDates);
    expect(hidden.totalMs).toBe(30);
    expect(hidden.totalMs).toBe(full.totalMs);
    expect(hidden.capacityMs).toBe(full.capacityMs);
    expect(hidden.gridRows[0]!.totalMs).toBe(full.gridRows[0]!.totalMs);
    expect(hidden.gridRows[0]!.entryIds).toEqual(full.gridRows[0]!.entryIds);
  });

  it("returns no visible columns when every day has zero capacity", () => {
    const projection = projectWeeklyTime({
      capacityTargets: {
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 0,
        friday: 0,
        saturday: 0,
        sunday: 0,
      },
      hideNonWorkingDays: true,
      entries: [],
      projects,
      weekDates,
    });
    expect(projection.days).toEqual([]);
    expect(projection.totalMs).toBe(0);
    expect(projection.capacityMs).toBe(0);
  });

  it("groups entries and includes running time once", () => {
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [
        {
          _id: "entry-1",
          localDate: "2026-08-10",
          projectId: "project-1",
          taskId: "task-1",
          label: "Build",
          durationMs: 4,
          sourceBlockIds: [],
          committedAt: 1,
        },
      ],
      projects,
      runningTime: {
        entryId: "entry-1",
        localDate: "2026-08-10",
        durationMs: 3,
        projectId: "project-1",
        taskId: "task-1",
      },
      weekDates,
    });

    expect(projection.totalMs).toBe(7);
    expect(projection.days[0]?.totalMs).toBe(7);
    expect(projection.gridRows[0]).toMatchObject({
      projectName: "Ajour",
      rowKey: "project-1::task-1",
      runningLocalDate: "2026-08-10",
      taskName: "Build",
      totalMs: 7,
    });
  });

  it("applies a correction below the resumed entry's saved time to its row", () => {
    const hour = 60 * 60 * 1000;
    // Resumed a saved 2h entry, then corrected its counted time to 1h.
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [
        {
          _id: "entry-1",
          localDate: "2026-08-10",
          projectId: "project-1",
          taskId: "task-1",
          label: "Build",
          durationMs: 2 * hour,
          sourceBlockIds: [],
          committedAt: 1,
        },
      ],
      projects,
      runningTime: {
        entryId: "entry-1",
        localDate: "2026-08-10",
        durationMs: -hour,
        projectId: "project-1",
        taskId: "task-1",
      },
      weekDates,
    });

    expect(projection.days[0]?.totalMs).toBe(hour);
    expect(projection.totalMs).toBe(hour);
    expect(projection.gridRows).toEqual([
      expect.objectContaining({
        rowKey: "project-1::task-1",
        runningLocalDate: "2026-08-10",
        totalMs: hour,
      }),
    ]);
    expect(projection.gridRows[0]?.dayTotalsMs[0]).toBe(hour);
  });

  it("uses the linked entry label to place running time in the correct taskless row", () => {
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [
        {
          _id: "docs-entry",
          localDate: "2026-08-10",
          projectId: "project-1",
          label: "docs.example",
          durationMs: 2,
          sourceBlockIds: [],
          committedAt: 1,
        },
        {
          _id: "github-entry",
          localDate: "2026-08-10",
          projectId: "project-1",
          label: "github.example",
          durationMs: 4,
          sourceBlockIds: [],
          committedAt: 2,
        },
      ],
      projects,
      runningTime: {
        entryId: "github-entry",
        localDate: "2026-08-10",
        durationMs: 3,
        projectId: "project-1",
      },
      weekDates,
    });

    expect(projection.gridRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: "project-1::docs.example",
          totalMs: 2,
        }),
        expect.objectContaining({
          rowKey: "project-1::github.example",
          totalMs: 7,
          runningLocalDate: "2026-08-10",
        }),
      ]),
    );
    expect(
      projection.gridRows.find(
        (row) => row.rowKey === "project-1::docs.example",
      )?.runningLocalDate,
    ).toBeUndefined();
  });

  it("handles zero and exceeded capacity, missing references, and week boundaries", () => {
    const projection = projectWeeklyTime({
      capacityTargets: {
        ...capacityTargets,
        monday: 0,
        tuesday: 5,
        wednesday: 0,
        thursday: 0,
        friday: 0,
      },
      entries: [
        {
          _id: "monday-entry",
          localDate: "2026-08-10",
          projectId: "missing-project",
          taskId: "missing-task",
          label: "Orphaned work",
          durationMs: 4,
          sourceBlockIds: [],
          committedAt: 1,
        },
        {
          _id: "tuesday-entry",
          localDate: "2026-08-11",
          label: "No project work",
          durationMs: 6,
          sourceBlockIds: [],
          committedAt: 2,
        },
        {
          _id: "outside-week",
          localDate: "2026-08-17",
          label: "Outside",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 3,
        },
      ],
      projects,
      weekDates,
    });

    expect(projection.days[0]).toMatchObject({
      capacityMs: 0,
      overCapacity: false,
      totalMs: 4,
    });
    expect(projection.days[1]).toMatchObject({
      capacityMs: 5,
      overCapacity: true,
      totalMs: 6,
    });
    expect(projection).toMatchObject({
      capacityMs: 5,
      overCapacity: true,
      totalMs: 10,
    });
    expect(projection.gridRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectName: "No project",
          taskName: "Orphaned work",
        }),
        expect.objectContaining({
          projectName: "No project",
          taskName: "No project work",
        }),
      ]),
    );
    expect(
      projection.gridRows.some((row) => row.entryIds.includes("outside-week")),
    ).toBe(false);
  });
  it("lists each cell's entries without the running entry's saved part", () => {
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [
        {
          _id: "entry-1",
          localDate: "2026-08-10",
          projectId: "project-1",
          taskId: "task-1",
          label: "Build",
          durationMs: 4,
          sourceBlockIds: [],
          committedAt: 1,
        },
        {
          _id: "entry-2",
          localDate: "2026-08-10",
          projectId: "project-1",
          taskId: "task-1",
          label: "Build",
          durationMs: 5,
          sourceBlockIds: [],
          committedAt: 2,
        },
      ],
      projects,
      runningTime: {
        entryId: "entry-2",
        localDate: "2026-08-10",
        durationMs: 3,
        projectId: "project-1",
        taskId: "task-1",
      },
      weekDates,
    });

    const row = projection.gridRows[0]!;
    expect(row.dayEntries[0]?.map((entry) => entry._id)).toEqual(["entry-1"]);
    expect(row.dayEntries[1]).toEqual([]);
    expect(row.runningLocalDate).toBe("2026-08-10");
    expect(row.acceptsNewEntries).toBe(true);
  });

  it("keeps a resumed entry in its old cell after its task changes while running", () => {
    const projectsWithTwoTasks = [
      {
        ...projects[0]!,
        tasks: [
          ...projects[0]!.tasks,
          {
            _id: "task-2",
            name: "Review",
            status: "active" as const,
            createdAt: 1,
          },
        ],
      },
    ];
    const resumed = {
      _id: "resumed",
      localDate: "2026-08-10",
      projectId: "project-1",
      taskId: "task-1",
      label: "Build",
      durationMs: 4,
      sourceBlockIds: [],
      committedAt: 1,
    };
    // The entry was resumed, then the running entry moved to task-2.
    const running = {
      entryId: "resumed",
      localDate: "2026-08-10",
      projectId: "project-1",
      taskId: "task-2",
    };
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [resumed],
      projects: projectsWithTwoTasks,
      runningTime: { ...running, durationMs: 3 },
      weekDates,
    });

    const oldRow = projection.gridRows.find(
      (row) => row.rowKey === "project-1::task-1",
    )!;
    const newRow = projection.gridRows.find(
      (row) => row.rowKey === "project-1::task-2",
    )!;
    expect(oldRow.dayEntries[0]?.map((entry) => entry._id)).toEqual([
      "resumed",
    ]);
    expect(oldRow.dayTotalsMs[0]).toBe(4);
    expect(oldRow.runningLocalDate).toBeUndefined();
    expect(newRow.dayEntries[0]).toEqual([]);
    expect(newRow.runningLocalDate).toBe("2026-08-10");
    // Both rows hold the running entry: the old one its saved part, the new one its time.
    expect(oldRow.holdsRunningEntry).toBe(true);
    expect(newRow.holdsRunningEntry).toBe(true);

    expect(
      selectWeeklyGridCell({
        entries: [resumed],
        localDate: "2026-08-10",
        rowKey: "project-1::task-1",
        running,
      }),
    ).toEqual({ rows: [resumed], hasRunning: false });
    expect(
      selectWeeklyGridCell({
        entries: [resumed],
        localDate: "2026-08-10",
        rowKey: "project-1::task-2",
        running,
      }),
    ).toEqual({ rows: ["running"], hasRunning: true });
  });

  it("selects one cell the same way the Grid rows group it", () => {
    const entries = [
      {
        _id: "entry-1",
        localDate: "2026-08-10",
        projectId: "project-1",
        taskId: "task-1",
        label: "Build",
        durationMs: 4,
        sourceBlockIds: [],
        committedAt: 1,
      },
      {
        _id: "entry-2",
        localDate: "2026-08-10",
        projectId: "project-1",
        taskId: "task-1",
        label: "Build",
        durationMs: 5,
        sourceBlockIds: [],
        committedAt: 2,
      },
      {
        _id: "other-day",
        localDate: "2026-08-11",
        projectId: "project-1",
        taskId: "task-1",
        label: "Build",
        durationMs: 5,
        sourceBlockIds: [],
        committedAt: 3,
      },
    ];
    const running = {
      entryId: "entry-1",
      localDate: "2026-08-10",
      projectId: "project-1",
      taskId: "task-1",
    };

    const cell = selectWeeklyGridCell({
      entries,
      localDate: "2026-08-10",
      rowKey: "project-1::task-1",
      running,
    });
    // The running entry keeps the place of entry-1, the entry it continues.
    expect(cell.rows.map((row) => (row === "running" ? row : row._id))).toEqual(
      ["running", "entry-2"],
    );
    expect(cell.hasRunning).toBe(true);
    expect(
      selectWeeklyGridCell({
        entries,
        localDate: "2026-08-11",
        rowKey: "project-1::task-1",
        running,
      }).hasRunning,
    ).toBe(false);
  });

  it("shows added rows empty until they get time, without duplicating a row", () => {
    const projection = projectWeeklyTime({
      addedRows: [
        { projectId: "project-1", taskId: "task-1" },
        { projectId: "project-1" },
      ],
      capacityTargets,
      entries: [
        {
          _id: "entry-1",
          localDate: "2026-08-10",
          projectId: "project-1",
          taskId: "task-1",
          label: "Build",
          durationMs: 4,
          sourceBlockIds: [],
          committedAt: 1,
        },
      ],
      projects,
      weekDates,
    });

    expect(
      projection.gridRows.map((row) => [row.rowKey, row.taskName, row.totalMs]),
    ).toEqual([
      ["project-1::task-1", "Build", 4],
      ["project-1::", "No task", 0],
    ]);
    expect(projection.gridRows[1]?.dayEntries).toEqual(weekDates.map(() => []));
    expect(projection.gridRows.map((row) => row.holdsRunningEntry)).toEqual([
      false,
      false,
    ]);
  });

  it("keeps typed time out of rows grouped by a legacy label", () => {
    const projection = projectWeeklyTime({
      capacityTargets,
      entries: [
        {
          _id: "legacy",
          localDate: "2026-08-10",
          projectId: "project-1",
          label: "docs.example",
          durationMs: 2,
          sourceBlockIds: [],
          committedAt: 1,
        },
      ],
      projects,
      weekDates,
    });

    expect(projection.gridRows[0]?.acceptsNewEntries).toBe(false);
  });
});
