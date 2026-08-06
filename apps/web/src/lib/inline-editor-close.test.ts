import { describe, expect, it } from "vitest";
import { isInlineEditorOutsideClick } from "./inline-editor-close";

describe("isInlineEditorOutsideClick", () => {
  it("ignores clicks inside the editor", () => {
    const child = {} as EventTarget;
    const editor = {
      contains(target: EventTarget | null) {
        return target === child;
      },
    };

    expect(isInlineEditorOutsideClick(child, editor)).toBe(false);
  });

  it("ignores clicks inside searchable-select portals", () => {
    const editor = {
      contains() {
        return false;
      },
    };
    const option = {
      closest(selector: string) {
        return selector === ".searchable-select-popover" ? {} : null;
      },
    } as unknown as EventTarget;

    expect(isInlineEditorOutsideClick(option, editor)).toBe(false);
  });

  it("ignores clicks inside project-task picker portals", () => {
    const editor = {
      contains() {
        return false;
      },
    };
    const option = {
      closest(selector: string) {
        return selector === ".project-task-picker-popover" ? {} : null;
      },
    } as unknown as EventTarget;

    expect(isInlineEditorOutsideClick(option, editor)).toBe(false);
  });

  it("ignores clicks inside explicitly ignored selectors", () => {
    const editor = {
      contains() {
        return false;
      },
    };
    const row = {
      closest(selector: string) {
        return selector === '[data-backlog-root-id="root_1"]' ? {} : null;
      },
    } as unknown as EventTarget;

    expect(
      isInlineEditorOutsideClick(row, editor, [
        '[data-backlog-root-id="root_1"]',
      ]),
    ).toBe(false);
  });

  it("treats other document clicks as outside clicks", () => {
    const editor = {
      contains() {
        return false;
      },
    };
    const outside = {
      closest() {
        return null;
      },
    } as unknown as EventTarget;

    expect(isInlineEditorOutsideClick(outside, editor)).toBe(true);
  });
});
