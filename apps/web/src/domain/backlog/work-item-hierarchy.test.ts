import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertValidParentWorkItem,
  getDirectChildWorkItems,
  inferInheritedParentMapping,
} from "./work-item-hierarchy";

function installMockWindow() {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        clear: vi.fn(() => {
          storage.clear();
        }),
      },
    },
  });
}

describe("work item hierarchy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("treats a manual subtask as a child of an imported parent", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.importConnectorWorkItems([
      {
        id: "connector-parent",
        source: "azure_devops",
        connectionId: "ado-1",
        connectionLabel: "Main connection",
        tenantLabel: "Contoso",
        sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
        externalId: "123",
        sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
        title: "Imported parent",
        projectName: "Project Mercury",
        workItemType: "Task",
        state: "Active",
        assignedTo: "Ada Lovelace",
        priority: 3,
        depth: 0,
        selectable: true,
        selected: true,
        childCount: 0,
        pushedAt: 1,
      },
    ]);

    const importedParent = localStore.snapshot().workItems[0];
    expect(importedParent).toBeTruthy();

    const subtaskId = localStore.addSubtask(importedParent!._id, {
      title: "Manual child",
    });
    const snapshot = localStore.snapshot().workItems;

    expect(getDirectChildWorkItems(importedParent!, snapshot)).toEqual([
      expect.objectContaining({
        _id: subtaskId,
        title: "Manual child",
        parentWorkItemId: importedParent!._id,
      }),
    ]);
  });

  it("rejects nesting a task that already owns subtasks", () => {
    const root = {
      _id: "root",
      title: "Root",
      status: "active" as const,
      source: "manual" as const,
      createdAt: 1,
    };
    const child = {
      ...root,
      _id: "child",
      title: "Child",
      parentWorkItemId: "root",
      hierarchyLevel: 1 as const,
    };
    const otherRoot = {
      ...root,
      _id: "other-root",
      title: "Other root",
    };

    expect(() =>
      assertValidParentWorkItem([root, child, otherRoot], "root", "other-root"),
    ).toThrow("Items with subitems cannot be nested.");
  });

  it("infers inherited mapping only when a subtask follows its parent", () => {
    expect(
      inferInheritedParentMapping(
        {
          parentWorkItemId: "parent",
          projectId: "project-1",
          taskId: "task-1",
        },
        {
          projectId: "project-1",
          taskId: "task-1",
        },
      ),
    ).toBe(true);
    expect(
      inferInheritedParentMapping(
        {
          parentWorkItemId: "parent",
          projectId: "project-2",
          taskId: "task-2",
        },
        {
          projectId: "project-1",
          taskId: "task-1",
        },
      ),
    ).toBe(false);
  });
});
