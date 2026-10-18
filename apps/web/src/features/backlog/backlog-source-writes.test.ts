import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import type { PendingSettleComment } from "@/lib/settle-comments";
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  write: vi.fn(),
  error: vi.fn(),
  post: vi.fn(),
  keepDraft: vi.fn(),
  announce: vi.fn(),
  queue: [] as PendingSettleComment[],
}));
vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: mocks.snapshot,
    completeSourceWrite: mocks.complete,
    failSourceWrite: mocks.fail,
  },
}));
vi.mock("@/lib/app-api", () => ({
  writeBacklogSettle: mocks.write,
  postItemComment: mocks.post,
}));
vi.mock("@/components/ui/toast", () => ({ showErrorToast: mocks.error }));
vi.mock("@/lib/comment-drafts", () => ({
  keepCommentAsDraft: mocks.keepDraft,
}));
vi.mock("@/features/backlog/comment-threads", () => ({
  announcePostedComment: mocks.announce,
}));
vi.mock("@/lib/settle-comments", () => ({
  getSettleComment: (itemId: string) =>
    mocks.queue.find((entry) => entry.itemId === itemId),
  takeSettleComment: (itemId: string) => {
    const entry = mocks.queue.find((pending) => pending.itemId === itemId);
    mocks.queue = mocks.queue.filter((pending) => pending.itemId !== itemId);
    return entry;
  },
  settleCommentItemIds: () => mocks.queue.map((entry) => entry.itemId),
}));
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
  mocks.queue = [];
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

describe("the comment typed in the settle dialog", () => {
  const comment = {
    itemId: "a",
    pluginId: "azure_devops",
    connectionId: "c",
    sourceId: "1",
    body: "Waiting on the client",
    at: 1000,
  };
  const posted = {
    id: "9",
    author: { id: "me", displayName: "Alex" },
    body: "Waiting on the client",
    createdAt: "2026-10-18T10:00:00Z",
  };

  beforeEach(() => {
    item = {
      ...item,
      status: "settled",
      pendingSourceWrite: { state: "Waiting", readyAt: 1000, previous: {} },
    };
    mocks.queue = [comment];
    mocks.post.mockResolvedValue({ comment: posted });
  });

  it("goes out once the settle's write lands, and joins the item's thread", async () => {
    const { sendPendingSourceWrites, sendSettleComment } =
      await import("./backlog-source-writes");
    let finish!: () => void;
    mocks.write.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const sending = sendPendingSourceWrites(["a"]);
    // The toast closed: the comment waits for the write.
    await sendSettleComment("a");
    expect(mocks.post).not.toHaveBeenCalled();
    finish();
    await sending;
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.write).toHaveBeenCalledBefore(mocks.post);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("azure_devops", "c", {
      sourceId: "1",
      body: "Waiting on the client",
    });
    expect(mocks.announce).toHaveBeenCalledWith(comment, posted);
    expect(mocks.queue).toEqual([]);
  });

  it("stays as the item's draft when the settle's write fails", async () => {
    const { sendPendingSourceWrites } = await import("./backlog-source-writes");
    mocks.write.mockRejectedValueOnce(new Error("Transition not allowed."));
    mocks.fail.mockImplementation(() => {
      item = { ...item, status: "active", pendingSourceWrite: undefined };
    });

    await sendPendingSourceWrites(["a"]);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Your comment is kept as a draft on it.",
        ),
      }),
    );
  });

  it("stays as the item's draft when the settle was undone", async () => {
    const { sendSettleComment } = await import("./backlog-source-writes");
    item = { ...item, status: "active", pendingSourceWrite: undefined };

    await sendSettleComment("a");

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
  });

  it("stays as the item's draft when the source refuses it", async () => {
    const { sendSettleComment } = await import("./backlog-source-writes");
    item = { ...item, pendingSourceWrite: undefined };
    mocks.post.mockRejectedValueOnce(new Error("No access."));

    await sendSettleComment("a");

    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(mocks.error).toHaveBeenCalledWith({
      title: `Couldn't post your comment on "A"`,
      description: "No access. It's kept as a draft on the item.",
    });
  });

  it("goes at the next launch for a settle with nothing to write", async () => {
    const { flushSettleComments } = await import("./backlog-source-writes");
    item = { ...item, pendingSourceWrite: undefined };

    await flushSettleComments();

    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.queue).toEqual([]);
  });
});
