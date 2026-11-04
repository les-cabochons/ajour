import { describe, expect, it } from "vitest";
import { entryShortId, matchesShortIdPrefix } from "../entry-short-id.ts";

describe("an entry's short id", () => {
  it("is the UUID after the id's prefix, without dashes, in lowercase", () => {
    expect(entryShortId("timesheet_3F2A9C1E-7B4D-4E8A-9C0B-1D2E3F4A5B6C")).toBe(
      "3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c",
    );
    expect(entryShortId("timer_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")).toBe(
      "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d",
    );
    expect(entryShortId("3f2a9c1e-7b4d-4e8a-9c0b-1d2e3f4a5b6c")).toBe(
      "3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c",
    );
  });

  it("is the whole id when the id holds no UUID", () => {
    expect(entryShortId("e1")).toBe("e1");
    expect(entryShortId("timesheet_legacy-42")).toBe("timesheet_legacy-42");
  });

  it("matches a prefix of the short id only", () => {
    const id = "timesheet_3f2a9c1e-7b4d-4e8a-9c0b-1d2e3f4a5b6c";
    expect(matchesShortIdPrefix(id, "3f2a")).toBe(true);
    expect(matchesShortIdPrefix(id, "3f2a9c1e7b4d")).toBe(true);
    expect(matchesShortIdPrefix(id, "9c1e")).toBe(false);
    expect(matchesShortIdPrefix("abcd1234", "abcd")).toBe(true);
  });
});
