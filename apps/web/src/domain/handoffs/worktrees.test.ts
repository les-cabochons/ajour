import { describe, expect, it } from "vitest";
import type { ListedWorktree, Worktree } from "@ajour/shared/worktrees";
import { projectStartInChoices } from "./start-in";
import {
  describeCleanUpDelay,
  describeListedWorktree,
  describeSwitched,
  describeWorktreeItem,
  finishedAtOf,
  finishedItemsOf,
} from "./worktrees";

const worktree: Worktree = {
  id: "worktree-1",
  repositoryFolderId: "folder-1",
  projectId: "project-1",
  workItemId: "item-1",
  itemKey: "4821",
  name: "aj-4821",
  branch: "4821-week-grid",
  source: "origin/main",
  createdAt: 1_000,
};

const listed = (overrides: Partial<ListedWorktree> = {}): ListedWorktree => ({
  worktree,
  status: { state: "clean" },
  ...overrides,
});

describe("a worktree's status in a list", () => {
  it("is what git status says when no thread runs in it", () => {
    expect(describeListedWorktree(listed())).toEqual({
      text: "Clean",
      tone: "quiet",
    });
    expect(
      describeListedWorktree(
        listed({ status: { state: "changed", changes: 3 } }),
      ),
    ).toEqual({ text: "3 changes", tone: "warning" });
  });

  it("names a running thread before the changes, since a delete would interrupt it", () => {
    expect(
      describeListedWorktree(
        listed({
          status: { state: "changed", changes: 3 },
          running: "working",
        }),
      ),
    ).toEqual({ text: "Working", tone: "running" });
    expect(describeListedWorktree(listed({ running: "needs-you" }))).toEqual({
      text: "Needs you",
      tone: "attention",
    });
  });

  it("is Missing for a folder that is gone", () => {
    expect(
      describeListedWorktree(listed({ status: { state: "missing" } })),
    ).toEqual({ text: "Missing", tone: "quiet" });
  });
});

describe("what clean up will do with a worktree, in the Settings list", () => {
  const at = Date.parse("2026-11-22T15:00:00");
  const day = 86_400_000;

  it("says why a worktree a rule would remove stays, with the count for changes", () => {
    const kept = (reason: string, overrides: Partial<ListedWorktree> = {}) =>
      describeListedWorktree(
        listed({
          cleanUp: { kind: "kept", reason } as ListedWorktree["cleanUp"],
          ...overrides,
        }),
      );
    expect(
      kept("changes", { status: { state: "changed", changes: 3 } }),
    ).toEqual({ text: "Kept: 3 changes", tone: "warning" });
    expect(
      kept("changes", { status: { state: "changed", changes: 1 } }).text,
    ).toBe("Kept: 1 change");
    expect(kept("recent")).toEqual({
      text: "Kept: used in the last hour",
      tone: "quiet",
    });
    expect(kept("branch").text).toBe("Kept: on another branch");
    expect(kept("not_ours").text).toBe("Kept: not the worktree Ajour made");
    expect(kept("unconfirmed").text).toBe("Kept: couldn't check its threads");
    expect(kept("failed").text).toBe("Kept: git couldn't remove it");
  });

  it("names a running thread and a missing folder before any reason to keep", () => {
    expect(
      describeListedWorktree(
        listed({
          running: "working",
          cleanUp: { kind: "kept", reason: "running" },
        }),
      ).text,
    ).toBe("Working");
    expect(
      describeListedWorktree(
        listed({
          status: { state: "missing" },
          cleanUp: { kind: "kept", reason: "missing" },
        }),
      ).text,
    ).toBe("Missing");
  });

  it("says the day a rule removes it, and never a day that has passed", () => {
    const goes = listed({ cleanUp: { kind: "goes", at } });
    expect(describeListedWorktree(goes, at - 2 * day, "en-US")).toEqual({
      text: "Goes Nov 22",
      tone: "quiet",
    });
    // Due since yesterday: the next round removes it, today.
    expect(describeListedWorktree(goes, at + day, "en-US").text).toBe(
      "Goes Nov 23",
    );
  });
});

describe("when an item is finished, for clean up", () => {
  it("is the latest of its settled and archived moments", () => {
    expect(finishedAtOf({ status: "settled", settledAt: 5 })).toBe(5);
    expect(finishedAtOf({ status: "archived", archivedAt: 9 })).toBe(9);
    expect(
      finishedAtOf({ status: "archived", settledAt: 5, archivedAt: 9 }),
    ).toBe(9);
    expect(
      finishedAtOf({ status: "settled", settledAt: 12, archivedAt: 9 }),
    ).toBe(12);
  });

  it("is never for an item that is active again, whatever moments it keeps", () => {
    expect(finishedAtOf({ status: "active" })).toBeUndefined();
    expect(
      finishedAtOf({ status: "active", settledAt: 5, archivedAt: 9 }),
    ).toBeUndefined();
  });

  it("sends only the finished items that have a worktree", () => {
    const items = [
      { _id: "done", status: "archived" as const, archivedAt: 9 },
      { _id: "active", status: "active" as const, archivedAt: 3 },
      { _id: "no-worktree", status: "archived" as const, archivedAt: 4 },
    ];
    expect(
      finishedItemsOf(
        [
          { workItemId: "done" },
          { workItemId: "done" },
          { workItemId: "active" },
          { workItemId: "deleted-item" },
        ],
        items,
      ),
    ).toEqual([{ workItemId: "done", finishedAt: 9 }]);
  });
});

it("says the branch a switched worktree is on now in its delete dialog, or that it is on none", () => {
  const preview = {
    listed: { worktree, status: { state: "clean" as const } },
    fingerprint: "status-1",
    files: [],
    moreFiles: 0,
    running: [],
  };
  expect(describeSwitched(preview)).toBe("");
  expect(describeSwitched({ ...preview, switched: { branch: "fix/x" } })).toBe(
    "It is on the branch fix/x now, which stays.",
  );
  expect(describeSwitched({ ...preview, switched: {} })).toBe(
    "It is on no branch now.",
  );
  expect(
    describeSwitched({ ...preview, switched: { commitsOnNoBranch: 1 } }),
  ).toBe(
    "It is on no branch now. Deleting the worktree loses 1 commit that is on no branch.",
  );
  expect(
    describeSwitched({ ...preview, switched: { commitsOnNoBranch: 3 } }),
  ).toBe(
    "It is on no branch now. Deleting the worktree loses 3 commits that are on no branch.",
  );
});

it("says a rule's delay in days", () => {
  expect(describeCleanUpDelay(1)).toBe("After 1 day");
  expect(describeCleanUpDelay(30)).toBe("After 30 days");
});

it("names a worktree's item by its title, and by its key once the item is gone", () => {
  const items = [{ _id: "item-1", title: "Week grid: keyboard editing" }];
  expect(describeWorktreeItem(worktree, items)).toBe(
    "Week grid: keyboard editing",
  );
  expect(describeWorktreeItem(worktree, [])).toBe("4821");
});

it("offers a project Settings with the default it follows, then the three places", () => {
  expect(projectStartInChoices("worktree")).toEqual([
    { value: "settings", label: "Settings (New worktree)" },
    { value: "main", label: "Main folder" },
    { value: "worktree", label: "New worktree" },
    { value: "ask", label: "Ask each time" },
  ]);
  expect(projectStartInChoices("ask")[0]!.label).toBe(
    "Settings (Ask each time)",
  );
});
