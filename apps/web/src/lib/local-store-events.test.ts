import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "ajour.local-state.v2";

function installMockWindow() {
  const storage = new Map<string, string>();
  const createStorage = (target: Map<string, string>) => ({
    get length() {
      return target.size;
    },
    key: (index: number) => Array.from(target.keys())[index] ?? null,
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => {
      target.set(key, value);
    },
    removeItem: (key: string) => {
      target.delete(key);
    },
    clear: () => target.clear(),
  });
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(storage),
      sessionStorage: createStorage(new Map()),
    },
  });
  return {
    storage,
    /** Fires a browser event at the window's listeners, as another window's write does. */
    fire(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

/** The store and the renderer's emitter, fresh, with events going to a recording sink. */
async function loadStore() {
  const sink = createRecordingSink<AjourEvent>();
  const events = await import("./wide-events");
  events.replaceEventSink(sink);
  const { localStore } = await import("./local-store");
  return { sink, localStore, events: events.wideEvents };
}

describe("store command events", () => {
  let browser: ReturnType<typeof installMockWindow>;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    browser = installMockWindow();
  });

  it("emits one command event, named from the command table, for each store command", async () => {
    const { sink, localStore } = await loadStore();

    localStore.startTimer({ projectId: "project_1", note: "Planning" });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "time_entry.start",
      kind: "command",
      runtime: "renderer",
      outcome: "ok",
      trigger: "user",
      counts: { store_write_count: 1 },
    });
    expect(sink.events[0]!.counts!.store_write_bytes).toBe(
      browser.storage.get(STORAGE_KEY)!.length * 2,
    );
  });

  it("reports noop for a command that writes nothing", async () => {
    const { sink, localStore } = await loadStore();

    localStore.saveTimer("no_such_timer");

    expect(sink.events).toMatchObject([
      { name: "time_entry.stop", outcome: "noop" },
    ]);
    expect(sink.events[0]!.counts).toBeUndefined();
  });

  it("reports two writes on one event when a command writes twice", async () => {
    const { sink, localStore } = await loadStore();
    const doing = localStore.addWorkflowState("Doing", "#d97706");
    const itemId = localStore.addWorkItem({ title: "Two writes" });
    sink.events.length = 0;

    localStore.moveWorkItemToState(itemId, doing, {
      edits: { title: "Renamed" },
    });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "backlog_item.move",
      outcome: "ok",
      counts: { store_write_count: 2 },
    });
  });

  it("records a write to a submitted week as refused for locked_week", async () => {
    browser.storage.set(
      STORAGE_KEY,
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "api",
            localDate: "2026-10-06",
            label: "",
            durationMs: 3_600_000,
            sourceBlockIds: [],
          },
        ],
        lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 2 }],
      }),
    );
    const { sink, localStore } = await loadStore();

    expect(() => localStore.deleteTimesheetEntry("api")).toThrow();

    expect(sink.events).toMatchObject([
      {
        name: "time_entry.delete",
        outcome: "refused",
        outcome_reason: "locked_week",
        error: { type: "LockedWeekError" },
      },
    ]);
    expect(sink.events[0]!.counts).toBeUndefined();
  });

  it("records a write from a stale window as refused for stale_window", async () => {
    const { sink, localStore } = await loadStore();
    localStore.startTimer({});
    const stored = JSON.parse(browser.storage.get(STORAGE_KEY)!);
    browser.storage.set(
      STORAGE_KEY,
      JSON.stringify({
        ...stored,
        lockedWeeks: [{ weekOf: "2020-01-06", lockedAt: 9 }],
        revision: "other-window",
      }),
    );
    browser.storage.set("ajour.local-state.revision", "other-window");
    sink.events.length = 0;

    expect(() =>
      localStore.addProject({ name: "Late", color: "#000" }),
    ).toThrow("Ajour changed in another window");

    expect(sink.events).toMatchObject([
      {
        name: "project.create",
        outcome: "refused",
        outcome_reason: "stale_window",
        store: { revision_changed: true },
      },
    ]);
  });

  it("folds a store command run inside another unit into it", async () => {
    const { sink, localStore, events } = await loadStore();

    events.run("calendar.fetch", { kind: "job", trigger: "schedule" }, () => {
      localStore.addWorkItem({ title: "First" });
      localStore.addWorkItem({ title: "Second" });
    });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "calendar.fetch",
      kind: "job",
      steps: ["backlog_item.create", "backlog_item.create"],
      counts: { store_write_count: 2 },
    });
  });

  it("folds a store command into an async unit that re-enters its scope after an await", async () => {
    const { sink, localStore, events } = await loadStore();

    const sync = events.start("calendar.fetch", {
      kind: "job",
      trigger: "schedule",
    });
    await Promise.resolve();
    sync.enter(() => localStore.addWorkItem({ title: "After the await" }));
    sync.end();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "calendar.fetch",
      steps: ["backlog_item.create"],
      counts: { store_write_count: 1 },
    });
  });

  it("lists a refused command that folded into another unit in its step failures", async () => {
    browser.storage.set(
      STORAGE_KEY,
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "api",
            localDate: "2026-10-06",
            label: "",
            durationMs: 3_600_000,
            sourceBlockIds: [],
          },
        ],
        lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 2 }],
      }),
    );
    const { sink, localStore, events } = await loadStore();

    events.run("calendar.fetch", { kind: "job", trigger: "schedule" }, () => {
      try {
        localStore.deleteTimesheetEntry("api");
      } catch {
        // The sync goes on.
      }
    });

    expect(sink.events).toMatchObject([
      {
        name: "calendar.fetch",
        outcome: "ok",
        step_failures: [
          {
            name: "time_entry.delete",
            outcome: "refused",
            outcome_reason: "locked_week",
          },
        ],
      },
    ]);
  });

  it("adds what an undoable action changed, per local state list, and that Undo was offered", async () => {
    const { sink, localStore } = await loadStore();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-06",
      durationMs: 600,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    sink.events.length = 0;

    localStore.deleteTimesheetEntry(entryId);

    expect(sink.events).toMatchObject([
      {
        name: "time_entry.delete",
        outcome: "ok",
        store: { undo_offered: true },
        counts: { store_write_count: 1, changed_time_entry_count: 1 },
      },
    ]);
  });

  it("emits undo.restore with the records it restored", async () => {
    const { sink, localStore } = await loadStore();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-06",
      durationMs: 600,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    const token = localStore.deleteTimesheetEntry(entryId)!;
    sink.events.length = 0;

    expect(localStore.undo(token)).toBe("restored");

    expect(sink.events).toMatchObject([
      {
        name: "undo.restore",
        kind: "command",
        outcome: "ok",
        undo: { result: "restored" },
        counts: { changed_time_entry_count: 1 },
      },
    ]);
  });

  it("records why an Undo was refused: expired, or changed since", async () => {
    const { sink, localStore } = await loadStore();
    const token = localStore.updateProjectWithUndo(
      localStore.snapshot().projects[0]!._id,
      { color: "#123456" },
    )!;
    localStore.updateProject(localStore.snapshot().projects[0]!._id, {
      color: "#654321",
    });
    sink.events.length = 0;

    expect(localStore.undo(token)).toBe("stale");
    expect(localStore.undo("undo_gone")).toBe("expired");

    expect(sink.events).toMatchObject([
      {
        name: "undo.restore",
        outcome: "refused",
        outcome_reason: "changed_since",
        undo: { result: "stale" },
      },
      {
        name: "undo.restore",
        outcome: "refused",
        outcome_reason: "expired",
        undo: { result: "expired" },
      },
    ]);
  });
});

describe("store command catalog fields", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    installMockWindow();
  });

  const eventNamed = (
    events: readonly AjourEvent[],
    name: AjourEvent["name"],
  ) => events.filter((event) => event.name === name);

  it("start and stop name the entry, its project and the time counted", async () => {
    const { sink, localStore } = await loadStore();
    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.startTimer({ projectId, accumulatedDurationMs: 1_000 });
    const firstId = localStore.snapshot().timers[0]!._id;

    localStore.startTimer({ projectId });
    const secondId = localStore.snapshot().timers[0]!._id;
    localStore.saveTimer(secondId);

    expect(eventNamed(sink.events, "time_entry.start")).toMatchObject([
      {
        time_entry: {
          id: firstId,
          project_id: projectId,
          replaced_running: false,
          counted_ms: 1_000,
        },
      },
      { time_entry: { id: secondId, replaced_running: true, counted_ms: 0 } },
    ]);
    const [stop] = eventNamed(sink.events, "time_entry.stop");
    expect(stop!.time_entry).toMatchObject({
      id: localStore.snapshot().timesheetEntries.at(-1)!._id,
    });
    expect(stop!.time_entry!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("create and update name the entry, its day, durations and what changed, never its note", async () => {
    const { sink, localStore } = await loadStore();
    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.saveManualTimeEntry({
      localDate: "2026-10-06",
      projectId,
      note: "Secret client meeting",
      durationMs: 600_000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    localStore.updateTimesheetEntry(entryId, {
      projectId,
      note: "Renamed",
      durationMs: 900_000,
    });

    expect(eventNamed(sink.events, "time_entry.create")).toMatchObject([
      {
        time_entry: {
          id: entryId,
          project_id: projectId,
          day: "2026-10-06",
          duration_ms: 600_000,
        },
      },
    ]);
    expect(eventNamed(sink.events, "time_entry.update")).toMatchObject([
      {
        time_entry: {
          id: entryId,
          running: false,
          changed_fields: ["note", "duration"],
          duration_before_ms: 600_000,
          duration_after_ms: 900_000,
        },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Secret");
  });

  it("lets the code around a command open its event to add what only it knows", async () => {
    const { sink, localStore } = await loadStore();
    const { runStoreCommand } = await import("./store-command-events");

    runStoreCommand("time_entry.create", (unit) => {
      localStore.saveManualTimeEntry({
        localDate: "2026-10-06",
        durationMs: 60_000,
      });
      unit.set({ time_entry: { host: "grid_cell" } });
    });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "time_entry.create",
      time_entry: { host: "grid_cell", day: "2026-10-06" },
      counts: { store_write_count: 1 },
    });
    expect(sink.events[0]!.steps).toBeUndefined();
  });

  it("submit week records its week and result, or why it was refused", async () => {
    const { sink, localStore } = await loadStore();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-06",
      durationMs: 60_000,
    });

    localStore.submitWeek("2026-10-08");
    localStore.markTimesheetEntriesCommitted(
      localStore.snapshot().timesheetEntries.map((entry) => entry._id),
    );
    localStore.submitWeek("2026-10-08");

    expect(eventNamed(sink.events, "week.submit")).toMatchObject([
      {
        outcome: "noop",
        week: {
          week_of: "2026-10-08",
          result: "uncommitted_changes",
          uncommitted_count: 1,
        },
      },
      {
        outcome: "ok",
        week: { week_of: "2026-10-05", result: "submitted" },
        store: { undo_offered: true },
        counts: { changed_submitted_week_count: 1 },
      },
    ]);
  });

  it("settle and move name the item, its workflow states and what came along", async () => {
    const { sink, localStore } = await loadStore();
    const doing = localStore.addWorkflowState("Doing", "#d97706");
    const done = localStore.addWorkflowState("Shipped", "#16a34a");
    localStore.updateWorkflowState(done, { name: "Shipped", done: true });
    const itemId = localStore.addWorkItem({
      title: "Hidden title",
      workflowStateId: doing,
    });
    const otherId = localStore.addWorkItem({ title: "Other" });

    localStore.moveWorkItemToState(itemId, done, { includeSubitems: false });
    localStore.settleWorkItem(otherId, undefined, { includeSubitems: true });

    expect(eventNamed(sink.events, "backlog_item.move")).toMatchObject([
      {
        backlog_item: {
          id: itemId,
          workflow_state_from: doing,
          workflow_state_to: done,
          closed: true,
          reopened: false,
          subitems_included: false,
          source_writes_queued: 0,
          result: "moved",
        },
      },
    ]);
    expect(eventNamed(sink.events, "backlog_item.settle")).toMatchObject([
      {
        backlog_item: {
          id: otherId,
          state_changed: false,
          priority_changed: false,
          subitems_included: true,
          archived: true,
        },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Hidden title");
  });

  it("share names the project, the connection and the result", async () => {
    const { sink, localStore } = await loadStore();
    const projectId = localStore.snapshot().projects[0]!._id;

    localStore.shareProjectWithTeam("team_connection", projectId);

    expect(eventNamed(sink.events, "project.share")).toMatchObject([
      {
        outcome: "noop",
        project: { id: projectId },
        connection: { id: "team_connection" },
        share: { result: "not_synced" },
      },
    ]);
  });

  it("suggestion add counts the entries, the remembered meetings and their projects", async () => {
    const { sink, localStore } = await loadStore();
    const projectId = localStore.snapshot().projects[0]!._id;
    const suggestion = {
      pluginId: "calendar-plugin",
      connectionId: "calendar-1",
      connectionLabel: "Work calendar",
      key: "k1",
      occurrenceKey: "o1",
      seriesId: "series-1",
      localDate: "2026-10-06",
      startsAt: 1,
      endsAt: 2,
      durationMs: 1_800_000,
      title: "Board meeting",
      untitled: false,
      allDay: false,
    };

    localStore.acceptCalendarSuggestions([
      { suggestion, projectId, remember: true },
    ]);

    expect(eventNamed(sink.events, "suggestion.add")).toMatchObject([
      {
        suggestion: {
          count: 1,
          skipped_count: 0,
          remembered_series_count: 1,
          project_ids: [projectId],
        },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Board meeting");
    expect(JSON.stringify(sink.events)).not.toContain("Work calendar");
  });

  it("the imports count their rows, conflicts and what they committed", async () => {
    const { sink, localStore } = await loadStore();
    const projectId = localStore.snapshot().projects[0]!._id;

    localStore.stageTimesheetImportRows([
      { date: "2026-10-06", project: "Internal", task: "Admin", hours: 1 },
      { date: "2026-10-07", project: "Internal", task: "Admin", hours: 2 },
    ]);
    localStore.commitReadyTimesheetImportDrafts();
    localStore.importProjectTasks(projectId, ["Design", "Design", ""]);
    localStore.importProjectWorkbookRows([
      {
        project: "Atlas",
        code: "",
        color: "",
        status: "active",
        task: "Build",
      },
    ] as never);

    expect(eventNamed(sink.events, "timesheet_import.stage")).toMatchObject([
      { timesheet_import: { row_count: 2, conflict_count: 0 } },
    ]);
    expect(eventNamed(sink.events, "timesheet_import.commit")).toMatchObject([
      { timesheet_import: { committed_count: 2 } },
    ]);
    expect(eventNamed(sink.events, "task.import")).toMatchObject([
      {
        project: { id: projectId },
        task_import: { imported_count: 1, duplicate_count: 1, blank_count: 1 },
      },
    ]);
    expect(eventNamed(sink.events, "project.import")).toMatchObject([
      { project_import: { schema: "default", row_count: 1 } },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Atlas");
  });
});

describe("preferences, reloads and boot", () => {
  let browser: ReturnType<typeof installMockWindow>;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    browser = installMockWindow();
  });

  it("records the user preferences that changed, with their enum and numeric values", async () => {
    const { sink, localStore } = await loadStore();

    localStore.setUserPreferences({
      themeMode: "dark",
      paceTolerancePercent: 15,
      commitLinesNameSource: "Client name field",
      hideNonWorkingDays: false,
    });
    localStore.setUserPreferences({ themeMode: "dark" });

    expect(sink.events).toMatchObject([
      {
        name: "preferences.update",
        kind: "command",
        outcome: "ok",
        preferences: {
          scope: "user",
          setting: "user_preferences",
          changed_keys: [
            "themeMode",
            "paceTolerancePercent",
            "commitLinesNameSource",
          ],
          values: { themeMode: "dark", paceTolerancePercent: 15 },
        },
      },
      { name: "preferences.update", outcome: "noop" },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Client name field");
  });

  it("records a change of a device UI setting, never a filter's text", async () => {
    const { sink } = await loadStore();
    const { updateBacklogView } = await import("./backlog-view-settings");
    const { updateSidebarLayout } = await import("./sidebar-layout");
    const { setSidePanelWidth, saveSidePanelWidths } =
      await import("./side-panel-width");

    updateBacklogView({
      layout: "board",
      filters: [{ field: "project", value: "Secret project" }],
    } as never);
    updateSidebarLayout({ density: "compact" });
    setSidePanelWidth("time", 400, { save: false });
    setSidePanelWidth("time", 420, { save: false });
    saveSidePanelWidths();

    expect(sink.events).toMatchObject([
      {
        name: "preferences.update",
        preferences: {
          scope: "device",
          setting: "backlog_view",
          changed_keys: ["layout", "filters"],
          values: { layout: "board" },
        },
      },
      {
        preferences: {
          setting: "sidebar_layout",
          changed_keys: ["density"],
          values: { density: "compact" },
        },
      },
      {
        preferences: {
          setting: "side_panel_width",
          changed_keys: ["time"],
          values: { time: 420 },
        },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Secret project");
  });

  it("emits local_state.reload when another window writes", async () => {
    const { sink, localStore } = await loadStore();
    localStore.subscribe(() => undefined);
    localStore.snapshot();
    browser.storage.set(
      STORAGE_KEY,
      JSON.stringify({ revision: "other-window", projects: [] }),
    );

    browser.fire("storage", { key: STORAGE_KEY });
    browser.fire("storage", { key: null });

    expect(sink.events).toMatchObject([
      {
        name: "local_state.reload",
        kind: "job",
        trigger: "system",
        local_state: { revision_changed: true, storage_cleared: false },
      },
      {
        name: "local_state.reload",
        local_state: { revision_changed: false, storage_cleared: true },
      },
    ]);
  });
});
