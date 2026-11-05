import { describe, expect, it } from "vitest";
import { buildProjectTaskOptions } from "./project-task-options";

describe("buildProjectTaskOptions", () => {
  it("groups active tasks by billable and non-billable", () => {
    expect(
      buildProjectTaskOptions([
        {
          _id: "task-1",
          name: "Client work",
          status: "active",
          createdAt: 1,
          billable: true,
        },
        {
          _id: "task-2",
          name: "Internal sync",
          status: "active",
          createdAt: 2,
          billable: false,
        },
        {
          _id: "task-3",
          name: "Archived item",
          status: "archived",
          createdAt: 3,
          billable: true,
        },
      ]),
    ).toEqual([
      {
        value: "task-1",
        label: "Client work",
        group: "Billable",
        keywords: ["Client work", "billable"],
      },
      {
        value: "task-2",
        label: "Internal sync",
        group: "Non-billable",
        keywords: ["Internal sync", "non-billable", "non billable"],
      },
    ]);
  });
});

describe("a managed project's task options", () => {
  it("lists the Not assigned tasks last in their group, with the hint", () => {
    expect(
      buildProjectTaskOptions([
        {
          _id: "task-export",
          name: "Ticket #102 - Export",
          status: "active",
          createdAt: 1,
          source: { remoteId: "1002", assigned: false },
        },
        {
          _id: "task-login",
          name: "Ticket #101 - Login",
          status: "active",
          createdAt: 2,
          source: { remoteId: "1001", assigned: true },
        },
      ]).map(({ value, hint }) => ({ value, hint })),
    ).toEqual([
      { value: "task-login", hint: undefined },
      { value: "task-export", hint: "Not assigned" },
    ]);
  });
});
