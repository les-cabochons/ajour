import { describe, expect, it } from "vitest";
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
