import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  write: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: mocks.snapshot,
    completeSourceWrite: mocks.complete,
    failSourceWrite: mocks.fail,
  },
}));
vi.mock("@/lib/app-api", () => ({ writeBacklogSettle: mocks.write }));
vi.mock("@/components/ui/toast", () => ({ showErrorToast: mocks.error }));
let item: LocalWorkItem;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout });
  item = {
    _id: "a",
    title: "A",
    status: "active",
    source: "azure_devops",
    sourceId: "1",
    sourceConnectionId: "c",
    createdAt: 1,
    pendingSourceWrite: { state: "Review", readyAt: 9000, previous: {} },
  };
  mocks.snapshot.mockImplementation(() => ({ workItems: [item] }));
  mocks.complete.mockImplementation(() => {
    item = { ...item, pendingSourceWrite: undefined };
  });
  mocks.write.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("defers a replacement move until its own Undo deadline and honors Undo", async () => {
  const { sendPendingSourceWrites } = await import("./backlog-source-writes");
  await sendPendingSourceWrites(["a"]);
  await vi.advanceTimersByTimeAsync(4000);
  item = {
    ...item,
    pendingSourceWrite: { state: "Done", readyAt: 13000, previous: {} },
  };
  await sendPendingSourceWrites(["a"]);
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.write).not.toHaveBeenCalled();
  item = { ...item, pendingSourceWrite: undefined };
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("reports the successful old snapshot before sending its replacement", async () => {
  const { sendPendingSourceWrites } = await import("./backlog-source-writes");
  item.pendingSourceWrite!.readyAt = 1000;
  const sentItems = [item];
  mocks.complete.mockImplementation(() => {});
  let finish!: () => void;
  mocks.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const sending = sendPendingSourceWrites(["a"]);
  item = {
    ...item,
    pendingSourceWrite: { state: "Done", readyAt: 9000, previous: {} },
  };
  finish();
  await sending;
  expect(mocks.complete).toHaveBeenCalledWith("a", sentItems);
  expect(item.pendingSourceWrite?.state).toBe("Done");
  await vi.advanceTimersByTimeAsync(8000);
  expect(mocks.write).toHaveBeenCalledTimes(2);
});

it("handles a failed current request even when a child acknowledgement advanced recovery", async () => {
  const { sendPendingSourceWrites } = await import("./backlog-source-writes");
  item.pendingSourceWrite!.readyAt = 1000;
  let rejectWrite!: (error: Error) => void;
  mocks.write.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectWrite = reject;
    }),
  );
  const request = sendPendingSourceWrites(["a"]);
  item = {
    ...item,
    pendingSourceWrite: {
      ...item.pendingSourceWrite!,
      previous: {
        ...item.pendingSourceWrite!.previous,
        workflowStateId: "confirmed",
      },
    },
  };
  rejectWrite(new Error("Parent write failed"));
  await request;
  expect(mocks.fail).toHaveBeenCalledWith("a");
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
