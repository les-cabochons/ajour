import { describe, expect, it } from "vitest";
import { parseBacklogItemCards } from "@/lib/backlog-item-cards";

describe("parseBacklogItemCards", () => {
  it("starts with both cards closed", () => {
    expect(parseBacklogItemCards(null)).toEqual({
      subitemsOpen: false,
      timeEntriesOpen: false,
    });
  });

  it("keeps the cards the user opened", () => {
    expect(
      parseBacklogItemCards('{"subitemsOpen":true,"timeEntriesOpen":false}'),
    ).toEqual({ subitemsOpen: true, timeEntriesOpen: false });
  });

  it("closes a card whose saved value is broken", () => {
    expect(parseBacklogItemCards('{"timeEntriesOpen":"yes"}')).toEqual({
      subitemsOpen: false,
      timeEntriesOpen: false,
    });
    expect(parseBacklogItemCards("not json")).toEqual({
      subitemsOpen: false,
      timeEntriesOpen: false,
    });
  });
});
