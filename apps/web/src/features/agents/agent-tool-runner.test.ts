import { beforeEach, describe, expect, it, vi } from "vitest";

const { offerUndo, canWriteToSource } = vi.hoisted(() => ({
  offerUndo: vi.fn(),
  canWriteToSource: vi.fn((_item: { title: string }) => false),
}));
vi.mock("@/features/feedback/undo-toast", () => ({ offerUndo }));
vi.mock("@/features/backlog/backlog-source-writes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  canWriteToSource,
}));

const client = { id: "c1", name: "Claude Code" };

function installMockWindow() {
  const storage = new Map<string, string>();
  const createStorage = (target: Map<string, string>) => ({
    get length() {
      return target.size;
    },
    key: (index: number) => Array.from(target.keys())[index] ?? null,
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => void target.set(key, value),
    removeItem: (key: string) => void target.delete(key),
    clear: () => target.clear(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(storage),
      sessionStorage: createStorage(new Map()),
    },
  });
}

/** Loads a fresh store and runner, and a project "Acme" with a task "Build". */
async function setup() {
  const { localStore } = await import("@/lib/local-store");
  const { runAgentToolCall } =
    await import("@/features/agents/agent-tool-runner");
  localStore.addProject({
    name: "Acme",
    color: "#123456",
    tasks: [{ name: "Build" }, { name: "Old", status: "archived" }],
  });
  const project = localStore
    .snapshot()
    .projects.find((candidate) => candidate.name === "Acme")!;
  const task = (name: string) =>
    project.tasks.find((candidate) => candidate.name === name)!;
  let next = 0;
  const call = (tool: string, input: unknown = {}) =>
    runAgentToolCall({ requestId: `r${(next += 1)}`, tool, input, client });
  return { localStore, call, project, task };
}

beforeEach(() => {
  vi.resetModules();
  installMockWindow();
  offerUndo.mockClear();
  canWriteToSource.mockReturnValue(false);
});

describe("agent read tools", () => {
  it("lists projects through the runner", async () => {
    const { call } = await setup();
    const result = call("list_projects");
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Acme",
          tasks: [expect.objectContaining({ name: "Build" })],
        }),
      ]),
    );
  });

  it("refuses invalid input with the field and reason", async () => {
    const { call } = await setup();
    const result = call("list_time_entries", {
      from: "yesterday",
      to: "2026-10-14",
    });
    expect(result).toEqual({
      requestId: "r1",
      ok: false,
      error: "from: Use a date such as 2026-10-14.",
    });
  });

  it("refuses a tool Ajour does not have", async () => {
    const { call } = await setup();
    expect(call("delete_everything")).toMatchObject({
      ok: false,
      error: "Ajour has no tool named delete_everything.",
    });
  });
});

describe("agent timer and entry tools", () => {
  it("starts an entry on a task, labels the Undo toast and can be undone", async () => {
    const { call, localStore, project, task } = await setup();

    const result = call("start_timer", {
      projectId: project._id,
      taskId: task("Build")._id,
      note: "Pairing",
    });

    expect(result).toMatchObject({
      ok: true,
      activity: { action: "Started an entry", objectTitle: "Acme · Build" },
    });
    expect(localStore.snapshot().timers[0]).toMatchObject({ note: "Pairing" });
    const [token, options] = offerUndo.mock.calls[0]!;
    expect(options.title).toBe("Claude Code: Started an entry");
    expect(localStore.undo(token)).toBe("restored");
    expect(localStore.snapshot().timers).toHaveLength(0);
  });

  it("refuses to start an entry on an archived task", async () => {
    const { call, project, task } = await setup();
    expect(
      call("start_timer", { projectId: project._id, taskId: task("Old")._id }),
    ).toMatchObject({ ok: false, error: "Restore the task first" });
  });

  it("refuses to move the running entry", async () => {
    const { call, localStore, project, task } = await setup();
    const { todayIsoDate } = await import("@/lib/utils");
    localStore.saveManualTimeEntry({
      localDate: todayIsoDate(),
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entry = localStore.snapshot().timesheetEntries[0]!;
    localStore.continueTimesheetEntry(entry._id);

    expect(
      call("move_entry", { entryId: entry._id, date: "2026-01-05" }),
    ).toMatchObject({ ok: false, error: "Stop the running entry first" });
  });

  it("creates an entry and marks it submitted", async () => {
    const { call, localStore, project, task } = await setup();
    const created = call("create_entry", {
      date: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      minutes: 90,
      note: "Workshop",
    });
    expect(created).toMatchObject({
      ok: true,
      output: { date: "2026-10-13", minutes: 90, state: "saved" },
    });

    const entryId = (created as { output: { entryId: string } }).output.entryId;
    expect(
      call("mark_entries_submitted", { entryIds: [entryId] }),
    ).toMatchObject({ ok: true });
    expect(
      localStore
        .snapshot()
        .timesheetEntries.find((entry) => entry._id === entryId)?.submittedAt,
    ).toBeDefined();
  });

  it("refuses to create an entry on an archived or unknown backlog item", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.addWorkItem({ title: "Old story" });
    const workItem = localStore.snapshot().workItems[0]!;
    localStore.archiveWorkItem(workItem._id);
    expect(localStore.snapshot().workItems[0]!.status).toBe("archived");
    const entry = {
      date: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      minutes: 30,
    };

    expect(
      call("create_entry", { ...entry, workItemId: workItem._id }),
    ).toMatchObject({ ok: false, error: "Restore the item first" });
    expect(
      call("create_entry", { ...entry, workItemId: "missing" }),
    ).toMatchObject({
      ok: false,
      error: "No backlog item has the id missing. Call list_work_items.",
    });
    expect(localStore.snapshot().timesheetEntries).toHaveLength(0);
  });

  it("stops the running entry", async () => {
    const { call, localStore, project } = await setup();
    call("start_timer", { projectId: project._id });
    expect(call("stop_timer")).toMatchObject({ ok: true });
    expect(localStore.snapshot().timers).toHaveLength(0);
    expect(call("stop_timer")).toMatchObject({
      ok: false,
      error: "No entry is running.",
    });
  });
});

describe("agent work item tools", () => {
  it("creates an item and moves it to a done state, which closes it", async () => {
    const { call, localStore } = await setup();
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!;

    const created = call("create_work_item", { title: "Write the spec" });
    const workItemId = (created as { output: { workItemId: string } }).output
      .workItemId;
    const moved = call("move_work_item", {
      workItemId,
      workflowStateId: done._id,
    });

    expect(moved).toMatchObject({ ok: true, output: { status: "archived" } });
    expect(offerUndo.mock.calls.at(-1)![1].title).toMatch(
      /^Claude Code: Closed in /,
    );
  });

  it("asks the agent to choose when a parent's open subitems are in question", async () => {
    const { call, localStore } = await setup();
    localStore.setUserPreferences({ closeParentSubitems: "ask" });
    const parentId = localStore.addWorkItem({ title: "Parent" });
    localStore.addWorkItem({ title: "Child", parentWorkItemId: parentId });

    expect(call("settle_work_item", { workItemId: parentId })).toMatchObject({
      ok: false,
      error:
        "This item has 1 open subitem. Call again with includeSubitems true or false.",
    });
    expect(
      call("settle_work_item", { workItemId: parentId, includeSubitems: true }),
    ).toMatchObject({ ok: true });
    expect(
      localStore
        .snapshot()
        .workItems.every((item) => item.status === "archived"),
    ).toBe(true);
  });

  it("refuses a snooze in the past", async () => {
    const { call, localStore } = await setup();
    const workItemId = localStore.addWorkItem({ title: "Later" });
    expect(
      call("snooze_work_item", { workItemId, until: "2020-01-01T09:00:00Z" }),
    ).toMatchObject({ ok: false, error: "Pick a time in the future." });
  });

  it("leaves synced items that write to their source to the user", async () => {
    const { call, localStore } = await setup();
    const workItemId = localStore.addWorkItem({ title: "Synced" });
    canWriteToSource.mockReturnValue(true);
    const target = localStore.snapshot().workflowStates[0]!;

    expect(
      call("move_work_item", { workItemId, workflowStateId: target._id }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("writes its state to its source"),
    });
  });

  it("gives the action set's reason when the item is archived", async () => {
    const { call, localStore } = await setup();
    const workItemId = localStore.addWorkItem({ title: "Old" });
    call("settle_work_item", { workItemId });

    expect(call("edit_work_item", { workItemId, title: "New" })).toMatchObject({
      ok: false,
      error: "Restore the item first",
    });
    expect(call("restore_work_item", { workItemId })).toMatchObject({
      ok: true,
      output: { status: "active" },
    });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Restored a backlog item",
    );
  });

  it("drops the old task when an edit changes the project", async () => {
    const { call, localStore, project, task } = await setup();
    const workItemId = localStore.addWorkItem({
      title: "Mapped",
      projectId: project._id,
      taskId: task("Build")._id,
    });

    expect(
      call("edit_work_item", { workItemId, projectId: null }),
    ).toMatchObject({ ok: true });
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === workItemId)!;
    expect(item.projectId).toBeUndefined();
    expect(item.taskId).toBeUndefined();
  });

  it("refuses a subitem of a subitem and an item created in a done state", async () => {
    const { call, localStore } = await setup();
    const parentId = localStore.addWorkItem({ title: "Parent" });
    const childId = localStore.addWorkItem({
      title: "Child",
      parentWorkItemId: parentId,
    });
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!;

    expect(
      call("create_work_item", { title: "Deep", parentWorkItemId: childId }),
    ).toMatchObject({ ok: false, error: "Subitems can't have subitems" });
    expect(
      call("create_work_item", { title: "Done", workflowStateId: done._id }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("done state"),
    });
  });

  it("refuses to close a parent whose carried subitem writes to its source", async () => {
    const { call, localStore } = await setup();
    const parentId = localStore.addWorkItem({ title: "Parent" });
    localStore.addWorkItem({
      title: "Synced child",
      parentWorkItemId: parentId,
    });
    canWriteToSource.mockImplementation(
      (item: { title: string }) => item.title === "Synced child",
    );
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!;
    const before = localStore.snapshot().workItems;

    expect(
      call("move_work_item", {
        workItemId: parentId,
        workflowStateId: done._id,
        includeSubitems: true,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "A subitem writes its state to its source",
      ),
    });
    expect(
      call("settle_work_item", { workItemId: parentId, includeSubitems: true }),
    ).toMatchObject({ ok: false });
    expect(localStore.snapshot().workItems).toEqual(before);
  });
});
