import { describe, expect, it } from "vitest";
import { countSourceItemTypes } from "@/domain/backlog/source-item-types";

const item = (
  sourceWorkItemType: string | undefined,
  overrides: Partial<{
    source: string;
    sourceConnectionId: string;
    status: "active" | "settled" | "archived";
  }> = {},
) => ({
  source: "azure_devops",
  sourceConnectionId: "contoso",
  status: "active" as const,
  sourceWorkItemType,
  ...overrides,
});

describe("countSourceItemTypes", () => {
  it("counts the types of one connection's items in the backlog, most first", () => {
    const types = countSourceItemTypes(
      [
        item("Bug"),
        item("Task"),
        item("task", { status: "settled" }),
        item(" Task "),
        item("Product Backlog Item"),
        item("Bug"),
        item("Epic", { status: "archived" }),
        item("Feature", { sourceConnectionId: "fabrikam" }),
        item("Issue", { source: "jira" }),
        item("Task", { source: "manual" }),
        item(undefined),
      ],
      "azure_devops",
      "contoso",
    );

    expect(types).toEqual([
      { name: "Task", count: 3 },
      { name: "Bug", count: 2 },
      { name: "Product Backlog Item", count: 1 },
    ]);
  });
});
