import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "ajour.local-state.v2";

function installMockWindow(desktop?: Record<string, unknown>) {
  const storage = new Map<string, string>();
  const createStorage = (target: Map<string, string>) => ({
    get length() {
      return target.size;
    },
    key: (index: number) => Array.from(target.keys())[index] ?? null,
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => {
      target.set(key, value);
    },
    removeItem: (key: string) => {
      target.delete(key);
    },
    clear: () => target.clear(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(storage),
      sessionStorage: createStorage(new Map()),
      ajourDesktop: desktop,
    },
  });
  return storage;
}

async function boot() {
  const sink = createRecordingSink<AjourEvent>();
  const { replaceEventSink } = await import("./wide-events");
  replaceEventSink(sink);
  const { startAppBoot } = await import("./app-boot");
  const started = startAppBoot();
  started.rendered();
  return sink.events;
}

describe("app.boot", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("records a stored state's load: its path, size, records and the migrations it applied", async () => {
    const storage = installMockWindow();
    const stored = JSON.stringify({
      backlogStatuses: [],
      priorityScales: [],
      timesheetEntries: [
        {
          _id: "entry",
          localDate: "2026-10-06",
          label: "",
          note: "Private note",
          durationMs: 60_000,
          sourceBlockIds: [],
        },
      ],
    });
    storage.set(STORAGE_KEY, stored);

    const events = await boot();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "app.boot",
      kind: "lifecycle",
      trigger: "boot",
      outcome: "ok",
      boot: {
        load_path: "stored",
        migrations: ["workflow_states_renamed", "retired_priority_scales"],
        state_bytes: stored.length * 2,
        persisted: true,
        first_render_ms: expect.any(Number),
      },
      recovery: { decision: "none" },
      records: { time_entry_count: 1, running_entry_count: 0 },
    });
    expect(JSON.stringify(events)).not.toContain("Private note");
  });

  it("records an empty store and an unreadable one", async () => {
    installMockWindow();
    expect((await boot())[0]).toMatchObject({
      boot: { load_path: "empty", persisted: true },
    });

    vi.resetModules();
    installMockWindow().set(STORAGE_KEY, "{not json");
    expect((await boot())[0]).toMatchObject({
      boot: { load_path: "unreadable" },
    });
  });

  it("records the desktop recovery: merged, why, and what a submitted week left out", async () => {
    const storage = installMockWindow({
      runtime: {
        automaticUpdatesEnabled: true,
        developmentBuild: false,
        platform: "win32",
        version: "1.4.0",
        launch: {
          launch_id: "launch-from-main",
          app: {
            version: "1.4.0",
            channel: "nightly",
            commit: "abc1234",
            packaged: true,
          },
          device: { platform: "win32", arch: "x64", electron: "38.1.0" },
        },
      },
      bootstrapLocalState: {
        timesheetEntries: [
          {
            _id: "recovered",
            localDate: "2026-10-06",
            label: "",
            durationMs: 60_000,
            sourceBlockIds: [],
          },
        ],
      },
    });
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        timesheetEntries: [],
        lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 1 }],
      }),
    );

    const [event] = await boot();

    expect(event).toMatchObject({
      launch_id: "launch-from-main",
      app: {
        version: "1.4.0",
        channel: "nightly",
        commit: "abc1234",
        packaged: true,
      },
      device: { platform: "win32", arch: "x64", electron: "38.1.0" },
      recovery: {
        decision: "merged",
        reason: "no_entries",
        left_out_entry_count: 1,
      },
      counts: { store_write_count: 1 },
    });
  });

  it("makes its own launch in the web build", async () => {
    installMockWindow();

    const [event] = await boot();

    expect(event!.launch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event!.window_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event!.app).toMatchObject({ channel: "web", packaged: false });
  });

  it("ends with the error when loading the local state throws", async () => {
    installMockWindow();
    Object.defineProperty(window, "ajourDesktop", {
      get() {
        throw new TypeError("The bridge is gone");
      },
    });
    const sink = createRecordingSink<AjourEvent>();
    const { replaceEventSink } = await import("./wide-events");
    replaceEventSink(sink);
    const { startAppBoot } = await import("./app-boot");

    expect(() => startAppBoot()).toThrow("The bridge is gone");

    expect(sink.events).toMatchObject([
      { name: "app.boot", outcome: "error", error: { type: "TypeError" } },
    ]);
  });

  it("ends with the error when the first render fails, and only once", async () => {
    installMockWindow();
    const sink = createRecordingSink<AjourEvent>();
    const { replaceEventSink } = await import("./wide-events");
    replaceEventSink(sink);
    const { startAppBoot } = await import("./app-boot");
    const boot = startAppBoot();

    boot.failed(new RangeError("Render failed"));
    boot.rendered();

    expect(sink.events).toMatchObject([
      { name: "app.boot", outcome: "error", error: { type: "RangeError" } },
    ]);
    expect(sink.events).toHaveLength(1);
  });
});
