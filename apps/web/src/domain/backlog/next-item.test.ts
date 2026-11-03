import { describe, expect, it } from "vitest";
import { pickNextItemId } from "@/domain/backlog/next-item";

describe("the item opened after a settle or a snooze", () => {
  it("is the row after it", () => {
    expect(pickNextItemId(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
  });

  it("skips the rows that left with it, such as its settled subitems", () => {
    expect(
      pickNextItemId(["parent", "sub-1", "sub-2", "next"], ["next"], "parent"),
    ).toBe("next");
  });

  it("is the row before it when it was the last row", () => {
    expect(pickNextItemId(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
  });

  it("is the first row when it wasn't in the list, as when the search hides it", () => {
    expect(pickNextItemId(["a", "b"], ["a", "b"], "hidden")).toBe("a");
  });

  it("is a row new to the list when nothing else is left", () => {
    expect(pickNextItemId(["a"], ["synced"], "a")).toBe("synced");
  });

  it("is nothing when the list is empty", () => {
    expect(pickNextItemId(["a"], [], "a")).toBeUndefined();
  });

  it("never is the item itself, even when it is still listed", () => {
    expect(pickNextItemId(["a", "b"], ["a", "b"], "a")).toBe("b");
    expect(pickNextItemId(["a"], ["a"], "a")).toBeUndefined();
  });
});
