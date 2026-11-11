// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findTypeaheadMatch } from "@/components/ui/dropdown-menu";
import { ignoreSecondClick } from "@/lib/double-click-guard";
import { focusWhenLost } from "@/lib/focus-return";
import { captureItemFocus } from "@/lib/item-keys";

/** Lets the focus return's first try, a microtask, run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A list scope with one row per id, each keyed by its id. */
function renderRows(ids: readonly string[]) {
  document.body.innerHTML = `<div data-focus-scope>${ids
    .map(
      (id) =>
        `<div tabindex="0" data-focus-column="0" data-focus-key="${id}">${id}</div>`,
    )
    .join("")}</div>`;
  const scope = document.querySelector<HTMLElement>("[data-focus-scope]")!;
  const row = (id: string) =>
    scope.querySelector<HTMLElement>(`[data-focus-key="${id}"]`)!;
  return { scope, row };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("captureItemFocus", () => {
  it("follows the item to the element that shows it now", async () => {
    const { scope, row } = renderRows(["a", "b", "c"]);
    row("b").focus();
    const restore = captureItemFocus(row("b"));
    // A change draws the item again, in another group.
    row("b").remove();
    const moved = document.createElement("div");
    moved.tabIndex = 0;
    moved.dataset.focusColumn = "0";
    moved.dataset.focusKey = "b";
    scope.append(moved);
    restore();
    await settle();
    expect(document.activeElement).toBe(moved);
  });

  it("moves to the item that took its place when it left", async () => {
    const { row } = renderRows(["a", "b", "c"]);
    row("b").focus();
    const restore = captureItemFocus(row("b"));
    row("b").remove();
    restore();
    await settle();
    expect(document.activeElement).toBe(row("c"));
  });

  it("moves to the one before when the last item left", async () => {
    const { row } = renderRows(["a", "b"]);
    row("b").focus();
    const restore = captureItemFocus(row("b"));
    row("b").remove();
    restore();
    await settle();
    expect(document.activeElement).toBe(row("a"));
  });

  it("leaves focus where something else put it", async () => {
    const { row } = renderRows(["a", "b"]);
    const field = document.createElement("input");
    document.body.append(field);
    row("b").focus();
    const restore = captureItemFocus(row("b"));
    row("b").remove();
    // A dialog the action opened took focus.
    field.focus();
    restore();
    await settle();
    expect(document.activeElement).toBe(field);
  });
});

describe("findTypeaheadMatch", () => {
  const items = ["No state", "To do", "In progress", "In review", "Done"].map(
    (name) => ({ name, text: name.toLocaleLowerCase() }),
  );

  it("matches the start of a name first", () => {
    expect(findTypeaheadMatch(items, "in")?.name).toBe("In progress");
  });

  it("matches the start of any word", () => {
    expect(findTypeaheadMatch(items, "rev")?.name).toBe("In review");
    expect(findTypeaheadMatch(items, "REV")?.name).toBe("In review");
  });

  it("finds nothing for letters no word starts with", () => {
    expect(findTypeaheadMatch(items, "xyz")).toBeUndefined();
  });
});

describe("ignoreSecondClick", () => {
  function click(target: Element, detail: number) {
    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, detail }),
      );
    }
  }

  it("drops the second click of the double-click it was armed by", () => {
    const row = document.createElement("div");
    document.body.append(row);
    const seen: string[] = [];
    for (const type of ["mousedown", "click", "dblclick"]) {
      row.addEventListener(type, () => seen.push(type));
    }
    ignoreSecondClick({ detail: 1 });
    click(row, 2);
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    expect(seen).toEqual([]);
    // The next click starts a new sequence and goes through.
    click(row, 1);
    expect(seen).toEqual(["mousedown", "click"]);
  });

  it("does nothing for a key press, which clicks with detail 0", () => {
    const row = document.createElement("div");
    document.body.append(row);
    const seen: string[] = [];
    row.addEventListener("click", () => seen.push("click"));
    ignoreSecondClick({ detail: 0 });
    click(row, 2);
    expect(seen).toEqual(["click"]);
  });
});

describe("findTypeaheadMatch cycling", () => {
  const items = ["Start entry", "Snooze…", "Settle", "Delete"].map((name) => ({
    name,
    text: name.toLocaleLowerCase(),
  }));

  it("moves to the next match when the same letter repeats", () => {
    expect(findTypeaheadMatch(items, "s", 0)?.name).toBe("Snooze…");
    expect(findTypeaheadMatch(items, "ss", 1)?.name).toBe("Settle");
    expect(findTypeaheadMatch(items, "sss", 2)?.name).toBe("Start entry");
  });

  it("starts at the first match when nothing is highlighted", () => {
    expect(findTypeaheadMatch(items, "s")?.name).toBe("Start entry");
  });

  it("still matches a typed word from the start", () => {
    expect(findTypeaheadMatch(items, "se", 0)?.name).toBe("Settle");
    expect(findTypeaheadMatch(items, "st", 2)?.name).toBe("Start entry");
  });
});

describe("focusWhenLost", () => {
  function press(type: string, detail: number) {
    window.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, detail }),
    );
  }

  it("keeps returning focus through the second press of a double-click", async () => {
    const { row } = renderRows(["a"]);
    ignoreSecondClick({ detail: 1 });
    focusWhenLost(() => row("a"));
    // The guard drops this press, so it is not the user's next action.
    press("mousedown", 2);
    window.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(document.activeElement).toBe(row("a"));
  });

  it("stops at a press the guard lets through", async () => {
    const { row } = renderRows(["a"]);
    focusWhenLost(() => row("a"));
    press("mousedown", 1);
    window.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(document.activeElement).not.toBe(row("a"));
  });
});
