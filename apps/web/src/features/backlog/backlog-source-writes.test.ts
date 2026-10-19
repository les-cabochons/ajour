import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  write: vi.fn(),
  error: vi.fn(),
  post: vi.fn(),
  keepDraft: vi.fn(),
  announce: vi.fn(),
  access: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("@/lib/local-store", () => ({
  localStore: {
    snapshot: mocks.snapshot,
    completeSourceWrite: mocks.complete,
    failSourceWrite: mocks.fail,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
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
vi.mock("@/lib/agent-comment-access", () => ({
  readAgentCommentAccess: mocks.access,
  agentAccessAllows: (access: string, need: "read" | "readWrite") =>
    need === "read" ? access !== "none" : access === "readWrite",
}));
vi.mock("@/features/backlog/comment-threads", () => ({
  announcePostedComment: mocks.announce,
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
  // A fresh settle comment queue per test. Storage is missing here, so it
  // lives in the session copy.
  vi.resetModules();
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
  const comment = (id: string, body = "Waiting on the client") => ({
    id,
    itemId: "a",
    pluginId: "azure_devops",
    connectionId: "c",
    sourceId: "1",
    body,
    at: 1000,
  });
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
    mocks.post.mockResolvedValue({ comment: posted });
  });

  async function load() {
    const writes = await import("./backlog-source-writes");
    const queue = await import("@/lib/settle-comments");
    return { ...writes, ...queue };
  }

  it("goes out once its Undo window closed and the write landed, and joins the item's thread", async () => {
    const {
      queueSettleComment,
      releaseSettleComment,
      sendPendingSourceWrites,
      settleCommentsOf,
    } = await load();
    queueSettleComment(comment("s1"));
    let finish!: () => void;
    mocks.write.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const sending = sendPendingSourceWrites(["a"]);
    // The toast closed: the comment waits for the write.
    await releaseSettleComment("s1", "a");
    expect(mocks.post).not.toHaveBeenCalled();
    finish();
    await sending;
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.write).toHaveBeenCalledBefore(mocks.post);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(
      "azure_devops",
      "c",
      { sourceId: "1", body: "Waiting on the client" },
      // The user's own comment: no agent check at the API.
      undefined,
    );
    expect(mocks.announce).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", sourceId: "1" }),
      posted,
    );
    expect(settleCommentsOf("a")).toEqual([]);
  });

  it("waits for its own Undo window even when an earlier write lands first", async () => {
    const {
      queueSettleComment,
      releaseSettleComment,
      sendPendingSourceWrites,
    } = await load();
    // A move's write, which the settle kept, lands before the settle's toast closes.
    queueSettleComment(comment("s1"));
    await sendPendingSourceWrites(["a"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(item.pendingSourceWrite).toBeUndefined();
    expect(mocks.post).not.toHaveBeenCalled();

    await releaseSettleComment("s1", "a");
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("releases only its own settle's comment", async () => {
    const { queueSettleComment, releaseSettleComment, settleCommentsOf } =
      await load();
    item = { ...item, pendingSourceWrite: undefined };
    queueSettleComment(comment("s1", "First"));
    queueSettleComment(comment("s2", "Second"));

    await releaseSettleComment("s1", "a");

    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(
      "azure_devops",
      "c",
      { sourceId: "1", body: "First" },
      undefined,
    );
    expect(settleCommentsOf("a").map((entry) => entry.id)).toEqual(["s2"]);
  });

  it("stays as the item's draft when the settle's write fails, even if the item stays settled", async () => {
    const { queueSettleComment, sendPendingSourceWrites, settleCommentsOf } =
      await load();
    queueSettleComment(comment("s1"));
    mocks.write.mockRejectedValueOnce(new Error("Transition not allowed."));
    // An earlier settle's write landed meanwhile, so recovery keeps it settled.
    mocks.fail.mockImplementation(() => {
      item = { ...item, pendingSourceWrite: undefined };
    });

    await sendPendingSourceWrites(["a"]);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(settleCommentsOf("a")).toEqual([]);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Your comment is kept as a draft on it.",
        ),
      }),
    );
  });

  it("stays as the item's draft when the settle was undone", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    item = { ...item, status: "active", pendingSourceWrite: undefined };
    queueSettleComment(comment("s1"));

    await releaseSettleComment("s1", "a");

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
  });

  it("stays as the item's draft when the source refuses it", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    item = { ...item, pendingSourceWrite: undefined };
    queueSettleComment(comment("s1"));
    mocks.post.mockRejectedValueOnce(new Error("No access."));

    await releaseSettleComment("s1", "a");

    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(mocks.error).toHaveBeenCalledWith({
      title: `Couldn't post your comment on "A"`,
      description: "No access. It's kept as a draft on the item.",
    });
  });

  it("goes at the next launch when Ajour quit during the Undo window", async () => {
    const { queueSettleComment, flushSettleComments, settleCommentsOf } =
      await load();
    item = { ...item, pendingSourceWrite: undefined };
    queueSettleComment(comment("s1"));

    await flushSettleComments();

    expect(mocks.post).toHaveBeenCalledOnce();
    expect(settleCommentsOf("a")).toEqual([]);
  });

  it("posts an agent's settle comment only while the agent may still post", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    item = { ...item, pendingSourceWrite: undefined };
    queueSettleComment({ ...comment("s1"), agentClient: "Claude Code" });
    queueSettleComment({
      ...comment("s2", "Second"),
      agentClient: "Claude Code",
    });

    mocks.access.mockResolvedValueOnce({ access: "readWrite" });
    await releaseSettleComment("s1", "a");
    expect(mocks.post).toHaveBeenCalledOnce();

    mocks.access.mockResolvedValueOnce({ access: "read" });
    await releaseSettleComment("s2", "a");
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Second");
    expect(mocks.error).toHaveBeenCalledWith({
      title: `Claude Code's comment on "A" wasn't posted`,
      description:
        "Agents can no longer post comments on its connection. It's kept as a draft on the item.",
    });
  });

  it("names the agent when its settle comment can't be checked", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    item = { ...item, pendingSourceWrite: undefined };
    queueSettleComment({ ...comment("s1"), agentClient: "Claude Code" });
    mocks.access.mockRejectedValueOnce(
      new Error("The local API is not running."),
    );

    await releaseSettleComment("s1", "a");

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(mocks.error).toHaveBeenCalledWith({
      title: `Couldn't post Claude Code's comment on "A"`,
      description:
        "The local API is not running. It's kept as a draft on the item.",
    });
  });

  it("leaves nothing to post when the settle ends while an agent's access loads", async () => {
    const {
      queueSettleComment,
      releaseSettleComment,
      settleCommentsOf,
      watchSettleEnds,
    } = await load();
    item = { ...item, pendingSourceWrite: undefined };
    const stop = watchSettleEnds();
    queueSettleComment({ ...comment("s1"), agentClient: "Claude Code" });
    // While access loads, the user unsettles the item.
    mocks.access.mockImplementationOnce(async () => {
      item = { ...item, status: "active" };
      for (const listener of mocks.listeners) listener();
      return { access: "readWrite" };
    });

    await releaseSettleComment("s1", "a");
    stop();

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(settleCommentsOf("a")).toEqual([]);
  });

  it("turns waiting comments into drafts the moment their settle ends", async () => {
    const {
      queueSettleComment,
      releaseSettleComment,
      settleCommentsOf,
      watchSettleEnds,
    } = await load();
    item = { ...item, pendingSourceWrite: undefined };
    const stop = watchSettleEnds();
    queueSettleComment(comment("s1"));

    // Unsettled, then archived before the toast closes: the settle ended.
    item = { ...item, status: "active" };
    for (const listener of mocks.listeners) listener();
    item = { ...item, status: "archived", archivedAt: 6000 };
    for (const listener of mocks.listeners) listener();
    await releaseSettleComment("s1", "a");
    stop();

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
    expect(settleCommentsOf("a")).toEqual([]);
  });

  it("keeps waiting comments when a standing settle goes on into an archive", async () => {
    const { queueSettleComment, settleCommentsOf, watchSettleEnds } =
      await load();
    const stop = watchSettleEnds();
    queueSettleComment(comment("s1"));

    item = { ...item, status: "archived", archivedAt: 6000 };
    for (const listener of mocks.listeners) listener();
    stop();

    expect(mocks.keepDraft).not.toHaveBeenCalled();
    expect(settleCommentsOf("a")).toHaveLength(1);
  });

  it("still posts when the settled item was archived meanwhile", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    // A sync reported it done while the comment waited: the settle stands.
    item = {
      ...item,
      status: "archived",
      settledAt: undefined,
      archivedAt: 5000,
      pendingSourceWrite: undefined,
    };
    queueSettleComment(comment("s1"));

    await releaseSettleComment("s1", "a");

    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.keepDraft).not.toHaveBeenCalled();
  });

  it("keeps a comment as a draft when its item now comes from another source", async () => {
    const { queueSettleComment, releaseSettleComment } = await load();
    item = { ...item, pendingSourceWrite: undefined, sourceId: "2" };
    queueSettleComment(comment("s1"));

    await releaseSettleComment("s1", "a");

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.keepDraft).toHaveBeenCalledWith("a", "Waiting on the client");
  });

  it("goes once a write it waited on is undone", async () => {
    const {
      queueSettleComment,
      releaseSettleComment,
      sendPendingSourceWrites,
      settleCommentsOf,
    } = await load();
    // A move made after the settle waits to write; the comment waits on it.
    item = {
      ...item,
      pendingSourceWrite: { state: "Review", readyAt: 99_000, previous: {} },
    };
    queueSettleComment(comment("s1"));
    await releaseSettleComment("s1", "a");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(settleCommentsOf("a")).toHaveLength(1);

    // Undo takes the move back; its toast's close sends what is left.
    item = { ...item, pendingSourceWrite: undefined };
    await sendPendingSourceWrites(["a"]);

    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(settleCommentsOf("a")).toEqual([]);
  });

  it("leaves a newer settle's comment, queued after the end was seen, waiting", async () => {
    const { queueSettleComment, settleCommentsOf, watchSettleEnds } =
      await load();
    const stop = watchSettleEnds();
    queueSettleComment(comment("s1"));
    // Another window settles the item again and queues a new comment just
    // after this one saw the earlier settle end.
    vi.setSystemTime(2000);
    queueSettleComment({ ...comment("s2", "Newer"), at: 3000 });

    item = { ...item, status: "active" };
    for (const listener of mocks.listeners) listener();
    stop();

    expect(mocks.keepDraft).toHaveBeenCalledExactlyOnceWith(
      "a",
      "Waiting on the client",
    );
    expect(settleCommentsOf("a").map((entry) => entry.id)).toEqual(["s2"]);
  });

  it("says the comment was kept when the watcher drafts it during a failed write's recovery", async () => {
    const { queueSettleComment, sendPendingSourceWrites, watchSettleEnds } =
      await load();
    const stop = watchSettleEnds();
    queueSettleComment(comment("s1"));
    mocks.write.mockRejectedValueOnce(new Error("Transition not allowed."));
    mocks.fail.mockImplementation(() => {
      item = { ...item, status: "active", pendingSourceWrite: undefined };
      for (const listener of mocks.listeners) listener();
    });

    await sendPendingSourceWrites(["a"]);
    stop();

    expect(mocks.keepDraft).toHaveBeenCalledExactlyOnceWith(
      "a",
      "Waiting on the client",
    );
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Your comment is kept as a draft on it.",
        ),
      }),
    );
  });
});
