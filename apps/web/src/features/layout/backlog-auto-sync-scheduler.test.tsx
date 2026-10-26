// @vitest-environment jsdom
import type { PluginsOverview } from "@ajour/shared";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { BacklogAutoSyncScheduler } from "@/features/layout/backlog-auto-sync-scheduler";
import { replaceEventSink } from "@/lib/wide-events";
import { installDomShims } from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";

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
