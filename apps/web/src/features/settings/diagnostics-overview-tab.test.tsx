// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocalLogSettings } from "@ajour/wide-events/local-log-file.ts";
import type {
  DesktopLogFilter,
  DesktopLogOverview,
  DesktopLogQueryResult,
  DesktopLogRange,
  DesktopLogsStatus,
} from "@/lib/desktop-bridge";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { overviewFixture } from "@/test-support/log-overview-fixtures";
import {
  SettingsSearchProvider,
  useSettingsWindowLocation,
} from "./settings-link";
import { SettingsDiagnosticsPage } from "./settings-diagnostics-page";

/*
 * Diagnostics > Overview (#445) in the Settings window, against a
 * logs.aggregate that answers the fixture: a failing sync, a plugin timeout
 * and a slow launch. Its links open the Events tab, whose logs.query the
 * test reads back.
 */

const overview = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  getCachedPluginsOverview: () => overview.value,
  getPluginsOverview: async () => overview.value,
  subscribePluginsOverview: () => () => {},
}));

beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  overview.value = null;
});

const JIRA_NAMES = {
  pluginsEnabled: true,
  unsignedPluginsEnabled: true,
  plugins: [],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
  connectionGroups: [
    {
      plugin: { id: "ajour.jira", displayName: "Jira" },
      enabled: true,
      connections: [{ id: "conn-jira", label: "Work Jira" }],
    },
  ],
};

function installMain({
  answer = overviewFixture(),
  settings = {},
  fileCount = 2,
}: {
  answer?:
    DesktopLogOverview | ((range: DesktopLogRange) => DesktopLogOverview);
  settings?: Partial<LocalLogSettings>;
  fileCount?: number;
} = {}) {
  const stored: LocalLogSettings = {
    enabled: true,
    retention_days: 7,
    size_limit_mb: 250,
    include_sensitive: false,
    ...settings,
  };
  const bridge = {
    runtime: {
      version: "1.2.3",
      launch: {
        launch_id: "launch-now",
        app: { version: "1.2.3", channel: "stable", packaged: true },
        device: { platform: "win32" },
      },
    },
    getLogsStatus: vi.fn(async (): Promise<DesktopLogsStatus> => ({
      settings: { ...stored },
      state: stored.enabled ? "on" : "off",
      storage_bytes: fileCount * 1024,
      file_count: fileCount,
      dropped_event_count: 0,
    })),
    onWideEventsForwarding: () => () => {},
    aggregateLogs: vi.fn(async ({ range }: { range: DesktopLogRange }) => {
      const result = typeof answer === "function" ? answer(range) : answer;
      return { ...result, range };
    }),
    queryLogs: vi.fn(
      async (_filter: DesktopLogFilter): Promise<DesktopLogQueryResult> => ({
        events: [],
        next_cursor: null,
        match_count: 0,
        file_count: 1,
        missing_file_count: 0,
        skipped_line_count: 0,
      }),
    ),
    tailLogs: vi.fn(async () => () => {}),
  };
  window.ajourDesktop = bridge as unknown as typeof window.ajourDesktop;
  return bridge;
}

function WindowPage() {
  const location = useSettingsWindowLocation();
  return (
    <SettingsSearchProvider value={location?.search ?? {}}>
      <SettingsDiagnosticsPage />
    </SettingsSearchProvider>
  );
}

async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {});
  }
}

/** Opens Diagnostics in the Settings window with `search`. */
async function openDiagnostics(search: Record<string, string> = {}) {
  const query = new URLSearchParams(search).toString();
  const view = await renderRoutes({
    routes: { "/": WindowPage },
    path: `/?settings=${encodeURIComponent(`diagnostics?${query}`)}`,
  });
  await settle();
  return view;
}

function windowSearch(router: {
  state: { location: { search: unknown } };
}): Record<string, string> {
  const value = (router.state.location.search as Record<string, unknown>)
    .settings as string;
  const [page, query = ""] = value.split("?");
  return { page: page!, ...Object.fromEntries(new URLSearchParams(query)) };
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

const figure = (name: string) => screen.getByRole("region", { name });
const lastFilter = (main: ReturnType<typeof installMain>) =>
  main.queryLogs.mock.calls.at(-1)![0];
const selectedTab = () =>
  screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

describe("the Overview tab", () => {
  it("is the default tab once the log holds data, and Settings before", async () => {
    installMain();
    await openDiagnostics();
    expect(selectedTab()).toBe("Overview");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Events",
      "Actions",
      "Settings",
    ]);

    cleanup();
    installMain({ fileCount: 0 });
    await openDiagnostics();
    expect(selectedTab()).toBe("Settings");

    // A link that names its tab keeps it.
    cleanup();
    installMain();
    await openDiagnostics({ tab: "settings" });
    expect(selectedTab()).toBe("Settings");
  });

  it("shows each figure's number and reason: a failing sync, a plugin timeout, a slow launch and crashes", async () => {
    overview.value = JIRA_NAMES;
    const main = installMain();
    await openDiagnostics({ tab: "overview", range: "24h" });

    expect(main.aggregateLogs.mock.calls.at(-1)![0]).toEqual({
      range: "24h",
    });

    const sync = figure("Sync");
    expect(sync.textContent).toContain("2 failed syncs of 9");
    const syncRow = within(sync).getByTestId("sync-row");
    expect(syncRow.textContent).toContain("Work Jira");
    expect(syncRow.textContent).toContain("2 of 4");
    expect(syncRow.textContent).toContain("(secret_unavailable)");

    const plugins = figure("Plugins");
    const pluginRow = within(plugins).getByTestId("plugin-row");
    expect(pluginRow.textContent).toContain("Jira 2.1.0");
    expect(pluginRow.textContent).toContain("Timed out");

    const launch = figure("App start");
    expect(launch.textContent).toContain("6.40 s");
    expect(launch.textContent).toContain("p95 6.40 s of 3");
    expect(launch.textContent).toContain("Slowest phase: Window");
    expect(launch.textContent).toContain("5.10 s");

    const crashes = figure("Crashes");
    expect(within(crashes).getAllByTestId("crash-row")).toHaveLength(2);
    expect(crashes.textContent).toMatch(/Crashes3/);

    const slow = screen.getAllByTestId("slow-row");
    expect(slow[0]!.textContent).toContain("app.launch");
    expect(screen.getAllByTestId("problem-row")[0]!.textContent).toContain(
      "Work Jira",
    );
  });

  it("draws one bar per hour, its segments the hour's aggregate", async () => {
    installMain();
    await openDiagnostics({ tab: "overview", range: "24h" });

    const chart = screen.getByRole("group", { name: "Problems per hour" });
    const bars = chart.querySelectorAll("[data-bar]");
    // Four hours, one of them without a problem: no link for it.
    expect(within(chart).getAllByRole("link")).toHaveLength(3);
    expect(bars).toHaveLength(3);
    const hour = bars[1]!;
    const heights = Object.fromEntries(
      [...hour.querySelectorAll<HTMLElement>("[data-series]")].map(
        (segment) => [segment.dataset.series, segment.style.height],
      ),
    );
    // 6 errors and 1 refusal of the hour's 7.
    expect(heights).toEqual({
      error: `${(6 / 7) * 100}%`,
      refused: `${(1 / 7) * 100}%`,
    });
    // The tallest hour fills the chart.
    expect(hour.querySelector<HTMLElement>("a > span")!.style.height).toBe(
      "100%",
    );
    expect(
      within(chart).getAllByRole("link")[2]!.getAttribute("aria-label"),
    ).toMatch(/3 problems · Timed out 1 · Cancelled 2$/);
    // The legend totals each outcome over the range.
    expect(chart.textContent).toContain("Error8");
  });

  it("opens Events filtered from a figure, a bar and a row", async () => {
    const main = installMain();
    const { router } = await openDiagnostics({ tab: "overview", range: "24h" });

    // A figure: the Sync figure opens the failed syncs.
    await click(within(figure("Sync")).getAllByRole("link")[0]!);
    expect(windowSearch(router)).toEqual({
      page: "diagnostics",
      tab: "events",
      problems: "1",
      launch: "all",
      range: "24h",
      name: "backlog.sync",
    });
    expect(selectedTab()).toBe("Events");
    expect(lastFilter(main)).toMatchObject({
      outcome: "problems",
      name: "backlog.sync",
    });
    expect(lastFilter(main).launch_id).toBeUndefined();

    // A bar: its hour's problems.
    cleanup();
    const second = installMain();
    const reopened = await openDiagnostics({ tab: "overview", range: "24h" });
    const chart = screen.getByRole("group", { name: "Problems per hour" });
    await click(within(chart).getAllByRole("link")[1]!);
    expect(windowSearch(reopened.router)).toEqual({
      page: "diagnostics",
      tab: "events",
      problems: "1",
      launch: "all",
      hour: "2026-11-18T10:00:00.000Z",
    });
    expect(lastFilter(second)).toEqual({
      outcome: "problems",
      from: "2026-11-18T10:00:00.000Z",
      to: "2026-11-18T11:00:00.000Z",
    });
    expect(
      screen.getByRole("button", { name: /^Time: / }).textContent,
    ).toContain("–");

    // A row: a top problem's name, outcome and reason.
    cleanup();
    const third = installMain();
    const again = await openDiagnostics({ tab: "overview" });
    await click(screen.getAllByTestId("problem-row")[0]!);
    expect(windowSearch(again.router)).toEqual({
      page: "diagnostics",
      tab: "events",
      name: "backlog.sync",
      outcome: "error",
      reason: "secret_unavailable",
    });
    expect(lastFilter(third)).toEqual({
      launch_id: "launch-now",
      name: "backlog.sync",
      outcome: ["error"],
      outcome_reason: ["secret_unavailable"],
    });
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", { name: "Query" }).value,
    ).toBe("name:backlog.sync outcome:error reason:secret_unavailable");
  });

  it("reads the range it is set to, and keeps it in the search", async () => {
    const main = installMain();
    const { router } = await openDiagnostics({ tab: "overview" });
    expect(main.aggregateLogs.mock.calls.at(-1)![0]).toEqual({
      range: "launch",
    });

    await click(screen.getByRole("button", { name: "7 days" }));

    expect(windowSearch(router)).toEqual({
      page: "diagnostics",
      tab: "overview",
      range: "7d",
    });
    expect(main.aggregateLogs.mock.calls.at(-1)![0]).toEqual({
      range: "7d",
    });
  });
});

describe("the empty and healthy states", () => {
  const empty = () =>
    overviewFixture({
      counts: [],
      problems: [],
      syncs: [],
      plugin_problems: [],
      problems_per_hour: [],
      durations: [],
      latest_launch: null,
      crash_count: 0,
    });

  it("says logging is off, with a link to the Settings tab", async () => {
    installMain({ answer: empty(), settings: { enabled: false } });
    await openDiagnostics({ tab: "overview" });

    expect(screen.getByText("Logging is off")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the Settings tab" }),
    ).toBeTruthy();
  });

  it("says there is no data yet while logging is on", async () => {
    installMain({ answer: empty() });
    await openDiagnostics({ tab: "overview" });

    expect(screen.getByText("No data yet")).toBeTruthy();
  });

  it("says everything is OK with no problem or crash, and draws no chart", async () => {
    installMain({
      answer: overviewFixture({
        counts: [{ name: "time_entry.update", outcome: "ok", count: 4 }],
        problems: [],
        syncs: [],
        plugin_problems: [],
        problems_per_hour: [{ hour: "2026-11-18T11:00:00.000Z", counts: {} }],
        crash_count: 0,
      }),
    });
    await openDiagnostics({ tab: "overview" });

    expect(screen.getByRole("status").textContent).toContain(
      "Everything is OK: no problem or crash in this launch.",
    );
    expect(screen.queryByRole("group", { name: "Problems per hour" })).toBe(
      null,
    );
    expect(figure("Sync").textContent).toContain("No sync in this range");
  });

  it("says when it can't read the log file", async () => {
    const main = installMain();
    main.aggregateLogs.mockRejectedValueOnce(new Error("unreadable"));
    await openDiagnostics({ tab: "overview" });

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't read the log file.",
    );
  });
});
