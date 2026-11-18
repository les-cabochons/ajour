// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { LocalLogSettings } from "@ajour/wide-events/local-log-file.ts";
import type {
  DesktopLogFilter,
  DesktopLogPage,
  DesktopLogQueryResult,
  DesktopLogsStatus,
  LoggedEvent,
} from "@/lib/desktop-bridge";
import { localStore } from "@/lib/local-store";
import {
  installDomShims,
  renderRoutes,
  stubNarrowView,
} from "@/test-support/dom";
import {
  SettingsSearchProvider,
  useSettingsWindowLocation,
} from "./settings-link";
import { SettingsDiagnosticsPage } from "./settings-diagnostics-page";

/*
 * Diagnostics > Events (#443) in the Settings window, against a query
 * service that filters and pages as main's does (local-log-query.cjs), and a
 * tail that delivers what the test writes.
 */

const overview = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  getCachedPluginsOverview: () => overview.value,
  getPluginsOverview: async () => overview.value,
  subscribePluginsOverview: () => () => {},
}));

beforeAll(installDomShims);

const THIS_LAUNCH = "launch-now";
const OLD_LAUNCH = "launch-old";
const TRACE_A = "0af7651916cd43dd8448eb211c80319c";
const TRACE_B = "1bf7651916cd43dd8448eb211c80319d";
const MINUTE = 60_000;

let span = 0;
/** An event that started `minutesAgo` before now, as the file holds it. */
function logged(
  name: string,
  fields: Partial<LoggedEvent> & { minutesAgo?: number } = {},
): LoggedEvent {
  const { minutesAgo = 1, ...rest } = fields;
  span += 1;
  return {
    schema: 1,
    name,
    kind: "command",
    runtime: "renderer",
    outcome: "ok",
    started_at: new Date(Date.now() - minutesAgo * MINUTE).toISOString(),
    duration_ms: 12,
    trace_id: TRACE_A,
    span_id: span.toString(16).padStart(16, "0"),
    trigger: "user",
    launch_id: THIS_LAUNCH,
    app: { version: "1.2.3", channel: "stable", packaged: true },
    device: { platform: "win32" },
    ...rest,
  } as LoggedEvent;
}

const isProblem = (outcome: string) => outcome !== "ok" && outcome !== "noop";
const list = <T,>(value: T | T[] | undefined) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** Main's `matches`, over whole events. */
function passes(event: LoggedEvent, filter: DesktopLogFilter) {
  const started = Date.parse(event.started_at);
  const runtimes = list(filter.runtime);
  const kinds = list(filter.kind);
  const outcomes =
    filter.outcome === "problems" ? undefined : list(filter.outcome);
  const connection = (event.connection as { id?: string } | undefined)?.id;
  const plugin = (event.plugin as { id?: string } | undefined)?.id;
  return (
    (filter.from === undefined || started >= Date.parse(filter.from)) &&
    (filter.to === undefined || started < Date.parse(filter.to)) &&
    (filter.launch_id === undefined || event.launch_id === filter.launch_id) &&
    (!runtimes || runtimes.includes(event.runtime)) &&
    (!kinds || kinds.includes(event.kind)) &&
    (filter.outcome !== "problems" || isProblem(event.outcome)) &&
    (!outcomes || outcomes.includes(event.outcome)) &&
    (filter.name === undefined || event.name === filter.name) &&
    (filter.name_prefix === undefined ||
      event.name.startsWith(filter.name_prefix)) &&
    (filter.trace_id === undefined || event.trace_id === filter.trace_id) &&
    (filter.connection_id === undefined ||
      connection === filter.connection_id) &&
    (filter.plugin_id === undefined || plugin === filter.plugin_id)
  );
}

/** Installs the bridge: the log file holds `events`. */
function installMain({
  events = [] as LoggedEvent[],
  settings = {} as Partial<LocalLogSettings>,
} = {}) {
  const stored: LocalLogSettings = {
    enabled: true,
    retention_days: 7,
    size_limit_mb: 250,
    include_sensitive: false,
    ...settings,
  };
  const tails: {
    filter: DesktopLogFilter | undefined;
    callback: (events: LoggedEvent[]) => void;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const bridge = {
    runtime: {
      version: "1.2.3",
      launch: {
        launch_id: THIS_LAUNCH,
        app: { version: "1.2.3", channel: "stable", packaged: true },
        device: { platform: "win32" },
      },
    },
    getLogsStatus: vi.fn(async (): Promise<DesktopLogsStatus> => ({
      settings: { ...stored },
      state: stored.enabled ? "on" : "off",
      storage_bytes: 1024,
      file_count: 1,
      dropped_event_count: 0,
    })),
    configureLogs: vi.fn(async () => bridge.getLogsStatus()),
    onWideEventsForwarding: () => () => {},
    queryLogs: vi.fn(
      async (
        filter: DesktopLogFilter,
        page: DesktopLogPage = {},
      ): Promise<DesktopLogQueryResult> => {
        const matching = events
          .filter((event) => passes(event, filter))
          .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
        const offset = page.cursor ? Number(page.cursor) : 0;
        const limit = page.limit ?? 100;
        const next = offset + limit;
        return {
          events: matching.slice(offset, next),
          next_cursor: next < matching.length ? String(next) : null,
          match_count: matching.length,
          file_count: 1,
          missing_file_count: 0,
          skipped_line_count: 0,
        };
      },
    ),
    tailLogs: vi.fn(
      async (
        filter: DesktopLogFilter | undefined,
        callback: (events: LoggedEvent[]) => void,
      ) => {
        const stop = vi.fn();
        tails.push({ filter, callback, stop });
        return stop;
      },
    ),
    /** Main writes events: every open tail whose filter passes them gets them. */
    write(written: LoggedEvent[]) {
      events.push(...written);
      for (const tail of tails) {
        if (tail.stop.mock.calls.length > 0) continue;
        const passed = written.filter((event) =>
          passes(event, tail.filter ?? {}),
        );
        if (passed.length) tail.callback(passed);
      }
    },
    tails,
  };
  window.ajourDesktop = bridge as unknown as typeof window.ajourDesktop;
  return bridge;
}

/** The Settings window as the shell renders it: the page gets the window's search. */
function WindowPage() {
  const location = useSettingsWindowLocation();
  return (
    <SettingsSearchProvider value={location?.search ?? {}}>
      <SettingsDiagnosticsPage />
    </SettingsSearchProvider>
  );
}

/** Opens Diagnostics in the Settings window with `search`. */
async function openDiagnostics(search: Record<string, string> = {}) {
  const query = new URLSearchParams({ tab: "events", ...search }).toString();
  const view = await renderRoutes({
    routes: { "/": WindowPage },
    path: `/?settings=${encodeURIComponent(`diagnostics?${query}`)}`,
  });
  await settle();
  return view;
}

/** Lets the bridge calls a change started answer. */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {});
  }
}

/** The window's location now: `diagnostics?tab=events&...` as a record. */
function windowSearch(router: {
  state: { location: { search: unknown } };
}): Record<string, string> {
  const value = (router.state.location.search as Record<string, unknown>)
    .settings as string;
  const [page, query = ""] = value.split("?");
  return { page: page!, ...Object.fromEntries(new URLSearchParams(query)) };
}

const rowNames = () =>
  screen
    .queryAllByRole("row")
    .filter((row) => row.hasAttribute("data-event-key"))
    .map((row) => row.querySelectorAll('[role="gridcell"]')[2]!.textContent);

const lastFilter = (main: ReturnType<typeof installMain>) =>
  main.queryLogs.mock.calls.at(-1)![0];

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

async function choose(chip: RegExp, choice: string) {
  await click(screen.getByRole("button", { name: chip }));
  await click(screen.getByRole("menuitemradio", { name: choice }));
}

async function query(text: string) {
  const box = screen.getByRole("searchbox", { name: "Query" });
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
  await settle();
}

async function selectRow(name: string) {
  const row = screen
    .getAllByRole("row")
    .find(
      (candidate) =>
        candidate.querySelectorAll('[role="gridcell"]')[2]?.textContent ===
        name,
    )!;
  await click(row);
}

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  overview.value = null;
});

/** A log with one event for each filter to keep or leave out. */
function mixedLog() {
  return [
    logged("time_entry.start", { minutesAgo: 1 }),
    logged("backlog.sync", {
      minutesAgo: 2,
      kind: "job",
      outcome: "error",
      connection: { id: "conn-1" },
      plugin: { id: "jira" },
    }),
    logged("logs.query", {
      minutesAgo: 3,
      kind: "ipc",
      runtime: "main",
      trace_id: TRACE_B,
    }),
    logged("http.request", {
      minutesAgo: 4,
      kind: "request",
      runtime: "api",
      outcome: "refused",
    }),
    logged("app.launch", {
      minutesAgo: 3 * 60,
      kind: "lifecycle",
      runtime: "main",
    }),
    logged("backlog.refresh", { minutesAgo: 5, launch_id: OLD_LAUNCH }),
  ];
}

describe("the Events tab", () => {
  it("shows Events next to Settings, and opens on it from tab=events", async () => {
    installMain({ events: mixedLog() });
    await openDiagnostics();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Events",
      "Settings",
    ]);
    expect(
      screen.getByRole("tab", { name: "Events" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("lists this launch's events, newest first, with time, outcome, name, runtime and duration", async () => {
    const main = installMain({ events: mixedLog() });
    await openDiagnostics();

    expect(lastFilter(main)).toEqual({ launch_id: THIS_LAUNCH });
    expect(rowNames()).toEqual([
      "time_entry.start",
      "backlog.sync",
      "logs.query",
      "http.request",
      "app.launch",
    ]);
    const [first] = screen
      .getAllByRole("row")
      .filter((row) => row.hasAttribute("data-event-key"));
    const cells = within(first!).getAllByRole("gridcell");
    expect(cells[0]!.textContent).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(within(cells[1]!).getByRole("img", { name: "ok" })).toBeTruthy();
    expect(cells[3]!.textContent).toBe("renderer");
    expect(cells[4]!.textContent).toBe("12 ms");
    expect(screen.getByTestId("event-count").textContent).toBe("5 events");
  });

  describe("each filter narrows the list", () => {
    it("Problems only keeps what didn't end ok or noop", async () => {
      const main = installMain({ events: mixedLog() });
      const { router } = await openDiagnostics();

      await click(screen.getByRole("button", { name: "Problems only" }));

      expect(lastFilter(main)).toMatchObject({ outcome: "problems" });
      expect(rowNames()).toEqual(["backlog.sync", "http.request"]);
      expect(windowSearch(router)).toMatchObject({ problems: "1" });
    });

    it.each([
      [/^Runtime/, "main", ["logs.query", "app.launch"], { runtime: "main" }],
      [/^Kind/, "ipc", ["logs.query"], { kind: "ipc" }],
      [
        /^Time/,
        "Last hour",
        ["time_entry.start", "backlog.sync", "logs.query", "http.request"],
        { range: "1h" },
      ],
    ])("the %s chip set to %s", async (chip, choice, names, search) => {
      const main = installMain({ events: mixedLog() });
      const { router } = await openDiagnostics();

      await choose(chip, choice);

      expect(rowNames()).toEqual(names);
      expect(windowSearch(router)).toMatchObject(search);
      expect(main.queryLogs).toHaveBeenCalledTimes(2);
    });

    it("Launch: All launches adds the launches before this one", async () => {
      const main = installMain({ events: mixedLog() });
      const { router } = await openDiagnostics();
      expect(rowNames()).not.toContain("backlog.refresh");

      await choose(/^Launch/, "All launches");

      expect(lastFilter(main)).not.toHaveProperty("launch_id");
      expect(rowNames()).toContain("backlog.refresh");
      expect(windowSearch(router)).toMatchObject({ launch: "all" });
    });
  });

  describe("each query term narrows the list", () => {
    it.each([
      ["name:logs.query", ["logs.query"], { name: "logs.query" }],
      ["backlog.", ["backlog.sync"], { name_prefix: "backlog." }],
      [
        "outcome:error,refused",
        ["backlog.sync", "http.request"],
        { outcome: ["error", "refused"] },
      ],
      [`trace:${TRACE_B}`, ["logs.query"], { trace_id: TRACE_B }],
      ["connection:conn-1", ["backlog.sync"], { connection_id: "conn-1" }],
      ["plugin:jira", ["backlog.sync"], { plugin_id: "jira" }],
    ])("%s", async (text, names, filter) => {
      const main = installMain({ events: mixedLog() });
      await openDiagnostics();

      await query(text);

      expect(lastFilter(main)).toMatchObject(filter);
      expect(rowNames()).toEqual(names);
    });

    it("says what is wrong with a term, and asks main nothing", async () => {
      const main = installMain({ events: mixedLog() });
      await openDiagnostics();

      await query("colour:red");

      expect(screen.getByText(/Ajour doesn't know colour:/)).toBeTruthy();
      expect(
        screen
          .getByRole("searchbox", { name: "Query" })
          .getAttribute("aria-invalid"),
      ).toBe("true");
      expect(main.queryLogs).toHaveBeenCalledTimes(1);
    });
  });

  it("opens filtered from its search keys, as an Overview link does", async () => {
    const main = installMain({ events: mixedLog() });
    await openDiagnostics({
      problems: "1",
      runtime: "renderer",
      kind: "job",
      launch: "all",
      range: "24h",
      name: "backlog.sync",
      connection: "conn-1",
      plugin: "jira",
      trace: TRACE_A,
    });

    expect(lastFilter(main)).toMatchObject({
      outcome: "problems",
      runtime: "renderer",
      kind: "job",
      name: "backlog.sync",
      connection_id: "conn-1",
      plugin_id: "jira",
      trace_id: TRACE_A,
    });
    expect(lastFilter(main).from).toBeDefined();
    expect(rowNames()).toEqual(["backlog.sync"]);
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", { name: "Query" }).value,
    ).toBe(`name:backlog.sync trace:${TRACE_A} connection:conn-1 plugin:jira`);
    expect(
      screen
        .getByRole("button", { name: "Problems only" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("asks for the next page near the end, and renders only the rows in view", async () => {
    const events = Array.from({ length: 450 }, (_, index) =>
      logged(`job.number_${index}`, { minutesAgo: index / 100 }),
    );
    const main = installMain({ events });
    await openDiagnostics();

    expect(main.queryLogs.mock.calls[0]![1]).toEqual({ limit: 200 });
    expect(screen.getByTestId("event-count").textContent).toBe("450 events");
    expect(rowNames().length).toBeLessThan(40);

    const rows = screen.getByTestId("event-rows");
    await act(async () => {
      rows.scrollTop = 200 * 28 - 448;
      fireEvent.scroll(rows);
    });
    await settle();

    expect(main.queryLogs.mock.calls[1]![1]).toEqual({
      limit: 200,
      cursor: "200",
    });
    expect(rowNames()).toContain("job.number_199");
    expect(rowNames()).not.toContain("job.number_0");
    expect(rowNames().length).toBeLessThan(40);
  });
});

describe("Live", () => {
  it("adds new matching events without reading the file again, and stops when turned off", async () => {
    const main = installMain({ events: mixedLog() });
    await openDiagnostics({ problems: "1", range: "1h" });
    expect(rowNames()).toEqual(["backlog.sync", "http.request"]);

    await click(screen.getByRole("button", { name: "Live" }));
    expect(main.tailLogs).toHaveBeenCalledTimes(1);
    // A tail follows what is written now: the filter without its range.
    expect(main.tailLogs.mock.calls[0]![0]).toEqual({
      outcome: "problems",
      launch_id: THIS_LAUNCH,
    });

    await act(async () => {
      main.write([
        logged("plugin.call", { minutesAgo: 0, outcome: "timeout" }),
        logged("time_entry.stop", { minutesAgo: 0 }),
      ]);
    });

    expect(rowNames()).toEqual(["plugin.call", "backlog.sync", "http.request"]);
    expect(screen.getByTestId("event-count").textContent).toBe("3 events");
    expect(main.queryLogs).toHaveBeenCalledTimes(1);

    await click(screen.getByRole("button", { name: "Live" }));
    expect(main.tails[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the Time range on what it adds: a job that started before it and just ended stays out", async () => {
    const main = installMain({ events: mixedLog() });
    await openDiagnostics({ range: "15m" });
    await click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByTestId("event-count").textContent).toBe("4 events");

    await act(async () => {
      main.write([
        logged("backlog.sync_all", { minutesAgo: 20, kind: "job" }),
        logged("time_entry.stop", { minutesAgo: 0 }),
      ]);
    });

    expect(rowNames()).toContain("time_entry.stop");
    expect(rowNames()).not.toContain("backlog.sync_all");
    expect(screen.getByTestId("event-count").textContent).toBe("5 events");
  });

  it("keeps the list newest first when a long event it added belongs on a later page", async () => {
    const events = Array.from({ length: 250 }, (_, index) =>
      logged(`job.number_${index}`, { minutesAgo: index }),
    );
    const main = installMain({ events });
    await openDiagnostics();
    await click(screen.getByRole("button", { name: "Live" }));

    // It started before all but the two oldest, and ended just now.
    await act(async () => {
      main.write([logged("backlog.sync_all", { minutesAgo: 247.5 })]);
    });
    const rows = screen.getByTestId("event-rows");
    await act(async () => {
      rows.scrollTop = 200 * 28 - 448;
      fireEvent.scroll(rows);
    });
    await settle();
    expect(main.queryLogs.mock.calls[1]![1]).toEqual({
      limit: 200,
      cursor: "200",
    });
    await act(async () => {
      rows.scrollTop = 251 * 28;
      fireEvent.scroll(rows);
    });

    expect(rowNames().slice(-4)).toEqual([
      "job.number_247",
      "backlog.sync_all",
      "job.number_248",
      "job.number_249",
    ]);
  });

  it("stops following when the page closes", async () => {
    const main = installMain({ events: mixedLog() });
    await openDiagnostics();
    await click(screen.getByRole("button", { name: "Live" }));

    cleanup();

    expect(main.tails[0]!.stop).toHaveBeenCalledTimes(1);
  });
});

describe("the detail pane", () => {
  let itemId: string;
  let projectId: string;
  let run = 0;

  beforeEach(() => {
    run += 1;
    act(() => {
      localStore.addProject({ name: `Diagnostics ${run}`, color: "#336699" });
    });
    projectId = localStore
      .snapshot()
      .projects.find((project) => project.name === `Diagnostics ${run}`)!._id;
    act(() => {
      localStore.addWorkItem({ title: `Fix export ${run}`, projectId });
    });
    itemId = localStore
      .snapshot()
      .workItems.find((item) => item.title === `Fix export ${run}`)!._id;
    overview.value = {
      pluginsEnabled: true,
      unsignedPluginsEnabled: true,
      plugins: [],
      totalPendingImportCount: 0,
      totalSelectedImportCount: 0,
      connectionGroups: [
        {
          plugin: { id: "jira", displayName: "Jira" },
          enabled: true,
          connections: [{ id: "conn-1", label: "Work Jira" }],
        },
      ],
    };
  });

  function syncEvent() {
    return logged("backlog.sync", {
      kind: "job",
      outcome: "error",
      outcome_reason: "unreachable",
      connection: { id: "conn-1" },
      plugin: { id: "jira" },
      backlog_item: { id: itemId },
      project: { id: projectId },
      steps: ["plugin.call", "backlog.import"],
      dropped_step_count: 2,
      step_failures: [
        { name: "plugin.call", outcome: "timeout", error_type: "TimeoutError" },
      ],
      counts: { work_item_count: 3 },
      error: { type: "FetchError", code: "ECONNREFUSED" },
    });
  }

  it("shows the envelope, the fields with their names, the steps, failures and counts", async () => {
    installMain({ events: [syncEvent()] });
    await openDiagnostics();

    await selectRow("backlog.sync");

    const pane = screen.getByRole("region", { name: "Event details" });
    expect(within(pane).getByText("unreachable")).toBeTruthy();
    expect(within(pane).getByText(TRACE_A)).toBeTruthy();
    expect(within(pane).getByText(THIS_LAUNCH)).toBeTruthy();
    expect(within(pane).getByText("FetchError · ECONNREFUSED")).toBeTruthy();
    // IDs keep their names next to them.
    expect(within(pane).getByText("Work Jira")).toBeTruthy();
    expect(within(pane).getByText("Jira")).toBeTruthy();
    expect(within(pane).getByText(`Fix export ${run}`)).toBeTruthy();
    expect(within(pane).getByText(`Diagnostics ${run}`)).toBeTruthy();
    expect(
      within(within(pane).getByRole("list", { name: "Steps" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["plugin.call", "backlog.import", "and 2 more"]);
    expect(
      within(pane).getByRole("list", { name: "Step failures" }).textContent,
    ).toContain("timeout · TimeoutError");
    expect(within(pane).getByLabelText("Counts").textContent).toContain(
      "work_item_count3",
    );
  });

  it("copies the event exactly as stored, with no joined name or title", async () => {
    const stored = syncEvent();
    const expected = JSON.stringify(stored, null, 2);
    installMain({ events: [stored] });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await openDiagnostics();
    await selectRow("backlog.sync");
    expect(screen.getByText("Work Jira")).toBeTruthy();

    await click(screen.getByRole("button", { name: "Copy JSON" }));

    const copied = writeText.mock.calls[0]![0];
    expect(copied).toBe(expected);
    expect(copied).not.toContain("Work Jira");
    expect(copied).not.toContain('Jira"');
    expect(copied).not.toContain(`Fix export ${run}`);
    expect(copied).not.toContain(`Diagnostics ${run}`);
  });

  it("shows sensitive fields that weren't written as hidden, while they are off", async () => {
    installMain({
      events: [
        logged("time_entry.update", {
          time_entry: { id: "entry-1", running: false },
          error: { type: "Error", code: "locked_week" },
        }),
      ],
    });
    await openDiagnostics();

    await selectRow("time_entry.update");

    const pane = screen.getByRole("region", { name: "Event details" });
    expect(
      within(pane).getAllByText("hidden · sensitive fields are off"),
    ).toHaveLength(3); // duration_before_ms, duration_after_ms, error.message
    expect(
      within(pane).getByText("time_entry.duration_before_ms"),
    ).toBeTruthy();
  });

  it("shows no hidden fields while sensitive fields are on", async () => {
    installMain({
      settings: { include_sensitive: true },
      events: [
        logged("time_entry.update", {
          time_entry: { id: "entry-1", duration_before_ms: 60_000 },
        }),
      ],
    });
    await openDiagnostics();

    await selectRow("time_entry.update");

    expect(screen.queryByText("hidden · sensitive fields are off")).toBeNull();
    expect(screen.getByText("60000")).toBeTruthy();
  });

  it("marks the sensitive fields an older event never got as not recorded, while they are on", async () => {
    installMain({
      settings: { include_sensitive: true },
      events: [
        logged("time_entry.update", {
          time_entry: { id: "entry-1", running: false },
          error: { type: "Error", code: "locked_week" },
        }),
      ],
    });
    await openDiagnostics();

    await selectRow("time_entry.update");

    const pane = screen.getByRole("region", { name: "Event details" });
    expect(within(pane).getAllByText("not recorded")).toHaveLength(3); // duration_before_ms, duration_after_ms, error.message
    expect(screen.queryByText("hidden · sensitive fields are off")).toBeNull();
  });

  it("Show trace opens the Actions tab on the event's trace", async () => {
    installMain({ events: mixedLog() });
    const { router } = await openDiagnostics();

    await selectRow("logs.query");
    await click(screen.getByRole("button", { name: "Show trace" }));

    expect(windowSearch(router)).toEqual({
      page: "diagnostics",
      tab: "actions",
      trace: TRACE_B,
    });
  });

  it("Same name and Same launch filter on the event's own", async () => {
    const main = installMain({ events: mixedLog() });
    const { router } = await openDiagnostics({ launch: "all" });

    await selectRow("backlog.refresh");
    await click(screen.getByRole("button", { name: "Same launch" }));
    expect(lastFilter(main)).toEqual({ launch_id: OLD_LAUNCH });
    expect(rowNames()).toEqual(["backlog.refresh"]);

    await click(screen.getByRole("button", { name: "Same name" }));
    expect(lastFilter(main)).toEqual({
      launch_id: OLD_LAUNCH,
      name: "backlog.refresh",
    });
    expect(windowSearch(router)).toMatchObject({
      tab: "events",
      launch: OLD_LAUNCH,
      name: "backlog.refresh",
    });
  });
});

describe("the empty states", () => {
  it("says logging is off, with a link to the Settings tab", async () => {
    installMain({ settings: { enabled: false } });
    const { router } = await openDiagnostics();

    expect(screen.getByText("Logging is off")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the Settings tab" });
    expect(link.getAttribute("href")).toBe(
      "/settings/diagnostics?tab=settings",
    );

    await click(link);

    expect(windowSearch(router)).toEqual({
      page: "diagnostics",
      tab: "settings",
    });
    expect(
      screen.getByRole("switch", { name: "Write events to a local file" }),
    ).toBeTruthy();
  });

  it("says no events match while logging is on", async () => {
    installMain({ events: mixedLog() });
    await openDiagnostics();

    await query("name:nothing.here");

    expect(screen.getByText("No events match")).toBeTruthy();
    expect(screen.queryByText("Logging is off")).toBeNull();
  });
});

describe("the narrow view", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    installDomShims();
  });

  it("reads the same keys from the page's own route, and writes them there", async () => {
    stubNarrowView(true);
    const main = installMain({ events: mixedLog() });
    const { router } = await renderRoutes({
      routes: { "/settings/diagnostics": SettingsDiagnosticsPage },
      path: "/settings/diagnostics?tab=events&problems=1",
    });
    await settle();

    expect(lastFilter(main)).toMatchObject({ outcome: "problems" });
    expect(rowNames()).toEqual(["backlog.sync", "http.request"]);

    await choose(/^Runtime/, "api");

    expect(router.state.location.pathname).toBe("/settings/diagnostics");
    expect(router.state.location.search).toMatchObject({
      tab: "events",
      problems: "1",
      runtime: "api",
    });
    expect(rowNames()).toEqual(["http.request"]);
  });
});

describe("the tabs", () => {
  it("keep the chosen tab in the page's search", async () => {
    installMain({ events: mixedLog() });
    const { router } = await openDiagnostics({ problems: "1" });

    await click(screen.getByRole("tab", { name: "Settings" }));

    expect(windowSearch(router)).toEqual({
      page: "diagnostics",
      tab: "settings",
    });
    expect(
      screen
        .getByRole("tab", { name: "Settings" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
