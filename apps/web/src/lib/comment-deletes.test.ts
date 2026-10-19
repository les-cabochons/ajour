import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePendingCommentDeletes } from "@/lib/comment-deletes";

describe("pending comment deletes", () => {
  it("keeps only complete entries", () => {
    const entry = {
      itemId: "item",
      pluginId: "azure_devops",
      connectionId: "conn",
      sourceId: "4821",
      commentId: "c1",
      at: 1,
    };

    expect(
      parsePendingCommentDeletes(
        JSON.stringify([entry, { ...entry, commentId: 2 }, "x"]),
      ),
    ).toEqual([entry]);
    expect(parsePendingCommentDeletes("{}")).toEqual([]);
    expect(parsePendingCommentDeletes("nope")).toEqual([]);
  });
});

describe("pending comment deletes by thread", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hides and sends a delete only in its own thread, whatever the comment id", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const deletes = await import("@/lib/comment-deletes");
    const work = {
      pluginId: "azure_devops",
      connectionId: "work",
      sourceId: "1",
    };
    const home = {
      pluginId: "azure_devops",
      connectionId: "home",
      sourceId: "1",
    };
    deletes.queueCommentDelete({ ...work, itemId: "a", commentId: "1", at: 1 });
    deletes.queueCommentDelete({ ...home, itemId: "b", commentId: "1", at: 2 });

    expect([...deletes.pendingCommentDeleteIds(work)]).toEqual(["1"]);
    deletes.cancelCommentDelete({ ...work, commentId: "1" });
    expect(deletes.pendingCommentDeleteIds(work).size).toBe(0);
    expect([...deletes.pendingCommentDeleteIds(home)]).toEqual(["1"]);
  });
});
