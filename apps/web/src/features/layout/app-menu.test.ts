import { describe, expect, it } from "vitest";
import { formatMenuAccelerator, resolveAppMenuAction } from "./app-menu";

describe("app menu actions", () => {
  it("runs registry actions through their shortcut handler", () => {
    expect(resolveAppMenuAction("time.day-view")).toEqual({
      kind: "shortcut",
      id: "time.day-view",
    });
  });

  it("opens Settings for Check for updates", () => {
    expect(resolveAppMenuAction("app.check-for-updates")).toEqual({
      kind: "check-for-updates",
    });
  });

  it("ignores unknown ids from the main process", () => {
    expect(resolveAppMenuAction("app.delete-everything")).toBeNull();
    expect(resolveAppMenuAction(42)).toBeNull();
  });
});

describe("Windows menu key labels", () => {
  it("writes the command key as Ctrl", () => {
    expect(formatMenuAccelerator("CmdOrCtrl+B")).toBe("Ctrl+B");
    expect(formatMenuAccelerator("Ctrl+Y")).toBe("Ctrl+Y");
    expect(formatMenuAccelerator("CmdOrCtrl+Plus")).toBe("Ctrl+Plus");
    expect(formatMenuAccelerator("D")).toBe("D");
  });
});
