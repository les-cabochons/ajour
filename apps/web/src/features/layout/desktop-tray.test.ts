import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  timers: [] as { _id: string }[],
  saveTimer: vi.fn(),
}));

vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: () => ({ timers: store.timers }),
    saveTimer: store.saveTimer,
  },
}));

const { runTrayAction } = await import("@/features/layout/desktop-tray");

describe("the tray menu's Stop", () => {
  beforeEach(() => {
    store.timers = [];
    store.saveTimer.mockClear();
  });

  it("stops the running entry the menu showed, as the dock's Stop does", () => {
    store.timers = [{ _id: "timer-1" }];

    runTrayAction({ action: "stop", timerId: "timer-1" });

    expect(store.saveTimer).toHaveBeenCalledExactlyOnceWith("timer-1");
  });

  // The user started another entry after the menu opened.
  it("leaves another running entry alone", () => {
    store.timers = [{ _id: "timer-2" }];

    runTrayAction({ action: "stop", timerId: "timer-1" });

    expect(store.saveTimer).not.toHaveBeenCalled();
  });

  it("ignores an action it does not know", () => {
    store.timers = [{ _id: "timer-1" }];

    runTrayAction({ action: "pause", timerId: "timer-1" } as never);

    expect(store.saveTimer).not.toHaveBeenCalled();
  });
});
