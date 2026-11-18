// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DesktopLogAction,
  DesktopLogActionView,
  DesktopLogTrace,
  LoggedEvent,
} from "@/lib/desktop-bridge";
import { cachePluginsOverview } from "@/lib/app-api";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  AGENT_TOOL_TRACE,
  RATE_LIMITED_SYNC_TRACE,
  actionOf,
  agentToolCall,
  loggedEvent,
  rateLimitedBacklogSync,
  traceOf,
} from "@/test-support/log-trace-fixtures";
import { useSettingsWindowLocation } from "./settings-link";
import { SettingsWindowPage } from "./settings-pages";

/*
 * Diagnostics > Actions (#444) in the settings window, against a bridge
 * that answers logs.actions, logs.trace and logs.query from fixtures.
 */

beforeAll(() => {
  installDomShims();
  // Connection names come from the plugins overview; none is asked for.
  cachePluginsOverview({ connectionGroups: [] } as never);
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
});

const OK_TRACE = "1234567890abcdef1234567890abcdef";
const RUN_TRACE = "abcdefabcdefabcdefabcdefabcdef12";

/** A sync that went well, through every lane: renderer, API, worker, broker. */
function okSync(): DesktopLogTrace {
  const trace_id = OK_TRACE;
  return traceOf(trace_id, [
    loggedEvent({
      name: "backlog.sync",
      runtime: "renderer",
      trigger: "schedule",
      trace_id,
      span_id: "1000000000000001",
      at: 60_000,
      duration_ms: 300,
    }),
    loggedEvent({
      name: "backlog.sync",
      kind: "request",
      trace_id,
      span_id: "1000000000000002",
      parent_span_id: "1000000000000001",
      at: 60_010,
      duration_ms: 280,
    }),
    loggedEvent({
      name: "backlog.sync",
      kind: "plugin_operation",
      trace_id,
      span_id: "1000000000000003",
      parent_span_id: "1000000000000002",
      at: 60_020,
      duration_ms: 260,
    }),
    loggedEvent({
      name: "plugin.request",
      trace_id,
      span_id: "1000000000000004",
      parent_span_id: "1000000000000003",
      at: 60_030,
      duration_ms: 200,
    }),
  ]);
}

/** An agent run, whose tool calls are traces of their own, joined by its client. */
function agentRun(): DesktopLogTrace {
  return traceOf(RUN_TRACE, [
    loggedEvent({
      name: "agent.run",
      trigger: "user",
      surface: "button",
      trace_id: RUN_TRACE,
      span_id: "2000000000000001",
      at: 0,
      duration_ms: 9000,
      agent: { run_id: "run-1", client_id: "client-1", task_id: "triage" },
    }),
  ]);
}

function installMain({
  traces = [rateLimitedBacklogSync(), okSync()],
  listed,
  slow = [OK_TRACE],
  events = [],
  refuseList = false,
}: {
  traces?: DesktopLogTrace[];
  /** The traces logs.actions lists; every trace by default. */
  listed?: string[];
  slow?: string[];
  events?: LoggedEvent[];
  refuseList?: boolean;
} = {}) {
  const byId = new Map(traces.map((trace) => [trace.trace_id, trace]));
  const actions: DesktopLogAction[] = (listed ?? [...byId.keys()]).map((id) =>
    actionOf(byId.get(id)!, { slow: slow.includes(id) }),
  );
  const bridge = {
    // The page reads it to pick its default tab.
    getLogsStatus: vi.fn(async () => ({
      settings: {
        enabled: true,
        retention_days: 7,
        size_limit_mb: 250,
        include_sensitive: false,
      },
      state: "on",
      storage_bytes: 1024,
      file_count: 1,
      dropped_event_count: 0,
    })),
    listLogActions: vi.fn(
      async (
        filter: { show?: DesktopLogActionView },
        _page?: { cursor?: string },
      ) => {
        if (refuseList) throw new Error("unavailable");
        const show = filter.show ?? "all";
        const shown = actions.filter((action) =>
          show === "failed"
            ? action.problem_count > 0
            : show === "slow"
              ? action.slow
              : true,
        );
        return {
          show,
          actions: shown,
          next_cursor: null as string | null,
          match_count: shown.length,
          file_count: 1,
          missing_file_count: 0,
          skipped_line_count: 0,
        };
      },
    ),
    getLogTrace: vi.fn(async (traceId: string) => {
      const trace = byId.get(traceId);
      if (trace) return trace;
      return traceOf(traceId, []);
    }),
    queryLogs: vi.fn(async (_filter: unknown, _page?: unknown) => ({
      events,
      next_cursor: null,
      match_count: events.length,
      file_count: 1,
      missing_file_count: 0,
      skipped_line_count: 0,
    })),
  };
  window.ajourDesktop = bridge as unknown as typeof window.ajourDesktop;
  return bridge;
}

/** The settings window as the app opens it: the page's search names it. */
function SettingsWindowHarness() {
  const location = useSettingsWindowLocation();
  return location ? <SettingsWindowPage location={location} /> : null;
}

async function renderDiagnostics(search = "tab=actions") {
  const view = await renderRoutes({
    routes: { "/": SettingsWindowHarness },
    path: `/?settings=${encodeURIComponent(`diagnostics?${search}`)}`,
  });
  // The page's code loads first.
  await screen.findByRole("tab", { name: "Actions" }, { timeout: 10_000 });
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => {});
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

const actionRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-action-trace]"));
const listedTraces = () => actionRows().map((row) => row.dataset.actionTrace);
const waterfallRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-waterfall-row]"));
const barOf = (row: HTMLElement) =>
  row.querySelector<HTMLElement>("[data-waterfall-bar]")!;
const filter = (name: string) => screen.getByRole("button", { name });
const settingsSearch = (router: { state: { location: { search: unknown } } }) =>
  new URLSearchParams(
    String(
      (router.state.location.search as Record<string, unknown>).settings,
    ).split("?")[1],
  );

describe("the Actions tab", () => {
  it("draws a backlog sync that failed at the broker in four levels, the three broker requests failed", async () => {
    installMain();
    await renderDiagnostics(`tab=actions&trace=${RATE_LIMITED_SYNC_TRACE}`);

    const rows = waterfallRows();
    expect(new Set(rows.map((row) => row.dataset.depth))).toEqual(
      new Set(["0", "1", "2", "3"]),
    );
    const broker = rows.filter((row) => row.dataset.lane === "broker");
    expect(broker).toHaveLength(3);
    for (const row of broker) {
      expect(row.dataset.failed).toBe("true");
      expect(barOf(row).className).toContain("bg-destructive");
      expect(row.textContent).toContain("rate_limited");
    }

    const note = screen.getByRole("note", { name: "Root cause" });
    expect(note.textContent).toContain(
      "plugin.request was refused in the broker",
    );
    expect(note.textContent).toContain("rate_limited");
    expect(note.textContent).toContain("broker holds each plugin to a rate");
  });

  it("lists one row per action: its name, trigger and surface, connection, outcome and duration", async () => {
    installMain();
    cachePluginsOverview({
      connectionGroups: [
        {
          plugin: { id: "jira" },
          connections: [{ id: "conn-jira", label: "Contoso Jira" }],
        },
      ],
    } as never);
    await renderDiagnostics();

    expect(listedTraces()).toEqual([RATE_LIMITED_SYNC_TRACE, OK_TRACE]);
    const row = actionRows()[0]!;
    expect(row.textContent).toContain("backlog.sync");
    expect(row.textContent).toContain("User · button");
    expect(row.textContent).toContain("Contoso Jira");
    expect(row.textContent).toContain("Error");
    const duration = row.querySelector('[data-slot="value"]');
    expect(duration?.textContent).toBe("1.50 s");
    expect(actionRows()[1]!.textContent).toContain("Schedule");
  });

  it("keeps the trigger, surface and connection on a second line in the narrow layout", async () => {
    installMain();
    cachePluginsOverview({
      connectionGroups: [
        {
          plugin: { id: "jira" },
          connections: [{ id: "conn-jira", label: "Contoso Jira" }],
        },
      ],
    } as never);
    await renderDiagnostics();

    // jsdom applies no breakpoint: read what the narrow layout doesn't hide.
    const shownNarrow = Array.from(
      actionRows()[0]!.querySelectorAll<HTMLElement>("span"),
    ).filter(
      (span) =>
        !span.className.split(" ").includes("hidden") &&
        !span.closest(".hidden"),
    );
    expect(shownNarrow.map((span) => span.textContent)).toContain(
      "User · button · Contoso Jira",
    );
  });

  it.each([
    [
      "a filter change",
      () => click(filter("Failed")),
      [RATE_LIMITED_SYNC_TRACE],
    ],
    [
      "a Refresh",
      () => click(screen.getByRole("button", { name: "Refresh" })),
      [RATE_LIMITED_SYNC_TRACE, OK_TRACE],
    ],
  ] as const)(
    "drops a Show more page that answers after %s",
    async (_, change, expected) => {
      const main = installMain();
      let answerMore: (actions: DesktopLogAction[]) => void = () => {};
      main.listLogActions.mockImplementation(
        async (
          { show = "all" }: { show?: DesktopLogActionView },
          page?: { cursor?: string },
        ) => {
          const all = [actionOf(rateLimitedBacklogSync()), actionOf(okSync())];
          const actions = page?.cursor
            ? await new Promise<DesktopLogAction[]>((resolve) => {
                answerMore = resolve;
              })
            : show === "failed"
              ? all.slice(0, 1)
              : all;
          return {
            show,
            actions,
            next_cursor: show === "all" ? `after-${actions.length}` : null,
            match_count: actions.length,
            file_count: 1,
            missing_file_count: 0,
            skipped_line_count: 0,
          };
        },
      );
      await renderDiagnostics();
      await click(screen.getByRole("button", { name: "Show more" }));

      await change();
      await act(async () =>
        answerMore([actionOf(traceOf(AGENT_TOOL_TRACE, agentToolCall()))]),
      );
      await settle();

      expect(listedTraces()).toEqual(expected);
      // Failed has one page: the old page's cursor doesn't come back.
      expect(screen.queryByRole("button", { name: "Show more" }) !== null).toBe(
        expected.length > 1,
      );
    },
  );

  it.each([
    ["Failed", "failed", [RATE_LIMITED_SYNC_TRACE]],
    ["Slow", "slow", [OK_TRACE]],
  ] as const)(
    "shows only the %s actions, and All shows every one again",
    async (name, show, traces) => {
      const main = installMain();
      const { router } = await renderDiagnostics();
      expect(filter("All").getAttribute("aria-pressed")).toBe("true");

      await click(filter(name));

      expect(main.listLogActions.mock.lastCall?.[0]).toEqual({ show });
      expect(listedTraces()).toEqual(traces);
      expect(filter(name).getAttribute("aria-pressed")).toBe("true");
      expect(settingsSearch(router).get("show")).toBe(show);

      await click(filter("All"));

      expect(listedTraces()).toEqual([RATE_LIMITED_SYNC_TRACE, OK_TRACE]);
      expect(settingsSearch(router).get("show")).toBeNull();
    },
  );

  it("opens on the filter its search names", async () => {
    installMain();
    await renderDiagnostics("tab=actions&show=failed");

    expect(filter("Failed").getAttribute("aria-pressed")).toBe("true");
    expect(listedTraces()).toEqual([RATE_LIMITED_SYNC_TRACE]);
  });

  it("says when no action failed", async () => {
    installMain({ traces: [okSync()] });
    await renderDiagnostics("tab=actions&show=failed");

    expect(listedTraces()).toEqual([]);
    expect(screen.getByText("No action failed")).toBeTruthy();
  });

  it("opens the trace the Events tab names, also when it isn't on the list's page", async () => {
    const main = installMain({ listed: [OK_TRACE] });
    await renderDiagnostics(`tab=actions&trace=${RATE_LIMITED_SYNC_TRACE}`);

    expect(
      screen
        .getByRole("tab", { name: "Actions" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(main.getLogTrace.mock.calls.map(([id]) => id)).toEqual([
      RATE_LIMITED_SYNC_TRACE,
    ]);
    expect(listedTraces()).toEqual([OK_TRACE]);
    expect(waterfallRows()).toHaveLength(6);
  });

  it("shows a trace when its row is picked, and marks the row", async () => {
    const main = installMain();
    const { router } = await renderDiagnostics();
    expect(waterfallRows()).toHaveLength(0);
    expect(main.getLogTrace).not.toHaveBeenCalled();

    await click(within(actionRows()[1]!).getByRole("button"));

    expect(main.getLogTrace.mock.calls.map(([id]) => id)).toEqual([OK_TRACE]);
    expect(settingsSearch(router).get("trace")).toBe(OK_TRACE);
    expect(
      within(actionRows()[1]!).getByRole("button").getAttribute("aria-current"),
    ).toBe("true");
    expect(waterfallRows()).toHaveLength(4);
    expect(screen.queryByRole("note", { name: "Root cause" })).toBeNull();
  });

  it("colors each runtime's bars with the chart tokens, and names them in a legend", async () => {
    installMain();
    await renderDiagnostics(`tab=actions&trace=${OK_TRACE}`);

    expect(
      waterfallRows().map((row) => [row.dataset.lane, barOf(row).className]),
    ).toEqual([
      ["renderer", expect.stringContaining("bg-chart-1")],
      ["api", expect.stringContaining("bg-chart-2")],
      ["plugin", expect.stringContaining("bg-chart-3")],
      ["broker", expect.stringContaining("bg-chart-4")],
    ]);
    const legend = screen.getByRole("list", { name: "Runtimes" });
    expect(legend.textContent).toBe("RendererLocal APIPlugin workerBroker");
  });

  it("shows an agent tool call with the writes it caused", async () => {
    installMain({ traces: [traceOf(AGENT_TOOL_TRACE, agentToolCall())] });
    await renderDiagnostics(`tab=actions&trace=${AGENT_TOOL_TRACE}`);

    const calls = screen.getByRole("list", { name: "Tool calls" });
    const items = within(calls).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("update_backlog_item");
    expect(items[0]!.textContent).toContain(
      "2 writes recorded · Ran backlog_item.update, time_entry.create · Undo offered",
    );
  });

  it("shows every tool call of an agent run, found by its client while it ran", async () => {
    const main = installMain({
      traces: [agentRun()],
      events: [
        ...agentToolCall("6aa92f3577b34da6a3ce929d0e0e4738", {
          at: 1000,
          tool: "list_backlog_items",
        }),
        ...agentToolCall("7bb92f3577b34da6a3ce929d0e0e4739", {
          at: 4000,
          tool: "create_time_entry",
        }),
        ...agentToolCall("8cc92f3577b34da6a3ce929d0e0e4730", {
          at: 5000,
          clientId: "another-client",
        }),
      ],
    });
    await renderDiagnostics(`tab=actions&trace=${RUN_TRACE}`);

    expect(
      main.queryLogs.mock.calls.map(([filter, page]) => [filter, page]),
    ).toEqual([
      [
        {
          name: "agent_tool.call",
          from: "2026-11-17T10:00:00.000Z",
          to: "2026-11-17T10:00:09.001Z",
        },
        { limit: 500 },
      ],
    ]);
    const calls = screen.getByRole("list", { name: "Tool calls" });
    expect(
      within(calls)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("[data-tool]")?.textContent),
    ).toEqual(["list_backlog_items", "create_time_entry"]);
  });

  it("says when it can't read the actions", async () => {
    installMain({ refuseList: true });
    await renderDiagnostics();

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't read the actions.",
    );
  });

  it("says when a trace is no longer in the log file", async () => {
    installMain();
    await renderDiagnostics(
      "tab=actions&trace=ffffffffffffffffffffffffffffffff",
    );

    expect(
      screen.getByText("This trace isn't in the log file anymore"),
    ).toBeTruthy();
  });
});
