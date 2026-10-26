import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@ajour/wide-events/catalog.ts";
import {
  createLocalLogFile,
  type LocalLogFile,
} from "@ajour/wide-events/local-log-file.ts";
import {
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
} from "@/test-support/local-api";

/*
 * The renderer's events reach the local log file (#440), end to end: the
 * renderer's real sink, chosen as on desktop with logging on, forwards its
 * batches through a bridge that hands them to the package's local log file,
 * as main does with each batch, and the real local API writes to the same
 * file through its event sink, as main gives it. A backlog sync's renderer
 * job, the API's request and the plugin operation can then be joined in the
 * file by their trace and their launch.
 */

const LAUNCH = {
  launch_id: "launch-from-main",
  app: { version: "1.4.0", channel: "stable", packaged: true },
  device: { platform: "win32", arch: "x64" },
} as const;

let root: string;
let file: LocalLogFile;
let api: Awaited<ReturnType<typeof startLocalApi>>;
let windowListeners: Map<string, (() => void)[]>;

/** A desktop window whose preload forwards the renderer's events to `file`. */
function installDesktopWindow() {
  const values = new Map<string, string>();
  windowListeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: () => void) =>
      windowListeners.set(type, [
        ...(windowListeners.get(type) ?? []),
        listener,
      ]),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
    ajourDesktop: {
      runtime: {
        automaticUpdatesEnabled: false,
        developmentBuild: false,
        platform: "win32",
        version: LAUNCH.app.version,
        launch: LAUNCH,
      },
      // IPC sends a structured clone; main checks the batch and writes it.
      forwardWideEvents: (batch: unknown) =>
        file.forward(structuredClone(batch), {
          runtime: "renderer",
          launch_id: LAUNCH.launch_id,
        }),
      onWideEventsForwarding: (callback: (forwarding: boolean) => void) => {
        callback(true);
        return () => undefined;
      },
    },
  });
}

/** What the page does when it hides: its `pagehide` listeners run. */
function hidePage() {
  for (const listener of windowListeners.get("pagehide") ?? []) listener();
}

async function linesInTheFile() {
  await file.flush();
  const directory = path.join(root, "logs", "events");
  const lines: Record<string, unknown>[] = [];
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const line of text.split("\n").filter(Boolean)) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ajour-renderer-logs-"));
  file = createLocalLogFile({
    directory: path.join(root, "logs", "events"),
    catalog,
    settings: {
      enabled: true,
      retention_days: 7,
      size_limit_mb: 250,
      include_sensitive: false,
    },
  });
  api = await startLocalApi({
    eventSink: file.sink,
    launch: {
      id: LAUNCH.launch_id,
      appVersion: LAUNCH.app.version,
      packaged: true,
    },
  });
  vi.resetModules();
  vi.stubEnv("VITE_APP_API_BASE_URL", api.baseUrl);
  vi.stubGlobal("fetch", fetchAsTheApp);
  installDesktopWindow();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await api.stop();
  await rm(root, { recursive: true, force: true });
});

describe("the renderer's events in the local log file", () => {
  it("joins a backlog sync's renderer job, API request and plugin operation by trace and launch, with a store command beside them", async () => {
    const { localStore } = await import("@/lib/local-store");
    const appApi = await import("@/lib/app-api");
    const { appPluginSettingsDependencies } =
      await import("@/features/settings/use-plugin-settings-workflow");
    const { createPluginSettingsWorkflow } =
      await import("@/features/settings/plugin-settings-workflow");
    const workflow = createPluginSettingsWorkflow({
      ...appPluginSettingsDependencies(),
      subscribeCatalog: () => () => undefined,
    });

    const itemId = localStore.addWorkItem({ title: "Secret roadmap item" });
    const { connection } = await appApi.savePluginConnection("jira", {
      label: "Work",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      token: "tok_local_log_canary",
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
    await waitForEvent(
      api.events,
      (event) =>
        event.name === "backlog.sync" && event.kind === "plugin_operation",
    );
    hidePage();

    const lines = await linesInTheFile();
    const find = (runtime: string, kind: string, name: string) =>
      lines.find(
        (line) =>
          line.runtime === runtime && line.kind === kind && line.name === name,
      );
    const command = find("renderer", "command", "backlog_item.create");
    const job = find("renderer", "job", "backlog.sync");
    const request = find("api", "request", "backlog.sync");
    const operation = find("api", "plugin_operation", "backlog.sync");

    expect(command).toMatchObject({
      outcome: "ok",
      backlog_item: { id: itemId },
    });
    expect(job).toMatchObject({
      outcome: "ok",
      connection: { id: connection.id },
    });
    expect(request).toMatchObject({
      trace_id: job!.trace_id,
      parent_span_id: job!.span_id,
    });
    expect(operation).toMatchObject({
      trace_id: job!.trace_id,
      parent_span_id: request!.span_id,
    });
    // Every runtime reports the launch main handed over.
    expect(new Set(lines.map((line) => line.launch_id))).toEqual(
      new Set([LAUNCH.launch_id]),
    );
    const text = JSON.stringify(lines);
    expect(text).not.toContain("Secret roadmap item");
    expect(text).not.toContain("tok_local_log_canary");
  });
});
