import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractTaskNamesFromWorkbook } from "./project-task-import";

async function buildWorkbookBuffer(
  ...sheets: Array<{ name: string; rows: unknown[][] }>
) {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRows(sheet.rows);
  }

  return workbook.xlsx.writeBuffer();
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

describe("extractTaskNamesFromWorkbook", () => {
  it("reads column C from the first worksheet, skipping blanks and the header row", async () => {
    const buffer = await buildWorkbookBuffer(
      {
        name: "Import",
        rows: [
          ["Numero", "Phase/tache", "Nom personnalisé de la tâche"],
          ["T", "Regular", "  Suivi   projet / gestion  "],
          ["T", "Regular", ""],
          ["T", "Regular", "Billet 101"],
        ],
      },
      {
        name: "Ignored",
        rows: [["Numero", "Phase/tache", "Should stay ignored"]],
      },
    );

    await expect(extractTaskNamesFromWorkbook(buffer)).resolves.toEqual({
      taskNames: ["Suivi projet / gestion", "Billet 101"],
      blankCount: 1,
      headerCount: 1,
    });
  });
});

describe("localStore.importProjectTasks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("skips duplicates across incoming rows and existing active or archived tasks", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.createTeam("Local Team", "local-team", [
      {
        name: "Project Mercury",
        color: "#123456",
        tasks: [
          { name: "Existing Task" },
          { name: "Déjà fait", status: "archived" },
        ],
      },
    ]);

    const projectId = localStore.snapshot().projects[0]?._id;
    expect(projectId).toBeTruthy();

    const result = localStore.importProjectTasks(projectId!, [
      " existing   task ",
      "New Task",
      "new task",
      "Deja fait",
      "Another Task",
    ]);

    expect(result).toEqual({
      importedCount: 2,
      duplicateCount: 3,
      blankCount: 0,
      headerCount: 0,
      importedNames: ["New Task", "Another Task"],
    });
    expect(
      localStore.snapshot().projects[0]?.tasks.map((task) => task.name),
    ).toEqual(["Existing Task", "Déjà fait", "New Task", "Another Task"]);
  });

  it("creates no new tasks when the same workbook is imported twice", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.createTeam("Local Team", "local-team", [
      {
        name: "Project Apollo",
        color: "#654321",
      },
    ]);

    const projectId = localStore.snapshot().projects[0]!._id;

    expect(
      localStore.importProjectTasks(projectId, ["Billet 1", "Billet 2"])
        .importedCount,
    ).toBe(2);
    expect(
      localStore.importProjectTasks(projectId, ["Billet 1", "Billet 2"]),
    ).toEqual({
      importedCount: 0,
      duplicateCount: 2,
      blankCount: 0,
      headerCount: 0,
      importedNames: [],
    });
  });

  it("can restore archived projects and tasks", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.createTeam("Local Team", "local-team", [
      {
        name: "Project Gemini",
        color: "#345678",
        tasks: [{ name: "Planning" }],
      },
    ]);

    const project = localStore.snapshot().projects[0];
    expect(project).toBeTruthy();

    const projectId = project!._id;
    const taskId = project!.tasks[0]!._id;

    localStore.archiveProjectTask(projectId, taskId);
    localStore.archiveProject(projectId);

    expect(localStore.snapshot().projects[0]?.status).toBe("archived");
    expect(localStore.snapshot().projects[0]?.tasks[0]?.status).toBe(
      "archived",
    );

    localStore.unarchiveProject(projectId);
    localStore.unarchiveProjectTask(projectId, taskId);

    expect(localStore.snapshot().projects[0]?.status).toBe("active");
    expect(localStore.snapshot().projects[0]?.tasks[0]).toMatchObject({
      status: "active",
      archivedAt: undefined,
    });
  });

  it("updates an existing imported Azure DevOps work item instead of creating a duplicate", async () => {
    const { localStore } = await import("../../lib/local-store");

    expect(
      localStore.importSyncedWorkItems([
        {
          id: "connector-initial",
          source: "azure_devops",
          connectionId: "ado-1",
          connectionLabel: "Main connection",
          tenantLabel: "Contoso",
          sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          externalId: "123",
          sourceUrl:
            "https://dev.azure.com/contoso/project/_workitems/edit/123",
          title: "Original title",
          note: "Original note",
          projectName: "Project Mercury",
          workItemType: "Task",
          state: "Active",
          assignedTo: "Ada Lovelace",
          priority: "low",
          depth: 0,
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: 1,
        },
      ]),
    ).toEqual({
      importedCount: 1,
      updatedCount: 0,
      archivedCount: 0,
    });

    const initialWorkItem = localStore.snapshot().workItems[0];
    expect(initialWorkItem?._id).toBeTruthy();

    expect(
      localStore.importSyncedWorkItems([
        {
          id: "connector-updated",
          source: "azure_devops",
          connectionId: "ado-1",
          connectionLabel: "Main connection",
          tenantLabel: "Contoso",
          sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          externalId: "123",
          sourceUrl:
            "https://dev.azure.com/contoso/project/_workitems/edit/123",
          title: "Updated title",
          note: "Updated note",
          projectName: "Project Mercury",
          workItemType: "Task",
          state: "Committed",
          assignedTo: "Ada Lovelace",
          priority: "medium",
          depth: 0,
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: 2,
        },
      ]),
    ).toEqual({
      importedCount: 0,
      updatedCount: 1,
      archivedCount: 0,
    });

    expect(localStore.snapshot().workItems).toHaveLength(1);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: initialWorkItem?._id,
      title: "Updated title",
      description: "Original note",
      sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
      sourceConnectionLabel: "Main connection",
      sourceProjectName: "Project Mercury",
      sourceWorkItemType: "Task",
      priority: 3,
      importedPriority: 3,
    });
  });

  it("keeps imported work items without priority empty instead of assigning one", async () => {
    const { localStore } = await import("../../lib/local-store");

    expect(
      localStore.importSyncedWorkItems([
        {
          id: "connector-empty-priority",
          source: "azure_devops",
          connectionId: "ado-1",
          connectionLabel: "Main connection",
          tenantLabel: "Contoso",
          sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/321",
          externalId: "321",
          sourceUrl:
            "https://dev.azure.com/contoso/project/_workitems/edit/321",
          title: "No priority from Azure",
          projectName: "Project Mercury",
          workItemType: "Task",
          state: "Active",
          assignedTo: "Ada Lovelace",
          depth: 0,
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: 3,
        },
      ]),
    ).toEqual({
      importedCount: 1,
      updatedCount: 0,
      archivedCount: 0,
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      title: "No priority from Azure",
      priority: undefined,
      importedPriority: undefined,
    });
  });

  it("allows clearing an existing work item priority", async () => {
    const { localStore } = await import("../../lib/local-store");

    const workItemId = localStore.addWorkItem({
      title: "Priority can be empty",
      priority: 4,
    });

    localStore.updateWorkItem(workItemId, { priority: undefined });

    expect(
      localStore
        .snapshot()
        .workItems.find((workItem) => workItem._id === workItemId),
    ).toMatchObject({
      _id: workItemId,
      priority: undefined,
    });
  });

  it("keeps a manually edited priority while refreshing the imported priority value", async () => {
    const { localStore } = await import("../../lib/local-store");

    localStore.importSyncedWorkItems([
      {
        id: "connector-initial-priority",
        source: "azure_devops",
        connectionId: "ado-1",
        connectionLabel: "Main connection",
        tenantLabel: "Contoso",
        sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/777",
        externalId: "777",
        sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/777",
        title: "Imported task",
        projectName: "Project Mercury",
        workItemType: "Task",
        state: "Active",
        assignedTo: "Ada Lovelace",
        priority: "low",
        depth: 0,
        selectable: true,
        selected: true,
        childCount: 0,
        pushedAt: 4,
      },
    ]);

    const importedWorkItem = localStore.snapshot().workItems[0];
    expect(importedWorkItem?._id).toBeTruthy();

    localStore.updateWorkItem(importedWorkItem!._id, { priority: 2 });
    localStore.importSyncedWorkItems([
      {
        id: "connector-updated-priority",
        source: "azure_devops",
        connectionId: "ado-1",
        connectionLabel: "Main connection",
        tenantLabel: "Contoso",
        sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/777",
        externalId: "777",
        sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/777",
        title: "Imported task",
        projectName: "Project Mercury",
        workItemType: "Task",
        state: "Active",
        assignedTo: "Ada Lovelace",
        priority: "medium",
        depth: 0,
        selectable: true,
        selected: true,
        childCount: 0,
        pushedAt: 5,
      },
    ]);

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedWorkItem?._id,
      priority: 2,
      importedPriority: 3,
    });
  });
});
