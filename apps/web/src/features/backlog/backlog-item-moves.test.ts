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
}));
vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: mocks.snapshot,
    moveWorkItemToState: mocks.move,
    changeWorkItemSourceState: mocks.change,
  },
}));
vi.mock("@/lib/app-api", () => ({ listConnectorSettleStates: mocks.states }));
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

it("cancels the move when source state discovery fails", async () => {
  mocks.states.mockRejectedValue(new Error("Connection unavailable"));
  await moveBacklogItemWithUndo(item, "review");
  expect(mocks.move).not.toHaveBeenCalled();
  expect(mocks.offerUndo).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ description: "Connection unavailable" }),
  );
});

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
  mocks.choose.mockResolvedValue("In QA");
  await changeSourceStateWithUndo({ ...item, workflowStateId: "review" });
  expect(mocks.choose).toHaveBeenCalledWith(
    expect.objectContaining({ sourceStatusLabels: ["In QA"] }),
  );
  expect(mocks.change).toHaveBeenCalledWith("a", "In QA");
});
