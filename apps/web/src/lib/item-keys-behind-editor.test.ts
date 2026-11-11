// @vitest-environment jsdom
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectAction } from "@/domain/actions/object-actions";
import { registerOpenEntryEditor } from "@/lib/entry-editor-presence";
import { handleItemKeyDown, type ActionKeys } from "@/lib/item-keys";

type Id = "settle" | "snooze";
const actions: ObjectAction<Id>[] = [
  { id: "settle", label: "Settle" },
  { id: "snooze", label: "Snooze" },
];
const keys: ActionKeys<Id> = { settle: "item.settle", snooze: "item.snooze" };

/** Presses `key` on a row, and returns the actions that ran. */
function pressOnRow(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  const row = document.createElement("div");
  document.body.append(row);
  const ran: string[] = [];
  handleItemKeyDown(
    {
      currentTarget: row,
      target: row,
      key,
      code: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      defaultPrevented: false,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
    } as unknown as ReactKeyboardEvent<HTMLElement>,
    { actions, keys, onAction: (id) => ran.push(id) },
  );
  return ran;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a row's single keys behind an open draft", () => {
  it("run their action when nothing is open", () => {
    expect(pressOnRow("e")).toEqual(["settle"]);
  });

  it("do nothing while an entry editor is open", () => {
    const close = registerOpenEntryEditor();
    expect(pressOnRow("e")).toEqual([]);
    expect(pressOnRow("b")).toEqual([]);
    close();
    expect(pressOnRow("b")).toEqual(["snooze"]);
  });

  it("do nothing while a floating composer is open", () => {
    const composer = document.createElement("div");
    composer.className = "composer-floating";
    document.body.append(composer);
    expect(pressOnRow("e")).toEqual([]);
  });
});
