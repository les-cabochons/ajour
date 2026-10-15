import { describe, expect, it } from "vitest";
import { externalEntryId } from "@/domain/agents/external-id";

describe("externalEntryId", () => {
  it("is ajour: and 8 hex characters of the FNV-1a hash of the entry id", () => {
    expect(externalEntryId("a")).toBe("ajour:e40c292c");
    expect(externalEntryId("timesheet-123")).toMatch(/^ajour:[0-9a-f]{8}$/);
  });

  it("tells entries apart", () => {
    expect(externalEntryId("a")).not.toBe(externalEntryId("b"));
  });
});
