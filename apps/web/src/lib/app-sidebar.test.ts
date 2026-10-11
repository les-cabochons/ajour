import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_STORAGE_KEY,
  readAppSidebarPreference,
  resolveAppSidebarState,
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

  it("reads back the saved rail", () => {
    const storage = memoryStorage();
    writeAppSidebarPreference(storage, "rail");
    expect(readAppSidebarPreference(storage)).toBe("rail");
  });

  it("falls back to expanded when storage is blocked", () => {
    expect(readAppSidebarPreference(throwingStorage)).toBe("expanded");
    expect(() =>
      writeAppSidebarPreference(throwingStorage, "rail"),
    ).not.toThrow();
  });
});

describe("resolveAppSidebarState", () => {
  it("follows the preference at wide widths", () => {
    expect(resolveAppSidebarState("expanded", false)).toBe("expanded");
    expect(resolveAppSidebarState("rail", false)).toBe("rail");
  });

  it("shows the rail when the window is narrow, whatever the preference", () => {
    expect(resolveAppSidebarState("expanded", true)).toBe("rail");
    expect(resolveAppSidebarState("rail", true)).toBe("rail");
  });
});
