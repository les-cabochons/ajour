import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTRY_SELECTION,
  getSelectionActionIds,
  getPasteDate,
  keepShownEntries,
  selectEntryOnClick,
} from "@/domain/time/entry-selection";

const ORDER = ["a", "b", "c", "d", "e"];
const PLAIN = { range: false, toggle: false };
const TOGGLE = { range: false, toggle: true };
const RANGE = { range: true, toggle: false };

describe("selectEntryOnClick", () => {
  it("selects only the clicked entry on a plain click", () => {
    const selection = selectEntryOnClick(
      { ids: ["a", "b"], anchorId: "a" },
      ORDER,
      "d",
      PLAIN,
    );

    expect(selection).toEqual({ ids: ["d"], anchorId: "d" });
  });

  it("adds and removes entries with Cmd or Ctrl+click", () => {
    const added = selectEntryOnClick(
      selectEntryOnClick(EMPTY_ENTRY_SELECTION, ORDER, "b", PLAIN),
      ORDER,
      "d",
      TOGGLE,
    );
    expect(added.ids).toEqual(["b", "d"]);

    const removed = selectEntryOnClick(added, ORDER, "b", TOGGLE);
    expect(removed).toEqual({ ids: ["d"], anchorId: "b" });
  });

  it("selects the range from the anchor with Shift+click, in either direction", () => {
    const anchored = selectEntryOnClick(
      EMPTY_ENTRY_SELECTION,
      ORDER,
      "c",
      PLAIN,
    );

    const down = selectEntryOnClick(anchored, ORDER, "e", RANGE);
    expect(down).toEqual({ ids: ["c", "d", "e"], anchorId: "c" });

    // A second Shift+click redraws the range from the same anchor.
    const up = selectEntryOnClick(down, ORDER, "a", RANGE);
    expect(up).toEqual({ ids: ["a", "b", "c"], anchorId: "c" });
  });

  it("selects the entry alone when Shift+click has no shown anchor", () => {
    const selection = selectEntryOnClick(
      { ids: ["gone"], anchorId: "gone" },
      ORDER,
      "b",
      RANGE,
    );

    expect(selection).toEqual({ ids: ["b"], anchorId: "b" });
  });
});

describe("keepShownEntries", () => {
  it("drops entries that are no longer shown", () => {
    const selection = keepShownEntries(
      { ids: ["a", "b", "c"], anchorId: "b" },
      new Set(["a", "c"]),
    );

    expect(selection).toEqual({ ids: ["a", "c"], anchorId: null });
  });

  it("returns the same selection when every entry is still shown", () => {
    const selection = { ids: ["a"], anchorId: "a" };

    expect(keepShownEntries(selection, new Set(ORDER))).toBe(selection);
  });
});

describe("getPasteDate", () => {
  // Monday, October 12, 2026 through Sunday, October 18.
  const shownWeek = [
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ];

  it("puts every entry on the target day", () => {
    const target = { kind: "day" as const, localDate: "2026-10-14" };

    expect(getPasteDate("2026-09-07", target)).toBe("2026-10-14");
    expect(getPasteDate("2026-10-18", target)).toBe("2026-10-14");
  });

  it("keeps the weekday of each entry in the shown week", () => {
    const target = { kind: "same-weekday" as const, weekDates: shownWeek };

    // Monday, September 7 and Sunday, October 4.
    expect(getPasteDate("2026-09-07", target)).toBe("2026-10-12");
    expect(getPasteDate("2026-10-04", target)).toBe("2026-10-18");
    // Thursday, October 22, a later week.
    expect(getPasteDate("2026-10-22", target)).toBe("2026-10-15");
  });
});

describe("getSelectionActionIds", () => {
  const pair = { ids: ["a", "b"], anchorId: "b" };

  it("applies to the whole selection from a selected entry", () => {
    expect(getSelectionActionIds(pair, "a", { fromKey: true })).toEqual([
      "a",
      "b",
    ]);
    expect(getSelectionActionIds(pair, "b", { fromKey: false })).toEqual([
      "a",
      "b",
    ]);
  });

  it("applies to the selection, not the focused entry, when the key comes from an unselected entry", () => {
    // Cmd+click toggled "b" off, and "b" kept focus.
    const toggledOff = { ids: ["a"], anchorId: "b" };

    expect(getSelectionActionIds(toggledOff, "b", { fromKey: true })).toEqual([
      "a",
    ]);
  });

  it("leaves a single entry, or a menu on an unselected entry, to the entry itself", () => {
    expect(
      getSelectionActionIds({ ids: ["a"], anchorId: "a" }, "a", {
        fromKey: true,
      }),
    ).toBeNull();
    expect(getSelectionActionIds(pair, "c", { fromKey: false })).toBeNull();
    expect(
      getSelectionActionIds(EMPTY_ENTRY_SELECTION, "a", { fromKey: true }),
    ).toBeNull();
  });
});
