import { describe, expect, it } from "vitest";
import {
  isEntryEditorOpen,
  registerOpenEntryEditor,
} from "./entry-editor-presence";

describe("entry editor presence", () => {
  it("stays open until every open editor closes", () => {
    expect(isEntryEditorOpen()).toBe(false);

    const closePanel = registerOpenEntryEditor();
    const closePopover = registerOpenEntryEditor();
    expect(isEntryEditorOpen()).toBe(true);

    closePanel();
    expect(isEntryEditorOpen()).toBe(true);

    closePopover();
    expect(isEntryEditorOpen()).toBe(false);
  });

  it("counts a closed editor once, even when closed twice", () => {
    const closeEditor = registerOpenEntryEditor();
    const closeOther = registerOpenEntryEditor();

    closeEditor();
    closeEditor();
    expect(isEntryEditorOpen()).toBe(true);

    closeOther();
    expect(isEntryEditorOpen()).toBe(false);
  });
});
