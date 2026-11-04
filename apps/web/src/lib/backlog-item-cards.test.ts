import { describe, expect, it } from "vitest";
import {
  parseBacklogItemCards,
  resolveSubitemsOpen,
} from "@/lib/backlog-item-cards";

describe("parseBacklogItemCards", () => {
  it("starts with Time entries closed and Subitems unchosen", () => {
    expect(parseBacklogItemCards(null)).toEqual({
      subitemsOpen: undefined,
      timeEntriesOpen: false,
    });
  });

  it("keeps the cards the user opened or closed", () => {
    expect(
      parseBacklogItemCards('{"subitemsOpen":true,"timeEntriesOpen":false}'),
    ).toEqual({ subitemsOpen: true, timeEntriesOpen: false });
    expect(parseBacklogItemCards('{"subitemsOpen":false}')).toEqual({
      subitemsOpen: false,
      timeEntriesOpen: false,
    });
  });

  it("treats a broken saved value as unchosen", () => {
    expect(parseBacklogItemCards('{"timeEntriesOpen":"yes"}')).toEqual({
      subitemsOpen: undefined,
      timeEntriesOpen: false,
    });
    for (const broken of ["not json", "null", "[true]", '"open"']) {
      expect(parseBacklogItemCards(broken)).toEqual({
        subitemsOpen: undefined,
        timeEntriesOpen: false,
      });
    }
  });
});

describe("resolveSubitemsOpen", () => {
  it("opens a short list of subitems until the user chooses", () => {
    expect(resolveSubitemsOpen(undefined, 0)).toBe(false);
    expect(resolveSubitemsOpen(undefined, 1)).toBe(true);
    expect(resolveSubitemsOpen(undefined, 3)).toBe(true);
    expect(resolveSubitemsOpen(undefined, 4)).toBe(false);
  });

  it("keeps the user's choice", () => {
    expect(resolveSubitemsOpen(false, 2)).toBe(false);
    expect(resolveSubitemsOpen(true, 9)).toBe(true);
  });
});
