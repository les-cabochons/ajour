import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

// The local log file in the main process (ADR 0014). main.cjs runs only
// inside Electron, so these tests run its own statements, the ones that make
// the local log file and the shared sink and register the logs channels, in
// a VM context, with a temporary user data folder.

const require = createRequire(import.meta.url);
const {
  createIpcListeners,
  refusedSender,
} = require("./electron/ipc-listeners.cjs");
const {
  createMainEvents,
  loadLocalLogFile,
  loadMainEmitter,
  loadMainSink,
} = require("./electron/main-events.cjs");
const {
  createLocalLogs,
  SWEEP_INTERVAL_MS,
} = require("./electron/local-logs.cjs");
const {
  DEFAULT_LOCAL_LOG_SETTINGS,
  loadLocalLogSettings,
  normalizeLocalLogSettings,
  saveLocalLogSettings,
} = require("./electron/local-log-settings.cjs");

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopRoot, "../..");
const wideEventsRoot = path.join(repoRoot, "packages/wide-events");
const source = (
  await readFile(path.join(desktopRoot, "electron/main.cjs"), "utf8")
).replace(/\r\n/g, "\n");

const temporaryDirectories: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function userDataFolder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-desktop-logs-"));
  temporaryDirectories.push(root);
  return root;
}

/** main.cjs from the line that starts with `start` to the one that starts with `end`. */
function section(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * main.cjs's local log file, shared sink and logs channels, with the user
 * data folder `userData`. With `record`, main's events go to a recording
 * sink; without it, main's emitter loads with the shared sink, as at launch.
 */
async function mainProcess({
  record = true,
  env = {},
}: { record?: boolean; env?: Record<string, string> } = {}) {
  const userData = await userDataFolder();
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const recording = recordingEvents();
  const events = record ? recording.events : createMainEvents();
  const activeWindow = { webContents: "active-window" };
  const context = vm.createContext({
    path,
    process: { env },
    app: {
      getPath: (name: string) => (name === "home" ? os.homedir() : userData),
    },
    internalAppApiRuntimeRoot: repoRoot,
    createLocalLogs,
    loadLocalLogFile,
    loadMainEmitter,
    loadMainSink,
    events,
    launch: {
      launch_id: "launch-1",
      app: { version: "1.2.0", channel: "stable", packaged: true },
      device: { platform: "win32" },
    },
    mainWindow: activeWindow,
    refusedSender,
    ipc: createIpcListeners(
      {
        handle(
          name: string,
          handler: (...args: unknown[]) => Promise<unknown>,
        ) {
          handlers.set(name, handler);
        },
      },
      { events },
    ),
  });
  vm.runInContext(
    section("const wideEventsRoot = ", "let internalAppApiServer = ") +
      section(
        "function assertActiveDesktopWindow(",
        "function assertDevelopmentBuild(",
      ) +
      section(
        "// The local log file's settings page",
        'ipc.handle("ajour:get-development-plugin-settings"',
      ),
    context,
  );
  const localLogs = vm.runInContext("localLogs", context);
  return {
    userData,
    directory: path.join(userData, "logs", "events"),
    recorded: recording.recorded,
    events,
    localLogs,
    mainEventSink: vm.runInContext("mainEventSink", context),
    invoke(
      channel: string,
      sender: unknown = activeWindow.webContents,
      ...args: unknown[]
    ) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
      return handler({ sender }, ...args) as Promise<Record<string, unknown>>;
    },
  };
}

/** Starts the real local API with `eventSink`, as main starts it. */
async function startApi(eventSink: unknown) {
  const { startAppApiServer, stopAppApiServer } =
    await import("../api/src/server.ts");
  const { MemorySecretVault } =
    await import("../api/src/test-support/memory-secret-vault.ts");
  const root = await userDataFolder();
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "app-api-state.json"),
    installedPluginDirectory: path.join(root, "plugins"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    vault: new MemorySecretVault(),
    eventSink: eventSink as never,
  });
  cleanups.push(() => stopAppApiServer(server));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function linesOf(file: string) {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("the local log settings", () => {
  it("default to off, 7 days, 250 MB and no sensitive fields", () => {
    expect(DEFAULT_LOCAL_LOG_SETTINGS).toEqual({
      enabled: false,
      retention_days: 7,
      size_limit_mb: 250,
      include_sensitive: false,
    });
    expect(normalizeLocalLogSettings(undefined)).toEqual(
      DEFAULT_LOCAL_LOG_SETTINGS,
    );
  });

  it("accept only the closed choices, and anything else takes its default", () => {
    expect(
      normalizeLocalLogSettings({
        enabled: true,
        retention_days: 90,
        size_limit_mb: 1000,
        include_sensitive: true,
      }),
    ).toEqual({
      enabled: true,
      retention_days: 90,
      size_limit_mb: 1000,
      include_sensitive: true,
    });
    expect(
      normalizeLocalLogSettings({
        enabled: "yes",
        retention_days: 14,
        size_limit_mb: "250",
        include_sensitive: 1,
      }),
    ).toEqual(DEFAULT_LOCAL_LOG_SETTINGS);
  });

  it("are stored in main, and a file that can't be read gives the defaults", async () => {
    const folder = await userDataFolder();
    const file = path.join(folder, "local-log-settings.json");

    saveLocalLogSettings(file, { enabled: true, retention_days: 30 });
    expect(loadLocalLogSettings(file)).toEqual({
      ...DEFAULT_LOCAL_LOG_SETTINGS,
      enabled: true,
      retention_days: 30,
    });

    await writeFile(file, "{ not json");
    expect(loadLocalLogSettings(file)).toEqual(DEFAULT_LOCAL_LOG_SETTINGS);
  });
});

describe("the logs channels", () => {
  it("logs.status: the settings, the state and what the folder holds, as an ipc event", async () => {
    const main = await mainProcess();

    await expect(main.invoke("ajour:get-logs-status")).resolves.toEqual({
      settings: DEFAULT_LOCAL_LOG_SETTINGS,
      state: "off",
      storage_bytes: 0,
      file_count: 0,
    });
    expect(main.recorded).toMatchObject([
      {
        name: "logs.status",
        kind: "ipc",
        outcome: "ok",
        ipc: { channel: "ajour:get-logs-status", sender_accepted: true },
        logs: { state: "off", file_count: 0, storage_bytes: 0 },
      },
    ]);
  });

  it("logs.configure: stores the settings in main, keeps what it leaves out, and turns writing on", async () => {
    const main = await mainProcess();

    const status = await main.invoke("ajour:configure-logs", undefined, {
      enabled: true,
      include_sensitive: true,
    });

    expect(status).toMatchObject({
      settings: {
        enabled: true,
        retention_days: 7,
        size_limit_mb: 250,
        include_sensitive: true,
      },
      state: "on",
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(main.userData, "local-log-settings.json"),
          "utf8",
        ),
      ),
    ).toEqual(status.settings);
    expect(main.recorded).toMatchObject([
      {
        name: "logs.configure",
        kind: "ipc",
        outcome: "ok",
        ipc: { channel: "ajour:configure-logs" },
        logs: {
          enabled_before: false,
          enabled_after: true,
          retention_days: 7,
          size_limit_mb: 250,
          include_sensitive: true,
        },
      },
    ]);
  });

  it("logs.configure sweeps at once when a limit changes, as its own logs.sweep event", async () => {
    const main = await mainProcess();
    await mkdir(main.directory, { recursive: true });
    await writeFile(path.join(main.directory, "2020-01-01.ndjson"), "{}\n");

    await main.invoke("ajour:configure-logs", undefined, { retention_days: 1 });

    await expect(readdir(main.directory)).resolves.toEqual([]);
    const sweep = main.recorded.find(({ name }) => name === "logs.sweep");
    const configure = main.recorded.find(
      ({ name }) => name === "logs.configure",
    );
    expect(sweep).toMatchObject({
      kind: "job",
      trigger: "user",
      parent_span_id: configure?.span_id,
      logs: {
        trigger: "settings",
        deleted_file_count: 1,
        deleted_bytes: 3,
        file_count: 0,
        storage_bytes: 0,
      },
    });
  });

  it("logs.delete_all: removes the folder and says what it removed", async () => {
    const main = await mainProcess();
    await mkdir(main.directory, { recursive: true });
    await writeFile(path.join(main.directory, "2026-10-25.ndjson"), "{}\n{}\n");

    await expect(main.invoke("ajour:delete-all-logs")).resolves.toMatchObject({
      state: "off",
      file_count: 0,
    });

    await expect(readdir(path.join(main.userData, "logs"))).resolves.toEqual(
      [],
    );
    expect(main.recorded).toMatchObject([
      {
        name: "logs.delete_all",
        kind: "ipc",
        outcome: "ok",
        ipc: { channel: "ajour:delete-all-logs" },
        logs: { deleted_file_count: 1, deleted_bytes: 6 },
      },
    ]);
  });

  it.each([
    "ajour:get-logs-status",
    "ajour:configure-logs",
    "ajour:delete-all-logs",
  ])("%s refuses a window other than the active one", async (channel) => {
    const main = await mainProcess();

    await expect(main.invoke(channel, "another-window", {})).rejects.toThrow(
      "Only the active Ajour window",
    );
    expect(main.recorded).toMatchObject([
      { outcome: "refused", outcome_reason: "foreign_sender" },
    ]);
  });
});

describe("the shared sink", () => {
  it("creates no file and no folder while logging is off, which is the default", async () => {
    const main = await mainProcess({ record: false });
    const url = await startApi(await main.mainEventSink);

    await main.invoke("ajour:get-logs-status");
    await fetch(`${url}/api/health`);
    await main.localLogs.flush();

    await expect(readdir(main.userData)).resolves.toEqual([]);
  });

  it("writes main's events and the local API's in today's file, one JSON object per line", async () => {
    const main = await mainProcess({ record: false });
    const url = await startApi(await main.mainEventSink);
    const before = today();

    await main.invoke("ajour:configure-logs", undefined, { enabled: true });
    await main.invoke("ajour:get-logs-status");
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    await main.events.ready;
    await vi.waitFor(async () => {
      await main.localLogs.flush();
      const [file] = await readdir(main.directory);
      const names = (await linesOf(path.join(main.directory, file!))).map(
        ({ name, runtime }) => `${runtime} ${name}`,
      );
      expect(names).toEqual(
        expect.arrayContaining([
          "main logs.configure",
          "main logs.status",
          "api api.health",
        ]),
      );
    });

    const files = await readdir(main.directory);
    expect(files).toHaveLength(1);
    expect([before, today()]).toContain(files[0]!.replace(".ndjson", ""));
    const raw = await readFile(path.join(main.directory, files[0]!), "utf8");
    for (const line of raw.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("still prints every event on the console with AJOUR_WIDE_EVENTS=console, logging on or off", async () => {
    const lines: string[] = [];
    const logFile = loadLocalLogFile({
      packageRoot: wideEventsRoot,
      directory: path.join(await userDataFolder(), "logs", "events"),
      settings: DEFAULT_LOCAL_LOG_SETTINGS,
    });
    const sink = await loadMainSink({
      packageRoot: wideEventsRoot,
      sinkSwitch: "console",
      write: (line: string) => lines.push(line),
      logFile,
    });
    const url = await startApi(sink);

    await fetch(`${url}/api/health`);

    expect(lines.map((line) => JSON.parse(line).name)).toContain("api.health");
  });
});

describe("the retention sweeps", () => {
  it("sweep at launch and then every hour, each as a logs.sweep job, on UTC days", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-26T23:30:00.000Z"));
    const userData = await userDataFolder();
    const directory = path.join(userData, "logs", "events");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "2026-10-19.ndjson"), "{}\n");
    const { events, recorded } = recordingEvents();
    const localLogs = createLocalLogs({
      settingsPath: path.join(userData, "local-log-settings.json"),
      events,
      open: (settings: unknown) =>
        loadLocalLogFile({ packageRoot: wideEventsRoot, directory, settings }),
    });
    cleanups.push(async () => localLogs.stopSweeps());

    localLogs.startSweeps();
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]).toMatchObject({
      name: "logs.sweep",
      kind: "job",
      trigger: "boot",
      logs: { trigger: "launch", deleted_file_count: 0, file_count: 1 },
    });

    // The day of 2026-10-19 ended 7 days ago at midnight UTC.
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    expect(recorded[1]).toMatchObject({
      name: "logs.sweep",
      trigger: "schedule",
      logs: { trigger: "interval", deleted_file_count: 1, file_count: 0 },
    });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
