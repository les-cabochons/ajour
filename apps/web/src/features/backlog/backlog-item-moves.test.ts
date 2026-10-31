import { beforeEach, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  moveBacklogItemWithUndo,
  changeSourceStateWithUndo,
} from "./backlog-item-moves";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  move: vi.fn(),
  change: vi.fn(),
  states: vi.fn(),
  choose: vi.fn(),
  error: vi.fn(),
  offerUndo: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: mocks.snapshot,
    moveWorkItemToState: mocks.move,
    changeWorkItemSourceState: mocks.change,
    updateWorkItem: mocks.update,
  },
  startStoreCommandFor: () => ({
    unit: {
      enter: <Result>(work: () => Result) => work(),
      set: () => undefined,
      cancel: () => undefined,
    },
    enter: <Result>(work: () => Result) => work(),
    didWork: () => undefined,
    fail: () => undefined,
    finish: () => undefined,
  }),
}));
vi.mock("@/lib/app-api", () => ({ listBacklogSettleStates: mocks.states }));
vi.mock("./backlog-source-writes", () => ({
  canWriteToSource: () => true,
  sendPendingSourceWrites: vi.fn(),
}));
vi.mock("./source-state-dialog", () => ({
  requestSourceStateChoice: mocks.choose,
}));
vi.mock("@/components/ui/toast", () => ({ showErrorToast: mocks.error }));
vi.mock("@/features/feedback/undo-toast", () => ({
  offerUndo: mocks.offerUndo,
}));

const item: LocalWorkItem = {
  _id: "a",
  title: "A",
  status: "active",
  source: "example",
  sourceId: "1",
  sourceConnectionId: "c",
  sourceProjectName: "Mercury",
  workflowStateId: "doing",
  createdAt: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockReturnValue({
    workItems: [item],
    workflowStates: [{ _id: "review", name: "Review" }],
    workflowStateWriteRules: [],
    workflowStateMappings: [
      {
        source: "example",
        connectionId: "c",
        sourceStatusKey: "resolved",
        sourceStatusLabel: "Resolved",
        workflowStateId: "review",
      },
      {
        source: "example",
        connectionId: "c",
        sourceStatusKey: "in qa",
        sourceStatusLabel: "In QA",
        workflowStateId: "review",
      },
    ],
  });
  mocks.states.mockResolvedValue({ states: [{ name: "In QA", done: false }] });
});

it("loads the actual item's workflow before choosing a default move write", async () => {
  await moveBacklogItemWithUndo(item, "review");
  expect(mocks.states).toHaveBeenCalledWith("example", "c", "1");
  expect(mocks.move).toHaveBeenCalledWith("a", "review", {
    includeSubitems: false,
    sourceWrites: { a: "In QA" },
  });
  expect(mocks.choose).not.toHaveBeenCalled();
});

it("saves an editor's other fields with its move, in the store's one call", async () => {
  mocks.move.mockReturnValue("move-token");

  await moveBacklogItemWithUndo(item, "review", {
    patch: { description: "New text" },
  });

  expect(mocks.move).toHaveBeenCalledWith("a", "review", {
    includeSubitems: false,
    sourceWrites: { a: "In QA" },
    edits: { description: "New text" },
    // No priority in the edits, so none to write.
    editsWriteToSource: false,
  });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.offerUndo).toHaveBeenCalledWith(
    "move-token",
    expect.objectContaining({ title: "Moved to Review" }),
  );
});

it("cancels the move when source state discovery fails", async () => {
  mocks.states.mockRejectedValue(new Error("Connection unavailable"));
  await moveBacklogItemWithUndo(item, "review");
  expect(mocks.move).not.toHaveBeenCalled();
  expect(mocks.offerUndo).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ description: "Connection unavailable" }),
  );
});

it.each(["moved", "deleted", "archived"])(
  "rejects an older move when its item is %s during source lookup",
  async (change) => {
    const before = mocks.snapshot();
    mocks.states.mockImplementation(async () => {
      mocks.snapshot.mockReturnValue({
        ...before,
        workItems:
          change === "deleted"
            ? []
            : [
                {
                  ...item,
                  ...(change === "moved"
                    ? { workflowStateId: "todo" }
                    : { status: "archived" }),
                },
              ],
      });
      return { states: [{ name: "In QA", done: false }] };
    });
    expect(await moveBacklogItemWithUndo(item, "review")).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.offerUndo).not.toHaveBeenCalled();
  },
);

it("rejects an older move after a newer move while Ask is open", async () => {
  const before = {
    ...mocks.snapshot(),
    workflowStateWriteRules: [
      {
        source: "example",
        connectionId: "c",
        workflowStateId: "review",
        write: { kind: "ask" },
      },
    ],
  };
  mocks.snapshot.mockReturnValue(before);
  mocks.states.mockResolvedValue({
    states: [{ name: "Resolved" }, { name: "In QA" }],
  });
  mocks.choose.mockImplementation(async () => {
    mocks.snapshot.mockReturnValue({
      ...before,
      workItems: [{ ...item, workflowStateId: "todo" }],
    });
    return "In QA";
  });
  expect(await moveBacklogItemWithUndo(item, "review")).toBe(false);
  expect(mocks.choose).toHaveBeenCalled();
  expect(mocks.move).not.toHaveBeenCalled();
});

it.each(["changed", "added"])(
  "rechecks included children when a child is %s during lookup",
  async (change) => {
    const child: LocalWorkItem = {
      ...item,
      _id: "child",
      source: "manual",
      parentWorkItemId: "a",
    };
    const before = {
      ...mocks.snapshot(),
      workItems: [item, child],
      userPreferences: { closeParentSubitems: "include" },
      workflowStates: [{ _id: "done", name: "Done", done: true }],
      workflowStateMappings: [
        {
          source: "example",
          connectionId: "c",
          sourceStatusKey: "closed",
          sourceStatusLabel: "Closed",
          workflowStateId: "done",
        },
      ],
    };
    mocks.snapshot.mockReturnValue(before);
    mocks.states.mockImplementation(async () => {
      mocks.snapshot.mockReturnValue({
        ...before,
        workItems:
          change === "changed"
            ? [item, { ...child, workflowStateId: "review" }]
            : [item, child, { ...child, _id: "new-child" }],
      });
      return { states: [{ name: "Closed", done: true }] };
    });
    expect(await moveBacklogItemWithUndo(item, "done")).toBe(false);
    expect(mocks.move).not.toHaveBeenCalled();
  },
);

it("moves locally without discovery when the configured rule says Don't write", async () => {
  mocks.snapshot.mockReturnValue({
    ...mocks.snapshot(),
    workflowStateWriteRules: [
      {
        source: "example",
        connectionId: "c",
        workflowStateId: "review",
        write: { kind: "none" },
      },
    ],
  });
  await moveBacklogItemWithUndo(item, "review");
  expect(mocks.states).not.toHaveBeenCalled();
  expect(mocks.move).toHaveBeenCalledWith("a", "review", {
    includeSubitems: false,
    sourceWrites: {},
  });
});

it("offers only this item's available alternatives in Change source state", async () => {
  mocks.snapshot.mockReturnValue({
    ...mocks.snapshot(),
    workItems: [{ ...item, workflowStateId: "review" }],
  });
  mocks.choose.mockResolvedValue("In QA");
  await changeSourceStateWithUndo({ ...item, workflowStateId: "review" });
  expect(mocks.choose).toHaveBeenCalledWith(
    expect.objectContaining({ sourceStatusLabels: ["In QA"] }),
  );
  expect(mocks.change).toHaveBeenCalledWith("a", "In QA");
});

it.each(["moved", "deleted", "archived"])(
  "does not open a stale source-state dialog after the item is %s during lookup",
  async (change) => {
    const original = { ...item, workflowStateId: "review" };
    const before = { ...mocks.snapshot(), workItems: [original] };
    mocks.snapshot.mockReturnValue(before);
    let finish!: (value: { states: { name: string; done: boolean }[] }) => void;
    mocks.states.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = changeSourceStateWithUndo(original);
    mocks.snapshot.mockReturnValue({
      ...before,
      workItems:
        change === "deleted"
          ? []
          : [
              {
                ...original,
                ...(change === "moved"
                  ? { workflowStateId: "doing" }
                  : { status: "archived" }),
              },
            ],
    });
    finish({ states: [{ name: "In QA", done: false }] });
    await request;
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  },
);

it.each(["move", "remap"])(
  "does not write a stale choice after a %s during the dialog",
  async (change) => {
    const original = { ...item, workflowStateId: "review" };
    const before = { ...mocks.snapshot(), workItems: [original] };
    mocks.snapshot.mockReturnValue(before);
    mocks.choose.mockImplementation(async () => {
      mocks.snapshot.mockReturnValue(
        change === "move"
          ? {
              ...before,
              workItems: [{ ...original, workflowStateId: "doing" }],
            }
          : { ...before, workflowStateMappings: [] },
      );
      return "In QA";
    });
    await changeSourceStateWithUndo(original);
    expect(mocks.choose).toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.offerUndo).not.toHaveBeenCalled();
  },
);
