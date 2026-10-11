import { describe, expect, it } from "vitest";
import { resolveFocusedObject, type FocusableElement } from "./focused-object";

/** A stand-in DOM element: its own attributes, and the element that contains it. */
function element(
  attributes: Record<string, string>,
  parent: FocusableElement | null = null,
): FocusableElement {
  const self: FocusableElement = {
    getAttribute: (name) => attributes[name] ?? null,
    closest: (selector) => {
      const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map(
        (match) => match[1]!,
      );
      return names.some((name) => name in attributes)
        ? self
        : (parent?.closest(selector) ?? null);
    },
  };
  return self;
}

describe("resolveFocusedObject", () => {
  it("finds the entry whose row contains the focused button", () => {
    const row = element({ "data-entry-id": "entry-1" });
    const button = element({}, row);

    expect(resolveFocusedObject(button)).toEqual({
      kind: "time-entry",
      entryId: "entry-1",
      isRunning: false,
    });
  });

  it("marks the running entry, whose id may be empty", () => {
    const card = element({ "data-entry-id": "", "data-running-entry": "true" });

    expect(resolveFocusedObject(card)).toEqual({
      kind: "time-entry",
      entryId: "",
      isRunning: true,
    });
  });

  it("prefers a task row over the project page around it", () => {
    const projectPage = element({ "data-project-id": "project-1" });
    const taskRow = element({ "data-task-id": "task-1" }, projectPage);
    const header = element({}, projectPage);

    expect(resolveFocusedObject(element({}, taskRow))).toEqual({
      kind: "task",
      projectId: "project-1",
      taskId: "task-1",
    });
    expect(resolveFocusedObject(header)).toEqual({
      kind: "project",
      projectId: "project-1",
    });
  });

  it("finds backlog items and ignores focus outside any object", () => {
    expect(
      resolveFocusedObject(element({ "data-backlog-item-id": "item-1" })),
    ).toEqual({ kind: "backlog-item", workItemId: "item-1" });
    expect(resolveFocusedObject(element({}))).toBeNull();
    expect(resolveFocusedObject(null)).toBeNull();
  });
});
