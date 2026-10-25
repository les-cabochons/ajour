import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  discardHeldDescription,
  descriptionHeld,
  reconcileDescription,
  releaseHeldDescription,
} from "@/domain/backlog/description-sync";
import {
  discardHeldEstimate,
  heldItemEdits,
  holdPendingEstimates,
  holdSourceWrite,
  isSourceWriteHeld,
  markHeldEstimates,
  releaseHeldEstimate,
  releaseHeldSourceWrite,
} from "@/domain/backlog/held-edits";

const connection = { pluginId: "azure_devops", connectionId: "contoso" };

function item(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    _id: "item-1",
    title: "Ship the access group",
    status: "active",
    source: "azure_devops",
    sourceId: "42",
    sourceConnectionId: "contoso",
    sourceConnectionLabel: "Contoso",
    hierarchyLevel: 0,
    createdAt: 1,
    ...overrides,
  } as LocalWorkItem;
}

/** Held edits touch only the work items, so the rest of the state can be empty. */
function state(...workItems: LocalWorkItem[]): LocalAppState {
  return { workItems } as LocalAppState;
}

describe("held edits on backlog items", () => {
  it("holds a settle's write as the user left it, and lifts the hold on approval", () => {
    const settled = item({
      status: "settled",
      pendingSourceWrite: {
        state: "Done",
        previous: { sourceStatusKey: "active" },
      },
    });

    const held = holdSourceWrite(state(settled), "item-1", 100);
    const heldAgain = holdSourceWrite(held, "item-1", 200);
    const released = releaseHeldSourceWrite(heldAgain, "item-1");

    expect(held.workItems[0]).toMatchObject({
      status: "settled",
      pendingSourceWrite: { state: "Done", heldAt: 100 },
    });
    expect(heldAgain).toBe(held);
    expect(heldItemEdits(held.workItems)).toEqual([
      { kind: "settle", ...connection, itemId: "item-1", at: 100 },
    ]);
    expect(isSourceWriteHeld(released.workItems[0]!)).toBe(false);
    expect(released.workItems[0]!.pendingSourceWrite?.state).toBe("Done");
  });

  it("marks exactly the estimate fields a sync held, and clears the others", () => {
    const estimated = item({
      remainingEstimateHours: 2,
      completedEstimateHours: 3,
      estimateSync: {
        remainingEstimateHours: { baselineValue: 5, remoteValue: 5 },
        completedEstimateHours: {
          baselineValue: 3,
          remoteValue: 3,
          held: { at: 10 },
        },
      },
    });
    const otherConnection = item({
      _id: "item-2",
      sourceConnectionId: "fabrikam",
      estimateSync: {
        remainingEstimateHours: { held: { at: 10 } },
      },
    });

    const next = markHeldEstimates(
      state(estimated, otherConnection),
      connection,
      [{ localWorkItemId: "item-1", fields: ["remainingEstimateHours"] }],
      100,
    );

    expect(next.workItems[0]!.estimateSync).toEqual({
      remainingEstimateHours: {
        baselineValue: 5,
        remoteValue: 5,
        held: { at: 100 },
      },
      completedEstimateHours: { baselineValue: 3, remoteValue: 3 },
    });
    // Another connection's items keep their own holds.
    expect(next.workItems[1]).toBe(otherConnection);
  });

  it("keeps a hold set after the sync's request was built while its change still waits", () => {
    // Editing turned on mid-sync: the answer to the earlier request names
    // nothing as held, yet the change has not been uploaded or reviewed.
    const heldMidSync = item({
      remainingEstimateHours: 1,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 4,
          remoteValue: 4,
          held: { at: 70 },
        },
      },
    });

    const next = markHeldEstimates(state(heldMidSync), connection, [], 100);

    expect(next.workItems[0]).toBe(heldMidSync);
    expect(heldItemEdits(next.workItems)).toEqual([
      {
        kind: "estimate",
        ...connection,
        itemId: "item-1",
        field: "remainingEstimateHours",
        at: 70,
      },
    ]);
  });

  it("holds every estimate change as editing turns on, even one no sync saw", () => {
    const changed = item({
      originalEstimateHours: 8,
      remainingEstimateHours: 1,
      estimateSync: {
        originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
        remainingEstimateHours: { baselineValue: 4, remoteValue: 4 },
      },
    });

    const next = holdPendingEstimates(state(changed), connection, 50);

    expect(heldItemEdits(next.workItems)).toEqual([
      {
        kind: "estimate",
        ...connection,
        itemId: "item-1",
        field: "remainingEstimateHours",
        at: 50,
      },
    ]);
  });

  it("sends an approved estimate with the next sync, or takes the source's value on discard", () => {
    const held = item({
      remainingEstimateHours: 1,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 4,
          remoteValue: 6,
          resolution: "keep_local",
          held: { at: 5 },
        },
      },
    });

    const released = releaseHeldEstimate(
      state(held),
      "item-1",
      "remainingEstimateHours",
    );
    const discarded = discardHeldEstimate(
      state(held),
      "item-1",
      "remainingEstimateHours",
    );

    expect(released.workItems[0]!.estimateSync?.remainingEstimateHours).toEqual(
      { baselineValue: 4, remoteValue: 6, resolution: "keep_local" },
    );
    expect(released.workItems[0]!.remainingEstimateHours).toBe(1);
    expect(discarded.workItems[0]).toMatchObject({
      remainingEstimateHours: 6,
      estimateSync: {
        remainingEstimateHours: { baselineValue: 6, remoteValue: 6 },
      },
    });
  });

  it("keeps a held description through syncs until it is sent or discarded", () => {
    const edited = {
      description: "Mine",
      descriptionSync: { baseline: "Base", remote: "Base" },
    };

    const held = descriptionHeld(edited, 30);
    const synced = reconcileDescription(held, { text: "Base" }, 40);
    const conflicted = reconcileDescription(held, { text: "Theirs" }, 40);

    expect(held.descriptionSync?.held).toEqual({ at: 30 });
    expect(synced).toEqual(held);
    expect(conflicted.descriptionSync).toMatchObject({
      held: { at: 30 },
      conflict: { localText: "Mine", remoteText: "Theirs" },
    });
    expect(releaseHeldDescription(held)).toEqual(edited);
    expect(discardHeldDescription(held)).toEqual({
      description: "Base",
      descriptionSync: { baseline: "Base", remote: "Base" },
    });
    expect(
      heldItemEdits([item({ ...held, _id: "item-3" })]).map(
        (edit) => edit.kind,
      ),
    ).toEqual(["description"]);
  });
});
