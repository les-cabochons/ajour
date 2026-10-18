import { describe, expect, it } from "vitest";
import { parseCommentsSeen, withCommentsSeen } from "@/lib/comments-seen";

describe("comments seen", () => {
  it("drops broken values", () => {
    expect(parseCommentsSeen('{"a":10,"b":"x","c":null}')).toEqual({ a: 10 });
    expect(parseCommentsSeen("not json")).toEqual({});
    expect(parseCommentsSeen(null)).toEqual({});
  });

  it("keeps the most recent visits within the limit", () => {
    const seen = { old: 1, middle: 2 };

    expect(withCommentsSeen(seen, "new", 3, 2)).toEqual({ new: 3, middle: 2 });
    expect(withCommentsSeen(seen, "old", 5, 2)).toEqual({ old: 5, middle: 2 });
  });
});
