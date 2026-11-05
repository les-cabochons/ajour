import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  exampleProjectSourceDirectory,
  exampleProjectSourceManifest,
} from "../../../../packages/example/index.ts";
import {
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
} from "@/test-support/local-api";

/*
 * The project source sync runner (#505) against the real local API, with
 * the example project source plugin and its fixture: the renderer's job,
 * the route, the plugin, and what the store keeps.
 */

const PLUGIN = exampleProjectSourceManifest.id;
const STATE_KEY = "ajour.local-state.v2";

let api: Awaited<ReturnType<typeof startLocalApi>>;
let storage: Map<string, string>;

function installWindow() {
  storage = new Map();
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

async function load() {
  const sink = createRecordingSink<AjourEvent>();
  (await import("@/lib/wide-events")).replaceEventSink(sink);
  const appApi = await import("@/lib/app-api");
  const { localStore } = await import("@/lib/local-store");
  const { syncProjectSourceConnection } =
    await import("@/lib/project-source-sync");
  const { connection } = await appApi.savePluginConnection(PLUGIN, {
    label: "Planner",
    tenantLabel: "Example",
    serviceUrl: "https://planner.example",
  });
  return {
    appApi,
    localStore,
    sync: (trigger?: "user" | "schedule") =>
      syncProjectSourceConnection(PLUGIN, connection.id, { trigger }),
    connectionId: connection.id,
    recorded: sink.events,
  };
}

describe("a project source sync", () => {
  it("links the local project with the fixture's code, adds the rest, and records one job with counts", async () => {
    const { localStore, sync, connectionId, recorded } = await load();
    const localId = localStore.addProject({
      name: "Acme support",
      code: "ACME-SUP",
      color: "#123456",
    });

    const outcome = await sync();

    expect(outcome).toMatchObject({
      kind: "applied",
      label: "Example planner",
      counts: { linked: 1, created: 1, archived: 1, held: 0 },
    });
    const projects = localStore.snapshot().projects;
    expect(projects.find((project) => project._id === localId)).toMatchObject({
      name: "Acme - Support",
      source: { pluginId: PLUGIN, connectionId, remoteId: "ACME-SUP" },
    });
    expect(
      projects.find((project) => project.name === "Globex - Internal"),
    ).toMatchObject({ status: "archived" });
    expect(localStore.snapshot().projectSources?.[connectionId]).toMatchObject({
      label: "Example planner",
      asOf: "2026-10-31T23:59:59.000Z",
    });

    const job = recorded.find(
      (event) => event.name === "project_source.sync" && event.kind === "job",
    )!;
    expect(job).toMatchObject({
      runtime: "renderer",
      trigger: "user",
      outcome: "ok",
      plugin: { id: PLUGIN },
      connection: { id: connectionId },
      project_source_sync: {
        trigger: "manual",
        fresh: true,
        unchanged: false,
        linked_count: 1,
        created_count: 1,
        archived_count: 1,
        held_count: 0,
      },
      counts: expect.objectContaining({ api_call_count: 2 }),
    });
    // The store command folds into the job: no event of its own.
    expect(
      recorded.some((event) => event.name === "project_source.apply_sync"),
    ).toBe(false);
    // No name from the snapshot reaches the event.
    expect(JSON.stringify(job)).not.toMatch(/Acme|Globex|Ticket/);
    const request = await waitForEvent(
      api.events,
      (event) =>
        event.name === "project_source.sync" && event.kind === "request",
    );
    expect(request).toMatchObject({
      trace_id: job.trace_id,
      parent_span_id: job.span_id,
    });
  });

  it("keeps the projects when the source has nothing new, and asks for all of it when the web holds nothing", async () => {
    const { localStore, sync, connectionId } = await load();
    await sync();
    const before = localStore.snapshot().projects;

    expect(await sync("schedule")).toEqual({ kind: "unchanged" });
    expect(localStore.snapshot().projects).toEqual(before);

    // Another workspace on the same API: it holds nothing yet, so the
    // cursor the API kept must not leave it empty.
    storage.delete(STATE_KEY);
    vi.resetModules();
    const again = await import("@/lib/project-source-sync");
    const freshStore = (await import("@/lib/local-store")).localStore;
    const managed = () =>
      freshStore.snapshot().projects.filter((project) => project.source);
    expect(managed()).toHaveLength(0);

    const outcome = await again.syncProjectSourceConnection(
      PLUGIN,
      connectionId,
    );

    expect(outcome).toMatchObject({ kind: "applied", counts: { created: 2 } });
    expect(managed()).toHaveLength(2);
  });

  it("turns the managed projects into local ones when the connection is removed", async () => {
    const { appApi, localStore, sync, connectionId } = await load();
    await sync();

    await appApi.deletePluginConnection(PLUGIN, connectionId);

    const state = localStore.snapshot();
    expect(state.projectSources).toEqual({});
    expect(state.projects.every((project) => !project.source)).toBe(true);
    expect(
      state.projects.find((project) => project.name === "Acme - Support"),
    ).toMatchObject({ code: "ACME-SUP", status: "active" });
  });
});
