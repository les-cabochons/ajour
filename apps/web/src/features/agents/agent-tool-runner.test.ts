import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { dataToolOutputSchemas } from "@ajour/shared/agent-tools";

type DataToolName = keyof typeof dataToolOutputSchemas;

const {
  offerUndo,
  canWriteToSource,
  sendPendingSourceWrites,
  listConnectorSettleStates,
} = vi.hoisted(() => ({
  offerUndo: vi.fn(),
  canWriteToSource: vi.fn((_item: { title: string }) => false),
  sendPendingSourceWrites: vi.fn(),
  listConnectorSettleStates: vi.fn(),
}));
vi.mock("@/features/feedback/undo-toast", () => ({ offerUndo }));
vi.mock("@/features/backlog/backlog-source-writes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  canWriteToSource,
  canWriteSettle: canWriteToSource,
  sendPendingSourceWrites,
}));
vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listConnectorSettleStates,
}));
vi.mock("@/lib/plugin-project-properties", () => ({
  listProjectPropertyPlugins: async () => [],
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
  // Every successful output must pass the schema the API checks it against.
  const call = async (tool: string, input: unknown = {}) => {
    const result = await runAgentToolCall({
      requestId: `r${(next += 1)}`,
      tool,
      input,
      client,
    });
    if (result.ok) {
      dataToolOutputSchemas[tool as DataToolName].parse(result.output);
    }
    return result;
  };
  /** The change of `entryId` as get_week_changes gives it, for marking. */
  const readChange = async (entryId: string, weekOf = "2026-10-13") => {
    const result = (await call("get_week_changes", {
      weekOf,
      onlyChecked: false,
    })) as {
      output: { changes: { entryId: string; version: string }[] };
    };
    const change = result.output.changes.find(
      (item) => item.entryId === entryId,
    );
    if (!change) throw new Error(`No change for ${entryId}.`);
    return { entryId, version: change.version };
  };
  return { localStore, call, readChange, project, task };
}

// The first import of these heavy modules is slow and, under full-suite load,
// used to eat the first test's timeout. Load them once here so the transform
// cost is paid before any test starts. Each test still gets a fresh copy.
beforeAll(async () => {
  installMockWindow();
  await import("@/lib/local-store");
  await import("@/features/agents/agent-tool-runner");
  await import("@/lib/app-api");
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  installMockWindow();
  offerUndo.mockClear();
  sendPendingSourceWrites.mockClear();
  canWriteToSource.mockReturnValue(false);
  listConnectorSettleStates.mockResolvedValue({
    states: [
      { name: "Active", category: "In progress", done: false },
      { name: "Resolved", category: "Resolved", done: false },
      { name: "In QA", category: "Resolved", done: false },
      { name: "Closed", category: "Done", done: true },
    ],
  });
});

/** Imports one synced Azure DevOps item, in source state Active. */
function importSyncedItem(
  localStore: Awaited<ReturnType<typeof setup>>["localStore"],
) {
  localStore.importConnectorWorkItems([
    {
      id: "connector-1",
      source: "azure_devops",
      connectionId: "ado-1",
      connectionLabel: "Main connection",
      tenantLabel: "Contoso",
      sourceId: "101",
      externalId: "101",
      sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/101",
      title: "Synced",
      projectName: "Mercury",
      workItemType: "Task",
      state: "Active",
      depth: 0,
      selectable: true,
      selected: true,
      childCount: 0,
      pushedAt: 1,
    },
  ]);
  canWriteToSource.mockReturnValue(true);
  return localStore
    .snapshot()
    .workItems.find((item) => item.title === "Synced")!._id;
}

/** Runs the Undo toast's window-closed callback of the last write. */
function closeUndoWindow() {
  offerUndo.mock.calls.at(-1)![1].onWindowClosed?.();
}

describe("agent read tools", () => {
  it("lists projects through the runner", async () => {
    const { call } = await setup();
    const result = await call("list_projects");
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toEqual({
      projects: expect.arrayContaining([
        expect.objectContaining({
          name: "Acme",
          tasks: [expect.objectContaining({ name: "Build" })],
        }),
      ]),
    });
  });

  it("refuses invalid input with the field and reason", async () => {
    const { call } = await setup();
    const result = await call("list_time_entries", {
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
    expect(await call("delete_everything")).toMatchObject({
      ok: false,
      error: "Ajour has no tool named delete_everything.",
    });
  });
});

describe("agent timer and entry tools", () => {
  it("starts an entry on a task, labels the Undo toast and can be undone", async () => {
    const { call, localStore, project, task } = await setup();

    const result = await call("start_timer", {
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
      await call("start_timer", {
        projectId: project._id,
        taskId: task("Old")._id,
      }),
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
      await call("move_entry", { entryId: entry._id, date: "2026-01-05" }),
    ).toMatchObject({ ok: false, error: "Stop the running entry first" });
  });

  it("keeps the task when edit_entry repeats the entry's project", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entry = localStore.snapshot().timesheetEntries[0]!;

    expect(
      await call("edit_entry", {
        entryId: entry._id,
        projectId: project._id,
        note: "Renamed",
      }),
    ).toMatchObject({ ok: true });
    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      taskId: task("Build")._id,
      note: "Renamed",
    });
  });

  it("drops the task when edit_entry moves the entry to another project", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.addProject({ name: "Other", color: "#654321" });
    const other = localStore
      .snapshot()
      .projects.find((candidate) => candidate.name === "Other")!;
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entry = localStore.snapshot().timesheetEntries[0]!;

    expect(
      await call("edit_entry", { entryId: entry._id, projectId: other._id }),
    ).toMatchObject({ ok: true });
    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      projectId: other._id,
    });
    expect(localStore.snapshot().timesheetEntries[0]!.taskId).toBeUndefined();
  });

  it("keeps the task when edit_running_entry repeats the current project", async () => {
    const { call, localStore, project, task } = await setup();
    await call("start_timer", {
      projectId: project._id,
      taskId: task("Build")._id,
    });

    expect(
      await call("edit_running_entry", {
        projectId: project._id,
        note: "Renamed",
      }),
    ).toMatchObject({ ok: true });
    expect(localStore.snapshot().timers[0]).toMatchObject({
      taskId: task("Build")._id,
      note: "Renamed",
    });
  });

  it("lists a new entry as added, commits it, then lists no change", async () => {
    const { call, readChange, project, task } = await setup();
    const created = await call("create_entry", {
      date: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      minutes: 90,
      note: "Workshop",
    });
    const entryId = (created as { output: { entryId: string } }).output.entryId;

    expect(
      await call("get_week_changes", { weekOf: "2026-10-14" }),
    ).toMatchObject({
      ok: true,
      output: {
        changes: [
          {
            change: "added",
            entryId,
            externalId: expect.stringMatching(/^ajour:[0-9a-f]{8}$/),
            version: expect.stringMatching(/^v:[0-9a-f]{8}$/),
            current: { date: "2026-10-13", hours: 1.5, note: "Workshop" },
          },
        ],
      },
    });
    expect(
      await call("mark_entries_committed", {
        changes: [await readChange(entryId)],
      }),
    ).toMatchObject({ ok: true, output: { committed: 1 } });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Marked 1 change as committed",
    );
    expect(
      await call("get_week_changes", { weekOf: "2026-10-14" }),
    ).toMatchObject({
      ok: true,
      output: { changes: [] },
    });
    expect(
      await call("list_time_entries", { from: "2026-10-12", to: "2026-10-18" }),
    ).toMatchObject({
      ok: true,
      output: { entries: [{ entryId, state: "committed" }] },
    });
  });

  it("commits a deleted entry by clearing its tombstone", async () => {
    const { call, readChange, localStore, project, task } = await setup();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    localStore.markTimesheetEntriesCommitted([entryId]);
    localStore.deleteTimesheetEntry(entryId);

    expect(
      await call("get_week_changes", { weekOf: "2026-10-13" }),
    ).toMatchObject({
      ok: true,
      output: {
        changes: [{ change: "deleted", entryId, committed: { hours: 0.5 } }],
      },
    });
    expect(
      await call("mark_entries_committed", {
        changes: [await readChange(entryId)],
      }),
    ).toMatchObject({ ok: true, output: { committed: 1 } });
    expect(localStore.snapshot().timesheetTombstones).toEqual([]);
  });

  it("refuses an id that is neither an entry nor a deleted entry", async () => {
    const { call } = await setup();

    expect(
      await call("mark_entries_committed", {
        changes: [{ entryId: "nope", version: "v:00000000" }],
      }),
    ).toMatchObject({
      ok: false,
      error:
        "No entry or deleted entry has the id nope. Call get_week_changes.",
    });
  });

  /** Saves an entry of 30 minutes on Monday and returns its id. */
  function saveEntry(
    localStore: Awaited<ReturnType<typeof setup>>["localStore"],
    projectId: string,
  ) {
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId,
      durationMs: 30 * 60_000,
    });
    return localStore.snapshot().timesheetEntries.at(-1)!._id;
  }

  it("refuses a change the user edited since the agent read it, and writes nothing", async () => {
    const { call, readChange, localStore, project } = await setup();
    const entryId = saveEntry(localStore, project._id);
    const read = await readChange(entryId);
    localStore.updateTimesheetEntry(entryId, {
      projectId: project._id,
      durationMs: 45 * 60_000,
    });
    const before = localStore.snapshot();

    expect(
      await call("mark_entries_committed", { changes: [read] }),
    ).toMatchObject({
      ok: false,
      error: `${entryId} changed since you read it. Call get_week_changes again and apply its current values.`,
    });
    expect(localStore.snapshot().timesheetEntries).toEqual(
      before.timesheetEntries,
    );
    expect(localStore.snapshot().timesheetEntries[0]!.commit).toBeUndefined();
  });

  it("refuses a change whose entry the user deleted since the agent read it", async () => {
    const { call, readChange, localStore, project } = await setup();
    const entryId = saveEntry(localStore, project._id);
    localStore.markTimesheetEntriesCommitted([entryId]);
    localStore.updateTimesheetEntry(entryId, {
      projectId: project._id,
      durationMs: 45 * 60_000,
    });
    const read = await readChange(entryId);
    localStore.deleteTimesheetEntry(entryId);

    expect(
      await call("mark_entries_committed", { changes: [read] }),
    ).toMatchObject({ ok: false, error: expect.stringContaining(entryId) });
    expect(localStore.snapshot().timesheetTombstones).toHaveLength(1);
  });

  it("refuses a deleted change once undo restored the entry", async () => {
    const { call, readChange, localStore, project } = await setup();
    const entryId = saveEntry(localStore, project._id);
    localStore.markTimesheetEntriesCommitted([entryId]);
    const undoToken = localStore.deleteTimesheetEntry(entryId)!;
    const read = await readChange(entryId);
    localStore.undo(undoToken);

    expect(
      await call("mark_entries_committed", { changes: [read] }),
    ).toMatchObject({
      ok: false,
      error: `${entryId} changed since you read it. Call get_week_changes again and apply its current values.`,
    });
    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);
  });

  it("refuses a whole call when one of its changes is stale, naming each stale id", async () => {
    const { call, readChange, localStore, project } = await setup();
    const good = saveEntry(localStore, project._id);
    const staleA = saveEntry(localStore, project._id);
    const staleB = saveEntry(localStore, project._id);
    const changes = [
      await readChange(good),
      await readChange(staleA),
      await readChange(staleB),
    ];
    for (const entryId of [staleA, staleB]) {
      localStore.updateTimesheetEntry(entryId, {
        projectId: project._id,
        note: "Edited",
        durationMs: 30 * 60_000,
      });
    }

    expect(await call("mark_entries_committed", { changes })).toMatchObject({
      ok: false,
      error: `${staleA}, ${staleB} changed since you read it. Call get_week_changes again and apply its current values.`,
    });
    expect(
      localStore.snapshot().timesheetEntries.every((entry) => !entry.commit),
    ).toBe(true);
  });

  it("leaves out the changes the user unchecked on the Commit page", async () => {
    const { call, localStore, project } = await setup();
    const { setChangesChecked } = await import("@/lib/commit-selection");
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      durationMs: 30 * 60_000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    setChangesChecked("2026-10-12", [entryId], false);

    expect(
      await call("get_week_changes", { weekOf: "2026-10-13" }),
    ).toMatchObject({
      ok: true,
      output: { changes: [] },
    });
    expect(
      await call("get_week_changes", {
        weekOf: "2026-10-13",
        onlyChecked: false,
      }),
    ).toMatchObject({
      ok: true,
      output: { changes: [{ entryId, checked: false }] },
    });
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
      await call("create_entry", { ...entry, workItemId: workItem._id }),
    ).toMatchObject({ ok: false, error: "Restore the item first" });
    expect(
      await call("create_entry", { ...entry, workItemId: "missing" }),
    ).toMatchObject({
      ok: false,
      error: "No backlog item has the id missing. Call list_work_items.",
    });
    expect(localStore.snapshot().timesheetEntries).toHaveLength(0);
  });

  it("stops the running entry", async () => {
    const { call, localStore, project } = await setup();
    await call("start_timer", { projectId: project._id });
    expect(await call("stop_timer")).toMatchObject({ ok: true });
    expect(localStore.snapshot().timers).toHaveLength(0);
    expect(await call("stop_timer")).toMatchObject({
      ok: false,
      error: "No entry is running.",
    });
  });

  it("duplicates an entry to another day and keeps the original", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entry = localStore.snapshot().timesheetEntries[0]!;

    expect(
      await call("duplicate_entry", { entryId: entry._id, date: "2026-10-14" }),
    ).toMatchObject({
      ok: true,
      output: { date: "2026-10-14", minutes: 30, state: "saved" },
    });
    expect(
      localStore
        .snapshot()
        .timesheetEntries.map((candidate) => candidate.localDate)
        .sort(),
    ).toEqual(["2026-10-13", "2026-10-14"]);
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Duplicated an entry",
    );
  });
});

describe("agent tools on submitted weeks", () => {
  // Thursday, October 15, 2026: today is in the week of the 12th.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 15));
  });
  afterEach(() => vi.useRealTimers());

  /** One committed 90-minute entry on Tuesday the 13th. */
  async function committedWeek() {
    const context = await setup();
    const created = await context.call("create_entry", {
      date: "2026-10-13",
      projectId: context.project._id,
      taskId: context.task("Build")._id,
      minutes: 90,
      note: "Workshop",
    });
    const entryId = (created as { output: { entryId: string } }).output.entryId;
    return { ...context, entryId };
  }

  it("reports the status, and submits the week once every change is committed", async () => {
    const { call, readChange, entryId } = await committedWeek();

    expect(
      await call("get_week_status", { weekOf: "2026-10-18" }),
    ).toMatchObject({
      ok: true,
      output: { weekOf: "2026-10-12", locked: false, uncommittedChanges: 1 },
    });
    expect(await call("submit_week", { weekOf: "2026-10-14" })).toMatchObject({
      ok: false,
      error:
        "Commit your changes first. The week of 2026-10-12 has 1 change that is not committed.",
    });

    await call("mark_entries_committed", {
      changes: [await readChange(entryId)],
    });

    expect(
      await call("get_week_status", { weekOf: "2026-10-12" }),
    ).toMatchObject({
      ok: true,
      output: {
        uncommittedChanges: 0,
        committedHoursByDay: expect.arrayContaining([
          { date: "2026-10-13", hours: 1.5 },
        ]),
        committedEntries: [
          {
            entryId,
            externalId: expect.stringMatching(/^ajour:[0-9a-f]{8}$/),
            committed: { date: "2026-10-13", hours: 1.5, note: "Workshop" },
          },
        ],
        pace: { loggedHours: 1.5, status: "under" },
      },
    });
    // A Sunday locks its Monday's week.
    expect(await call("submit_week", { weekOf: "2026-10-18" })).toMatchObject({
      ok: true,
      output: { weekOf: "2026-10-12", locked: true },
    });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Submitted the week",
    );
    expect(
      await call("get_week_status", { weekOf: "2026-10-12" }),
    ).toMatchObject({
      ok: true,
      output: { locked: true },
    });
  });

  it("refuses every entry write to a submitted week, with the reason", async () => {
    const { call, readChange, localStore, project, entryId } =
      await committedWeek();
    await call("mark_entries_committed", {
      changes: [await readChange(entryId)],
    });
    await call("submit_week", { weekOf: "2026-10-12" });
    const reason =
      "The week of 2026-10-12 is submitted. Reopen it to change it.";

    for (const [tool, input] of [
      [
        "create_entry",
        { date: "2026-10-16", projectId: project._id, minutes: 30 },
      ],
      ["edit_entry", { entryId, minutes: 30 }],
      ["move_entry", { entryId, date: "2026-10-20" }],
      ["duplicate_entry", { entryId }],
      [
        "mark_entries_committed",
        { changes: [{ entryId, version: "v:00000000" }] },
      ],
      ["start_timer", { projectId: project._id }],
    ] as const) {
      expect(await call(tool, input), tool).toMatchObject({
        ok: false,
        error: reason,
      });
    }
    expect(localStore.snapshot().timers).toEqual([]);
    // A copy to an open week leaves the submitted entry as it is.
    expect(
      await call("duplicate_entry", { entryId, date: "2026-10-20" }),
    ).toMatchObject({ ok: true, output: { date: "2026-10-20" } });
  });
});

describe("agent work item tools", () => {
  it("creates an item and moves it to a done state, which closes it", async () => {
    const { call, localStore } = await setup();
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!;

    const created = await call("create_work_item", { title: "Write the spec" });
    const workItemId = (created as { output: { workItemId: string } }).output
      .workItemId;
    const moved = await call("move_work_item", {
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

    expect(
      await call("settle_work_item", { workItemId: parentId }),
    ).toMatchObject({
      ok: false,
      error:
        "This item has 1 open subitem. Call again with includeSubitems true or false.",
    });
    expect(
      await call("settle_work_item", {
        workItemId: parentId,
        includeSubitems: true,
      }),
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
      await call("snooze_work_item", {
        workItemId,
        until: "2020-01-01T09:00:00Z",
      }),
    ).toMatchObject({ ok: false, error: "Pick a time in the future." });
  });

  it("settles a synced item in the source state the agent picks, and writes it after the Undo window", async () => {
    const { call, localStore } = await setup();
    const workItemId = importSyncedItem(localStore);

    expect(await call("settle_work_item", { workItemId })).toMatchObject({
      ok: false,
      error:
        "This item's source asks which state it settles in. Call again with sourceState, one of: Active, Resolved, In QA, Closed.",
    });
    expect(
      await call("settle_work_item", { workItemId, sourceState: "in qa" }),
    ).toMatchObject({ ok: true, output: { status: "settled" } });
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === workItemId)!;
    expect(item.pendingSourceWrite).toMatchObject({ state: "In QA" });
    expect(sendPendingSourceWrites).not.toHaveBeenCalled();
    closeUndoWindow();
    expect(sendPendingSourceWrites).toHaveBeenCalledWith([workItemId]);
  });

  it("moves a synced item in the source state the agent picks when its workflow state stands for several", async () => {
    const { call, localStore } = await setup();
    const workItemId = importSyncedItem(localStore);
    const review = localStore.addWorkflowState("Review", "#2563eb");
    for (const sourceStatusLabel of ["Resolved", "In QA"]) {
      localStore.setWorkflowStateMapping({
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: sourceStatusLabel.toLowerCase(),
        sourceStatusLabel,
        workflowStateId: review,
      });
    }
    localStore.setWorkflowStateWriteRule({
      source: "azure_devops",
      connectionId: "ado-1",
      workflowStateId: review,
      write: { kind: "ask" },
    });

    expect(
      await call("move_work_item", { workItemId, workflowStateId: review }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Call again with sourceState, one of:"),
    });
    expect(
      await call("move_work_item", {
        workItemId,
        workflowStateId: review,
        sourceState: "In QA",
      }),
    ).toMatchObject({ ok: true, output: { workflowState: "Review" } });
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === workItemId)!;
    expect(item.pendingSourceWrite).toMatchObject({ state: "In QA" });
    closeUndoWindow();
    expect(sendPendingSourceWrites).toHaveBeenCalledWith([workItemId]);
  });

  it("settles a synced item locally, then unsettles it", async () => {
    const { call, localStore } = await setup();
    const workItemId = importSyncedItem(localStore);
    // Its connector can't write, so Settle stays in Ajour.
    canWriteToSource.mockReturnValue(false);

    expect(await call("settle_work_item", { workItemId })).toMatchObject({
      ok: true,
      output: { status: "settled" },
    });
    expect(await call("unsettle_work_item", { workItemId })).toMatchObject({
      ok: true,
      output: { status: "active" },
    });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Unsettled a backlog item",
    );
  });

  it("ends a snooze early", async () => {
    const { call, localStore } = await setup();
    const workItemId = localStore.addWorkItem({ title: "Later" });
    const until = new Date(Date.now() + 86_400_000).toISOString();

    expect(await call("snooze_work_item", { workItemId, until })).toMatchObject(
      { ok: true, output: { snoozedUntil: until } },
    );
    const unsnoozed = await call("unsnooze_work_item", { workItemId });
    expect(unsnoozed).toMatchObject({ ok: true });
    expect(unsnoozed.ok && unsnoozed.output).not.toHaveProperty("snoozedUntil");
  });

  it("archives a synced item and refuses Archive on a manual one", async () => {
    const { call, localStore } = await setup();
    const workItemId = importSyncedItem(localStore);
    const manualId = localStore.addWorkItem({ title: "Manual" });

    expect(await call("archive_work_item", { workItemId })).toMatchObject({
      ok: true,
      output: { status: "archived" },
    });
    expect(
      await call("archive_work_item", { workItemId: manualId }),
    ).toMatchObject({ ok: false });
  });

  it("gives the action set's reason when the item is archived", async () => {
    const { call, localStore } = await setup();
    const workItemId = localStore.addWorkItem({ title: "Old" });
    await call("settle_work_item", { workItemId });

    expect(
      await call("edit_work_item", { workItemId, title: "New" }),
    ).toMatchObject({
      ok: false,
      error: "Restore the item first",
    });
    expect(await call("restore_work_item", { workItemId })).toMatchObject({
      ok: true,
      output: { status: "active" },
    });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Restored a backlog item",
    );
  });

  it("drops the old task when an edit changes the project", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.addProject({ name: "Other", color: "#654321" });
    const other = localStore
      .snapshot()
      .projects.find((candidate) => candidate.name === "Other")!;
    const workItemId = localStore.addWorkItem({
      title: "Mapped",
      projectId: project._id,
      taskId: task("Build")._id,
    });

    expect(
      await call("edit_work_item", { workItemId, projectId: other._id }),
    ).toMatchObject({ ok: true });
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === workItemId)!;
    expect(item.projectId).toBe(other._id);
    expect(item.taskId).toBeUndefined();
  });

  it("keeps the task when an item edit repeats its current project", async () => {
    const { call, localStore, project, task } = await setup();
    const workItemId = localStore.addWorkItem({
      title: "Mapped",
      projectId: project._id,
      taskId: task("Build")._id,
    });

    expect(
      await call("edit_work_item", {
        workItemId,
        projectId: project._id,
        title: "Renamed",
      }),
    ).toMatchObject({ ok: true });
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === workItemId)!;
    expect(item.taskId).toBe(task("Build")._id);
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
      await call("create_work_item", {
        title: "Deep",
        parentWorkItemId: childId,
      }),
    ).toMatchObject({ ok: false, error: "Subitems can't have subitems" });
    expect(
      await call("create_work_item", {
        title: "Done",
        workflowStateId: done._id,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("done state"),
    });
  });
});
