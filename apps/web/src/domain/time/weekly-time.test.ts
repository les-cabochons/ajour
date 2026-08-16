import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import { projectWeeklyTime } from "@/domain/time/weekly-time";

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
    name: "HarDay",
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
    expect(projection.ledgerRows[0]).toMatchObject({
      projectName: "HarDay",
      rowKey: "project-1::task-1",
      runningLocalDate: "2026-08-10",
      taskName: "Build",
      totalMs: 7,
    });
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

    expect(projection.ledgerRows).toEqual(
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
      projection.ledgerRows.find(
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
    expect(projection.ledgerRows).toEqual(
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
      projection.ledgerRows.some((row) => row.entryIds.includes("outside-week")),
    ).toBe(false);
  });
});
