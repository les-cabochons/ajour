import { afterEach, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";

const { snapshot, startTimer } = vi.hoisted(() => ({
  snapshot: vi.fn(),
  startTimer: vi.fn(),
}));
vi.mock("@/lib/local-store", () => ({ localStore: { snapshot, startTimer } }));
vi.mock("@/features/backlog/settle-dialog", () => ({
  settleBacklogItem: vi.fn(),
}));
vi.mock("@/features/backlog/backlog-item-moves", () => ({
  changeSourceStateWithUndo: vi.fn(),
}));
vi.mock("@/features/backlog/snooze-picker", () => ({ requestSnooze: vi.fn() }));
vi.mock("@/features/feedback/undo-toast", () => ({ offerUndo: vi.fn() }));
vi.mock("@/features/time/new-entry-request", () => ({
  openNewEntryEditor: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());
const item: LocalWorkItem = {
  _id: "item",
  title: "Item",
  status: "active",
  source: "manual",
  createdAt: 1,
};

it("ignores Start entry when the item already owns the running entry", () => {
  snapshot.mockReturnValue({
    timers: [{ _id: "running", workItemId: item._id }],
  });
  runBacklogItemAction(item, "start-entry", vi.fn());
  expect(startTimer).not.toHaveBeenCalled();
});

it.each(["other", undefined])(
  "starts an entry when the running item is %s",
  (runningId) => {
    snapshot.mockReturnValue({
      timers: runningId ? [{ _id: "running", workItemId: runningId }] : [],
    });
    runBacklogItemAction(item, "start-entry", vi.fn());
    expect(startTimer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workItemId: item._id,
        accumulatedDurationMs: 0,
      }),
    );
  },
);
