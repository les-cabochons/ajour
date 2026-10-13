import { expect, it } from "vitest";
import {
  canDragBacklogItem,
  getBacklogDropOrder,
  type BacklogDropTarget,
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
