import { afterEach, describe, expect, it, vi } from "vitest";
import { openModifiedSourceClick, openSourceUrl } from "./source-navigation";

afterEach(() => vi.unstubAllGlobals());
describe("source navigation", () => {
  it.each(["javascript:alert(1)", "file:///tmp/data", "not a url"])(
    "rejects %s",
    (url) => {
      const open = vi.fn();
      vi.stubGlobal("window", { open });
      expect(openSourceUrl(url)).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );
  it.each(["ctrlKey", "metaKey"])(
    "opens a source link on %s and stops local navigation",
    (modifier) => {
      const open = vi.fn();
      vi.stubGlobal("window", { open });
      const event = {
        ctrlKey: modifier === "ctrlKey",
        metaKey: modifier === "metaKey",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      expect(openModifiedSourceClick(event, "https://example.com/42")).toBe(
        true,
      );
      expect(open).toHaveBeenCalledWith(
        "https://example.com/42",
        "_blank",
        "noopener,noreferrer",
      );
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    },
  );
  it("leaves a plain click and a local item to the app", () => {
    const event = {
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(openModifiedSourceClick(event, "https://example.com/42")).toBe(
      false,
    );
    expect(
      openModifiedSourceClick({ ...event, ctrlKey: true }, undefined),
    ).toBe(false);
  });
});
