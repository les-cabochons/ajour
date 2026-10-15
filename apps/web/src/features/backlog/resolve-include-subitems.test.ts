import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { resolveIncludeSubitems } from "@/features/backlog/backlog-item-moves";
import { requestCloseSubitemsChoice } from "@/features/backlog/close-subitems-dialog";
import { localStore } from "@/lib/local-store";

vi.mock("@/features/backlog/close-subitems-dialog", () => ({
  requestCloseSubitemsChoice: vi.fn(),
}));
vi.mock("@/features/feedback/undo-toast", () => ({ offerUndo: vi.fn() }));
vi.mock("@/lib/local-store", () => ({ localStore: { snapshot: vi.fn() } }));

const parent: LocalWorkItem = {
  _id: "parent",
  title: "Parent",
  status: "active",
  source: "manual",
  createdAt: 1,
};
const child: LocalWorkItem = {
  ...parent,
  _id: "child",
  title: "Child",
  parentWorkItemId: parent._id,
};
const defaults: LocalAppState = {
  user: { _id: "user", name: "User", email: "local@example.com" },
  projects: [],
  rules: [],
  segments: [],
  dismissedSegmentIds: [],
  editedBlocks: [],
  importedBrowserDrafts: [],
  timers: [],
  timesheetEntries: [],
  timesheetImportDrafts: [],
  timesheetTombstones: [],
  workItems: [],
  workflowStates: [],
  workflowStateMappings: [],
  workflowStateWriteRules: [],
  backlogSortMode: "custom",
  capture: {
    urlMode: "sanitized_path",
    titleMode: "normalized",
    blockedDomains: [],
    sensitiveDomains: [],
    maxPathSegments: 4,
  },
  userPreferences: {
    themeMode: "system",
    updateTrack: "stable",
    projectDataShapeId: "default",
    weeklyTimeViewStyle: "grid",
    weeklyCapacityTargets: {
      monday: 8,
      tuesday: 8,
      wednesday: 8,
      thursday: 8,
      friday: 8,
      saturday: 0,
      sunday: 0,
    },
    warnWhenOverCapacity: true,
    warnWhenSubmittingUnderCapacity: true,
    closeParentSubitems: "ask",
  },
  updatedAt: 0,
};

afterEach(() => vi.restoreAllMocks());

describe.each(["close", "settle"] as const)(
  "%s subitem confirmation",
  (verb) => {
    it.each(["added", "reparented", "replaced"])(
      "rejects an answer after a subitem is %s",
      async (change) => {
        const initial = { ...defaults, workItems: [parent, child] };
        const snapshot = vi
          .spyOn(localStore, "snapshot")
          .mockReturnValue(initial);
        let answer!: (include: boolean | null) => void;
        vi.mocked(requestCloseSubitemsChoice).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        );
        const pending = resolveIncludeSubitems(parent, verb);
        expect(requestCloseSubitemsChoice).toHaveBeenLastCalledWith(
          parent,
          [child],
          verb,
        );
        const another = { ...child, _id: "another" };
        snapshot.mockReturnValue({
          ...initial,
          workItems:
            change === "added"
              ? [parent, child, another]
              : change === "reparented"
                ? [parent, { ...child, parentWorkItemId: "other" }]
                : [parent, another],
        });
        answer(true);
        expect(await pending).toBeNull();
      },
    );

    it("accepts an unchanged subitem set after unrelated edits", async () => {
      const initial = { ...defaults, workItems: [parent, child] };
      const snapshot = vi
        .spyOn(localStore, "snapshot")
        .mockReturnValue(initial);
      vi.mocked(requestCloseSubitemsChoice).mockImplementationOnce(async () => {
        snapshot.mockReturnValue({
          ...initial,
          workItems: [{ ...child, title: "Renamed" }, parent],
        });
        return true;
      });
      expect(await resolveIncludeSubitems(parent, verb)).toBe(true);
    });
  },
);
