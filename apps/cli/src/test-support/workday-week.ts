import type { DataToolOutput } from "../../../../packages/shared/agent-tools.ts";
export const week: DataToolOutput<"get_week_lines"> = {
  weekOf: "2026-11-02",
  groupBy: "day-task",
  locked: false,
  sections: [
    {
      localDate: "2026-11-02",
      lines: [
        {
          projectName: "Ajour Desktop",
          taskName: "07 Export",
          hours: 3,
          comments: "Fix export rounding",
          entryIds: ["1"],
        },
        {
          projectName: "Acme Platform",
          taskName: "05 Backend",
          hours: 3.5,
          comments: "Rate limiter",
          entryIds: ["2"],
        },
      ],
    },
    {
      localDate: "2026-11-03",
      lines: [
        {
          projectName: "Acme Platform",
          taskName: "03 Meetings",
          hours: 2.25,
          comments: "Sprint planning",
          entryIds: ["3"],
        },
        {
          projectName: "Ajour Desktop",
          taskName: "04 Review",
          hours: 2.25,
          comments: "PR #510",
          entryIds: ["4"],
        },
      ],
    },
    {
      localDate: "2026-11-04",
      lines: [
        {
          projectName: "Ajour Desktop",
          taskName: "04 Review",
          hours: 2,
          comments: "PR #512, #514",
          entryIds: ["5"],
        },
        {
          projectName: "Acme Platform",
          taskName: "03 Meetings",
          hours: 0.75,
          comments: "Weekly sync, moved to 10:30",
          entryIds: ["6"],
        },
        {
          projectName: "Acme Platform",
          taskName: "05 Backend",
          hours: 2.5,
          comments: "Rate limiter retries",
          entryIds: ["7"],
        },
      ],
    },
  ],
  notSent: {
    hours: 1.5,
    items: [
      {
        projectId: "ajr",
        projectName: "Ajour Desktop",
        taskName: "09 Admin",
        hours: 1.5,
      },
    ],
  },
  waiting: {
    hours: 3,
    tasks: [
      {
        projectId: "acme",
        taskId: "temp",
        taskName: "Temp migration",
        hours: 3,
      },
    ],
  },
  running: {
    timerId: "timer",
    date: "2026-11-04",
    taskName: "07 Export",
    unsavedMinutes: 84,
  },
};

export function grouped(by: "day-task" | "day" | "task"): typeof week {
  if (by !== "task") return { ...week, groupBy: by };
  return {
    ...week,
    groupBy: by,
    sections: [
      {
        lines: [
          {
            projectName: "Acme Platform",
            taskName: "05 Backend",
            hours: 6,
            comments: "Rate limiter | Rate limiter retries",
            entryIds: ["2", "7"],
          },
          {
            projectName: "Ajour Desktop",
            taskName: "04 Review",
            hours: 4.25,
            comments: "PR #510 | PR #512, #514",
            entryIds: ["4", "5"],
          },
          {
            projectName: "Ajour Desktop",
            taskName: "07 Export",
            hours: 3,
            comments: "Fix export rounding",
            entryIds: ["1"],
          },
          {
            projectName: "Acme Platform",
            taskName: "03 Meetings",
            hours: 3,
            comments: "Sprint planning | Weekly sync, moved to 10:30",
            entryIds: ["3", "6"],
          },
        ],
      },
    ],
  };
}
