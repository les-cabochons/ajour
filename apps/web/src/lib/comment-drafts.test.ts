import { describe, expect, it } from "vitest";
import { parseCommentDrafts, withCommentDraft } from "@/lib/comment-drafts";

describe("comment drafts", () => {
  it("drops broken entries", () => {
    expect(
      parseCommentDrafts(
        '{"a":{"text":"Hi","at":1},"b":{"text":2,"at":1},"c":"x"}',
      ),
    ).toEqual({ a: { text: "Hi", at: 1 } });
    expect(parseCommentDrafts("nope")).toEqual({});
  });

  it("clears a draft that is only whitespace", () => {
    expect(
      withCommentDraft({ a: { text: "Hi", at: 1 } }, "a", "  ", 2),
    ).toEqual({});
  });

  it("keeps the newest drafts within the limit", () => {
    const drafts = { old: { text: "1", at: 1 }, middle: { text: "2", at: 2 } };

    expect(withCommentDraft(drafts, "new", "3", 3, 2)).toEqual({
      new: { text: "3", at: 3 },
      middle: { text: "2", at: 2 },
    });
  });
});
