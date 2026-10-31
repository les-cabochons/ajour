import { describe, expect, it } from "vitest";
import {
  canDragBacklogItem,
  getBacklogDropMark,
  getBacklogDropOrder,
  getBacklogRowShifts,
  type BacklogDropTarget,
  type BacklogReorderPeer,
} from "./use-backlog-drag";

it.each<{
  description: string;
  targets: BacklogDropTarget[];
  canReorder: boolean;
  sortableIds?: string[];
  expected: boolean;
}>([
  {
    description: "a subitem with a root peer in its group",
    targets: [{ key: "lane/origin", itemIds: ["a", "b"] }],
    canReorder: true,
    sortableIds: ["b"],
    expected: false,
  },
  {
    description: "a root with only a subitem peer",
    targets: [{ key: "lane/origin", itemIds: ["a", "b"] }],
    canReorder: true,
    sortableIds: ["a"],
    expected: false,
  },
  {
    description: "a subitem moving to another group",
    targets: [
      { key: "lane/origin", itemIds: ["a", "b"] },
      { key: "lane/other", itemIds: [] },
    ],
    canReorder: true,
    sortableIds: ["b"],
    expected: true,
  },
  {
    description: "a sorted ungrouped list",
    targets: [{ key: "lane/origin", itemIds: ["a", "b"] }],
    canReorder: false,
    expected: false,
  },
  {
    description: "custom ordering with a peer",
    targets: [{ key: "lane/origin", itemIds: ["a", "b"] }],
    canReorder: true,
    expected: true,
  },
  {
    description: "custom ordering without a peer",
    targets: [{ key: "lane/origin", itemIds: ["a"] }],
    canReorder: true,
    expected: false,
  },
  {
    description: "another destination with sorted ordering",
    targets: [
      { key: "lane/origin", itemIds: ["a"] },
      { key: "lane/other", itemIds: [] },
    ],
    canReorder: false,
    expected: true,
  },
  {
    description: "destinations confined to another swimlane",
    targets: [{ key: "other-lane/other", itemIds: ["b"] }],
    canReorder: true,
    expected: false,
  },
  {
    description: "moving out of an unavailable origin group",
    targets: [{ key: "lane/active", itemIds: [] }],
    canReorder: false,
    expected: true,
  },
  {
    description: "a lane with no destinations",
    targets: [],
    canReorder: true,
    expected: false,
  },
])(
  "determines drag eligibility for $description",
  ({ targets, canReorder, sortableIds, expected }) => {
    expect(
      canDragBacklogItem(
        targets,
        (id) => canReorder && (!sortableIds || sortableIds.includes(id)),
        "a",
        "lane/origin",
      ),
    ).toBe(expected);
  },
);

it.each([
  {
    description: "same-group subitem",
    itemIds: ["parent", "child", "other"],
    itemId: "child",
    index: 0,
    sameGroup: true,
    expected: null,
  },
  {
    description: "cross-group subitem",
    itemIds: ["other"],
    itemId: "child",
    index: 1,
    sameGroup: false,
    expected: null,
  },
  {
    description: "root past a subitem",
    itemIds: ["parent", "child", "other"],
    itemId: "parent",
    index: 2,
    sameGroup: true,
    expected: ["other", "parent"],
  },
  {
    description: "cross-group root among subitems",
    itemIds: ["child", "other"],
    itemId: "parent",
    index: 1,
    sameGroup: false,
    expected: ["parent", "other"],
  },
])(
  "builds only root ordering for $description",
  ({ itemIds, itemId, index, sameGroup, expected }) => {
    expect(
      getBacklogDropOrder(
        itemIds,
        itemId,
        index,
        sameGroup,
        (id) => id !== "child",
      ),
    ).toEqual(expected);
  },
);

describe("the drop line", () => {
  const targets = [{ key: "lane/list", itemIds: ["a", "b", "b-sub", "c"] }];
  const canReorder = (itemId: string) => itemId !== "b-sub";
  const drag = (itemId: string, index: number) => ({
    itemId,
    originKey: "lane/list",
    targetKey: "lane/list",
    index,
  });

  it("marks the item the dragged one would land before", () => {
    // Dragging "a" below "b" and its subitem lands it before "c".
    expect(getBacklogDropMark(drag("a", 2), targets, canReorder)).toEqual({
      itemId: "c",
      edge: "before",
    });
  });

  it("marks the end of the list after its last row", () => {
    expect(getBacklogDropMark(drag("a", 3), targets, canReorder)).toEqual({
      itemId: "c",
      edge: "after",
    });
  });

  it("shows no line when the drop changes nothing", () => {
    expect(getBacklogDropMark(drag("a", 0), targets, canReorder)).toBe(
      undefined,
    );
    expect(getBacklogDropMark(null, targets, canReorder)).toBe(undefined);
  });
});

describe("moving within a priority level", () => {
  const level: Record<string, number> = {
    urgent: 1,
    "high-1": 2,
    "high-2": 2,
    "high-elsewhere": 2,
    medium: 3,
  };
  const sameLevel = (itemId: string, draggedId: string) =>
    level[itemId] === level[draggedId];
  const target = {
    key: "lane/todo",
    itemIds: ["urgent", "high-1", "high-2", "medium"],
  };
  const drag = (itemId: string, index: number, originKey = "lane/todo") => ({
    itemId,
    originKey,
    targetKey: "lane/todo",
    index,
  });

  it("stops at the first item of the level when dragged above it", () => {
    // Index 0 is above the Urgent row.
    expect(
      getBacklogDropOrder(target.itemIds, "high-2", 0, true, sameLevel),
    ).toEqual(["high-2", "high-1"]);
    expect(getBacklogDropMark(drag("high-2", 0), [target], sameLevel)).toEqual({
      itemId: "high-1",
      edge: "before",
    });
  });

  it("stops after the last item of the level when dragged past it", () => {
    // Index 3 is below the Medium row.
    expect(
      getBacklogDropOrder(target.itemIds, "high-1", 3, true, sameLevel),
    ).toEqual(["high-2", "high-1"]);
    expect(getBacklogDropMark(drag("high-1", 3), [target], sameLevel)).toEqual({
      itemId: "high-2",
      edge: "after",
    });
  });

  it("changes nothing for the first item dragged above its level", () => {
    expect(
      getBacklogDropOrder(target.itemIds, "high-1", 0, true, sameLevel),
    ).toBe(null);
    expect(getBacklogDropMark(drag("high-1", 0), [target], sameLevel)).toBe(
      undefined,
    );
  });

  it("lands an item from another group among the items of its level", () => {
    const from = "lane/doing";
    expect(
      getBacklogDropOrder(
        target.itemIds,
        "high-elsewhere",
        0,
        false,
        sameLevel,
      ),
    ).toEqual(["high-elsewhere", "high-1", "high-2"]);
    expect(
      getBacklogDropMark(drag("high-elsewhere", 4, from), [target], sameLevel),
    ).toEqual({ itemId: "high-2", edge: "after" });
  });

  it("drags an item only with another item of its level or another group", () => {
    expect(canDragBacklogItem([target], sameLevel, "high-1", "lane/todo")).toBe(
      true,
    );
    expect(canDragBacklogItem([target], sameLevel, "medium", "lane/todo")).toBe(
      false,
    );
  });
});

describe("the drop line where rows that never move keep their slot", () => {
  // The Backlog page under Custom ordering: a subitem keeps its row, and the
  // moved items trade their slots, so the line marks the slot the item takes.
  const isRoot = (itemId: string) => !itemId.endsWith("-sub");
  const drag = (itemId: string, index: number) => ({
    itemId,
    originKey: "lane/list",
    targetKey: "lane/list",
    index,
  });

  it("marks the slot above a subitem when an item lands last", () => {
    // "a" dropped below "b-sub" takes "b"'s slot: b, a, b-sub.
    const targets = [{ key: "lane/list", itemIds: ["a", "b", "b-sub"] }];
    expect(
      getBacklogDropMark(drag("a", 2), targets, isRoot, "keep-slot"),
    ).toEqual({ itemId: "b", edge: "after" });
  });

  it("marks the slot below a subitem when an item moves up past it", () => {
    // "c" dropped above "b" takes "b"'s slot: a, a-sub, c, b.
    const targets = [{ key: "lane/list", itemIds: ["a", "a-sub", "b", "c"] }];
    expect(
      getBacklogDropMark(drag("c", 2), targets, isRoot, "keep-slot"),
    ).toEqual({ itemId: "b", edge: "before" });
  });

  it("marks the first slot when an item lands first", () => {
    // "b" dropped above "a" takes "a"'s slot: b, a-sub, a.
    const targets = [{ key: "lane/list", itemIds: ["a", "a-sub", "b"] }];
    expect(
      getBacklogDropMark(drag("b", 0), targets, isRoot, "keep-slot"),
    ).toEqual({ itemId: "a", edge: "before" });
  });
});

it("keeps a parent's subitem above the line when an item lands last", () => {
  // The sidebar shows a subitem below its parent, so the item lands after both.
  const targets = [{ key: "lane/list", itemIds: ["a", "b", "b-sub"] }];
  expect(
    getBacklogDropMark(
      { itemId: "a", originKey: "lane/list", targetKey: "lane/list", index: 2 },
      targets,
      (itemId) => itemId !== "b-sub",
    ),
  ).toEqual({ itemId: "b-sub", edge: "after" });
});

describe("the gap a dragged sidebar row opens", () => {
  /**
   * What the list reads mid-drag: each row at its slot plus its shift, and
   * the dragged item in the slot left empty, where the gap is.
   */
  function readDuringDrag(
    rows: string[],
    itemId: string,
    index: number,
    canReorder: BacklogReorderPeer = () => true,
  ) {
    const drag = {
      itemId,
      originKey: "lane/list",
      targetKey: "lane/list",
      index,
    };
    const shifts = getBacklogRowShifts(
      drag,
      [{ key: "lane/list", itemIds: rows }],
      canReorder,
    );
    const slots: string[] = Array(rows.length).fill(itemId);
    rows.forEach((id, row) => {
      if (id !== itemId) slots[row + (shifts.get(id) ?? 0)] = id;
    });
    return slots;
  }

  it("reads in the order the drop gives", () => {
    expect(readDuringDrag(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(readDuringDrag(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("stays at the row's own place until the pointer leaves it", () => {
    expect(readDuringDrag(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("never opens between a parent and its subitem", () => {
    const isRoot = (id: string) => !id.endsWith("-sub");
    // Index 1 is between "b" and its subitem: the gap opens after both.
    expect(readDuringDrag(["a", "b", "b-sub", "c"], "a", 2, isRoot)).toEqual([
      "b",
      "b-sub",
      "a",
      "c",
    ]);
  });

  it("takes a parent's subitem along with the parent", () => {
    const isRoot = (id: string) => !id.endsWith("-sub");
    expect(readDuringDrag(["a", "a-sub", "b"], "a", 2, isRoot)).toEqual([
      "b",
      "a",
      "a-sub",
    ]);
  });

  it("moves nothing while the pointer is outside the list", () => {
    const shifts = getBacklogRowShifts(
      { itemId: "c", originKey: "lane/list", targetKey: null, index: 0 },
      [{ key: "lane/list", itemIds: ["a", "b", "c"] }],
      () => true,
    );
    expect(shifts.size).toBe(0);
  });
});
