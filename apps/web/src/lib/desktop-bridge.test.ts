import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { LaunchContext } from "@ajour/wide-events";
import type {} from "./desktop-bridge";

type DesktopBridge = NonNullable<Window["ajourDesktop"]>;

// Checked by `just typecheck`: the desktop main process answers a synchronous
// request that fails with null (apps/desktop/electron/ipc-listeners.cjs).
describe("desktop bridge", () => {
  it("lets every synchronous answer be null", () => {
    expectTypeOf<null>().toExtend<DesktopBridge["bootstrapLocalState"]>();
    expectTypeOf<null>().toExtend<DesktopBridge["runtime"]>();
    expectTypeOf<null>().toExtend<DesktopBridge["appMenu"]>();
  });

  // The main process makes the launch context (apps/desktop/electron/main-events.cjs).
  it("hands the renderer the main process's launch context", () => {
    expectTypeOf<
      NonNullable<DesktopBridge["runtime"]>["launch"]
    >().toEqualTypeOf<LaunchContext | undefined>();
  });
});

// The diagnostics viewer's reads (#442) go through the bridge to main's
// query service, each with the active unit's traceparent.
describe("the diagnostics viewer's reads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(ajourDesktop?: Partial<DesktopBridge>) {
    vi.resetModules();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ...(ajourDesktop ? { ajourDesktop } : {}),
    });
    const bridge = await import("./desktop-bridge");
    const { wideEvents } = await import("./wide-events");
    return { bridge, wideEvents };
  }

  it("passes each read's arguments and the active unit's traceparent to the bridge", async () => {
    const desktop = {
      queryLogs: vi.fn(async () => ({ events: [] })),
      getLogTrace: vi.fn(async () => ({ roots: [] })),
      listLogActions: vi.fn(async () => ({ actions: [] })),
      aggregateLogs: vi.fn(async () => ({ counts: [] })),
      tailLogs: vi.fn(async () => () => undefined),
    };
    const { bridge, wideEvents } = await load(desktop as never);
    const onEvents = vi.fn();

    wideEvents.run(
      "route.change",
      { kind: "navigation", trigger: "user" },
      () => {
        void bridge.queryLogs({ outcome: "problems" }, { limit: 50 });
        void bridge.getLogTrace("0af7651916cd43dd8448eb211c80319c");
        void bridge.listLogActions({ show: "slow" });
        void bridge.aggregateLogs("7d");
        void bridge.tailLogs({ runtime: "api" }, onEvents);
      },
    );

    const carrier = { traceparent: expect.stringMatching(/^00-/) };
    expect(desktop.queryLogs).toHaveBeenCalledWith(
      { outcome: "problems" },
      { limit: 50 },
      carrier,
    );
    expect(desktop.getLogTrace).toHaveBeenCalledWith(
      "0af7651916cd43dd8448eb211c80319c",
      carrier,
    );
    expect(desktop.listLogActions).toHaveBeenCalledWith(
      { show: "slow" },
      undefined,
      carrier,
    );
    expect(desktop.aggregateLogs).toHaveBeenCalledWith(
      { range: "7d" },
      carrier,
    );
    expect(desktop.tailLogs).toHaveBeenCalledWith(
      { runtime: "api" },
      onEvents,
      carrier,
    );
  });

  it("says diagnostics are a desktop feature outside the desktop app", async () => {
    const { bridge } = await load();

    expect(() => bridge.queryLogs()).toThrow(
      "Diagnostics are available in the desktop app.",
    );
    expect(() => bridge.aggregateLogs("launch")).toThrow(
      "Diagnostics are available in the desktop app.",
    );
  });
});
