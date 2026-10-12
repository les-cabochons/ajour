import { describe, expect, it } from "vitest";
import { parseBacklogItemSearch } from "@/features/backlog/backlog-item-search";

describe("parseBacklogItemSearch", () => {
  it("keeps the actions the item page hosts", () => {
    expect(parseBacklogItemSearch({ action: "edit" })).toEqual({
      action: "edit",
    });
    expect(parseBacklogItemSearch({ action: "add-subitem" })).toEqual({
      action: "add-subitem",
    });
  });

  it("drops a missing, unknown or non-string action", () => {
    expect(parseBacklogItemSearch({})).toEqual({});
    expect(parseBacklogItemSearch({ action: "delete" })).toEqual({});
    expect(parseBacklogItemSearch({ action: 1 })).toEqual({});
  });
});
