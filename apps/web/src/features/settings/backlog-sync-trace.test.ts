import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
} from "@/test-support/local-api";

/*
 * A backlog sync started from Settings, end to end against the started local
 * API (#310): the renderer's `backlog.sync` job, the local API's request and
 * the plugin operation are one trace, each the child of the one before.
 */

let api: Awaited<ReturnType<typeof startLocalApi>>;

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  });
}

beforeEach(async () => {
  api = await startLocalApi();
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

/** The Settings plugin workflow, on the real client, with a recording sink. */
async function loadSettings() {
  const sink = createRecordingSink<AjourEvent>();
  (await import("@/lib/wide-events")).replaceEventSink(sink);
  const appApi = await import("@/lib/app-api");
  const { appPluginSettingsDependencies } =
    await import("@/features/settings/use-plugin-settings-workflow");
  const { createPluginSettingsWorkflow } =
    await import("@/features/settings/plugin-settings-workflow");
  const workflow = createPluginSettingsWorkflow({
    ...appPluginSettingsDependencies(),
    subscribeCatalog: () => () => undefined,
  });
  return { appApi, workflow, recorded: sink.events };
}

describe("a backlog sync started from Settings", () => {
  it("is one trace: the renderer's job, the local API's request and the plugin operation", async () => {
    const { appApi, workflow, recorded } = await loadSettings();
    const { connection } = await appApi.savePluginConnection("jira", {
      label: "Work",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      token: "tok_trace_canary",
    });
    const disconnect = workflow.connect();

    try {
      expect(
        await workflow.execute({
          type: "sync",
          pluginId: "jira",
          connectionId: connection.id,
        }),
      ).toBe(true);
    } finally {
      disconnect();
    }

    const job = recorded.find((event) => event.name === "backlog.sync")!;
    const request = await waitForEvent(
      api.events,
      (event) => event.name === "backlog.sync" && event.kind === "request",
    );
    const operation = await waitForEvent(
      api.events,
      (event) =>
        event.name === "backlog.sync" && event.kind === "plugin_operation",
    );
    expect(job).toMatchObject({
      kind: "job",
      runtime: "renderer",
      trigger: "user",
      outcome: "ok",
      plugin: { id: "jira" },
      connection: { id: connection.id },
      backlog_sync: {
        trigger: "manual",
        mode: "review",
        items_sent: 0,
        staged_count: 1,
      },
      counts: expect.objectContaining({ api_call_count: 1 }),
    });
    expect(request).toMatchObject({
      runtime: "api",
      outcome: "ok",
      trace_id: job.trace_id,
      parent_span_id: job.span_id,
    });
    expect(operation).toMatchObject({
      runtime: "api",
      outcome: "ok",
      trace_id: job.trace_id,
      parent_span_id: request.span_id,
    });
    // The job is the trace's root, and the trace holds these three events.
    expect(job.parent_span_id).toBeUndefined();
    expect(
      [...recorded, ...api.events]
        .filter((event) => event.trace_id === job.trace_id)
        .map((event) => `${event.runtime} ${event.kind} ${event.name}`)
        .sort(),
    ).toEqual([
      "api plugin_operation backlog.sync",
      "api request backlog.sync",
      "renderer job backlog.sync",
    ]);
    // One renderer event for the sync, and nothing it carried.
    expect(recorded.filter((event) => event.name === "backlog.sync")).toEqual([
      job,
    ]);
    const everything = JSON.stringify([...recorded, ...api.events]);
    expect(everything).not.toContain("Secret roadmap item");
    expect(everything).not.toContain("tok_trace_canary");
  });
});
