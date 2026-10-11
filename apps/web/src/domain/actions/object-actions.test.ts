import { describe, expect, it } from "vitest";
import {
  getBacklogItemActions,
  getProjectActions,
  getTaskActions,
  getTimeEntryActions,
  getTimeEntryActionState,
  type ObjectAction,
} from "@/domain/actions/object-actions";

function ids(actions: ObjectAction[]) {
  return actions.map((action) => action.id);
}

function disabledReasons(actions: ObjectAction[]) {
  return Object.fromEntries(
    actions
      .filter((action) => action.disabledReason)
      .map((action) => [action.id, action.disabledReason]),
  );
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

  it("disables Edit, Continue and relocation inside an editor with an invalid draft", () => {
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
    // Continue saves the draft first, so it needs a valid draft too.
    expect(
      actions.find((action) => action.id === "continue")?.disabledReason,
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

describe("project actions", () => {
  it("lists Edit, New task and a destructive Archive last on an active project", () => {
    const actions = getProjectActions({ status: "active" });

    expect(ids(actions)).toEqual(["edit", "new-task", "archive"]);
    expect(disabledReasons(actions)).toEqual({});
    expect(actions.at(-1)).toMatchObject({ id: "archive", destructive: true });
  });

  it("swaps Archive for Restore and blocks the rest on an archived project", () => {
    const actions = getProjectActions({ status: "archived" });

    expect(ids(actions)).toEqual(["edit", "new-task", "restore"]);
    expect(disabledReasons(actions)).toEqual({
      edit: "Restore the project first",
      "new-task": "Restore the project first",
    });
    expect(actions.at(-1)?.destructive).toBeUndefined();
  });
});

describe("task actions", () => {
  const active = { status: "active" } as const;
  const archived = { status: "archived" } as const;

  it("lists the active task set with Archive last", () => {
    const actions = getTaskActions(active, active);

    expect(ids(actions)).toEqual([
      "start-entry",
      "new-entry",
      "edit",
      "archive",
    ]);
    expect(disabledReasons(actions)).toEqual({});
    expect(actions.at(-1)?.destructive).toBe(true);
  });

  it("keeps Restore available on an archived task and blocks the work actions", () => {
    const actions = getTaskActions(active, archived);

    expect(ids(actions)).toEqual([
      "start-entry",
      "new-entry",
      "edit",
      "restore",
    ]);
    expect(disabledReasons(actions)).toEqual({
      "start-entry": "Restore the task first",
      "new-entry": "Restore the task first",
      edit: "Restore the task first",
    });
  });

  it("blocks every action, Restore included, in an archived project", () => {
    expect(disabledReasons(getTaskActions(archived, active))).toEqual({
      "start-entry": "Restore the project first",
      "new-entry": "Restore the project first",
      edit: "Restore the project first",
      archive: "Restore the project first",
    });
    expect(
      getTaskActions(archived, archived).find(
        (action) => action.id === "restore",
      )?.disabledReason,
    ).toBe("Restore the project first");
  });
});

describe("backlog item actions", () => {
  const manualItem = { status: "active", source: "manual" } as const;
  const syncedItem = {
    status: "active",
    source: "jira",
    sourceUrl: "https://example.atlassian.net/browse/ENG-42",
  } as const;

  it("lists a manual root item without Open in source, Archive then Delete last", () => {
    const actions = getBacklogItemActions(manualItem, {
      subitemCount: 0,
      isSubitem: false,
    });

    expect(ids(actions)).toEqual([
      "start-entry",
      "new-entry",
      "edit",
      "add-subitem",
      "archive",
      "delete",
    ]);
    expect(disabledReasons(actions)).toEqual({});
    expect(actions.slice(-2).every((action) => action.destructive)).toBe(true);
  });

  it("lists Open in source only when the connector gave a source URL", () => {
    // An opaque source id such as ENG-42 is not a link.
    const opaqueSourceItem = {
      status: "active",
      source: "jira",
      sourceId: "ENG-42",
    } as const;
    expect(
      ids(
        getBacklogItemActions(syncedItem, {
          subitemCount: 0,
          isSubitem: false,
        }),
      ),
    ).toContain("open-in-source");
    expect(
      ids(
        getBacklogItemActions(opaqueSourceItem, {
          subitemCount: 0,
          isSubitem: false,
        }),
      ),
    ).not.toContain("open-in-source");
  });

  it("states the subitem count in the Delete label", () => {
    const deleteLabel = (subitemCount: number) =>
      getBacklogItemActions(manualItem, { subitemCount, isSubitem: false }).at(
        -1,
      )?.label;

    expect(deleteLabel(0)).toBe("Delete");
    expect(deleteLabel(1)).toBe("Delete (and 1 subitem)");
    expect(deleteLabel(3)).toBe("Delete (and 3 subitems)");
  });

  it("disables Add subitem on a subitem", () => {
    const actions = getBacklogItemActions(manualItem, {
      subitemCount: 0,
      isSubitem: true,
    });

    expect(disabledReasons(actions)).toEqual({
      "add-subitem": "Subitems can't have subitems",
    });
  });

  it("swaps Archive for Restore and blocks the work actions on an archived item", () => {
    const actions = getBacklogItemActions(
      { ...syncedItem, status: "archived" },
      { subitemCount: 2, isSubitem: false },
    );

    expect(ids(actions)).toEqual([
      "start-entry",
      "new-entry",
      "edit",
      "add-subitem",
      "open-in-source",
      "restore",
      "delete",
    ]);
    expect(disabledReasons(actions)).toEqual({
      "start-entry": "Restore the item first",
      "new-entry": "Restore the item first",
      edit: "Restore the item first",
      "add-subitem": "Restore the item first",
    });
    expect(actions.find((action) => action.id === "restore")?.destructive).toBe(
      undefined,
    );
  });

  it("disables Edit inside the item's editor", () => {
    const actions = getBacklogItemActions(manualItem, {
      subitemCount: 0,
      isSubitem: false,
      isEditing: true,
    });

    expect(disabledReasons(actions)).toEqual({ edit: "Already editing" });
  });
});
