import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  exampleProjectSourceDirectory,
  exampleProjectSourceManifest,
} from "../../../../packages/example/index.ts";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";
import { fetchAsTheApp, startLocalApi } from "@/test-support/local-api";

/*
 * A time sync round (#692) against the real local API, with the example
 * planner: its project source manages Acme - Support, and its time sync
 * keeps an in-memory remote per connection. The round is the renderer's
 * job: it plans from the local store, sends through the route, and keeps
 * what the plugin answered.
 */

const PLUGIN = exampleProjectSourceManifest.id;
const HOUR = 3_600_000;

let api: Awaited<ReturnType<typeof startLocalApi>>;

function installWindow() {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage,
    sessionStorage: localStorage,
  });
}

beforeEach(async () => {
  api = await startLocalApi({
    pluginDirectories: [exampleProjectSourceDirectory],
  });
  vi.resetModules();
  vi.stubEnv("VITE_APP_API_BASE_URL", api.baseUrl);
  vi.stubGlobal("fetch", fetchAsTheApp);
  installWindow();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await api.stop();
});

/**
 * A connection with Time entries on, whose managed projects are synced, and
 * one entry of 1:30 today on Ticket #101 - Login.
 */
async function load() {
  const sink = createRecordingSink<AjourEvent>();
  (await import("@/lib/wide-events")).replaceEventSink(sink);
  const appApi = await import("@/lib/app-api");
  const { localStore } = await import("@/lib/local-store");
  const { syncProjectSourceConnection } =
    await import("@/lib/project-source-sync");
  const { runTimeSyncRound } = await import("@/lib/time-sync");
  const { connection } = await appApi.savePluginConnection(PLUGIN, {
    label: "Planner",
    tenantLabel: "Example",
    serviceUrl: "https://planner.example",
  });
  await appApi.setPluginEnabled(PLUGIN, true, "timeSync");
  await syncProjectSourceConnection(PLUGIN, connection.id);
  const project = localStore
    .snapshot()
    .projects.find((candidate) => candidate.source?.remoteId === "ACME-SUP")!;
  const task = project.tasks.find(
    (candidate) => candidate.name === "Ticket #101 - Login",
  )!;
  localStore.saveManualTimeEntry({
    localDate: formatLocalDateFromTimestamp(Date.now()),
    projectId: project._id,
    taskId: task._id,
    note: "Fixed the redirect for Acme",
    durationMs: 1.5 * HOUR,
  });
  const entryId = localStore.snapshot().timesheetEntries.at(-1)!._id;
  return {
    appApi,
    localStore,
    connectionId: connection.id,
    entryId,
    round: (trigger: Parameters<typeof runTimeSyncRound>[2]) =>
      runTimeSyncRound(PLUGIN, connection.id, trigger),
    jobs: () =>
      sink.events.filter(
        (event) => event.name === "time_sync.round" && event.kind === "job",
      ),
  };
}

describe("a time sync round", () => {
  it("sends a saved entry, keeps its synced copy, and records one job with counts", async () => {
    const { localStore, connectionId, entryId, round, jobs } = await load();

    expect(await round("change")).toEqual({
      kind: "applied",
      synced: 1,
      refused: 0,
      failed: 0,
      waiting: 0,
    });

    const timeSync = localStore.snapshot().timeSyncs?.[connectionId];
    expect(timeSync?.copies[entryId]).toMatchObject({
      remoteId: expect.any(String),
      agreed: {
        minutes: 90,
        projectRemoteId: "ACME-SUP",
        taskName: "Ticket #101 - Login",
        taskRemoteId: "1001",
      },
    });
    expect(timeSync?.lastRound).toMatchObject({ synced: 1 });
    // A round is not a commit.
    expect(
      localStore.snapshot().timesheetEntries.find((e) => e._id === entryId),
    ).not.toHaveProperty("commit");

    expect(jobs()).toEqual([
      expect.objectContaining({
        runtime: "renderer",
        trigger: "schedule",
        outcome: "ok",
        plugin: { id: PLUGIN },
        connection: { id: connectionId },
        time_sync_round: {
          trigger: "change",
          change_count: 1,
          synced_count: 1,
          refused_count: 0,
          failed_count: 0,
          waiting_count: 0,
          entry_count: 1,
        },
      }),
    ]);
    // The store commands fold into the job, and no name or note reaches it.
    expect(JSON.stringify(jobs()[0])).not.toMatch(/Acme|Ticket|redirect/);
  });

  it("starts no round for a store write that leaves nothing to send, while the poll still lists the window", async () => {
    const { round, jobs } = await load();
    await round("change");

    expect(await round("change")).toEqual({ kind: "idle" });
    expect(jobs()).toHaveLength(1);

    expect(await round("poll")).toMatchObject({ kind: "applied", synced: 0 });
    expect(jobs().at(-1)).toMatchObject({
      time_sync_round: { trigger: "poll", change_count: 0 },
    });
  });

  it("keeps the change waiting and the error when the round fails, until one goes through", async () => {
    const { localStore, connectionId, entryId, round, jobs } = await load();
    await round("change");
    localStore.updateTimesheetEntry(entryId, { durationMs: 2 * HOUR });
    // The local API can't reach the plugin's service this once.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      String(url).endsWith("/sync-time-entries")
        ? new Response(JSON.stringify({ error: "The planner is down." }), {
            status: 502,
            headers: { "content-type": "application/json" },
          })
        : fetchAsTheApp(url, init),
    );

    await expect(round("change")).rejects.toThrow("The planner is down.");

    const failed = () => localStore.snapshot().timeSyncs?.[connectionId];
    expect(failed()?.copies[entryId]?.agreed.minutes).toBe(90);
    expect(failed()?.copies[entryId]?.changedAt).toEqual(expect.any(Number));
    expect(failed()?.error).toEqual({
      at: expect.any(Number),
      message: "The planner is down.",
    });
    expect(jobs().at(-1)).toMatchObject({
      outcome: "error",
      time_sync_round: { trigger: "change", change_count: 1 },
    });

    vi.stubGlobal("fetch", fetchAsTheApp);
    expect(await round("retry")).toMatchObject({ kind: "applied", synced: 1 });

    const recovered = localStore.snapshot().timeSyncs?.[connectionId];
    expect(recovered?.copies[entryId]?.agreed.minutes).toBe(120);
    expect(recovered?.copies[entryId]).not.toHaveProperty("changedAt");
    expect(recovered).not.toHaveProperty("error");
  });

  it("leaves Undo alone, and sends an Undo's result like any other change", async () => {
    const { localStore, connectionId, entryId, round } = await load();
    await round("change");
    const token = localStore.deleteTimesheetEntry(entryId)!;

    expect(await round("change")).toMatchObject({ synced: 1 });
    expect(localStore.snapshot().timeSyncs?.[connectionId]?.copies).toEqual({});

    // The round changed no entry, so the Undo still applies.
    expect(localStore.undo(token)).toBe("restored");
    expect(await round("change")).toMatchObject({ synced: 1 });
    expect(
      localStore.snapshot().timeSyncs?.[connectionId]?.copies[entryId],
    ).toMatchObject({ agreed: { minutes: 90 } });
  });

  it("drops the synced copies when Time entries goes off", async () => {
    const { appApi, localStore, connectionId, round } = await load();
    const { followTimeSyncSwitches } = await import("@/lib/time-sync");
    await round("change");

    followTimeSyncSwitches(
      await appApi.setPluginEnabled(PLUGIN, false, "timeSync"),
    );

    expect(localStore.snapshot().timeSyncs?.[connectionId]).toBeUndefined();
  });
});
