// @vitest-environment jsdom
import type { PluginsOverview } from "@ajour/shared";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Toaster } from "@/components/ui/toast";
import { BacklogAutoSyncScheduler } from "@/features/layout/backlog-auto-sync-scheduler";
import { localStore } from "@/lib/local-store";
import { replaceEventSink } from "@/lib/wide-events";
import { installDomShims } from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { fixtureSnapshot } from "../../../../../packages/example/index.ts";

/*
 * The scheduler's tick is no unit of work: reading the overview to find the
 * due connections records nothing. Each sync it starts is one job.
 */

let sink: ReturnType<typeof createRecordingSink<AjourEvent>>;

beforeAll(installDomShims);

beforeEach(() => {
  sink = createRecordingSink<AjourEvent>();
  replaceEventSink(sink);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The code host connection, with automatic sync on and last synced at `lastSyncAt`. */
function overviewSyncedAt(lastSyncAt: number): PluginsOverview {
  const overview = structuredClone(codeHostOverview);
  const connection = overview.connectionGroups[0]!.connections[0]!;
  connection.autoSync = true;
  connection.lastSyncAt = lastSyncAt;
  return overview;
}

function stubApi(overview: PluginsOverview) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({
          viewer: { login: "alex", isBot: false },
          pullRequests: [pullRequestFacts],
        })
      : Response.json(overview),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("the automatic sync scheduler", () => {
  it("records nothing for a tick that finds no connection due", async () => {
    const fetch = stubApi(overviewSyncedAt(Date.now()));

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Let the tick finish with what it read.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sink.events).toEqual([]);
  });

  it("leaves a connection paused for its secret alone, as it would only fail, and still syncs the others that are due", async () => {
    const overview = overviewSyncedAt(1);
    const [paused] = overview.connectionGroups[0]!.connections;
    paused!.paused = {
      reason: "secret_rejected",
      message: "The service rejected this connection's saved token.",
    };
    // A second connection of the same plugin, due too, with its token intact.
    overview.connectionGroups[0]!.connections.push({
      ...structuredClone(paused!),
      id: "other",
      label: "Other",
      paused: undefined,
    });
    const fetch = stubApi(overview);

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(sink.events).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pull_request.sync",
        outcome: "ok",
        connection: { id: "other" },
      }),
    ]);
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/connections/other/"))).toBe(true);
    expect(
      urls.some((url) => url.includes(`/connections/${paused!.id}/`)),
    ).toBe(false);
  });

  it("leaves the pull requests of a connection whose access leaves them off alone, and syncs those of a connection that has them on", async () => {
    const overview = overviewSyncedAt(1);
    const group = overview.connectionGroups[0]!;
    group.connectionAccess = [
      {
        id: "readBacklog",
        label: "Read the backlog",
        always: true,
        operations: [],
      },
      {
        id: "pullRequests",
        label: "Pull requests",
        always: false,
        operations: ["syncPullRequests"],
      },
    ];
    const [readsOnly] = group.connections;
    readsOnly!.access = ["readBacklog"];
    group.connections.push({
      ...structuredClone(readsOnly!),
      id: "other",
      label: "Other",
      access: ["readBacklog", "pullRequests"],
    });
    const fetch = stubApi(overview);

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(sink.events).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pull_request.sync",
        outcome: "ok",
        connection: { id: "other" },
      }),
    ]);
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(
      urls.some((url) => url.includes(`/connections/${readsOnly!.id}/`)),
    ).toBe(false);
  });

  it("records one scheduled job for each sync it starts, and nothing for the tick", async () => {
    const fetch = stubApi(overviewSyncedAt(1));

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(sink.events).toHaveLength(1));

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pull_request.sync",
        kind: "job",
        trigger: "schedule",
        outcome: "ok",
        connection: { id: "work" },
      }),
    ]);
    // The tick's overview read sent no trace; the sync's calls sent its own.
    const traceparents = fetch.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>).traceparent,
    );
    expect(traceparents[0]).toBeUndefined();
    expect(new Set(traceparents.slice(1))).toEqual(
      new Set([`00-${sink.events[0]!.trace_id}-${sink.events[0]!.span_id}-01`]),
    );
  });
});

describe("the scheduler and a project source", () => {
  const MINUTE = 60_000;

  beforeEach(() => {
    localStore.removeConnectionProjectSource("work");
    sink.events.length = 0;
  });

  /** The web last applied a snapshot from the connection `minutesAgo` minutes ago. */
  function appliedMinutesAgo(minutesAgo: number) {
    localStore.applyProjectSourceSync(
      { pluginId: "planner", connectionId: "work" },
      fixtureSnapshot,
      Date.now() - minutesAgo * MINUTE,
    );
    // Only the scheduler's syncs count.
    sink.events.length = 0;
  }

  /**
   * A project source connection whose shared last sync time, which its other
   * capabilities move too, is `minutesAgo` minutes ago.
   */
  function projectSourceOverview(minutesAgo: number): PluginsOverview {
    const overview = structuredClone(codeHostOverview);
    const group = overview.connectionGroups[0]!;
    group.plugin = {
      ...group.plugin,
      id: "planner",
      apiVersion: 4,
      displayName: "Planner",
      capabilities: { projectSource: {} },
    };
    const connection = group.connections[0]!;
    connection.pluginId = "planner";
    // Its own interval is the backlog's: Managed projects keep 15 minutes.
    connection.autoSyncIntervalMinutes = 60;
    connection.lastSyncAt = Date.now() - minutesAgo * MINUTE;
    return overview;
  }

  function stubProjectSourceApi(overview: PluginsOverview) {
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "POST" && url.endsWith("/sync-projects")
        ? Response.json({
            connection: overview.connectionGroups[0]!.connections[0],
            unchanged: true,
          })
        : Response.json(overview),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  /** Renders the scheduler and waits for its first tick to settle. */
  async function tickOnce(fetch: ReturnType<typeof vi.fn>) {
    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("syncs a project source connection every 15 minutes of its own, as an automatic sync", async () => {
    appliedMinutesAgo(16);
    // A backlog sync of the same connection a minute ago doesn't count.
    const fetch = stubProjectSourceApi(projectSourceOverview(1));

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(sink.events).toHaveLength(1));

    expect(sink.events[0]).toMatchObject({
      name: "project_source.sync",
      kind: "job",
      trigger: "schedule",
      plugin: { id: "planner" },
      connection: { id: "work" },
    });
    const [url, init] = fetch.mock.calls.find(([, call]) =>
      Boolean(call?.method === "POST"),
    )!;
    expect(String(url)).toContain(
      "/api/plugins/planner/connections/work/sync-projects",
    );
    expect(JSON.parse(String(init!.body))).toMatchObject({ trigger: "auto" });
  });

  it("syncs at once a project source the web holds nothing from", async () => {
    const fetch = stubProjectSourceApi(projectSourceOverview(1));

    render(<BacklogAutoSyncScheduler />);
    await waitFor(() => expect(sink.events).toHaveLength(1));

    expect(sink.events[0]).toMatchObject({
      name: "project_source.sync",
      project_source_sync: { fresh: true },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sync-projects"),
      expect.anything(),
    );
  });

  it("leaves a project source it applied less than 15 minutes ago alone, however old the shared last sync", async () => {
    appliedMinutesAgo(10);
    const fetch = stubProjectSourceApi(projectSourceOverview(60));

    await tickOnce(fetch);

    expect(sink.events).toEqual([]);
  });

  it("leaves a project source whose Managed projects switch is off alone", async () => {
    const overview = projectSourceOverview(16);
    overview.connectionGroups[0]!.inactiveCapabilities = ["projectSource"];
    const fetch = stubProjectSourceApi(overview);

    await tickOnce(fetch);

    expect(sink.events).toEqual([]);
  });
});

describe("the scheduler's failure toasts", () => {
  const TIMED_OUT = 'Plugin "github" timed out while handling syncConnection.';
  const TOO_MANY = "The plugin sent too many requests. Try again in a moment.";

  /** The code host connection, due for its pull requests and, with `backlog`, its backlog items too. */
  function failingOverview({ backlog }: { backlog: boolean }) {
    const overview = overviewSyncedAt(1);
    if (backlog) {
      overview.connectionGroups[0]!.plugin.capabilities = {
        connector: {},
        codeHost: {},
      };
    }
    return overview;
  }

  /** Answers the overview, and each sync with the next of `errors` for its route. */
  function stubFailingApi(
    overview: PluginsOverview,
    errors: { sync?: string[]; pullRequests: string[] },
  ) {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json(overview);
      const queue = url.endsWith("/syncPullRequests")
        ? errors.pullRequests
        : errors.sync!;
      return Response.json({ error: queue.shift() }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Each toast on screen, as its title and its text. */
  function shownToasts() {
    return screen
      .queryAllByRole("alertdialog", { hidden: true })
      .map((toast) => ({
        title: toast.querySelector("h2")?.textContent,
        text: toast.querySelector("p")?.textContent,
      }));
  }

  it("shows one toast for a connection whose backlog items and pull requests both fail, with a line for each", async () => {
    stubFailingApi(failingOverview({ backlog: true }), {
      sync: [TIMED_OUT],
      pullRequests: [TOO_MANY],
    });

    render(
      <>
        <Toaster />
        <BacklogAutoSyncScheduler />
      </>,
    );

    // The pull requests' failure joined the backlog's toast.
    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          title: "Work sync failed",
          text: `Backlog items: ${TIMED_OUT}\nPull requests: ${TOO_MANY}`,
        },
      ]),
    );
  });

  it("replaces a connection's toast when a later poll fails with another reason, instead of stacking a second one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFailingApi(failingOverview({ backlog: false }), {
      pullRequests: [TIMED_OUT, TOO_MANY],
    });

    render(
      <>
        <Toaster />
        <BacklogAutoSyncScheduler />
      </>,
    );
    await waitFor(() =>
      expect(shownToasts()).toEqual([
        { title: "Work sync failed", text: TIMED_OUT },
      ]),
    );

    // The connection is still due, so the next poll tries again.
    await vi.advanceTimersByTimeAsync(30_000);

    await waitFor(() =>
      expect(shownToasts()).toEqual([
        { title: "Work sync failed", text: TOO_MANY },
      ]),
    );
  });
});
