import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

function installLegacyWindow() {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        clear: vi.fn(() => {
          storage.clear();
        }),
      },
    },
  });

  storage.set(
    "ajour.local-state.v2",
    JSON.stringify({
      activityLoggerEnabled: true,
    }),
  );
}

describe("activity logger removal", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installLegacyWindow();
  });

  it("drops the legacy activity logger flag from persisted local state", async () => {
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot()).not.toHaveProperty("activityLoggerEnabled");
  });
});
