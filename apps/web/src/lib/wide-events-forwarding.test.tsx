// @vitest-environment jsdom
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { catalog } from "@ajour/wide-events/catalog.ts";
import type { ForwardedBatch } from "@ajour/wide-events/forwarding.ts";
import {
  createLocalLogFile,
  type LocalLogFile,
} from "@ajour/wide-events/local-log-file.ts";
import { installDomShims, renderRoutes } from "@/test-support/dom";

/*
 * The renderer's sink on desktop (#440), as lib/wide-events.ts picks it at
 * its first use, with a bridge that behaves as the preload does: it tells
 * the page at once whether logging is on, then each change main pushes, and
 * hands each batch to the package's local log file the way main does. The
 * renderer switches with the setting, without a reload, and builds no event
 * while it is off.
 */

const LAUNCH = {
  launch_id: "launch-from-main",
  app: { version: "1.4.0", channel: "stable", packaged: true },
  device: { platform: "win32", arch: "x64" },
} as const;

let root: string;
let file: LocalLogFile;
let batches: ForwardedBatch[];
let setLogging: (on: boolean) => void;
let failSends: boolean;

beforeAll(installDomShims);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ajour-renderer-forwarding-"));
  file = createLocalLogFile({
    directory: path.join(root, "events"),
    catalog,
    settings: {
      enabled: true,
      retention_days: 7,
      size_limit_mb: 250,
      include_sensitive: false,
    },
  });
  batches = [];
  failSends = false;
  window.localStorage.clear();
  let logging = false;
  const listeners = new Set<(on: boolean) => void>();
  setLogging = (on) => {
    logging = on;
    for (const listener of listeners) listener(on);
  };
  window.ajourDesktop = {
    runtime: {
      automaticUpdatesEnabled: false,
      developmentBuild: false,
      platform: "win32",
      version: LAUNCH.app.version,
      launch: LAUNCH,
    },
    forwardWideEvents: (batch) => {
      if (failSends) throw new Error("The window is closing.");
      const sent = structuredClone(batch);
      batches.push(sent);
      file.forward(sent, { runtime: "renderer", launch_id: LAUNCH.launch_id });
    },
    onWideEventsForwarding: (callback) => {
      listeners.add(callback);
      callback(logging);
      return () => listeners.delete(callback);
    },
  };
  vi.resetModules();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete window.ajourDesktop;
  await rm(root, { recursive: true, force: true });
});

/** The renderer's modules as a fresh window loads them. */
async function loadRenderer() {
  const { wideEvents } = await import("@/lib/wide-events");
  const { localStore } = await import("@/lib/local-store");
  const { watchRouteChanges } = await import("@/lib/route-events");
  return { wideEvents, localStore, watchRouteChanges };
}

const hidePage = () => window.dispatchEvent(new Event("pagehide"));

const forwardedNames = () =>
  batches.flatMap(({ events }) => events.map(({ name }) => name));

async function linesInTheFile() {
  await file.flush();
  const directory = path.join(root, "events");
  const names = await readdir(directory).catch(() => []);
  const lines: Record<string, unknown>[] = [];
  for (const name of names) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const line of text.split("\n").filter(Boolean)) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}

/** A unit that fails with an error whose message counts its reads: building its event reads it. */
function failingUnit(
  wideEvents: Awaited<ReturnType<typeof loadRenderer>>["wideEvents"],
) {
  let reads = 0;
  const error = new Error();
  Object.defineProperty(error, "message", {
    get() {
      reads += 1;
      return "failed";
    },
  });
  wideEvents
    .start("week.reopen", { kind: "command", trigger: "user" })
    .fail(error)
    .end();
  return reads;
}

describe("the renderer's local log file sink", () => {
  it("builds no event and sends nothing while logging is off, as before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { wideEvents, localStore } = await loadRenderer();

    localStore.addWorkItem({ title: "Off the record" });
    expect(failingUnit(wideEvents)).toBe(0);
    vi.advanceTimersByTime(5000);
    hidePage();

    expect(batches).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("switches on and off with the setting, without a reload, and a store command and a route change land in the file", async () => {
    const { wideEvents, localStore, watchRouteChanges } = await loadRenderer();
    localStore.addWorkItem({ title: "Before logging" });

    act(() => setLogging(true));
    const itemId = localStore.addWorkItem({ title: "Secret roadmap item" });
    const view = await renderRoutes({
      routes: { "/": () => <p>Time</p>, "/settings": () => <p>Settings</p> },
    });
    const unwatch = watchRouteChanges(view.router);
    await act(() => view.router.navigate({ to: "/settings" }));
    await waitFor(() => {
      hidePage();
      expect(forwardedNames()).toContain("route.change");
    });
    unwatch();

    const lines = await linesInTheFile();
    const command = lines.find((line) => line.name === "backlog_item.create");
    const route = lines.find((line) => line.name === "route.change");
    expect(command).toMatchObject({
      runtime: "renderer",
      kind: "command",
      launch_id: LAUNCH.launch_id,
      backlog_item: { id: itemId },
      trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(route).toMatchObject({
      runtime: "renderer",
      kind: "navigation",
      launch_id: LAUNCH.launch_id,
      route: { to_id: "/settings" },
    });
    // The command before logging was turned on was never built.
    expect(
      lines.filter((line) => line.name === "backlog_item.create"),
    ).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain("Secret roadmap item");

    act(() => setLogging(false));
    const sent = batches.length;
    localStore.addWorkItem({ title: "After logging" });
    expect(failingUnit(wideEvents)).toBe(0);
    hidePage();
    expect(batches).toHaveLength(sent);
  });

  it("sends a batch a second after the first event, or at once at 100 events", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { localStore } = await loadRenderer();
    setLogging(true);

    localStore.addWorkItem({ title: "One" });
    vi.advanceTimersByTime(999);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(forwardedNames()).toEqual(["backlog_item.create"]);

    for (let index = 0; index < 100; index += 1) {
      localStore.addWorkItem({ title: `Item ${index}` });
    }
    expect(batches.map(({ events }) => events.length)).toEqual([1, 100]);
  });

  it("drops a batch it can't send without changing the work, and counts it in the next one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { localStore } = await loadRenderer();
    setLogging(true);
    failSends = true;

    expect(localStore.addWorkItem({ title: "Kept" })).toEqual(
      expect.any(String),
    );
    localStore.addWorkItem({ title: "Also kept" });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

    failSends = false;
    localStore.addWorkItem({ title: "Sent" });
    hidePage();
    expect(batches).toEqual([
      { events: [expect.any(Object)], unsent_event_count: 2 },
    ]);
  });

  it("still prints every event on the devtools console with AJOUR_WIDE_EVENTS=console, logging on or off", async () => {
    vi.stubEnv("AJOUR_WIDE_EVENTS", "console");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { localStore } = await loadRenderer();
    const printed = () =>
      log.mock.calls.map(([line]) => JSON.parse(String(line)).name);

    localStore.addWorkItem({ title: "Printed" });
    hidePage();
    expect(printed()).toEqual(["backlog_item.create"]);
    expect(batches).toEqual([]);

    setLogging(true);
    localStore.addWorkItem({ title: "Printed and written" });
    hidePage();
    expect(printed()).toEqual(["backlog_item.create", "backlog_item.create"]);
    expect(forwardedNames()).toEqual(["backlog_item.create"]);
  });
});
