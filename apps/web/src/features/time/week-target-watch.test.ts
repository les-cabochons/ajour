import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "ajour.local-state.v2";
const hour = 60 * 60 * 1000;

/** A window whose events reach their listeners, as in a browser. */
function installWindow() {
  const events = new EventTarget();
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      localStorage: {
        get length() {
          return storage.size;
        },
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    },
  });
  return events;
}

/** What another window's write looks like here: a storage event. */
function storageEventFromAnotherWindow(events: EventTarget) {
  events.dispatchEvent(
    Object.assign(new Event("storage"), { key: STORAGE_KEY }),
  );
}

const mondayTarget = {
  monday: 2 * hour,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 0,
  saturday: 0,
  sunday: 0,
};

describe("watchWeekTargets", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}`,
    });
  });

  it("reports a week this window's write brings to its target", async () => {
    installWindow();
    const { localStore } = await import("@/lib/local-store");
    const { watchWeekTargets } = await import("./week-target-watch");
    localStore.setUserPreferences({ weeklyCapacityTargets: mondayTarget });
    const onReach = vi.fn();
    watchWeekTargets(onReach);

    localStore.saveManualTimeEntry({
      localDate: "2026-10-12",
      durationMs: 2 * hour,
    });

    expect(onReach).toHaveBeenCalledTimes(1);
    expect(onReach.mock.calls[0]![0]).toMatchObject({ weekOf: "2026-10-12" });
    expect(localStore.snapshot().commitPromptedWeeks).toEqual(["2026-10-12"]);
  });

  it("ignores another window's write, and does not count it later", async () => {
    const events = installWindow();
    const { localStore } = await import("@/lib/local-store");
    const { watchWeekTargets } = await import("./week-target-watch");
    localStore.setUserPreferences({ weeklyCapacityTargets: mondayTarget });
    const onReach = vi.fn();
    watchWeekTargets(onReach);

    // Another window saves the entry that reaches the target.
    const current = localStore.snapshot();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...current,
        timesheetEntries: [
          {
            _id: "other-window",
            localDate: "2026-10-12",
            label: "",
            durationMs: 2 * hour,
            sourceBlockIds: [],
            committedAt: 1,
          },
        ],
      }),
    );
    storageEventFromAnotherWindow(events);
    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);

    // A later write here starts from the other window's state: still at target.
    localStore.saveManualTimeEntry({
      localDate: "2026-10-12",
      durationMs: hour,
    });

    expect(onReach).not.toHaveBeenCalled();
    expect(localStore.snapshot().commitPromptedWeeks).toEqual([]);
  });
});
