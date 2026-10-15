import { normalizePersistedWorkItem } from "@/domain/backlog/work-item-transitions";
import { describe, expect, it } from "vitest";
import {
  connectorPriorityFromLevel,
  normalizePriorityLevel,
  priorityLevelFromConnector,
} from "@/domain/backlog/priority";

describe("priority levels", () => {
  it("turns stored numbers into levels, with anything above 4 as Low", () => {
    expect(normalizePriorityLevel(1)).toBe(1);
    expect(normalizePriorityLevel(17)).toBe(4);
    expect(normalizePriorityLevel(0)).toBeUndefined();
    expect(normalizePriorityLevel("2")).toBeUndefined();
  });

  it("reads and writes levels by their connector name", () => {
    expect(priorityLevelFromConnector("urgent")).toBe(1);
    expect(priorityLevelFromConnector("low")).toBe(4);
    expect(priorityLevelFromConnector(undefined)).toBeUndefined();
    expect(connectorPriorityFromLevel(2)).toBe("high");
    expect(connectorPriorityFromLevel(undefined)).toBeUndefined();
  });
});

it("drops stored source priorities that are not levels, so the next sync brings the level", () => {
  const legacy = {
    _id: "a",
    title: "A",
    source: "jira",
    sourceConnectionId: "c",
    status: "active" as const,
    priority: 3,
    importedPriority: 50,
    settledImportedPriority: 2,
    createdAt: 1,
  };
  const migrated = normalizePersistedWorkItem(legacy, () => 1);
  expect(migrated.priority).toBe(3);
  expect(migrated.importedPriority).toBeUndefined();
  expect(migrated.settledImportedPriority).toBe(2);
});
