import { describe, expect, it } from "vitest";
import {
  findDraftConflicts,
  keepMineInDraft,
  reconcileDraft,
  useTheirsInDraft,
} from "@/domain/draft-reconcile";

interface Fields {
  hours: string;
  note: string;
  projectId: string;
  taskId: string;
}

const base: Fields = {
  hours: "0:15",
  note: "Standup",
  projectId: "p1",
  taskId: "t1",
};
const pair = [["projectId", "taskId"]] as const;

describe("reconcileDraft", () => {
  it("takes the record's new value for a field the user did not change", () => {
    const draft = { fields: { ...base, note: "Standup, moved" }, base };
    const current = { ...base, hours: "2:00" };

    const result = reconcileDraft(draft, current, pair);

    expect(result.fields).toEqual({ ...current, note: "Standup, moved" });
    expect(result.base).toEqual(current);
    expect(findDraftConflicts(result, current, pair)).toEqual([]);
  });

  it("keeps a field only the user changed, on its old base", () => {
    const draft = { fields: { ...base, hours: "1:00" }, base };

    const result = reconcileDraft(draft, base, pair);

    expect(result).toEqual(draft);
    expect(findDraftConflicts(result, base, pair)).toEqual([]);
  });

  it("leaves a field both changed to different values as the user typed it, in conflict", () => {
    const draft = { fields: { ...base, hours: "1:00" }, base };
    const current = { ...base, hours: "2:00" };

    const result = reconcileDraft(draft, current, pair);

    expect(result.fields.hours).toBe("1:00");
    expect(result.base.hours).toBe("0:15");
    expect(findDraftConflicts(result, current, pair)).toEqual([["hours"]]);
  });

  it("is no conflict when both changed to the same value", () => {
    const draft = { fields: { ...base, hours: "2:00" }, base };
    const current = { ...base, hours: "2:00" };

    const result = reconcileDraft(draft, current, pair);

    expect(result.base.hours).toBe("2:00");
    expect(findDraftConflicts(result, current, pair)).toEqual([]);
  });

  it("moves a project and its task together", () => {
    const current = { ...base, projectId: "p2", taskId: "t2" };
    const untouched = reconcileDraft(
      { fields: { ...base, note: "x" }, base },
      current,
      pair,
    );
    expect(untouched.fields).toMatchObject({ projectId: "p2", taskId: "t2" });

    const changedTask = { fields: { ...base, taskId: "t3" }, base };
    const conflicted = reconcileDraft(changedTask, current, pair);
    expect(conflicted.fields).toMatchObject({ projectId: "p1", taskId: "t3" });
    expect(findDraftConflicts(conflicted, current, pair)).toEqual([
      ["projectId", "taskId"],
    ]);
  });

  it("settles a conflict by keeping mine or taking theirs", () => {
    const current = { ...base, hours: "2:00" };
    const conflicted = reconcileDraft(
      { fields: { ...base, hours: "1:00" }, base },
      current,
      pair,
    );

    const mine = keepMineInDraft(conflicted, current, ["hours"]);
    expect(mine.fields.hours).toBe("1:00");
    expect(findDraftConflicts(mine, current, pair)).toEqual([]);

    const theirs = useTheirsInDraft(conflicted, current, ["hours"]);
    expect(theirs.fields.hours).toBe("2:00");
    expect(findDraftConflicts(theirs, current, pair)).toEqual([]);
  });

  it("compares object fields by value", () => {
    const withIcon = { name: "A", icon: { kind: "preset", name: "dot" } };
    const draft = { fields: { ...withIcon, name: "B" }, base: withIcon };
    const current = { ...withIcon, icon: { kind: "preset", name: "dot" } };

    expect(findDraftConflicts(reconcileDraft(draft, current), current)).toEqual(
      [],
    );
  });
});
