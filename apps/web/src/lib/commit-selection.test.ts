import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("commit selection", () => {
  it("keeps unchecked changes per week until the week is reset", async () => {
    const { getUncheckedChangeIds, resetCheckedChanges, setChangesChecked } =
      await import("@/lib/commit-selection");

    setChangesChecked("2026-10-05", ["a", "b"], false);
    setChangesChecked("2026-10-05", ["b"], true);

    expect([...getUncheckedChangeIds("2026-10-05")]).toEqual(["a"]);
    expect([...getUncheckedChangeIds("2026-10-12")]).toEqual([]);

    resetCheckedChanges("2026-10-05");
    expect([...getUncheckedChangeIds("2026-10-05")]).toEqual([]);
  });

  it("returns the same set until it changes, as React snapshots need", async () => {
    const { getUncheckedChangeIds, setChangesChecked } =
      await import("@/lib/commit-selection");

    setChangesChecked("2026-10-05", ["a"], false);

    expect(getUncheckedChangeIds("2026-10-05")).toBe(
      getUncheckedChangeIds("2026-10-05"),
    );
  });
});
