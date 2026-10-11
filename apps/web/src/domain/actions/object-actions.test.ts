import { describe, expect, it } from "vitest";
import {
  getTimeEntryActions,
  getTimeEntryActionState,
} from "@/domain/actions/object-actions";

function ids(actions: ReturnType<typeof getTimeEntryActions>) {
  return actions.map((action) => action.id);
}

describe("time entry actions", () => {
  it("lists the saved entry set in spec order with Delete last", () => {
    const actions = getTimeEntryActions("saved");

    expect(ids(actions)).toEqual([
      "edit",
      "continue",
      "duplicate",
      "duplicate-to",
      "move-to",
      "delete",
    ]);
    expect(actions.every((action) => !action.disabledReason)).toBe(true);
    expect(actions.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });

  it("swaps Continue for Stop and Delete for Discard on a running entry", () => {
    const actions = getTimeEntryActions("running");

    expect(ids(actions)).toEqual([
      "edit",
      "stop",
      "duplicate",
      "duplicate-to",
      "move-to",
      "discard",
    ]);
  });

  it("keeps relocation actions listed but disabled while running", () => {
    const disabled = getTimeEntryActions("running").filter(
      (action) => action.disabledReason,
    );

    expect(disabled.map((action) => action.id)).toEqual([
      "duplicate",
      "duplicate-to",
      "move-to",
    ]);
    expect(disabled[0]?.disabledReason).toBe("Stop the timer first");
  });

  it("keeps every action on a submitted entry and flags the ones that unsubmit it", () => {
    const actions = getTimeEntryActions("submitted", { isToday: true });

    expect(actions.every((action) => !action.disabledReason)).toBe(true);
    expect(
      actions.filter((action) => action.hint).map((action) => action.id),
    ).toEqual(["continue", "move-to"]);
  });

  it("does not flag Continue on a submitted entry from another day", () => {
    const continueAction = getTimeEntryActions("submitted", {
      isToday: false,
    }).find((action) => action.id === "continue");

    expect(continueAction?.hint).toBeUndefined();
  });

  it("disables Edit and relocation inside an editor with an invalid draft", () => {
    const actions = getTimeEntryActions("saved", {
      isEditing: true,
      invalidDraftReason: "Enter a valid duration first",
    });

    expect(actions.find((action) => action.id === "edit")?.disabledReason).toBe(
      "Already editing",
    );
    expect(
      actions.find((action) => action.id === "duplicate")?.disabledReason,
    ).toBe("Enter a valid duration first");
    expect(
      actions.find((action) => action.id === "delete")?.disabledReason,
    ).toBeUndefined();
  });

  it("derives the action state from running and submitted flags", () => {
    expect(getTimeEntryActionState({ isRunning: true, submittedAt: 1 })).toBe(
      "running",
    );
    expect(getTimeEntryActionState({ submittedAt: 1 })).toBe("submitted");
    expect(getTimeEntryActionState({})).toBe("saved");
  });
});
