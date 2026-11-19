// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeSyncRequest } from "@ajour/shared";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  exampleProjectSourceManifest,
  runExampleTimeSyncRound,
} from "../../../../packages/example/index.ts";

/*
 * When the time sync runner (#843) sends its rounds: a check every 5
 * seconds while the window shows and every 60 while it is hidden, with the
 * cursor of the last full answer and no changes, as long as nothing changed
 * in Ajour since. The local API is a stub whose sync-time-entries route
 * answers from the example planner's remote, which keeps a change marker.
 * The clock is fake, so a test moves it to each round.
 */

const API = "http://ajour.test";
const CONNECTION = "planner";

const plugin = {
  ...exampleProjectSourceManifest,
  connectionFields: exampleProjectSourceManifest.connectionFields.map(
    (field) => ({ secret: false, ...field }),
  ),
};

const connection = {
  id: CONNECTION,
  pluginId: plugin.id,
  label: "Planner",
  tenantLabel: "Example",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  lastSyncAt: 1,
  pendingImportCount: 0,
  selectedImportCount: 0,
  configSummary: {},
  editableValues: {
    label: "Planner",
    tenantLabel: "Example",
    serviceUrl: "https://planner.example",
  },
};

const overview = {
  vault: { state: "available" },
  pluginsEnabled: true,
  plugins: [plugin],
  connectionGroups: [
    {
      plugin,
      enabled: true,
      inactiveCapabilities: [],
      connections: [connection],
    },
  ],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};

/** Each round the route received, and how many times the window read the plugins overview. */
let requests: TimeSyncRequest[];
let overviewReads: number;
/** The error the route answers the next round with, as when the plugin's service is down. */
let failNext: string | undefined;
/** True for a plugin that keeps no change marker: its answers carry no cursor. */
let cursorless: boolean;
let visibility: DocumentVisibilityState;

function stubApi(remoteKey: string) {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === `${API}/api/plugins`) {
      overviewReads += 1;
      return Response.json(overview);
    }
    if (url.endsWith(`/connections/${CONNECTION}/sync-time-entries`)) {
      const request = JSON.parse(String(init?.body)) as TimeSyncRequest;
      requests.push(request);
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        return Response.json({ error }, { status: 502 });
      }
      const answer = runExampleTimeSyncRound(remoteKey, request);
      if (cursorless && "entries" in answer) delete answer.cursor;
      return Response.json(
        "unchanged" in answer ? answer : { connection, ...answer },
      );
    }
    throw new Error(`The stub API has no ${url}.`);
  });
}

/** Each round so far: a check sends the cursor, a full round none. */
const kinds = () =>
  requests.map((request) => (request.cursor === undefined ? "full" : "check"));

beforeEach(() => {
  requests = [];
  overviewReads = 0;
  failNext = undefined;
  cursorless = false;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  localStorage.clear();
  // The example planner manages Acme - Support.
  localStorage.setItem(
    "ajour.local-state.v2",
    JSON.stringify({
      projects: [
        {
          _id: "acme",
          name: "Acme - Support",
          code: "ACME-SUP",
          color: "#123456",
          icon: { kind: "preset", name: "dot" },
          status: "active",
          source: {
            pluginId: plugin.id,
            connectionId: CONNECTION,
            remoteId: "ACME-SUP",
            syncedAt: 1,
          },
          tasks: [
            {
              _id: "login",
              name: "Ticket #101 - Login",
              status: "active",
              createdAt: 1,
              source: { remoteId: "1001", assigned: true },
            },
          ],
        },
      ],
    }),
  );
  vi.resetModules();
  vi.stubEnv("VITE_APP_API_BASE_URL", API);
  stubApi(`runner-${crypto.randomUUID()}`);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * Starts the runner with the plugins overview already read, as the sync
 * scheduler leaves it, and runs it to its first full round, 5 seconds in.
 */
async function start() {
  const sink = createRecordingSink<AjourEvent>();
  (await import("@/lib/wide-events")).replaceEventSink(sink);
  const appApi = await import("@/lib/app-api");
  await appApi.getPluginsOverview();
  const { localStore } = await import("@/lib/local-store");
  const { startTimeSyncRunner } = await import("@/lib/time-sync");
  const listener = { failed: vi.fn(), succeeded: vi.fn() };
  const stop = startTimeSyncRunner(listener);
  overviewReads = 0;
  await vi.advanceTimersByTimeAsync(5_000);
  return { localStore, listener, stop };
}

describe("the time sync runner's checks", () => {
  it("lists once a minute for a plugin without a cursor, as the poll did before #843", async () => {
    cursorless = true;
    const { stop } = await start();
    expect(kinds()).toEqual(["full"]);

    // Checks come every 5 seconds, but the minute since the listing hasn't passed.
    await vi.advanceTimersByTimeAsync(55_000);
    expect(requests).toHaveLength(1);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual(["full", "full"]);
    stop();
  });

  it("checks every 5 seconds while the window shows, every 60 while it is hidden, and at once when it shows again", async () => {
    const { stop } = await start();
    expect(kinds()).toEqual(["full"]);
    expect(overviewReads).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual(["full", "check"]);
    expect(requests[1]).toMatchObject({ changes: [] });

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    // The check already due goes, then the next waits a minute.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(30_000);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual([
      "full",
      "check",
      "check",
      "check",
      "check",
      "check",
    ]);
    // Only the full round read the plugins overview.
    expect(overviewReads).toBe(1);
    stop();
  });

  it.each([
    [
      "an entry saved",
      (store: Awaited<ReturnType<typeof start>>["localStore"]) =>
        store.saveManualTimeEntry({
          localDate: "2026-11-02",
          projectId: "acme",
          taskId: "login",
          // Under 30 seconds: it stays local, so no round goes for it.
          durationMs: 10_000,
        }),
    ],
    [
      "a week submitted",
      (store: Awaited<ReturnType<typeof start>>["localStore"]) =>
        store.submitWeek(new Date().toISOString().slice(0, 10)),
    ],
    [
      "a project changed, as a project source sync does",
      (store: Awaited<ReturnType<typeof start>>["localStore"]) =>
        store.updateProject("acme", { color: "#654321" }),
    ],
  ])(
    "makes the round after %s a full one, without the cursor",
    async (_name, write) => {
      const { localStore, stop } = await start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(kinds()).toEqual(["full", "check"]);

      write(localStore);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(kinds()).toEqual(["full", "check", "full"]);
      expect(overviewReads).toBe(2);
      // The full round's answer gives the next check its cursor.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(kinds()).toEqual(["full", "check", "full", "check"]);
      stop();
    },
  );

  it("drops the cursor after a failed check, so the round after it is full", async () => {
    const { listener, stop } = await start();
    failNext = "The planner is down.";

    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual(["full", "check"]);
    expect(listener.failed).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: CONNECTION }),
      "The planner is down.",
    );

    // The retry goes 5 seconds later, and the checks wait for it.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual(["full", "check", "full"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kinds()).toEqual(["full", "check", "full", "check"]);
    stop();
  });
});
