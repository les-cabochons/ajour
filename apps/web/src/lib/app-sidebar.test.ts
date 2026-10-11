import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_STORAGE_KEY,
  isAppSidebarShortcut,
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

const keyB = {
  key: "b",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
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

describe("isAppSidebarShortcut", () => {
  it("uses Cmd+B on macOS and Ctrl+B elsewhere", () => {
    expect(isAppSidebarShortcut({ ...keyB, metaKey: true }, "mac")).toBe(true);
    expect(isAppSidebarShortcut({ ...keyB, ctrlKey: true }, "mac")).toBe(false);
    expect(isAppSidebarShortcut({ ...keyB, ctrlKey: true }, "other")).toBe(
      true,
    );
    expect(isAppSidebarShortcut({ ...keyB, metaKey: true }, "other")).toBe(
      false,
    );
  });

  it("ignores other modifiers, key repeat and other keys", () => {
    const command = { ...keyB, metaKey: true };
    expect(isAppSidebarShortcut({ ...command, shiftKey: true }, "mac")).toBe(
      false,
    );
    expect(isAppSidebarShortcut({ ...command, altKey: true }, "mac")).toBe(
      false,
    );
    expect(isAppSidebarShortcut({ ...command, repeat: true }, "mac")).toBe(
      false,
    );
    expect(isAppSidebarShortcut({ ...command, key: "\\" }, "mac")).toBe(false);
    expect(isAppSidebarShortcut(keyB, "mac")).toBe(false);
  });

  it("accepts B with caps lock on", () => {
    expect(
      isAppSidebarShortcut({ ...keyB, key: "B", ctrlKey: true }, "other"),
    ).toBe(true);
  });
});
