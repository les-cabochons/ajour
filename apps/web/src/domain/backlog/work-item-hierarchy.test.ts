import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertValidParentWorkItem,
  getDirectChildWorkItems,
  inferInheritedParentMapping,
} from "./work-item-hierarchy";
import type { LocalWorkItem } from "@/domain/local-state";

function workItem(overrides: Partial<LocalWorkItem> & { _id: string }) {
  return {
    title: overrides._id,
    status: "active",
    source: "manual",
    createdAt: 0,
    ...overrides,
  } as LocalWorkItem;
}

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
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("treats a manual subtask as a child of an imported parent", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.importSyncedWorkItems([
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
        priority: "medium",
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

  it("lists children by local and source parent, newest first, ties in list order", () => {
    const parent = workItem({ _id: "parent", sourceId: "ado/7" });
    const list = [
      workItem({ _id: "later-b", parentWorkItemId: "parent", createdAt: 2 }),
      workItem({ _id: "older", parentSourceId: "ado/7", createdAt: 1 }),
      parent,
      workItem({ _id: "later-a", parentWorkItemId: "parent", createdAt: 2 }),
      workItem({
        _id: "other",
        parentWorkItemId: "someone-else",
        createdAt: 3,
      }),
    ];

    expect(
      getDirectChildWorkItems(parent, list).map((item) => item._id),
    ).toEqual(["later-b", "later-a", "older"]);
  });

  it("reads a replaced list instead of the index of the one before", () => {
    const parent = workItem({ _id: "parent" });
    const child = workItem({ _id: "child", parentWorkItemId: "parent" });

    expect(getDirectChildWorkItems(parent, [parent, child])).toEqual([child]);
    expect(getDirectChildWorkItems(parent, [parent])).toEqual([]);
    expect(getDirectChildWorkItems(parent, [child, parent])).toEqual([child]);
  });
});
