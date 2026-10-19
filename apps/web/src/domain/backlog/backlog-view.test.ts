import { describe, expect, it } from "vitest";
import {
  ARCHIVED_STATE_FILTER,
  DEFAULT_BACKLOG_VIEW_SETTINGS as defaults,
  groupBacklogItems,
  orderBacklogItems,
  selectBacklogViewItems,
  getSubitemHoursLeft,
  getSubitemProgress,
} from "./backlog-view";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
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
const projects: LocalAppState["projects"] = ["p", "q", "archived"].map(
  (_id) => ({
    _id,
    name: _id,
    status: _id === "archived" ? "archived" : "active",
    icon: DEFAULT_PROJECT_ICON,
    color: "#000000",
    tasks: [],
  }),
);
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
  const state = { workItems, workflowStates, projects };
  it("shows recent done items and standalone subitems with active and settled items", () => {
    expect(
      selectBacklogViewItems(state, defaults, [], { now }).map((i) => i._id),
    ).toEqual(["active", "settled", "recent", "child"]);
  });
  it("supports all and none done windows while missing-sync archives need the Archived filter", () => {
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
  it("shows every archived item under the Archived state filter", () => {
    const archived = { field: "state" as const, value: ARCHIVED_STATE_FILTER };
    expect(
      selectBacklogViewItems(
        state,
        { ...defaults, doneWindow: "none" },
        [archived],
        { now },
      ).map((i) => i._id),
    ).toEqual(["recent", "old", "missing"]);
    expect(
      selectBacklogViewItems(
        state,
        defaults,
        [archived, { field: "state", value: "todo" }],
        { now },
      ).map((i) => i._id),
    ).toEqual(["recent", "old", "missing", "child"]);
  });
  it("uses OR within a property and AND between properties", () => {
    const state = {
      workflowStates,
      projects,
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
  it.each([
    { values: [""], expected: ["missing", "unknown"] },
    { values: ["todo"], expected: ["known"] },
    { values: ["", "todo"], expected: ["missing", "unknown", "known"] },
    { values: ["deleted"], expected: [] },
  ])("filters resolved workflow states for $values", ({ values, expected }) => {
    const state = {
      workflowStates,
      projects,
      workItems: [
        item("missing"),
        item("unknown", { workflowStateId: "deleted" }),
        item("known", { workflowStateId: "todo" }),
      ],
    };
    expect(
      selectBacklogViewItems(
        state,
        defaults,
        values.map((value) => ({ field: "state" as const, value })),
        { now },
      ).map((workItem) => workItem._id),
    ).toEqual(expected);
  });
  it.each([
    { values: [""], expected: ["missing", "unknown"] },
    { values: ["p"], expected: ["known"] },
    { values: ["", "p"], expected: ["missing", "unknown", "known"] },
    { values: ["deleted"], expected: [] },
    { values: ["archived"], expected: ["archived-project"] },
  ])("filters resolved projects for $values", ({ values, expected }) => {
    const state = {
      workflowStates,
      projects,
      workItems: [
        item("missing"),
        item("unknown", { projectId: "deleted" }),
        item("known", { projectId: "p" }),
        item("archived-project", { projectId: "archived" }),
      ],
    };
    expect(
      selectBacklogViewItems(
        state,
        defaults,
        values.map((value) => ({ field: "project" as const, value })),
        { now },
      ).map((workItem) => workItem._id),
    ).toEqual(expected);
  });
  it.each([
    {
      values: [""],
      expected: [
        "missing",
        "unknown",
        "wrong-project",
        "unknown-project",
        "no-project",
      ],
    },
    { values: ["p-task"], expected: ["known"] },
    { values: ["q-task"], expected: ["other-known"] },
    { values: ["deleted"], expected: [] },
    { values: ["archived-task"], expected: ["archived-assignment"] },
    {
      values: ["", "p-task"],
      expected: [
        "missing",
        "unknown",
        "wrong-project",
        "unknown-project",
        "no-project",
        "known",
      ],
    },
  ])(
    "filters tasks within their assigned project for $values",
    ({ values, expected }) => {
      const state = {
        workflowStates,
        projects: projects.map((project) => ({
          ...project,
          tasks: [
            {
              _id: `${project._id}-task`,
              name: "Task",
              status: project.status,
              createdAt: 1,
            },
          ],
        })),
        workItems: [
          item("missing", { projectId: "p" }),
          item("unknown", { projectId: "p", taskId: "deleted" }),
          item("wrong-project", { projectId: "p", taskId: "q-task" }),
          item("unknown-project", { projectId: "deleted", taskId: "p-task" }),
          item("no-project", { taskId: "p-task" }),
          item("known", { projectId: "p", taskId: "p-task" }),
          item("other-known", { projectId: "q", taskId: "q-task" }),
          item("archived-assignment", {
            projectId: "archived",
            taskId: "archived-task",
          }),
        ],
      };
      expect(
        selectBacklogViewItems(
          state,
          defaults,
          values.map((value) => ({ field: "task" as const, value })),
          { now },
        ).map((workItem) => workItem._id),
      ).toEqual(expected);
    },
  );
  it("filters running entries, zero estimates, and source connections", () => {
    const state = {
      workflowStates,
      projects,
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
  it("sums the hours left on open subitems only", () => {
    expect(
      getSubitemHoursLeft([
        item("a", { remainingEstimateHours: 2.5 }),
        item("b", { status: "settled", remainingEstimateHours: 0 }),
        item("c"),
        item("d", { status: "archived", remainingEstimateHours: 4 }),
      ]),
    ).toBe(2.5);
  });
  it("has no hours left when no open subitem has an estimate", () => {
    expect(getSubitemHoursLeft([])).toBeUndefined();
    expect(
      getSubitemHoursLeft([
        item("a"),
        item("b", { status: "archived", remainingEstimateHours: 3 }),
      ]),
    ).toBeUndefined();
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
