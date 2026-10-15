import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_STORAGE_KEY,
  readAppSidebarPreference,
  writeAppSidebarPreference,
} from "./app-sidebar";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("app sidebar preference", () => {
  it("defaults to expanded when nothing or something unknown is saved", () => {
    expect(readAppSidebarPreference(memoryStorage())).toBe("expanded");
    expect(
      readAppSidebarPreference(
        memoryStorage({ [APP_SIDEBAR_STORAGE_KEY]: "collapsed" }),
      ),
    ).toBe("expanded");
  });

  it("reads back the saved hidden sidebar", () => {
    const storage = memoryStorage();
    writeAppSidebarPreference(storage, "hidden");
    expect(readAppSidebarPreference(storage)).toBe("hidden");
  });

  it("reads a rail saved before the rail was removed as hidden", () => {
    expect(
      readAppSidebarPreference(
        memoryStorage({ [APP_SIDEBAR_STORAGE_KEY]: "rail" }),
      ),
    ).toBe("hidden");
  });

  it("falls back to expanded when storage is blocked", () => {
    expect(readAppSidebarPreference(throwingStorage)).toBe("expanded");
    expect(() =>
      writeAppSidebarPreference(throwingStorage, "hidden"),
    ).not.toThrow();
  });
});
