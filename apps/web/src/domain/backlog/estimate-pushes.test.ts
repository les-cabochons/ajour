import { describe, expect, it } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  hasEstimateChangeToPush,
  itemsWithNewEstimateChanges,
} from "@/domain/backlog/estimate-pushes";

/** A synced item whose remaining estimate both sides agree is 5 hours. */
function item(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    _id: "item-1",
    title: "Ship the access group",
    status: "active",
    source: "azure_devops",
    sourceId: "42",
    sourceConnectionId: "contoso",
    hierarchyLevel: 0,
    createdAt: 1,
    remainingEstimateHours: 5,
    estimateSync: {
      remainingEstimateHours: { baselineValue: 5, remoteValue: 5 },
    },
    ...overrides,
  } as LocalWorkItem;
}

/** The item with its remaining estimate's sync state replaced. */
function remaining(
  value: number,
  field: NonNullable<LocalWorkItem["estimateSync"]>["remainingEstimateHours"],
) {
  return item({
    remainingEstimateHours: value,
    estimateSync: { remainingEstimateHours: field },
  });
}

describe("estimate changes that go to the source", () => {
  it("starts an upload for a new value, and again for each value typed after it", () => {
    const agreed = item();
    const edited = remaining(3, { baselineValue: 5, remoteValue: 5 });
    const editedAgain = remaining(2, { baselineValue: 5, remoteValue: 5 });

    expect(hasEstimateChangeToPush(agreed)).toBe(false);
    expect(hasEstimateChangeToPush(edited)).toBe(true);
    expect(itemsWithNewEstimateChanges([agreed], [edited])).toEqual(["item-1"]);
    expect(itemsWithNewEstimateChanges([edited], [editedAgain])).toEqual([
      "item-1",
    ]);
    // The item changed in another way: its estimate change isn't new.
    expect(
      itemsWithNewEstimateChanges([edited], [{ ...edited, title: "Renamed" }]),
    ).toEqual([]);
  });

  it("starts nothing when the change goes away: uploaded, undone or kept in a conflict", () => {
    const edited = remaining(3, { baselineValue: 5, remoteValue: 5 });
    const uploaded = remaining(3, { baselineValue: 3, remoteValue: 3 });
    const conflict = remaining(3, {
      baselineValue: 5,
      remoteValue: 8,
      conflict: {
        detectedAt: 10,
        localValue: 3,
        remoteValue: 8,
        baselineValue: 5,
      },
    });

    expect(itemsWithNewEstimateChanges([edited], [uploaded])).toEqual([]);
    expect(itemsWithNewEstimateChanges([edited], [item()])).toEqual([]);
    expect(itemsWithNewEstimateChanges([edited], [conflict])).toEqual([]);
  });

  it("starts an upload for Keep mine and for a released hold, never for a held field", () => {
    const conflict = remaining(3, { baselineValue: 5, remoteValue: 8 });
    const keptMine = remaining(3, {
      baselineValue: 5,
      remoteValue: 8,
      resolution: "keep_local",
    });
    const held = remaining(3, {
      baselineValue: 5,
      remoteValue: 5,
      held: { at: 1 },
    });
    const released = remaining(3, { baselineValue: 5, remoteValue: 5 });

    expect(itemsWithNewEstimateChanges([conflict], [keptMine])).toEqual([
      "item-1",
    ]);
    expect(itemsWithNewEstimateChanges([item()], [held])).toEqual([]);
    expect(hasEstimateChangeToPush(held)).toBe(false);
    expect(itemsWithNewEstimateChanges([held], [released])).toEqual(["item-1"]);
  });

  it("never uploads a manual item's estimates", () => {
    const manual = item({
      source: "manual",
      sourceId: undefined,
      sourceConnectionId: undefined,
      remainingEstimateHours: 3,
    });

    expect(hasEstimateChangeToPush(manual)).toBe(false);
    expect(itemsWithNewEstimateChanges([], [manual])).toEqual([]);
  });
});
