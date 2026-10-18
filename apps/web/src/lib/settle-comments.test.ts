import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSettleComment,
  parsePendingSettleComments,
  queueSettleComment,
  settleCommentItemIds,
  takeSettleComment,
} from "@/lib/settle-comments";

const entry = {
  itemId: "item",
  pluginId: "azure_devops",
  connectionId: "conn",
  sourceId: "4821",
  body: "Waiting on the client",
  at: 1,
};

describe("pending settle comments", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps only complete entries", () => {
    expect(
      parsePendingSettleComments(
        JSON.stringify([entry, { ...entry, body: 2 }, "x"]),
      ),
    ).toEqual([entry]);
    expect(parsePendingSettleComments("nope")).toEqual([]);
  });

  it("keeps one comment per item and sends it once", () => {
    queueSettleComment(entry);
    queueSettleComment({ ...entry, body: "Second thoughts", at: 2 });
    queueSettleComment({ ...entry, itemId: "other" });

    expect(settleCommentItemIds()).toEqual(["item", "other"]);
    expect(getSettleComment("item")?.body).toBe("Second thoughts");
    expect(takeSettleComment("item")?.body).toBe("Second thoughts");
    expect(takeSettleComment("item")).toBeUndefined();
    expect(settleCommentItemIds()).toEqual(["other"]);
  });
});
