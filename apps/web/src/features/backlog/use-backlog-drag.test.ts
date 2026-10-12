import { expect, it } from "vitest";
import { canDragBacklogItem, type BacklogDropTarget } from "./use-backlog-drag";

it.each<{
  description: string;
  targets: BacklogDropTarget[];
  canReorder: boolean;
  expected: boolean;
}>([
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
  ({ targets, canReorder, expected }) => {
    expect(canDragBacklogItem(targets, canReorder, "a", "lane/origin")).toBe(
      expected,
    );
  },
);
