import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKLOG_VIEW_SETTINGS as defaults,
  groupBacklogItems,
  orderBacklogItems,
  selectBacklogViewItems,
  getSubitemProgress,
} from "./backlog-view";
import type { LocalWorkItem } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
const now = 1000000000;
const item = (
  _id: string,
  patch: Partial<LocalWorkItem> = {},
): LocalWorkItem => ({
  _id,
  title: _id,
  status: "active",
  source: "manual",
  createdAt: 1,
  ...patch,
});
const workflowStates = [
  { _id: "todo", name: "To do", color: "#000000", createdAt: 1 },
  { _id: "done", name: "Done", color: "#000000", createdAt: 1, done: true },
];
describe("backlog view selection", () => {
  const workItems = [
    item("active"),
    item("settled", { status: "settled" }),
    item("recent", {
      status: "archived",
      workflowStateId: "done",
      archivedAt: now - 1,
    }),
    item("old", { status: "archived", workflowStateId: "done", archivedAt: 1 }),
    item("missing", {
      status: "archived",
      workflowStateId: "done",
      archivedByMissingSync: true,
      archivedAt: now - 1,
    }),
    item("child", { parentWorkItemId: "active", workflowStateId: "todo" }),
  ];
  const state = { workItems, workflowStates };
  it("shows recent done items and standalone subitems with active and settled items", () => {
    expect(
      selectBacklogViewItems(state, defaults, [], { now }).map((i) => i._id),
    ).toEqual(["active", "settled", "recent", "child"]);
  });
  it("supports all and none done windows while missing-sync archives stay in Archive", () => {
    expect(
      selectBacklogViewItems(state, { ...defaults, doneWindow: "all" }, [], {
        now,
      }).map((i) => i._id),
    ).toEqual(["active", "settled", "recent", "old", "child"]);
    expect(
      selectBacklogViewItems(
        state,
        {
          ...defaults,
          doneWindow: "none",
          showSettled: false,
          showSubitems: false,
        },
        [],
        { now },
      ).map((i) => i._id),
    ).toEqual(["active"]);
  });
  it("uses OR within a property and AND between properties", () => {
    const state = {
      workflowStates,
      workItems: [
        item("a", { priority: 1, projectId: "p" }),
        item("b", { priority: 2, projectId: "p" }),
        item("c", { priority: 1, projectId: "q" }),
      ],
    };
    expect(
      selectBacklogViewItems(
        state,
        defaults,
        [
          { field: "priority", value: "1" },
          { field: "priority", value: "2" },
          { field: "project", value: "p" },
        ],
        { now },
      ).map((i) => i._id),
    ).toEqual(["a", "b"]);
  });
  it("filters running entries, zero estimates, and source connections", () => {
    const state = {
      workflowStates,
      workItems: [
        item("a", { sourceConnectionId: "c", completedEstimateHours: 0 }),
        item("b"),
      ],
    };
    expect(
      selectBacklogViewItems(
        state,
        defaults,
        [
          { field: "connection", value: "c" },
          { field: "running", value: "yes" },
          { field: "hasEstimate", value: "yes" },
        ],
        { now, runningWorkItemId: "a" },
      ).map((i) => i._id),
    ).toEqual(["a"]);
  });
});
describe("backlog ordering and grouping", () => {
  const items = [
    item("z", { priority: 2, createdAt: 2 }),
    item("a", { priority: 2, createdAt: 3, remainingEstimateHours: 0 }),
    item("b", { priority: 1 }),
    item("c"),
  ];
  it("keeps the custom order within priority levels and places missing priorities last", () => {
    expect(
      orderBacklogItems(items, items, "priority_asc").map((i) => i._id),
    ).toEqual(["b", "z", "a", "c"]);
  });
  it("preserves the persisted descending priority order with No priority first", () => {
    expect(
      orderBacklogItems(items, items, "priority_desc").map((i) => i._id),
    ).toEqual(["c", "z", "a", "b"]);
  });
  it("orders by newest creation, title, or remaining estimate with absent estimates last", () => {
    expect(
      orderBacklogItems(items, items, "created").map((i) => i._id),
    ).toEqual(["a", "z", "b", "c"]);
    expect(orderBacklogItems(items, items, "title").map((i) => i._id)).toEqual([
      "a",
      "b",
      "c",
      "z",
    ]);
    expect(
      orderBacklogItems(items, items, "remaining").map((i) => i._id),
    ).toEqual(["a", "z", "b", "c"]);
  });
  it("keeps empty workflow columns for drops and groups unknown states under No state", () => {
    const groups = groupBacklogItems(
      { workflowStates, projects: [] },
      [item("a", { workflowStateId: "unknown" })],
      "state",
      { keepEmpty: true },
    );
    expect(groups.map((g) => g.label)).toEqual(["No state", "To do", "Done"]);
    expect(groups[0]?.items[0]?._id).toBe("a");
    expect(
      groupBacklogItems({ workflowStates, projects: [] }, [], "state", {
        keepEmpty: true,
      }).map((g) => g.label),
    ).toEqual(["To do", "Done"]);
  });
  it("reports only archived subitems as closed progress", () => {
    expect(
      getSubitemProgress([
        item("a"),
        item("b", { status: "settled" }),
        item("c", { status: "archived" }),
      ]),
    ).toEqual({ closed: 1, total: 3 });
  });
  it("keeps assigned archived projects marked while omitting empty archived projects", () => {
    const groups = groupBacklogItems(
      {
        workflowStates,
        projects: [
          {
            _id: "active",
            name: "Active project",
            icon: DEFAULT_PROJECT_ICON,
            color: "#000000",
            status: "active",
            tasks: [],
          },
          {
            _id: "archived",
            name: "Archived project",
            icon: DEFAULT_PROJECT_ICON,
            color: "#000000",
            status: "archived",
            tasks: [],
          },
          {
            _id: "empty",
            name: "Empty archived project",
            icon: DEFAULT_PROJECT_ICON,
            color: "#000000",
            status: "archived",
            tasks: [],
          },
        ],
      },
      [item("assigned", { projectId: "archived" }), item("unassigned")],
      "project",
      { keepEmpty: true },
    );
    expect(groups).toMatchObject([
      { kind: "project", projectId: "active", archived: false, items: [] },
      {
        kind: "project",
        projectId: "archived",
        archived: true,
        items: [{ _id: "assigned" }],
      },
      { kind: "project", archived: false, items: [{ _id: "unassigned" }] },
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Active project",
      "Archived project",
      "No project",
    ]);
  });
});
