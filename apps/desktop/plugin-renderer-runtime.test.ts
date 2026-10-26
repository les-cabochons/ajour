import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

/*
 * The sandboxed renderer runtime (#390) against a stand-in for Electron: what
 * it asks of each plugin's page, session and process, and how runs end. The
 * real-Electron check, scripts/check-plugin-sandbox.mjs, proves the same
 * against Chromium.
 */

const require = createRequire(import.meta.url);
const { createPluginRendererRuntime, DEAD_PROXY } =
  require("./electron/plugin-renderer-runtime.cjs") as {
    createPluginRendererRuntime: (options: Record<string, unknown>) => Runtime;
    DEAD_PROXY: unknown;
  };
const policy = require("./electron/plugin-renderer-policy.cjs") as {
  strippedFileCount: () => number;
  forgetStrippedFiles: (packageDirectory: string) => Promise<void>;
};
const { createIpcListeners } = require("./electron/ipc-listeners.cjs") as {
  createIpcListeners: (
    ipcMain: unknown,
    options: { events: unknown },
  ) => unknown;
};

interface Outcome {
  ok: boolean;
  failure?: string;
  [key: string]: unknown;
}
interface Run {
  settled: Promise<Outcome>;
  terminate(reason: "settled" | "timeout" | "cancelled"): Promise<void>;
}
interface Runtime {
  runsPluginApi4: boolean;
  unavailableReason(): string | undefined;
  attach(host: {
    recordBlocked: (id: string, at: number) => Promise<void>;
    recordStopped?: (id: string, cause: string, at: number) => void;
  }): void;
  start(invocation: Record<string, unknown>): Run;
  keepReady(plugins: Record<string, unknown>[]): void;
  closeAll(): Promise<void>;
  rendererProcessIds(): Record<string, number>;
}

class FakeContents extends EventEmitter {
  static next = 1;
  readonly id = FakeContents.next++;
  readonly pid = 1000 + this.id;
  destroyed = false;
  url = "";
  mainFrame:
    | {
        detached: boolean;
        parent: null;
        origin: string;
        processId: number;
        routingId: number;
      }
    | undefined;
  windowOpen?: () => { action: string };
  webRtcPolicy?: string;
  setWebRTCIPHandlingPolicy(policy: string) {
    this.webRtcPolicy = policy;
  }
  setAudioMuted() {}
  setWindowOpenHandler(handler: () => { action: string }) {
    this.windowOpen = handler;
  }
  async loadURL(url: string) {
    this.url = url;
    this.mainFrame = {
      detached: false,
      parent: null,
      // Node gives a non-special scheme the origin "null"; Chromium, this.
      origin: `${new URL(url).protocol}//${new URL(url).host}`,
      processId: this.id,
      routingId: 1,
    };
  }
  getOSProcessId() {
    return this.pid;
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeSession extends EventEmitter {
  handled = new Map<string, (request: { url: string }) => unknown>();
  beforeRequest?: (
    details: { url: string },
    callback: (answer: { cancel?: boolean }) => void,
  ) => void;
  proxy: unknown;
  permissionRequest?: (
    contents: unknown,
    permission: string,
    callback: (granted: boolean) => void,
  ) => void;
  permissionCheck?: () => boolean;
  protocol = {
    handle: (scheme: string, handler: (request: { url: string }) => unknown) =>
      this.handled.set(scheme, handler),
  };
  webRequest = {
    onBeforeRequest: (listener: FakeSession["beforeRequest"]) => {
      this.beforeRequest = listener;
    },
  };
  constructor(
    readonly partition: string,
    readonly options: unknown,
  ) {
    super();
  }
  async setProxy(proxy: unknown) {
    this.proxy = proxy;
  }
  setPermissionRequestHandler(handler: FakeSession["permissionRequest"]) {
    this.permissionRequest = handler;
  }
  setPermissionCheckHandler(handler: () => boolean) {
    this.permissionCheck = handler;
  }
  setDevicePermissionHandler() {}
  setSpellCheckerEnabled() {}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Electron closes the page of a WebContentsView once the view is garbage
 * collected (#449): the stand-in does the same.
 */
const collectedViews = new FinalizationRegistry<FakeContents>((contents) =>
  contents.close(),
);

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** Collects what nothing holds, and lets the finalizers run. */
async function collectGarbage() {
  for (let round = 0; round < 3; round += 1) {
    gc();
    await flush();
  }
}

function setUp(
  options: {
    metrics?: (pid: number) => Record<string, unknown> | undefined;
    launchRefusal?: { cause: string; reason: string };
    /** More of the runtime's options, such as its timers. */
    runtime?: Record<string, unknown>;
  } = {},
) {
  const { events, recorded } = recordingEvents();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcListeners = createIpcListeners(
    {
      handle: (channel: string, handler: () => unknown) =>
        handlers.set(channel, handler),
    },
    { events },
  );
  const views: {
    options: { webPreferences: Record<string, unknown> };
    contents: FakeContents;
  }[] = [];
  const sessions = new Map<string, FakeSession>();
  const runtime = createPluginRendererRuntime({
    app: {
      getAppMetrics: () =>
        views.map(({ contents }) => ({
          pid: contents.pid,
          sandboxed: true,
          integrityLevel: "untrusted",
          ...options.metrics?.(contents.pid),
        })),
    },
    session: {
      fromPartition(partition: string, sessionOptions: unknown) {
        if (!sessions.has(partition)) {
          sessions.set(partition, new FakeSession(partition, sessionOptions));
        }
        return sessions.get(partition);
      },
    },
    WebContentsView: class {
      webContents = new FakeContents();
      constructor(viewOptions: { webPreferences: Record<string, unknown> }) {
        views.push({ options: viewOptions, contents: this.webContents });
        collectedViews.register(this, this.webContents);
      }
    },
    ipcListeners,
    events,
    hostDirectory: "/ajour/plugin-host",
    preloadPath: "/ajour/plugin-host/preload.cjs",
    platform: "win32",
    devTools: false,
    ...(options.launchRefusal ? { launchRefusal: options.launchRefusal } : {}),
    ...options.runtime,
  });
  const blocked: string[] = [];
  const stopped: [string, string][] = [];
  runtime.attach({
    recordBlocked: async (pluginId) => {
      blocked.push(pluginId);
    },
    recordStopped: (pluginId, cause) => {
      stopped.push([pluginId, cause]);
    },
  });
  /** What the plugin's page sends, from its main frame unless `frame` says otherwise. */
  const page = (contents: FakeContents) => ({
    send: (message: unknown, frame: unknown = contents.mainFrame) =>
      Promise.resolve().then(() =>
        handlers.get("ajour:plugin-renderer")!(
          { sender: contents, senderFrame: frame },
          message,
        ),
      ),
  });
  const start = (pluginId = "jira", extra: Record<string, unknown> = {}) =>
    runtime.start({
      pluginId,
      packageDirectory: `/plugins/${pluginId}`,
      entrypoint: "lib/plugin.mjs",
      apiVersion: 4,
      method: "syncConnection",
      args: [{ id: "connection-1" }],
      ...extra,
    });
  /** Waits for the plugin's page, then loads it as Ajour's page script does. */
  const ready = async (index?: number) => {
    const view = () => views[index ?? views.length - 1];
    for (let wait = 0; !view()?.contents.url && wait < 50; wait += 1) {
      await flush();
    }
    const contents = view()!.contents;
    const driver = page(contents);
    const isReady = await driver.send({ type: "ready" });
    return { contents, driver, isReady };
  };
  return {
    runtime,
    recorded,
    views,
    sessions,
    blocked,
    stopped,
    start,
    ready,
    page,
  };
}

describe("the sandboxed renderer runtime", () => {
  it("opens one hidden page per plugin, sandboxed, without Node, on an in-memory partition", async () => {
    const { runtime, views, sessions, start, ready } = setUp();

    start("jira");
    const { contents } = await ready();

    expect(runtime.runsPluginApi4).toBe(true);
    expect(views[0]!.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      partition: "ajour-plugin:jira",
      preload: "/ajour/plugin-host/preload.cjs",
      devTools: false,
    });
    expect(contents.url).toBe("ajour-plugin://jira/.ajour/host.html");
    expect(sessions.get("ajour-plugin:jira")!.options).toEqual({
      cache: false,
    });
  });

  it("closes every way out of the plugin's session but its own files, and counts what it blocks", async () => {
    const { recorded, sessions, blocked, start, ready } = setUp();
    start("jira");
    const { contents } = await ready();
    const pluginSession = sessions.get("ajour-plugin:jira")!;
    const request = (url: string) =>
      new Promise((resolve) => pluginSession.beforeRequest!({ url }, resolve));

    await expect(
      request("ajour-plugin://jira/lib/plugin.mjs"),
    ).resolves.toEqual({});
    await expect(request("http://127.0.0.1:8787/api/plugins")).resolves.toEqual(
      { cancel: true },
    );
    await expect(request("ajour-plugin://github/plugin.mjs")).resolves.toEqual({
      cancel: true,
    });
    expect(pluginSession.proxy).toEqual(DEAD_PROXY);
    expect(DEAD_PROXY).toEqual({
      mode: "fixed_servers",
      proxyRules: "http://0.0.0.0:0",
      proxyBypassRules: "<-loopback>",
    });
    expect(contents.webRtcPolicy).toBe("disable_non_proxied_udp");
    expect(pluginSession.permissionCheck!()).toBe(false);
    const granted = await new Promise((resolve) =>
      pluginSession.permissionRequest!(contents, "notifications", resolve),
    );
    expect(granted).toBe(false);
    expect(contents.windowOpen!()).toEqual({ action: "deny" });
    const navigation = { preventDefault: vi.fn() };
    contents.emit("will-frame-navigate", navigation);
    expect(navigation.preventDefault).toHaveBeenCalled();

    expect(blocked).toEqual(["jira", "jira", "jira", "jira", "jira"]);
    expect(
      recorded
        .filter((event) => event.name === "plugin_renderer.blocked")
        .map((event) => [
          event.outcome,
          event.outcome_reason,
          event.plugin?.id,
          event.blocked?.exit,
        ]),
    ).toEqual([
      ["refused", "blocked", "jira", "request"],
      ["refused", "blocked", "jira", "request"],
      ["refused", "blocked", "jira", "permission"],
      ["refused", "blocked", "jira", "window_open"],
      ["refused", "blocked", "jira", "navigation"],
    ]);
  });

  it("runs a call once its page loaded and its process reports the sandbox", async () => {
    const { recorded, start, ready } = setUp();
    const run = start("jira");
    const { driver, isReady } = await ready();

    expect(isReady).toBe(true);
    const command = (await driver.send({ type: "next" })) as {
      runId: string;
    };
    expect(command).toEqual({
      type: "start",
      runId: expect.any(String),
      url: "ajour-plugin://jira/lib/plugin.mjs",
      method: "syncConnection",
      args: [{ id: "connection-1" }],
    });
    await driver.send({
      type: "settled",
      runId: command.runId,
      outcome: { ok: true, result: { items: [] } },
    });

    await expect(run.settled).resolves.toMatchObject({
      ok: true,
      result: { items: [] },
    });
    expect(
      recorded.find((event) => event.name === "plugin_renderer.open"),
    ).toMatchObject({ outcome: "ok", plugin: { id: "jira" } });
  });

  it("holds each plugin's view while its renderer is open, so a collection doesn't close its page mid-run", async () => {
    const { start, ready } = setUp();
    const run = start("jira");
    const { contents, driver } = await ready();

    await collectGarbage();

    expect(contents.destroyed).toBe(false);
    const command = (await driver.send({ type: "next" })) as {
      runId: string;
    };
    await driver.send({
      type: "settled",
      runId: command.runId,
      outcome: { ok: true, result: "done" },
    });
    await expect(run.settled).resolves.toMatchObject({
      ok: true,
      result: "done",
    });
  });

  it("cuts a plugin's error and bounds its result", async () => {
    const { start, ready } = setUp();
    const failing = start("jira");
    const { driver } = await ready();
    const first = (await driver.send({ type: "next" })) as { runId: string };
    await driver.send({
      type: "settled",
      runId: first.runId,
      outcome: {
        ok: false,
        failure: "plugin_error",
        message: "x".repeat(5000),
        httpStatus: 401,
      },
    });

    await expect(failing.settled).resolves.toEqual({
      ok: false,
      failure: "plugin_error",
      message: `${"x".repeat(4095)}…`,
      httpStatus: 401,
    });
  });

  describe("a package of TypeScript source", () => {
    let packageDirectory: string;

    beforeEach(async () => {
      packageDirectory = await mkdtemp(
        path.join(os.tmpdir(), "ajour-renderer-ts-"),
      );
      await writeFile(
        path.join(packageDirectory, "plugin.ts"),
        'import { Status } from "./status.ts";\nexport const status = (): Status => Status.Open;',
      );
      await writeFile(
        path.join(packageDirectory, "status.ts"),
        "export enum Status { Open, Closed }",
      );
    });

    afterEach(async () => {
      await policy.forgetStrippedFiles(packageDirectory);
      await rm(packageDirectory, { recursive: true, force: true });
    });

    const startTypeScript = () => {
      const world = setUp();
      const run = world.start("jira", {
        packageDirectory,
        entrypoint: "plugin.ts",
      });
      return { ...world, run };
    };
    /** What the plugin's worker asks the origin for, as its import does. */
    const serveFrom =
      (sessions: Map<string, { handled: Map<string, unknown> }>) =>
      (url: string) =>
        (
          sessions
            .get("ajour-plugin:jira")!
            .handled.get("ajour-plugin") as (request: {
            url: string;
          }) => Promise<Response>
        )({ url });
    const importFailure = (url: string) => ({
      ok: false,
      failure: "plugin_error",
      stage: "import",
      message: `Failed to fetch dynamically imported module: ${url}`,
    });

    it("serves the TypeScript entrypoint as JavaScript", async () => {
      const { sessions, ready } = startTypeScript();
      const { driver } = await ready();
      const first = (await driver.send({ type: "next" })) as { url: string };

      const entrypoint = await serveFrom(sessions)(first.url);

      expect(first.url).toBe("ajour-plugin://jira/plugin.ts");
      expect(entrypoint.status).toBe(200);
      expect(entrypoint.headers.get("content-type")).toBe(
        "text/javascript; charset=utf-8",
      );
    });

    it("fails a run whose import graph holds a file it can't strip, naming the file", async () => {
      const { sessions, run, ready } = startTypeScript();
      const { driver } = await ready();
      const first = (await driver.send({ type: "next" })) as {
        runId: string;
        url: string;
      };
      await serveFrom(sessions)(first.url);
      const status = await serveFrom(sessions)("ajour-plugin://jira/status.ts");

      await driver.send({
        type: "settled",
        runId: first.runId,
        outcome: importFailure(first.url),
      });

      expect(status.status).toBe(500);
      await expect(run.settled).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
        message:
          "status.ts uses TypeScript that Ajour can't strip: TypeScript enum is not supported in strip-only mode.",
      });
    });

    it("keeps the failure of a run that started after the file was refused", async () => {
      const { sessions, run, start, ready } = startTypeScript();
      const { driver } = await ready();
      const first = (await driver.send({ type: "next" })) as {
        runId: string;
        url: string;
      };
      await serveFrom(sessions)("ajour-plugin://jira/status.ts");
      const later = start("jira", {
        packageDirectory,
        entrypoint: "plugin.ts",
      });
      const second = (await driver.send({ type: "next" })) as {
        runId: string;
        url: string;
      };

      await driver.send({
        type: "settled",
        runId: second.runId,
        outcome: importFailure(second.url),
      });
      await driver.send({
        type: "settled",
        runId: first.runId,
        outcome: importFailure(first.url),
      });

      await expect(later.settled).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
        message: `Failed to fetch dynamically imported module: ${second.url}`,
      });
      await expect(run.settled).resolves.toMatchObject({
        message: expect.stringContaining("status.ts uses TypeScript"),
      });
    });

    it.each([
      [
        "its own error",
        { ok: false, failure: "plugin_error", message: "Boom." },
        "Boom.",
      ],
      [
        "an import that failed for another reason",
        {
          ok: false,
          failure: "plugin_error",
          stage: "import",
          message: "Failed to fetch dynamically imported module.",
        },
        "Failed to fetch dynamically imported module.",
      ],
    ])(
      "keeps %s for a later run, after a file was refused",
      async (_name, outcome, message) => {
        const { sessions, run, start, ready } = startTypeScript();
        const { driver } = await ready();
        const first = (await driver.send({ type: "next" })) as {
          runId: string;
          url: string;
        };
        await serveFrom(sessions)("ajour-plugin://jira/status.ts");
        await driver.send({
          type: "settled",
          runId: first.runId,
          outcome: importFailure(first.url),
        });
        await run.settled;

        const later = start("jira", {
          packageDirectory,
          entrypoint: "plugin.ts",
        });
        const command = (await driver.send({ type: "next" })) as {
          runId: string;
        };
        await driver.send({
          type: "settled",
          runId: command.runId,
          outcome,
        });

        await expect(later.settled).resolves.toEqual({
          ok: false,
          failure: "plugin_error",
          message,
        });
      },
    );

    it("forgets the package's stripped files once its renderer closes", async () => {
      const { runtime, sessions, ready } = startTypeScript();
      const { driver } = await ready();
      const first = (await driver.send({ type: "next" })) as { url: string };
      await serveFrom(sessions)(first.url);
      const kept = policy.strippedFileCount();

      await runtime.closeAll();

      expect(kept).toBe(1);
      expect(policy.strippedFileCount()).toBe(0);
    });
  });

  it("relays a run's ajour.http to that run's broker only, never another's", async () => {
    const { recorded, start, ready } = setUp();
    const http = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: new Uint8Array([123, 125]),
    }));
    start("jira", { broker: { http, publicFetch: vi.fn(), close: vi.fn() } });
    const { driver } = await ready();
    const { runId } = (await driver.send({ type: "next" })) as {
      runId: string;
    };

    const answer = await driver.send({
      type: "http",
      runId,
      callId: 1,
      request: {
        connectionId: "connection-1",
        method: "GET",
        path: "/rest/api/3/myself",
        pending: { id: "forged" },
      },
    });
    expect(answer).toEqual({
      ok: true,
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new Uint8Array([123, 125]),
      },
    });
    expect(http).toHaveBeenCalledWith({
      connectionId: "connection-1",
      method: "GET",
      path: "/rest/api/3/myself",
      signal: expect.any(AbortSignal),
    });

    const elsewhere = await driver.send({
      type: "http",
      runId: "not-a-run",
      callId: 2,
      request: { connectionId: "connection-1", method: "GET", path: "/" },
    });
    expect(elsewhere).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(http).toHaveBeenCalledTimes(1);
    expect(
      recorded.filter(
        (event) =>
          event.name === "plugin_renderer.call" && event.outcome === "refused",
      ),
    ).toMatchObject([
      {
        outcome_reason: "unknown_run",
        plugin: { id: "jira" },
        plugin_renderer: { message: "http" },
      },
    ]);
  });

  it("gives the plugin the broker's refusal, and only the kind of any other failure", async () => {
    const { start, ready } = setUp();
    const http = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("No such endpoint."), {
          name: "AjourRequestError",
          code: "refused",
        }),
      )
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.7:443"));
    start("jira", { broker: { http, publicFetch: vi.fn(), close: vi.fn() } });
    const { driver } = await ready();
    const { runId } = (await driver.send({ type: "next" })) as {
      runId: string;
    };
    const call = () =>
      driver.send({
        type: "http",
        runId,
        callId: 1,
        request: { connectionId: "c", method: "GET", path: "/" },
      });

    await expect(call()).resolves.toEqual({
      ok: false,
      error: {
        name: "AjourRequestError",
        code: "refused",
        message: "No such endpoint.",
      },
    });
    await expect(call()).resolves.toEqual({
      ok: false,
      error: {
        name: "AjourRequestError",
        code: "network",
        message: "The request failed.",
      },
    });
  });

  it("refuses a call from anything but a registered page's main frame", async () => {
    const { recorded, start, ready, page } = setUp();
    start("jira");
    const { contents, driver } = await ready();

    await expect(
      driver.send({ type: "next" }, { ...contents.mainFrame, parent: {} }),
    ).rejects.toMatchObject({ code: "refused_sender" });
    const stranger = new FakeContents();
    await stranger.loadURL("ajour-plugin://jira/.ajour/host.html");
    await expect(page(stranger).send({ type: "ready" })).rejects.toMatchObject({
      code: "refused_sender",
    });
    expect(
      recorded
        .filter((event) => event.name === "plugin_renderer.call")
        .filter((event) => event.outcome === "refused")
        .map((event) => event.outcome_reason),
    ).toEqual(["foreign_sender", "foreign_sender"]);
  });

  it("ends a run as asked: a settled or cancelled one stops its worker, a timeout closes the page", async () => {
    const { runtime, start, ready } = setUp();
    const settled = start("jira");
    const { contents, driver } = await ready();
    const first = (await driver.send({ type: "next" })) as { runId: string };
    await driver.send({
      type: "settled",
      runId: first.runId,
      outcome: { ok: true, result: null },
    });
    await settled.terminate("settled");

    const cancelled = start("jira");
    const second = (await driver.send({ type: "next" })) as { runId: string };
    await cancelled.terminate("cancelled");
    await expect(cancelled.settled).resolves.toEqual({
      ok: false,
      failure: "terminated",
    });
    await expect(driver.send({ type: "next" })).resolves.toEqual({
      type: "stop",
      runId: second.runId,
    });
    expect(contents.destroyed).toBe(false);
    expect(runtime.rendererProcessIds()).toEqual({ jira: contents.pid });

    const timedOut = start("jira");
    await driver.send({ type: "next" });
    await timedOut.terminate("timeout");
    expect(contents.destroyed).toBe(true);
    expect(runtime.rendererProcessIds()).toEqual({});
  });

  it.each([
    ["crashed", "crashed"],
    ["oom", "oom"],
    ["killed", "killed"],
    ["abnormal-exit", "crashed"],
  ])(
    "fails the runs of a page whose process ended (%s) as crashed, with its cause",
    async (reason, cause) => {
      const { recorded, start, ready } = setUp();
      const run = start("jira");
      const { contents, driver } = await ready();
      await driver.send({ type: "next" });

      contents.emit("render-process-gone", {}, { reason, exitCode: 9 });

      await expect(run.settled).resolves.toEqual({
        ok: false,
        failure: "crashed",
        cause,
      });
      expect(
        recorded.find((event) => event.name === "process.gone"),
      ).toMatchObject({
        outcome: "error",
        plugin: { id: "jira" },
        process: { type: "plugin_renderer", reason, exit_code: 9 },
      });
    },
  );

  it("turns every plugin off when a renderer's process isn't sandboxed", async () => {
    const { runtime, recorded, start, ready } = setUp({
      metrics: () => ({ sandboxed: false }),
    });
    const run = start("jira");
    const { contents, isReady } = await ready();

    expect(isReady).toBe(false);
    await expect(run.settled).resolves.toEqual({
      ok: false,
      failure: "runtime_unavailable",
      reason: "A plugin's process isn't sandboxed.",
    });
    expect(contents.destroyed).toBe(true);
    expect(runtime.unavailableReason()).toBe(
      "A plugin's process isn't sandboxed.",
    );
    await expect(start("github").settled).resolves.toMatchObject({
      failure: "runtime_unavailable",
    });
    expect(
      recorded
        .filter((event) =>
          ["plugin_renderer.open", "plugin_sandbox.off"].includes(event.name),
        )
        .map((event) => [event.name, event.outcome, event.outcome_reason]),
    ).toEqual([
      ["plugin_renderer.open", "refused", "not_sandboxed"],
      ["plugin_sandbox.off", "refused", "renderer_not_sandboxed"],
    ]);
  });

  it("opens nothing when the launch turned plugins off", async () => {
    const { runtime, recorded, views, start } = setUp({
      launchRefusal: {
        cause: "launch_flag",
        reason: "Ajour was started with --no-sandbox.",
      },
    });

    await expect(start("jira").settled).resolves.toEqual({
      ok: false,
      failure: "runtime_unavailable",
      reason: "Ajour was started with --no-sandbox.",
    });
    expect(views).toEqual([]);
    expect(runtime.unavailableReason()).toBe(
      "Ajour was started with --no-sandbox.",
    );
    expect(recorded).toMatchObject([
      {
        name: "plugin_sandbox.off",
        outcome: "refused",
        outcome_reason: "launch_flag",
        sandbox: { cause: "launch_flag" },
      },
    ]);
  });

  it("answers a closed renderer's origin with a 404 that carries the policy", async () => {
    const { runtime, sessions, start, ready } = setUp();
    start("jira");
    await ready(0);
    await runtime.closeAll();

    const response = (await sessions
      .get("ajour-plugin:jira")!
      .handled.get("ajour-plugin")!({
      url: "ajour-plugin://jira/lib/plugin.mjs",
    })) as Response;

    expect(response.status).toBe(404);
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("closes every page as Ajour quits", async () => {
    const { runtime, views, start, ready } = setUp();
    const jira = start("jira");
    await ready(0);
    start("github");
    await ready(1);

    await runtime.closeAll();

    expect(views.map(({ contents }) => contents.destroyed)).toEqual([
      true,
      true,
    ]);
    await expect(jira.settled).resolves.toEqual({
      ok: false,
      failure: "terminated",
    });
  });
});

describe("the renderer's lifecycle (#391)", () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (condition: () => boolean) => {
    for (let wait = 0; !condition() && wait < 200; wait += 1) await sleep(5);
    expect(condition()).toBe(true);
  };
  /** Runs one call to its end, as the page would. */
  async function settle(
    driver: { send(message: unknown): Promise<unknown> },
    run: Run,
  ) {
    const command = (await driver.send({ type: "next" })) as {
      runId: string;
    };
    await driver.send({
      type: "settled",
      runId: command.runId,
      outcome: { ok: true, result: null },
    });
    await run.settled;
    await run.terminate("settled");
  }
  const closes = (recorded: { name: string }[]) =>
    recorded
      .filter((event) => event.name === "plugin_renderer.close")
      .map((event) => {
        const close = event as {
          outcome?: string;
          plugin?: { id?: string };
          plugin_renderer?: { close_reason?: string };
        };
        return [
          close.plugin?.id,
          close.outcome,
          close.plugin_renderer?.close_reason,
        ];
      });

  it('closes a "Load when needed" renderer once idle after its last call', async () => {
    const { recorded, start, ready } = setUp({
      runtime: { idleCloseMs: 40 },
    });
    const first = start("jira");
    const { contents, driver } = await ready();
    await settle(driver, first);

    // A call within the idle time keeps the page.
    await sleep(20);
    const second = start("jira");
    await settle(driver, second);
    await sleep(25);
    expect(contents.destroyed).toBe(false);

    await until(() => contents.destroyed);
    expect(closes(recorded)).toEqual([["jira", "ok", "idle"]]);
  });

  it('starts an "Always ready" plugin without a call, and keeps it open while idle', async () => {
    const { runtime, views, recorded, start, ready } = setUp({
      runtime: { idleCloseMs: 20 },
    });

    runtime.keepReady([
      {
        pluginId: "jira",
        packageDirectory: "/plugins/jira",
        entrypoint: "lib/plugin.mjs",
        apiVersion: 4,
        lifecycle: { alwaysReady: true, memoryCeilingMb: 256 },
      },
    ]);
    const { contents, driver } = await ready();
    expect(views).toHaveLength(1);
    await settle(driver, start("jira"));
    await sleep(60);
    expect(contents.destroyed).toBe(false);
    expect(
      recorded.find((event) => event.name === "plugin_renderer.open"),
    ).toMatchObject({ plugin_renderer: { always_ready: true } });

    // Turned off, suspended or switched to "Load when needed": it goes once idle.
    runtime.keepReady([]);
    await until(() => contents.destroyed);
    expect(views).toHaveLength(1);
  });

  it("starts no plugin while plugins are off on this computer", async () => {
    const { runtime, views } = setUp({
      launchRefusal: {
        cause: "launch_flag",
        reason: "Ajour was started with --no-sandbox.",
      },
    });

    runtime.keepReady([
      {
        pluginId: "jira",
        packageDirectory: "/plugins/jira",
        entrypoint: "lib/plugin.mjs",
        apiVersion: 4,
        lifecycle: { alwaysReady: true, memoryCeilingMb: 256 },
      },
    ]);
    await sleep(20);

    expect(views).toEqual([]);
  });

  it("closes a renderer above its memory ceiling, fails its runs with memory, and reports the stop", async () => {
    let privateKb = 100 * 1024;
    const { recorded, stopped, start, ready } = setUp({
      metrics: () => ({ memory: { privateBytes: privateKb } }),
      runtime: { memorySampleMs: 10 },
    });
    const run = start("jira", {
      lifecycle: { alwaysReady: false, memoryCeilingMb: 128 },
    });
    const { contents, driver } = await ready();
    await driver.send({ type: "next" });

    await sleep(40);
    expect(contents.destroyed).toBe(false);
    privateKb = 129 * 1024;

    await expect(run.settled).resolves.toEqual({
      ok: false,
      failure: "crashed",
      cause: "memory",
    });
    expect(contents.destroyed).toBe(true);
    expect(stopped).toEqual([["jira", "memory"]]);
    expect(
      recorded.find((event) => event.name === "plugin_renderer.close"),
    ).toMatchObject({
      outcome: "error",
      plugin_renderer: {
        close_reason: "memory",
        memory_ceiling_mb: 128,
        memory_mb: 129,
      },
    });
  });

  it("reads the working set where there are no private bytes", async () => {
    const { stopped, start, ready } = setUp({
      metrics: () => ({ memory: { workingSetSize: 300 * 1024 } }),
      runtime: { memorySampleMs: 10 },
    });
    const run = start("jira");
    await ready();

    // Ajour's default ceiling, 256 MB, when the run says none.
    await expect(run.settled).resolves.toMatchObject({ cause: "memory" });
    expect(stopped).toEqual([["jira", "memory"]]);
  });

  it("reports a crash as a stop, whether or not a call was running, and not a timeout", async () => {
    const { stopped, start, ready } = setUp();
    const timedOut = start("jira");
    const { driver } = await ready(0);
    await driver.send({ type: "next" });
    await timedOut.terminate("timeout");
    expect(stopped).toEqual([]);

    const settled = start("jira");
    const second = await ready(1);
    await settle(second.driver, settled);
    second.contents.emit("render-process-gone", {}, { reason: "killed" });

    expect(stopped).toEqual([["jira", "killed"]]);
  });

  /** A record that keeps what it was given, for a test to read. */
  function recordOf() {
    const entries: { pid: number; pluginId: string; createdAt?: number }[] = [];
    const removed: unknown[] = [];
    return {
      entries,
      removed,
      add(entry: { pid: number; pluginId: string; createdAt?: number }) {
        entries.push(entry);
      },
      remove(entry: unknown) {
        removed.push(entry);
      },
    };
  }

  it("records each ready renderer's process for the next launch's sweep, until it closes", async () => {
    const record = recordOf();
    const { runtime, start, ready } = setUp({
      metrics: (pid) => ({ creationTime: pid * 10 }),
      runtime: { processRecord: record },
    });
    start("jira");
    const { contents } = await ready();

    expect(record.entries).toEqual([
      { pid: contents.pid, pluginId: "jira", createdAt: contents.pid * 10 },
    ]);
    await runtime.closeAll();
    // The entry it added, so a reused id's newer entry is never the one removed.
    expect(record.removed).toHaveLength(1);
    expect(record.removed[0]).toBe(record.entries[0]);
  });

  it("keeps a renderer in the record when its page doesn't go, until it does or its process is gone", async () => {
    const record = recordOf();
    let alive = true;
    const { runtime, start, ready } = setUp({
      metrics: (pid) => ({ creationTime: pid * 10 }),
      runtime: {
        processRecord: record,
        closeTimeoutMs: 20,
        processAlive: () => alive,
      },
    });
    start("jira");
    const { contents } = await ready();
    // A page that doesn't close when asked.
    contents.close = () => {};

    await runtime.closeAll();
    expect(record.removed).toEqual([]);

    // It goes late: the entry goes with it.
    contents.destroyed = true;
    contents.emit("destroyed");
    await flush();
    expect(record.removed).toEqual([record.entries[0]]);

    // Another that never reports, but whose process ends.
    start("github");
    const second = await ready(1);
    second.contents.close = () => {};
    alive = false;
    await runtime.closeAll();
    expect(record.removed).toEqual([record.entries[0], record.entries[1]]);
  });

  it("closes the renderer of a plugin that can't run now at once, and keeps the others waiting for idle", async () => {
    const { runtime, views, recorded, start, ready } = setUp();
    const stopped = start("jira");
    const first = await ready();
    start("github");
    const second = await ready(1);

    runtime.keepReady([], ["jira"]);

    await expect(stopped.settled).resolves.toEqual({
      ok: false,
      failure: "terminated",
    });
    await until(() => first.contents.destroyed);
    expect(second.contents.destroyed).toBe(false);
    expect(views).toHaveLength(2);
    expect(
      recorded
        .filter((event) => event.name === "plugin_renderer.close")
        .map((event) => [
          event.plugin?.id,
          event.plugin_renderer?.close_reason,
        ]),
    ).toEqual([["jira", "plugin_off"]]);
  });
});
