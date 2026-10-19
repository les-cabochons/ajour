import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entry = (id: string, itemId = "item") => ({
  id,
  itemId,
  pluginId: "azure_devops",
  connectionId: "conn",
  sourceId: "4821",
  body: "Waiting on the client",
  at: 1,
});

function stubStorage(setItem?: () => void) {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem:
        setItem ?? ((key: string, value: string) => values.set(key, value)),
    },
  });
  return values;
}

describe("pending settle comments", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps only complete entries", async () => {
    const { parsePendingSettleComments } =
      await import("@/lib/settle-comments");

    expect(
      parsePendingSettleComments(
        JSON.stringify([
          entry("s1"),
          { ...entry("s2"), ready: true },
          { ...entry("s3"), body: 2 },
          { ...entry("s4"), ready: "yes" },
          "x",
        ]),
      ),
    ).toEqual([entry("s1"), { ...entry("s2"), ready: true }]);
    expect(parsePendingSettleComments("nope")).toEqual([]);
  });

  it("keeps each settle's comment apart, readies one at a time, and takes it once", async () => {
    const values = stubStorage();
    const queue = await import("@/lib/settle-comments");
    queue.queueSettleComment(entry("s1"));
    queue.queueSettleComment(entry("s2"));
    queue.queueSettleComment(entry("s3", "other"));

    queue.markSettleCommentReady("s1");

    expect(queue.settleCommentItemIds()).toEqual(["item", "other"]);
    expect(
      queue.settleCommentsOf("item").map(({ id, ready }) => ({ id, ready })),
    ).toEqual([
      { id: "s1", ready: true },
      { id: "s2", ready: undefined },
    ]);
    expect(queue.takeSettleComment("s1")?.id).toBe("s1");
    expect(queue.takeSettleComment("s1")).toBeUndefined();
    expect(
      JSON.parse(values.get(queue.PENDING_SETTLE_COMMENTS_STORAGE_KEY)!),
    ).toHaveLength(2);
  });

  it("readies every comment left from a session that quit", async () => {
    stubStorage();
    const queue = await import("@/lib/settle-comments");
    queue.queueSettleComment(entry("s1"));
    queue.queueSettleComment(entry("s2", "other"));

    queue.markSettleCommentsReady();

    expect(
      [
        ...queue.settleCommentsOf("item"),
        ...queue.settleCommentsOf("other"),
      ].map((pending) => pending.ready),
    ).toEqual([true, true]);
  });

  it("keeps a comment for the session when storage refuses it", async () => {
    stubStorage(() => {
      throw new Error("QuotaExceededError");
    });
    const queue = await import("@/lib/settle-comments");

    queue.queueSettleComment(entry("s1"));

    expect(queue.settleCommentsOf("item").map((pending) => pending.id)).toEqual(
      ["s1"],
    );
  });
});
