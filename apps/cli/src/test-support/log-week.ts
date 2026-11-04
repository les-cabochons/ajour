import type {
  AgentRunningTimer,
  AgentTimeEntry,
  DataToolOutput,
} from "../../../../packages/shared/agent-tools.ts";
import { datesBetween } from "../dates.ts";

/**
 * The mockups' week, as Ajour's read tools return it: Wednesday 4 November
 * 2026, with 07 Export running, a local only task and a Not known yet one.
 */
export const TODAY = "2026-11-04";

export const projects: DataToolOutput<"list_projects">["projects"] = [
  {
    projectId: "p-acme",
    name: "Acme Platform",
    code: "ACME",
    tasks: [
      { taskId: "t-meet", name: "03 Meetings" },
      { taskId: "t-backend", name: "05 Backend" },
      {
        taskId: "t-temp",
        name: "Temp migration",
        commitsAs: { kind: "not-known-yet" },
      },
    ],
  },
  {
    projectId: "p-ajr",
    name: "Ajour Desktop",
    code: "AJR",
    tasks: [
      { taskId: "t-review", name: "04 Review" },
      { taskId: "t-export", name: "07 Export" },
      {
        taskId: "t-admin",
        name: "09 Admin",
        commitsAs: { kind: "local-only" },
      },
    ],
  },
];

const TASKS = {
  meet: ["p-acme", "ACME", "Acme Platform", "t-meet", "03 Meetings"],
  backend: ["p-acme", "ACME", "Acme Platform", "t-backend", "05 Backend"],
  temp: ["p-acme", "ACME", "Acme Platform", "t-temp", "Temp migration"],
  review: ["p-ajr", "AJR", "Ajour Desktop", "t-review", "04 Review"],
  export: ["p-ajr", "AJR", "Ajour Desktop", "t-export", "07 Export"],
  admin: ["p-ajr", "AJR", "Ajour Desktop", "t-admin", "09 Admin"],
} as const;

function on(task: keyof typeof TASKS) {
  const [projectId, projectCode, projectName, taskId, taskName] = TASKS[task];
  return { projectId, projectCode, projectName, taskId, taskName };
}

export function entry(
  date: string,
  id: string,
  task: keyof typeof TASKS,
  minutes: number,
  note: string,
  state: AgentTimeEntry["state"] = "saved",
): AgentTimeEntry {
  return {
    entryId: `timesheet_${id}`,
    shortId: id.padEnd(32, "0"),
    date,
    state,
    minutes,
    note,
    ...on(task),
  };
}

export const running: AgentRunningTimer = {
  timerId: "timer_1",
  shortId: "3f9a2c1".padEnd(32, "0"),
  date: TODAY,
  countedMinutes: 84,
  note: "Fix export rounding",
  ...on("export"),
};

export const entries: AgentTimeEntry[] = [
  entry(
    "2026-11-02",
    "2a9e1f0",
    "export",
    180,
    "Fix export rounding",
    "committed",
  ),
  entry("2026-11-02", "5c17e08", "admin", 90, "Expenses", "committed"),
  entry("2026-11-02", "4e0c2b8", "backend", 210, "Rate limiter", "committed"),
  entry("2026-11-03", "d8b2a40", "meet", 135, "Sprint planning", "committed"),
  entry(
    "2026-11-03",
    "66e03f9",
    "temp",
    180,
    "Schema dry run on the staging copy",
  ),
  entry("2026-11-03", "1b9cc3d", "review", 135, "PR #510"),
  entry("2026-11-04", "b7e1d04", "review", 120, "PR #512, #514"),
  entry("2026-11-04", "91c0aa3", "meet", 45, "Weekly sync", "committed"),
  entry(
    "2026-11-04",
    "0d4f77e",
    "backend",
    150,
    "Rate limiter retries",
    "committed",
  ),
];

export function listed(
  from: string,
  to: string,
): DataToolOutput<"list_time_entries"> {
  return {
    entries: entries.filter((item) => item.date >= from && item.date <= to),
    running: running.date >= from && running.date <= to ? running : null,
    targets: datesBetween(from, to).map((date) => ({
      date,
      hours: ["2026-11-07", "2026-11-08"].includes(date) ? 0 : 8,
    })),
  };
}
