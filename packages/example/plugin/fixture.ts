// The snapshot the example planner serves: two projects, one over budget,
// one complete, with tasks assigned and not. Tests assert against it.
import type { ProjectSourceSnapshot } from "../../plugin-sdk/index.ts";

/** The cursor that comes with the snapshot; sent back, it means "unchanged". */
export const FIXTURE_CURSOR = 'W/"example-planner-1"';

export const fixtureSnapshot: ProjectSourceSnapshot = {
  source: { label: "Example planner", url: "https://planner.example" },
  asOf: "2026-10-31T23:59:59.000Z",
  me: { hoursAvailable: true },
  projects: [
    {
      remoteId: "ACME-SUP",
      name: "Acme - Support",
      code: "ACME-SUP",
      url: "https://planner.example/projects/ACME-SUP",
      client: "Acme inc.",
      complete: false,
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      budget: {
        unit: "hours",
        total: 40,
        consumed: 31.5,
        remaining: 8.5,
        status: "warning",
      },
      tasks: [
        {
          remoteId: "1001",
          name: "Ticket #101 - Login",
          group: "Support",
          closed: false,
          billable: true,
          estimateHours: 8,
          assigned: true,
          myHours: 5.25,
        },
        {
          remoteId: "1002",
          name: "Ticket #102 - Export",
          group: "Support",
          closed: false,
          billable: true,
          estimateHours: 4,
          assigned: false,
        },
        {
          remoteId: "1003",
          name: "Ticket #099 - Time zone",
          group: "Support",
          closed: true,
          billable: true,
          estimateHours: 2,
          assigned: true,
          myHours: 2,
        },
      ],
    },
    {
      remoteId: "GLOBEX-INT",
      name: "Globex - Internal",
      code: "GLOBEX-INT",
      url: "https://planner.example/projects/GLOBEX-INT",
      complete: true,
      budget: {
        unit: "money",
        total: 20000,
        consumed: 21200,
        remaining: -1200,
        status: "over",
      },
      tasks: [
        {
          remoteId: "2001",
          name: "Weekly follow-up",
          group: "Management",
          closed: false,
          billable: false,
          assigned: true,
          myHours: 14,
        },
      ],
    },
  ],
};
