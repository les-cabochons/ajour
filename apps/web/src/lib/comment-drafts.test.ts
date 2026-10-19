import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCommentDraft,
  keepCommentAsDraft,
  parseCommentDrafts,
  setCommentDraft,
  subscribeCommentDrafts,
  withCommentDraft,
} from "@/lib/comment-drafts";

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

describe("comments kept as drafts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds an unsent comment after the draft already there, and tells the composer", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const changes: [string, string][] = [];
    const unsubscribe = subscribeCommentDrafts((itemId, text) =>
      changes.push([itemId, text]),
    );

    setCommentDraft("item", "Half a thought");
    keepCommentAsDraft("item", "Waiting on the client");
    keepCommentAsDraft("item", "Waiting on the client");
    keepCommentAsDraft("other", "Alone");
    unsubscribe();
    setCommentDraft("other", "");

    expect(getCommentDraft("item")).toBe(
      "Half a thought\n\nWaiting on the client\n\nWaiting on the client",
    );
    expect(getCommentDraft("other")).toBeUndefined();
    expect(changes.at(-1)).toEqual(["other", "Alone"]);
  });
});
