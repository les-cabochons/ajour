import { describe, expect, it } from "vitest";
import {
  describeLogWarning,
  describeStorage,
  formatBytes,
  RETENTION_CHOICES,
  SIZE_LIMIT_CHOICES,
} from "./diagnostics-settings-model";

describe("the log settings choices", () => {
  it("are the closed sets the issue names", () => {
    expect(RETENTION_CHOICES.map(({ value }) => value)).toEqual([1, 7, 30, 90]);
    expect(SIZE_LIMIT_CHOICES.map(({ value }) => value)).toEqual([
      100, 250, 1000,
    ]);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [2_621_440, "2.5 MB"],
    [1_610_612_736, "1.5 GB"],
    [5 * 1024 ** 4, "5120.0 GB"],
  ])("writes %d bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("describeStorage", () => {
  it("gives bytes, file count and the oldest day, and zero for an empty folder", () => {
    expect(
      describeStorage({
        storage_bytes: 2048,
        file_count: 2,
        oldest_day: "2026-10-20",
      }),
    ).toBe("2.0 KB in 2 files, oldest 2026-10-20");
    expect(describeStorage({ storage_bytes: 0, file_count: 0 })).toBe(
      "0 B in 0 files",
    );
  });
});

describe("describeLogWarning", () => {
  it("names each reason and how to resume", () => {
    for (const reason of [
      "disk_full",
      "no_permission",
      "write_failed",
    ] as const) {
      expect(describeLogWarning(reason)).toContain("off and on again");
    }
    expect(describeLogWarning("disk_full")).toContain("disk is full");
    expect(describeLogWarning("no_permission")).toContain("isn't allowed");
    expect(describeLogWarning("write_failed")).toContain("failed");
  });
});
