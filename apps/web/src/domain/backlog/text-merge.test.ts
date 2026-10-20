import { describe, expect, it } from "vitest";
import { mergeTexts } from "@/domain/backlog/text-merge";

const lines = (...text: string[]) => text.join("\n");

describe("merging two edits of one text", () => {
  it("takes the only side that changed", () => {
    expect(mergeTexts("a\nb", "a\nB", "a\nb")).toEqual({ merged: "a\nB" });
    expect(mergeTexts("a\nb", "a\nb", "A\nb")).toEqual({ merged: "A\nb" });
  });

  it("keeps the same change made on both sides once", () => {
    expect(mergeTexts("a\nb", "a\nB", "a\nB")).toEqual({ merged: "a\nB" });
  });

  it("merges changes to different lines", () => {
    expect(
      mergeTexts(
        lines("Title", "", "Step one", "Step two", "", "Notes"),
        lines("Title", "", "Step one, done", "Step two", "", "Notes"),
        lines("Title", "", "Step one", "Step two", "", "Notes and links"),
      ),
    ).toEqual({
      merged: lines(
        "Title",
        "",
        "Step one, done",
        "Step two",
        "",
        "Notes and links",
      ),
    });
  });

  it("merges lines added at different places", () => {
    expect(
      mergeTexts(
        lines("a", "b", "c"),
        lines("start", "a", "b", "c"),
        lines("a", "b", "c", "end"),
      ),
    ).toEqual({ merged: lines("start", "a", "b", "c", "end") });
  });

  it("merges changes to neighbouring lines", () => {
    expect(
      mergeTexts(
        lines("a", "b", "c"),
        lines("a", "B", "c"),
        lines("a", "b", "C"),
      ),
    ).toEqual({ merged: lines("a", "B", "C") });
  });

  it("is a conflict when both sides changed the same line differently", () => {
    expect(mergeTexts("a\nb", "a\nmine", "a\ntheirs")).toEqual({
      conflict: true,
    });
  });

  it("is a conflict when both sides added different lines at the same place", () => {
    expect(mergeTexts("a\nc", "a\nmine\nc", "a\ntheirs\nc")).toEqual({
      conflict: true,
    });
  });

  it("is a conflict when one side removed a line the other changed", () => {
    expect(mergeTexts("a\nb\nc", "a\nc", "a\nB\nc")).toEqual({
      conflict: true,
    });
  });

  it("merges from an empty text when only one side wrote", () => {
    expect(mergeTexts("", "New", "")).toEqual({ merged: "New" });
    expect(mergeTexts("", "Mine", "Theirs")).toEqual({ conflict: true });
  });
});
