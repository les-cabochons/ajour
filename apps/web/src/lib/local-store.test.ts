import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockedWeekMessage } from "@/domain/time/locked-weeks";

function installMockWindow() {
  const storage = new Map<string, string>();
  const sessionStorage = new Map<string, string>();

  function createStorage(target: Map<string, string>) {
    return {
      get length() {
        return target.size;
      },
      key: vi.fn((index: number) => Array.from(target.keys())[index] ?? null),
      getItem: vi.fn((key: string) => target.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        target.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        target.delete(key);
      }),
      clear: vi.fn(() => {
        target.clear();
      }),
    };
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(storage),
      sessionStorage: createStorage(sessionStorage),
    },
  });
}

function buildImportCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "connector-1",
    source: "azure_devops" as const,
    connectionId: "ado-1",
    connectionLabel: "Main connection",
    tenantLabel: "Contoso",
    sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/101",
    externalId: "101",
    sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/101",
    title: "Imported work item",
    projectName: "Project Mercury",
    workItemType: "Task",
    state: "Active",
    assignedTo: "Ada Lovelace",
    priority: "high" as const,
    originalEstimateHours: 12,
    remainingEstimateHours: 8,
    completedEstimateHours: 4,
    depth: 0 as const,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: 1,
    ...overrides,
  };
}

describe("localStore workflow state sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("persists closure and a saved running entry when a workflow state becomes Done", async () => {
    const { localStore } = await import("./local-store");
    const doing = localStore.addWorkflowState("Doing", "#d97706");
    const itemId = localStore.addWorkItem({
      title: "Occupied state",
      workflowStateId: doing,
    });
    localStore.startTimer({ workItemId: itemId, note: "Flag change" });
    const startedAt = localStore.snapshot().timers[0]!.startedAt;
    vi.spyOn(Date, "now").mockReturnValue(startedAt + 600);
    try {
      localStore.updateWorkflowState(doing, { name: "Doing", done: true });
      const stored = JSON.parse(
        window.localStorage.getItem("ajour.local-state.v2")!,
      );
      expect(
        stored.workItems.find((item: { _id: string }) => item._id === itemId),
      ).toMatchObject({ status: "archived", workflowStateId: doing });
      expect(stored.timers).toEqual([]);
      expect(stored.timesheetEntries).toEqual([
        expect.objectContaining({ workItemId: itemId, durationMs: 600 }),
      ]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("rechecks Done lifecycle after a failed Settle write restores the same workflow", async () => {
    const { localStore } = await import("./local-store");
    const doing = localStore.addWorkflowState("Doing", "#d97706");
    for (const sourceStatusKey of ["active", "waiting"]) {
      localStore.setWorkflowStateMapping({
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey,
        workflowStateId: doing,
      });
    }
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.settleWorkItem(id, { state: { name: "Waiting", done: false } });
    localStore.updateWorkflowState(doing, { name: "Doing", done: true });
    expect(localStore.snapshot().workItems[0]?.status).toBe("archived");
    localStore.failSourceWrite(id);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: doing,
      sourceStatusLabel: "Active",
    });
    expect(
      localStore.snapshot().workItems[0]?.pendingSourceWrite,
    ).toBeUndefined();
    vi.resetModules();
    const reloaded = (await import("./local-store")).localStore;
    expect(reloaded.snapshot().workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: doing,
    });
    reloaded.restoreWorkItem(id);
    expect(reloaded.snapshot().workItems[0]?.workflowStateId).toBeUndefined();
  });

  it.each(["clear", "delete"])(
    "returns a missing-sync archive after %s of its temporary Done state",
    async (change) => {
      const { localStore } = await import("./local-store");
      const doing = localStore.addWorkflowState("Doing", "#d97706");
      localStore.setWorkflowStateMapping({
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "active",
        workflowStateId: doing,
      });
      localStore.importSyncedWorkItems([buildImportCandidate()]);
      localStore.importSyncedWorkItems([], {
        archiveMissingFromConnectionId: "ado-1",
      });
      localStore.updateWorkflowState(doing, { name: "Doing", done: true });
      if (change === "clear")
        localStore.updateWorkflowState(doing, { name: "Doing", done: false });
      else localStore.deleteWorkflowState(doing);
      expect(localStore.snapshot().workItems[0]).toMatchObject({
        status: "archived",
        archivedByMissingSync: true,
      });
      expect(localStore.snapshot().workItems[0]?.workflowStateId).toBe(
        change === "clear" ? doing : undefined,
      );
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore;
      reloaded.importSyncedWorkItems([buildImportCandidate()]);
      expect(reloaded.snapshot().workItems[0]).toMatchObject({
        status: "active",
        archivedByMissingSync: false,
      });
      expect(reloaded.snapshot().workItems[0]?.workflowStateId).toBe(
        change === "clear" ? doing : undefined,
      );
      expect(reloaded.snapshot().workItems[0]?.importedWorkflowStateId).toBe(
        change === "clear" ? doing : undefined,
      );
    },
  );

  it("keeps an explicit project-level unmapped override after reload", async () => {
    const { localStore } = await import("./local-store");
    const workflowStateId = localStore.snapshot().workflowStates[0]!._id;
    const key = {
      source: "azure_devops" as const,
      connectionId: "c",
      sourceStatusKey: "active",
    };
    localStore.setWorkflowStateMapping({ ...key, workflowStateId });
    localStore.setWorkflowStateMapping({
      ...key,
      sourceProjectName: "Mercury",
      workflowStateId: null,
    });
    vi.resetModules();
    const reloaded = (await import("./local-store")).localStore.snapshot();
    expect(
      reloaded.workflowStateMappings.find(
        (mapping) => mapping.sourceProjectName === "Mercury",
      )?.workflowStateId,
    ).toBeNull();
  });

  it("defaults update checks to the stable release track", async () => {
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().userPreferences.updateTrack).toBe("stable");
    expect(localStore.snapshot().userPreferences.projectDataShapeId).toBe(
      "default",
    );
    expect(localStore.snapshot().userPreferences).toMatchObject({
      weeklyTimeViewStyle: "grid",
      weeklyCapacityTargets: {
        monday: 8 * 60 * 60 * 1000,
        friday: 8 * 60 * 60 * 1000,
        saturday: 0,
        sunday: 0,
      },
      warnWhenOverCapacity: true,
      warnWhenSubmittingUnderCapacity: true,
    });
  });

  it("keeps a pending reopen and its Undo through done and missing sync processing", async () => {
    const { localStore } = await import("./local-store");
    const openId = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    localStore.setWorkflowStateMapping({
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "active",
      workflowStateId: openId,
    });
    const candidate = buildImportCandidate({
      state: "Closed",
      stateDone: true,
    });
    localStore.importSyncedWorkItems([candidate]);
    const closed = localStore.snapshot().workItems[0]!;
    expect(closed.status).toBe("archived");
    const token = localStore.moveWorkItemToState(closed._id, openId, {
      sourceWrites: { [closed._id]: "Active" },
    });
    const pending = localStore.snapshot().workItems[0]!;
    expect(pending.status).toBe("active");
    expect(pending.pendingSourceWrite?.state).toBe("Active");
    localStore.importSyncedWorkItems([candidate]);
    expect(localStore.snapshot().workItems[0]).toEqual(pending);
    expect(
      localStore.archiveDoneSyncedWorkItems([
        {
          source: candidate.source,
          connectionId: candidate.connectionId,
          sourceId: candidate.sourceId,
          state: "Closed",
        },
      ]),
    ).toBe(0);
    localStore.importSyncedWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });
    expect(localStore.snapshot().workItems[0]).toEqual(pending);
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().workItems[0]).toEqual(closed);
    expect(
      localStore.snapshot().workItems[0]?.pendingSourceWrite,
    ).toBeUndefined();
  });

  it.each(["failure", "undo", "independent edit"])(
    "advances an in-flight close's recovery snapshot before replacement %s",
    async (outcome) => {
      const { localStore } = await import("./local-store");
      const openId = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const doneId = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      for (const [sourceStatusKey, workflowStateId] of [
        ["active", openId],
        ["closed", doneId],
      ] as const)
        localStore.setWorkflowStateMapping({
          source: "azure_devops",
          connectionId: "ado-1",
          sourceStatusKey,
          workflowStateId,
        });
      localStore.importSyncedWorkItems([buildImportCandidate()]);
      const parentId = localStore.snapshot().workItems[0]!._id;
      const childId = localStore.addSubtask(parentId, {
        title: "Manual child",
      });
      localStore.moveWorkItemToState(parentId, doneId, {
        includeSubitems: true,
        sourceWrites: { [parentId]: "Closed" },
      });
      const sentItems = localStore.snapshot().workItems;
      const closed = sentItems.find((item) => item._id === parentId)!;
      const closedChild = sentItems.find((item) => item._id === childId)!;
      const token = localStore.moveWorkItemToState(parentId, openId, {
        sourceWrites: { [parentId]: "Active" },
      });
      if (outcome === "independent edit")
        localStore.updateWorkItem(parentId, {
          description: "Keep my later edit",
        });
      if (outcome === "failure")
        localStore.updateWorkItem(childId, {
          description: "Keep the child's later edit",
        });
      const readyAt = localStore
        .snapshot()
        .workItems.find((item) => item._id === parentId)
        ?.pendingSourceWrite?.readyAt;
      localStore.completeSourceWrite(parentId, sentItems);
      const replacement = localStore
        .snapshot()
        .workItems.find((item) => item._id === parentId)!;
      expect(replacement).toMatchObject({
        status: "active",
        workflowStateId: openId,
        sourceStatusLabel: "Active",
      });
      expect(replacement.pendingSourceWrite).toMatchObject({
        state: "Active",
        readyAt,
        previous: {
          sourceStatusLabel: "Closed",
          workflowStateId: doneId,
          lifecycle: { status: "archived" },
        },
      });
      if (outcome === "independent edit") {
        expect(localStore.undo(token!)).toBe("stale");
        expect(
          localStore.snapshot().workItems.find((item) => item._id === parentId)
            ?.description,
        ).toBe("Keep my later edit");
        return;
      }
      if (outcome === "undo") expect(localStore.undo(token!)).toBe("restored");
      else localStore.failSourceWrite(parentId);
      expect(
        localStore.snapshot().workItems.find((item) => item._id === parentId),
      ).toEqual({ ...closed, pendingSourceWrite: undefined });
      const child = localStore
        .snapshot()
        .workItems.find((item) => item._id === childId)!;
      expect(child).toEqual(
        outcome === "undo"
          ? closedChild
          : { ...closedChild, description: "Keep the child's later edit" },
      );
    },
  );

  it.each(["Done", "Open", "Unmapped"] as const)(
    "applies a deferred %s mapping when the source write succeeds",
    async (destination) => {
      const { localStore } = await import("./local-store");
      const review = localStore.addWorkflowState("Review");
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const done = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "In QA",
        sourceProjectName: "Project Mercury",
      };
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: review,
      });
      localStore.importSyncedWorkItems([buildImportCandidate()]);
      const id = localStore.snapshot().workItems[0]!._id;
      localStore.moveWorkItemToState(id, review, {
        sourceWrites: { [id]: "In QA" },
      });
      const sent = localStore.snapshot().workItems;
      localStore.startTimer({ workItemId: id, accumulatedDurationMs: 60000 });
      const mappedId =
        destination === "Done"
          ? done
          : destination === "Open"
            ? open
            : undefined;
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: mappedId ?? null,
      });
      expect(localStore.snapshot().workItems[0]).toMatchObject({
        workflowStateId: review,
        importedWorkflowStateId: review,
        pendingSourceWrite: expect.any(Object),
      });
      localStore.completeSourceWrite(id, sent);
      const acknowledged = localStore.snapshot();
      expect(acknowledged.workItems[0]).toMatchObject({
        workflowStateId: mappedId,
        importedWorkflowStateId: mappedId,
        status: destination === "Done" ? "archived" : "active",
        pendingSourceWrite: undefined,
        sourceStatusLabel: "In QA",
      });
      if (destination === "Done") {
        expect(acknowledged.workItems[0]?.workflowStateIdBeforeClose).toBe(
          review,
        );
        expect(acknowledged.timers).toEqual([]);
        expect(acknowledged.timesheetEntries).toEqual([
          expect.objectContaining({
            workItemId: id,
            durationMs: expect.any(Number),
          }),
        ]);
      } else {
        expect(acknowledged.timers).toHaveLength(1);
        expect(acknowledged.timesheetEntries).toEqual([]);
      }
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore.snapshot();
      expect(reloaded.workItems[0]?.workflowStateId).toBe(mappedId);
      expect(reloaded.workItems[0]?.status).toBe(
        destination === "Done" ? "archived" : "active",
      );
    },
  );

  it.each(["Done", "Open", "Unmapped"] as const)(
    "applies a deferred %s mapping after the source write fails",
    async (destination) => {
      const { localStore } = await import("./local-store");
      const review = localStore.addWorkflowState("Review");
      const writing = localStore.addWorkflowState("Writing");
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const done = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
        sourceProjectName: "Project Mercury",
      };
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: review,
      });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "In QA",
        workflowStateId: writing,
      });
      localStore.importSyncedWorkItems([buildImportCandidate()]);
      const id = localStore.snapshot().workItems[0]!._id;
      localStore.moveWorkItemToState(id, writing, {
        sourceWrites: { [id]: "In QA" },
      });
      localStore.startTimer({ workItemId: id, accumulatedDurationMs: 60000 });
      const mappedId =
        destination === "Done"
          ? done
          : destination === "Open"
            ? open
            : undefined;
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: mappedId ?? null,
      });
      expect(localStore.snapshot().workItems[0]).toMatchObject({
        workflowStateId: writing,
        importedWorkflowStateId: writing,
        pendingSourceWrite: expect.any(Object),
      });
      localStore.failSourceWrite(id);
      const acknowledged = localStore.snapshot();
      expect(acknowledged.workItems[0]).toMatchObject({
        workflowStateId: mappedId,
        importedWorkflowStateId: mappedId,
        status: destination === "Done" ? "archived" : "active",
        pendingSourceWrite: undefined,
        sourceStatusLabel: "Active",
      });
      if (destination === "Done") {
        expect(acknowledged.workItems[0]?.workflowStateIdBeforeClose).toBe(
          review,
        );
        expect(acknowledged.timers).toEqual([]);
        expect(acknowledged.timesheetEntries).toEqual([
          expect.objectContaining({
            workItemId: id,
            durationMs: expect.any(Number),
          }),
        ]);
      } else {
        expect(acknowledged.timers).toHaveLength(1);
        expect(acknowledged.timesheetEntries).toEqual([]);
      }
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore.snapshot();
      expect(reloaded.workItems[0]?.workflowStateId).toBe(mappedId);
      expect(reloaded.workItems[0]?.status).toBe(
        destination === "Done" ? "archived" : "active",
      );
    },
  );

  it("keeps a newer write protected when an older write succeeds after remapping", async () => {
    const { localStore } = await import("./local-store");
    const review = localStore.addWorkflowState("Review");
    const working = localStore.addWorkflowState("Working");
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!._id;
    const mapping = {
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "In QA",
    };
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: review });
    localStore.setWorkflowStateMapping({
      ...mapping,
      sourceStatusKey: "Working",
      workflowStateId: working,
    });
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.moveWorkItemToState(id, review, {
      sourceWrites: { [id]: "In QA" },
    });
    const sent = localStore.snapshot().workItems;
    localStore.moveWorkItemToState(id, working, {
      sourceWrites: { [id]: "Working" },
    });
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: done });
    localStore.completeSourceWrite(id, sent);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: working,
      importedWorkflowStateId: working,
      pendingSourceWrite: {
        state: "Working",
        previous: { sourceStatusLabel: "In QA" },
      },
    });
    localStore.completeSourceWrite(id, localStore.snapshot().workItems);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: working,
      pendingSourceWrite: undefined,
    });
  });

  it("reconciles carried children when the parent's final write releases them", async () => {
    const { localStore } = await import("./local-store");
    const open = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!._id;
    const review = localStore.addWorkflowState("Review");
    const mapping = {
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "Active",
    };
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: open });
    localStore.setWorkflowStateMapping({
      ...mapping,
      sourceStatusKey: "Closed",
      workflowStateId: done,
    });
    const parent = buildImportCandidate();
    const child = buildImportCandidate({
      id: "child",
      sourceId: "child-source",
      parentSourceId: parent.sourceId,
      depth: 1,
    });
    localStore.importSyncedWorkItems([parent, child]);
    const parentId = localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
    const childId = localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === child.sourceId)!._id;
    localStore.moveWorkItemToState(parentId, done, {
      includeSubitems: true,
      sourceWrites: { [parentId]: "Closed" },
    });
    const sent = localStore.snapshot().workItems;
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: review });
    expect(
      localStore.snapshot().workItems.find((item) => item._id === childId)
        ?.importedWorkflowStateId,
    ).toBe(open);
    localStore.completeSourceWrite(parentId, sent);
    expect(
      localStore.snapshot().workItems.find((item) => item._id === childId),
    ).toMatchObject({
      status: "archived",
      workflowStateId: done,
      importedWorkflowStateId: review,
    });
    expect(
      localStore.snapshot().workItems.find((item) => item._id === parentId),
    ).toMatchObject({
      status: "archived",
      workflowStateId: done,
      pendingSourceWrite: undefined,
    });
  });

  it("preserves a local workflow override when a priority write releases mapping protection", async () => {
    const { localStore } = await import("./local-store");
    const review = localStore.addWorkflowState("Review");
    const open = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!._id;
    const mapping = {
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "Active",
    };
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: review });
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.updateWorkItem(id, { workflowStateId: open });
    localStore.settleWorkItem(id, { priority: 1 });
    const sent = localStore.snapshot().workItems;
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: done });
    localStore.completeSourceWrite(id, sent);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "settled",
      workflowStateId: open,
      importedWorkflowStateId: done,
      importedPriority: 1,
      pendingSourceWrite: undefined,
    });
  });

  it.each([false, true])(
    "applies deferred child mappings after parent failure, with independent child write %s",
    async (childWrites) => {
      const { localStore } = await import("./local-store");
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const done = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const review = localStore.addWorkflowState("Review");
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
      };
      localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: open });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "Closed",
        workflowStateId: done,
      });
      const parent = buildImportCandidate();
      const child = buildImportCandidate({
        id: "child",
        sourceId: "child-source",
        parentSourceId: parent.sourceId,
        depth: 1,
      });
      localStore.importSyncedWorkItems([parent, child]);
      const parentId = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
      const childId = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === child.sourceId)!._id;
      localStore.moveWorkItemToState(parentId, done, {
        includeSubitems: true,
        sourceWrites: {
          [parentId]: "Closed",
          ...(childWrites ? { [childId]: "Closed" } : {}),
        },
      });
      localStore.updateWorkItem(childId, {
        description: "Later independent edit",
      });
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: review,
      });
      localStore.failSourceWrite(parentId);
      expect(
        localStore.snapshot().workItems.find((item) => item._id === parentId),
      ).toMatchObject({
        status: "active",
        workflowStateId: review,
        importedWorkflowStateId: review,
        pendingSourceWrite: undefined,
      });
      const recoveredChild = localStore
        .snapshot()
        .workItems.find((item) => item._id === childId)!;
      expect(recoveredChild).toMatchObject({
        status: childWrites ? "archived" : "active",
        workflowStateId: childWrites ? done : review,
        description: "Later independent edit",
      });
      if (childWrites) {
        expect(recoveredChild.pendingSourceWrite?.state).toBe("Closed");
        localStore.failSourceWrite(childId);
      }
      expect(
        localStore.snapshot().workItems.find((item) => item._id === childId),
      ).toMatchObject({
        status: "active",
        workflowStateId: review,
        importedWorkflowStateId: review,
        description: "Later independent edit",
      });
      expect(
        localStore.snapshot().workItems.find((item) => item._id === childId)
          ?.pendingSourceWrite,
      ).toBeUndefined();
    },
  );

  it("preserves a local workflow override after a failed priority write releases mapping protection", async () => {
    const { localStore } = await import("./local-store");
    const review = localStore.addWorkflowState("Review");
    const open = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    const done = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!._id;
    const mapping = {
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "Active",
    };
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: review });
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.updateWorkItem(id, { workflowStateId: open });
    localStore.settleWorkItem(id, { priority: 1 });
    localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: done });
    localStore.failSourceWrite(id);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: open,
      importedWorkflowStateId: done,
      importedPriority: 2,
      pendingSourceWrite: undefined,
    });
  });

  it.each([
    [false, "failure"],
    [true, "failure"],
    [false, "undo"],
    [true, "undo"],
  ] as const)(
    "closes recovery into a newly Done state, carrying children %s via %s",
    async (includeSubitems, recovery) => {
      const { localStore } = await import("./local-store");
      const original = localStore.addWorkflowState("Original");
      const review = localStore.addWorkflowState("Review");
      const done = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
      };
      localStore.setWorkflowStateMapping({
        ...mapping,
        workflowStateId: original,
      });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "In QA",
        workflowStateId: review,
      });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "Closed",
        workflowStateId: done,
      });
      const parent = buildImportCandidate();
      const child = buildImportCandidate({
        id: "child",
        sourceId: "child-source",
        parentSourceId: parent.sourceId,
        depth: 1,
      });
      localStore.importSyncedWorkItems(
        includeSubitems ? [parent, child] : [parent],
      );
      const id = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
      localStore.startTimer({ workItemId: id, accumulatedDurationMs: 60000 });
      const token = localStore.moveWorkItemToState(
        id,
        includeSubitems ? done : review,
        {
          includeSubitems,
          sourceWrites: { [id]: includeSubitems ? "Closed" : "In QA" },
        },
      );
      localStore.updateWorkflowState(original, {
        name: "Original",
        done: true,
      });
      expect(
        localStore.snapshot().workItems.find((item) => item._id === id),
      ).toMatchObject({
        workflowStateId: includeSubitems ? done : review,
        pendingSourceWrite: expect.any(Object),
      });
      expect(localStore.snapshot().timers).toHaveLength(
        includeSubitems ? 0 : 1,
      );
      if (recovery === "failure") localStore.failSourceWrite(id);
      else expect(localStore.undo(token!)).toBe("restored");
      for (const item of localStore.snapshot().workItems) {
        expect(item).toMatchObject({
          status: "archived",
          workflowStateId: original,
          importedWorkflowStateId: original,
        });
        expect(item.pendingSourceWrite).toBeUndefined();
        expect(item.workflowStateIdBeforeClose).toBeUndefined();
      }
      expect(localStore.snapshot().timers).toEqual([]);
      expect(localStore.snapshot().timesheetEntries).toHaveLength(1);
      expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
        workItemId: id,
        durationMs: expect.any(Number),
      });
      expect(
        localStore.snapshot().timesheetEntries[0]!.durationMs,
      ).toBeGreaterThanOrEqual(60000);
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore.snapshot();
      expect(
        reloaded.workItems.every(
          (item) =>
            item.status === "archived" && item.workflowStateId === original,
        ),
      ).toBe(true);
      expect(reloaded.timers).toEqual([]);
      expect(reloaded.timesheetEntries).toHaveLength(1);
    },
  );

  it.each([
    [false, "failure"],
    [true, "failure"],
    [false, "undo"],
    [true, "undo"],
  ] as const)(
    "moves recovered archives to a remaining Done state, carrying children %s via %s",
    async (includeSubitems, recovery) => {
      const { localStore } = await import("./local-store");
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const replacement = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const original = localStore.addWorkflowState("Original done");
      localStore.updateWorkflowState(original, {
        name: "Original done",
        done: true,
      });
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
      };
      localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: open });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "Closed",
        workflowStateId: original,
      });
      const parent = buildImportCandidate();
      const child = buildImportCandidate({
        id: "child",
        sourceId: "child-source",
        parentSourceId: parent.sourceId,
        depth: 1,
      });
      localStore.importSyncedWorkItems(
        includeSubitems ? [parent, child] : [parent],
      );
      const id = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
      const childId = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === child.sourceId)?._id;
      localStore.moveWorkItemToState(id, original, {
        includeSubitems,
        sourceWrites: {
          [id]: "Closed",
          ...(childId ? { [childId]: "Closed" } : {}),
        },
      });
      localStore.completeSourceWrite(id);
      if (childId) localStore.completeSourceWrite(childId);
      const token = localStore.moveWorkItemToState(id, open, {
        sourceWrites: { [id]: "Active" },
      });
      expect(
        localStore
          .snapshot()
          .workItems.every((item) => item.status === "active"),
      ).toBe(true);
      localStore.startTimer({ workItemId: id, accumulatedDurationMs: 60000 });
      localStore.updateWorkflowState(original, {
        name: "Original done",
        done: false,
      });
      if (recovery === "failure") localStore.failSourceWrite(id);
      else expect(localStore.undo(token!)).toBe("restored");
      for (const item of localStore.snapshot().workItems) {
        expect(item).toMatchObject({
          status: "archived",
          workflowStateId: replacement,
          workflowStateIdBeforeClose: open,
          sourceStatusKey: "closed",
          archivedSourceStatusKey: "closed",
        });
        expect(item.pendingSourceWrite).toBeUndefined();
      }
      expect(localStore.snapshot().timers).toEqual([]);
      expect(localStore.snapshot().timesheetEntries).toEqual([
        expect.objectContaining({
          workItemId: id,
          durationMs: expect.any(Number),
        }),
      ]);
      expect(
        localStore.snapshot().timesheetEntries[0]!.durationMs,
      ).toBeGreaterThanOrEqual(60000);
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore;
      expect(
        reloaded
          .snapshot()
          .workItems.every(
            (item) =>
              item.status === "archived" &&
              item.workflowStateId === replacement,
          ),
      ).toBe(true);
      reloaded.restoreWorkItem(id);
      expect(
        reloaded
          .snapshot()
          .workItems.every(
            (item) => item.status === "active" && item.workflowStateId === open,
          ),
      ).toBe(true);
    },
  );

  it.each(["failure", "undo"] as const)(
    "keeps a missing-sync archive in its open state after %s recovery",
    async (recovery) => {
      const { localStore } = await import("./local-store");
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const review = localStore.addWorkflowState("Review");
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
      };
      localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: open });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "In QA",
        workflowStateId: review,
      });
      localStore.importSyncedWorkItems([buildImportCandidate()]);
      const id = localStore.snapshot().workItems[0]!._id;
      localStore.importSyncedWorkItems([], {
        archiveMissingFromConnectionId: "ado-1",
      });
      expect(localStore.snapshot().workItems[0]).toMatchObject({
        status: "archived",
        archivedByMissingSync: true,
        workflowStateId: open,
      });
      const token = localStore.moveWorkItemToState(id, review, {
        sourceWrites: { [id]: "In QA" },
      });
      if (recovery === "failure") localStore.failSourceWrite(id);
      else expect(localStore.undo(token!)).toBe("restored");
      expect(localStore.snapshot().workItems[0]).toMatchObject({
        status: "archived",
        archivedByMissingSync: true,
        workflowStateId: open,
      });
      expect(
        localStore.snapshot().workItems[0]?.pendingSourceWrite,
      ).toBeUndefined();
    },
  );

  it.each([
    ["missing", "none"],
    ["missing", "synced"],
    ["explicit", "none"],
    ["explicit", "manual"],
    ["legacy unknown", "none"],
    ["modern unknown", "none"],
    ["markerless explicit", "none"],
    ["markerless missing", "none"],
  ] as const)(
    "restores %s archives with %s children after hydrating recovery snapshots",
    async (archiveKind, children) => {
      const { localStore } = await import("./local-store");
      const isMissing =
        archiveKind === "missing" || archiveKind === "markerless missing";
      const open = localStore
        .snapshot()
        .workflowStates.find((state) => !state.done)!._id;
      const replacement = localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id;
      const oldDone = localStore.addWorkflowState("Old done");
      const review = localStore.addWorkflowState("Review");
      localStore.updateWorkflowState(oldDone, { name: "Old done", done: true });
      const mapping = {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: "Active",
      };
      localStore.setWorkflowStateMapping({ ...mapping, workflowStateId: open });
      localStore.setWorkflowStateMapping({
        ...mapping,
        sourceStatusKey: "In QA",
        workflowStateId: review,
      });
      const parent = buildImportCandidate();
      const child = buildImportCandidate({
        id: "child",
        sourceId: "child-source",
        parentSourceId: parent.sourceId,
        depth: 1,
      });
      localStore.importSyncedWorkItems(
        children === "synced" ? [parent, child] : [parent],
      );
      const id = localStore
        .snapshot()
        .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
      if (children === "manual")
        localStore.addSubtask(id, {
          title: "Manual child",
          workflowStateId: open,
        });
      if (
        archiveKind.endsWith("unknown") ||
        archiveKind.startsWith("markerless")
      )
        localStore.updateWorkItem(id, {
          sourceStatusKey: undefined,
          sourceStatusLabel: undefined,
          importedWorkflowStateId: undefined,
          ...(archiveKind === "modern unknown" ||
          archiveKind.startsWith("markerless")
            ? { workflowStateId: undefined }
            : {}),
        });
      if (isMissing) {
        localStore.settleWorkItem(id, undefined, { includeSubitems: true });
        localStore.importSyncedWorkItems([], {
          archiveMissingFromConnectionId: "ado-1",
        });
      } else {
        localStore.moveWorkItemToState(id, oldDone, { includeSubitems: true });
      }
      localStore.moveWorkItemToState(id, review, {
        sourceWrites: { [id]: "In QA" },
      });
      if (!isMissing)
        localStore.updateWorkflowState(oldDone, {
          name: "Old done",
          done: false,
        });
      const legacy = structuredClone(localStore.snapshot());
      for (const item of legacy.workItems) {
        const previous = item.pendingSourceWrite?.previous;
        if (previous?.lifecycle && archiveKind !== "modern unknown")
          delete previous.lifecycle.archivedByMissingSync;
        for (const snapshot of previous?.carriedChildren ?? []) {
          delete snapshot.before.archivedByMissingSync;
          delete snapshot.after.archivedByMissingSync;
        }
      }
      // JSON property order must not affect whether a carried snapshot matches.
      window.localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify(legacy, (key: string, value: unknown) =>
          key === "after" && typeof value === "object" && value !== null
            ? Object.fromEntries(Object.entries(value).reverse())
            : value,
        ),
      );
      vi.resetModules();
      const reloaded = (await import("./local-store")).localStore;
      expect(
        reloaded.snapshot().workItems.find((item) => item._id === id)
          ?.pendingSourceWrite?.previous.lifecycle?.archivedByMissingSync,
      ).toBe(isMissing);
      reloaded.failSourceWrite(id);
      for (const item of reloaded.snapshot().workItems) {
        expect(item).toMatchObject({
          status: "archived",
          archivedByMissingSync: isMissing,
          workflowStateId: isMissing
            ? archiveKind === "markerless missing"
              ? undefined
              : open
            : replacement,
        });
        expect(item.pendingSourceWrite).toBeUndefined();
      }
      vi.resetModules();
      const restarted = (await import("./local-store")).localStore;
      if (isMissing)
        restarted.importSyncedWorkItems(
          children === "synced" ? [parent, child] : [parent],
        );
      else restarted.restoreWorkItem(id);
      expect(
        restarted
          .snapshot()
          .workItems.every(
            (item) =>
              item.status === "active" &&
              item.workflowStateId ===
                (archiveKind === "modern unknown" ||
                archiveKind === "markerless explicit"
                  ? undefined
                  : open),
          ),
      ).toBe(true);
    },
  );

  it("recovers the last successful priority write when its replacement fails", async () => {
    const { localStore } = await import("./local-store");
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.settleWorkItem(id, { priority: 1 });
    const sentItems = localStore.snapshot().workItems;
    localStore.unsettleWorkItem(id);
    localStore.settleWorkItem(id, { priority: 4 });
    localStore.completeSourceWrite(id, sentItems);
    expect(
      localStore.snapshot().workItems[0]?.pendingSourceWrite?.priority,
    ).toBe(4);
    localStore.failSourceWrite(id);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "settled",
      importedPriority: 1,
      priority: 1,
      pendingSourceWrite: undefined,
    });
  });

  it("recovers the last successful open workflow state after a replacement fails", async () => {
    const { localStore } = await import("./local-store");
    const workingId = localStore.addWorkflowState("Working");
    const reviewId = localStore.addWorkflowState("Reviewing");
    for (const [label, workflowStateId] of [
      ["Working", workingId],
      ["Reviewing", reviewId],
    ] as const)
      localStore.setWorkflowStateMapping({
        source: "azure_devops",
        connectionId: "ado-1",
        sourceStatusKey: label,
        workflowStateId,
      });
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const id = localStore.snapshot().workItems[0]!._id;
    localStore.moveWorkItemToState(id, workingId, {
      sourceWrites: { [id]: "Working" },
    });
    const sentItems = localStore.snapshot().workItems;
    localStore.moveWorkItemToState(id, reviewId, {
      sourceWrites: { [id]: "Reviewing" },
    });
    localStore.completeSourceWrite(id, sentItems);
    localStore.failSourceWrite(id);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: workingId,
      importedWorkflowStateId: workingId,
      sourceStatusLabel: "Working",
      pendingSourceWrite: undefined,
    });
  });

  it.each(["settings", "import", "done items"])(
    "closes existing items and saves their timer when %s automatically maps to Done",
    async (path) => {
      const { localStore } = await import("./local-store");
      const candidate = buildImportCandidate({ state: "Resolved" });
      localStore.importSyncedWorkItems([candidate]);
      const item = localStore.snapshot().workItems[0]!;
      expect(item.workflowStateId).toBeUndefined();
      localStore.startTimer({
        workItemId: item._id,
        accumulatedDurationMs: 60000,
      });
      if (path === "settings") {
        localStore.autoMapSourceStates([
          {
            source: candidate.source,
            connectionId: candidate.connectionId,
            label: "Resolved",
            done: true,
          },
        ]);
      } else if (path === "import") {
        localStore.importSyncedWorkItems([
          buildImportCandidate({ state: "Resolved", stateDone: true }),
        ]);
      } else {
        expect(
          localStore.archiveDoneSyncedWorkItems([
            {
              source: candidate.source,
              connectionId: candidate.connectionId,
              sourceId: "another-item",
              state: "Resolved",
            },
          ]),
        ).toBe(1);
      }
      const snapshot = localStore.snapshot();
      const doneId = snapshot.workflowStates.find((state) => state.done)!._id;
      expect(snapshot.workItems[0]).toMatchObject({
        status: "archived",
        workflowStateId: doneId,
        importedWorkflowStateId: doneId,
      });
      expect(snapshot.timers).toHaveLength(0);
      expect(snapshot.timesheetEntries).toEqual([
        expect.objectContaining({
          workItemId: item._id,
          durationMs: expect.any(Number),
        }),
      ]);
      expect(snapshot.timesheetEntries[0]!.durationMs).toBeGreaterThanOrEqual(
        60000,
      );
    },
  );

  it("preserves carried children and reconciles deferred mappings when a parent reopen is undone", async () => {
    const { localStore } = await import("./local-store");
    const openId = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    const doneId = localStore
      .snapshot()
      .workflowStates.find((state) => state.done)!._id;
    localStore.setWorkflowStateMapping({
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "active",
      workflowStateId: openId,
    });
    const parent = buildImportCandidate();
    const child = buildImportCandidate({
      id: "child-candidate",
      sourceId: "child-source",
      depth: 1,
      parentSourceId: parent.sourceId,
    });
    localStore.importSyncedWorkItems([parent, child]);
    const parentId = localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === parent.sourceId)!._id;
    const childId = localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === child.sourceId)!._id;
    localStore.moveWorkItemToState(parentId, doneId, {
      includeSubitems: true,
      sourceWrites: { [parentId]: "Closed", [childId]: "Closed" },
    });
    localStore.completeSourceWrite(parentId);
    localStore.completeSourceWrite(childId);
    const closed = localStore.snapshot().workItems;
    expect(
      closed.find((item) => item._id === childId)?.settledWithParentId,
    ).toBe(parentId);
    const token = localStore.moveWorkItemToState(parentId, openId, {
      sourceWrites: { [parentId]: "Active" },
    });
    const pending = localStore.snapshot().workItems;
    expect(pending.find((item) => item._id === childId)).toMatchObject({
      status: "active",
      pendingSourceWrite: undefined,
    });
    localStore.importSyncedWorkItems(
      [parent, child].map((item) => ({
        ...item,
        state: "Closed",
        stateDone: true,
      })),
    );
    expect(localStore.snapshot().workItems).toEqual(pending);
    localStore.archiveDoneSyncedWorkItems(
      [parent, child].map((item) => ({
        source: item.source,
        connectionId: item.connectionId,
        sourceId: item.sourceId,
        state: "Closed",
      })),
    );
    localStore.importSyncedWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });
    expect(localStore.snapshot().workItems).toEqual(pending);
    expect(localStore.undo(token!)).toBe("restored");
    // The protected sync introduced Closed's Done mapping. Undo restores the
    // archive and refreshes its imported baseline without changing other fields.
    expect(localStore.snapshot().workItems).toEqual(
      closed.map((item) => ({ ...item, importedWorkflowStateId: doneId })),
    );
  });

  it("preserves a local open-state override when automatic mapping discovers Done", async () => {
    const { localStore } = await import("./local-store");
    const candidate = buildImportCandidate({ state: "Resolved" });
    localStore.importSyncedWorkItems([candidate]);
    const item = localStore.snapshot().workItems[0]!;
    const openId = localStore
      .snapshot()
      .workflowStates.find((state) => !state.done)!._id;
    localStore.updateWorkItem(item._id, { workflowStateId: openId });
    localStore.autoMapSourceStates([
      {
        source: candidate.source,
        connectionId: candidate.connectionId,
        label: "Resolved",
        done: true,
      },
    ]);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: openId,
      importedWorkflowStateId: localStore
        .snapshot()
        .workflowStates.find((state) => state.done)!._id,
    });
  });

  it("normalizes malformed weekly time preferences", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        userPreferences: {
          weeklyTimeViewStyle: "stream",
          timeView: "month",
          weeklyCapacityTargets: {
            monday: -1,
            tuesday: 123,
            wednesday: "invalid",
          },
          warnWhenOverCapacity: false,
          warnWhenSubmittingUnderCapacity: false,
        },
      }),
    );

    const { localStore } = await import("./local-store");
    expect(localStore.snapshot().userPreferences).toMatchObject({
      weeklyTimeViewStyle: "grid",
      timeView: "day",
      weeklyCapacityTargets: {
        monday: 8 * 60 * 60 * 1000,
        tuesday: 123,
        wednesday: 8 * 60 * 60 * 1000,
      },
      warnWhenOverCapacity: false,
      warnWhenSubmittingUnderCapacity: false,
    });
  });

  it.each([undefined, false, "true", 1])(
    "defaults hideNonWorkingDays to false for a missing or invalid value %s",
    async (hideNonWorkingDays) => {
      window.localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({ userPreferences: { hideNonWorkingDays } }),
      );
      const { localStore } = await import("./local-store");
      expect(localStore.snapshot().userPreferences.hideNonWorkingDays).toBe(
        false,
      );
    },
  );

  it("preserves the hide non-working days preference after reloading storage", async () => {
    const { localStore } = await import("./local-store");
    localStore.setUserPreferences({ hideNonWorkingDays: true });
    vi.resetModules();
    const { localStore: reloadedStore } = await import("./local-store");
    expect(reloadedStore.snapshot().userPreferences.hideNonWorkingDays).toBe(
      true,
    );
  });

  it.each([
    [" workday-agent ", "workday-agent"],
    ["ajour", "ajour"],
    ["", undefined],
    [42, undefined],
    [undefined, undefined],
  ])(
    "normalizes the Commit lines name source %j to %j",
    async (commitLinesNameSource, expected) => {
      window.localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({ userPreferences: { commitLinesNameSource } }),
      );
      const { localStore } = await import("./local-store");
      expect(localStore.snapshot().userPreferences.commitLinesNameSource).toBe(
        expected,
      );
    },
  );

  it("persists the selected project data shape", async () => {
    const { localStore } = await import("./local-store");

    localStore.setUserPreferences({
      projectDataShapeId: "workday-project-data",
    });

    expect(localStore.snapshot().userPreferences.projectDataShapeId).toBe(
      "workday-project-data",
    );
    expect(window.localStorage.setItem).toHaveBeenCalled();
  });

  it("persists a selected nightly update track", async () => {
    const { localStore } = await import("./local-store");

    localStore.setUserPreferences({ updateTrack: "nightly" });

    expect(localStore.snapshot().userPreferences.updateTrack).toBe("nightly");
    expect(window.localStorage.setItem).toHaveBeenCalled();
  });

  it("normalizes unsupported persisted update tracks to stable", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        userPreferences: {
          themeMode: "system",
          updateTrack: "experimental",
        },
      }),
    );

    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().userPreferences.updateTrack).toBe("stable");
  });

  it("keeps a local workflow state override when the synced mapping changes", async () => {
    const { localStore } = await import("./local-store");

    const todoStatusId = localStore.addWorkflowState("Ready");
    const doingStatusId = localStore.addWorkflowState("Doing");
    const blockedStatusId = localStore.addWorkflowState("Blocked");

    localStore.setWorkflowStateMapping({
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "active",
      workflowStateId: todoStatusId,
    });

    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const importedItem = localStore.snapshot().workItems[0];
    expect(importedItem).toMatchObject({
      workflowStateId: todoStatusId,
      importedWorkflowStateId: todoStatusId,
      sourceStatusLabel: "Active",
    });

    localStore.updateWorkItem(importedItem!._id, {
      workflowStateId: doingStatusId,
    });

    localStore.setWorkflowStateMapping({
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "active",
      workflowStateId: blockedStatusId,
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      workflowStateId: doingStatusId,
      importedWorkflowStateId: blockedStatusId,
    });
  });

  it("closes open items when their source state is mapped to a done state, with Undo", async () => {
    const { localStore } = await import("./local-store");
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const doneStateId = localStore
      .snapshot()
      .workflowStates.find((workflowState) => workflowState.done)!._id;

    const { closedCount, undoToken } = localStore.setWorkflowStateMapping({
      source: "azure_devops",
      connectionId: "ado-1",
      sourceStatusKey: "active",
      workflowStateId: doneStateId,
    });

    expect(closedCount).toBe(1);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: doneStateId,
    });
    localStore.undo(undoToken!);
    expect(localStore.snapshot().workItems[0]?.status).toBe("active");
  });

  it("stores workflow state colors and lets them be updated", async () => {
    const { localStore } = await import("./local-store");

    const workflowStateId = localStore.addWorkflowState("Ready", "#123456");
    expect(localStore.snapshot().workflowStates).toContainEqual(
      expect.objectContaining({
        _id: workflowStateId,
        name: "Ready",
        color: "#123456",
      }),
    );

    localStore.updateWorkflowState(workflowStateId, {
      name: "Doing",
      color: "#654321",
    });

    expect(localStore.snapshot().workflowStates).toContainEqual(
      expect.objectContaining({
        _id: workflowStateId,
        name: "Doing",
        color: "#654321",
      }),
    );
  });

  it("reads workflow states saved under their old backlog status names", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workItems: [
          {
            _id: "item-1",
            title: "Legacy item",
            status: "active",
            source: "manual",
            createdAt: 1,
            backlogStatusId: "status-1",
          },
        ],
        backlogStatuses: [
          { _id: "status-1", name: "Doing", color: "#2563eb", createdAt: 1 },
        ],
        backlogStatusMappings: [
          {
            source: "azure_devops",
            connectionId: "ado-1",
            sourceStatusKey: "active",
            backlogStatusId: "status-1",
          },
        ],
        updatedAt: 1,
      }),
    );

    const { localStore } = await import("./local-store");
    const state = localStore.snapshot();

    expect(state.workflowStates[0]).toMatchObject({
      _id: "status-1",
      name: "Doing",
    });
    expect(
      state.workflowStates.some((workflowState) => workflowState.done),
    ).toBe(true);
    expect(state.workflowStateMappings).toEqual([
      expect.objectContaining({ workflowStateId: "status-1" }),
    ]);
    expect(state.workItems[0]).toMatchObject({ workflowStateId: "status-1" });
    expect(state.workItems[0]).not.toHaveProperty("backlogStatusId");
  });

  it("hydrates a fallback color for legacy workflow states without one", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        user: {
          _id: "local_user",
          name: "Local User",
          email: "local-only@ajour.dev",
        },
        projects: [],
        rules: [],
        segments: [],
        dismissedSegmentIds: [],
        editedBlocks: [],
        importedBrowserDrafts: [],
        timers: [],
        timesheetEntries: [],
        timesheetImportDrafts: [],
        workItems: [],
        workflowStates: [
          {
            _id: "status-1",
            name: "Legacy",
            createdAt: 1,
          },
        ],
        workflowStateMappings: [],
        backlogSortMode: "custom",
        capture: {
          urlMode: "sanitized_path",
          titleMode: "normalized",
          blockedDomains: [],
          sensitiveDomains: [],
          maxPathSegments: 4,
        },
        userPreferences: {
          themeMode: "system",
        },
        updatedAt: 1,
      }),
    );

    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().workflowStates).toContainEqual(
      expect.objectContaining({
        _id: "status-1",
        name: "Legacy",
        color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      }),
    );
  });

  it("removes retired auth and draft state while preserving committed local data", async () => {
    const accountCacheKey =
      "msal.2|uid.utid|login.microsoftonline.com|tenant-id";
    const tokenCacheKey =
      "msal.2|uid.utid|login.microsoftonline.com|refreshtoken|client-id|||";
    window.localStorage.setItem(accountCacheKey, "encrypted-account");
    window.localStorage.setItem(tokenCacheKey, "encrypted-token");
    window.sessionStorage.setItem(
      "msal.client-id.interaction.status",
      "pending",
    );
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        outlookIntegration: {
          configured: true,
          connected: true,
          accountEmail: "local@example.com",
        },
        outlookMeetingDrafts: [
          {
            _id: "meeting-event-1",
            eventId: "event-1",
            subject: "Planning",
          },
        ],
        workItems: [
          {
            _id: "legacy-work-item",
            title: "Planning follow-up",
            status: "active",
            source: "outlook",
            sourceId: "event-1",
            parentSourceId: "event-parent",
            createdAt: 1,
          },
        ],
        timesheetEntries: [
          {
            _id: "committed-meeting",
            localDate: "2026-08-01",
            label: "Planning",
            durationMs: 60 * 60 * 1000,
            sourceBlockIds: ["meeting:event-1"],
            committedAt: 2,
          },
        ],
        updatedAt: 3,
      }),
    );
    vi.mocked(window.localStorage.setItem).mockClear();

    const { localStore } = await import("./local-store");
    const state = localStore.snapshot();

    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      accountCacheKey,
    );
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(tokenCacheKey);
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith(
      "msal.client-id.interaction.status",
    );
    expect(state).not.toHaveProperty("outlookIntegration");
    expect(state).not.toHaveProperty("outlookMeetingDrafts");
    expect(state.workItems[0]).toMatchObject({
      _id: "legacy-work-item",
      source: "manual",
    });
    expect(state.workItems[0]?.sourceId).toBeUndefined();
    expect(state.workItems[0]?.parentSourceId).toBeUndefined();
    expect(state.timesheetEntries[0]).toMatchObject({
      _id: "committed-meeting",
      label: "Planning",
      durationMs: 60 * 60 * 1000,
      sourceBlockIds: ["meeting:event-1"],
      committedAt: 2,
    });
    const persistedState = JSON.parse(
      window.localStorage.getItem("ajour.local-state.v2")!,
    );
    expect(persistedState).not.toHaveProperty("outlookIntegration");
    expect(persistedState).not.toHaveProperty("outlookMeetingDrafts");
    expect(persistedState.workItems[0]).toMatchObject({
      _id: "legacy-work-item",
      source: "manual",
    });
    expect(persistedState.workItems[0]).not.toHaveProperty("sourceId");
    expect(persistedState.workItems[0]).not.toHaveProperty("parentSourceId");
    expect(persistedState.timesheetEntries[0]).toMatchObject({
      _id: "committed-meeting",
      sourceBlockIds: ["meeting:event-1"],
    });
    // The sanitized state once, and its new revision.
    expect(
      vi.mocked(window.localStorage.setItem).mock.calls.map(([key]) => key),
    ).toEqual(["ajour.local-state.v2", "ajour.local-state.revision"]);
  });

  it("does not overwrite state changed by another tab during retired state migration", async () => {
    const legacyState = JSON.stringify({
      outlookMeetingDrafts: [{ eventId: "event-1", subject: "Planning" }],
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-08-01",
          label: "Planning",
          durationMs: 60 * 60 * 1000,
          committedAt: 2,
        },
      ],
      updatedAt: 3,
    });
    const concurrentlyUpdatedState = JSON.stringify({
      outlookMeetingDrafts: [{ eventId: "event-1", subject: "Planning" }],
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-08-01",
          label: "Planning",
          durationMs: 60 * 60 * 1000,
          committedAt: 2,
        },
        {
          _id: "entry-2",
          localDate: "2026-08-01",
          label: "Newer entry",
          durationMs: 30 * 60 * 1000,
          committedAt: 4,
        },
      ],
      updatedAt: 4,
    });
    const getItem = vi.mocked(window.localStorage.getItem);
    getItem
      .mockReturnValueOnce(legacyState)
      .mockReturnValueOnce(concurrentlyUpdatedState);

    const { localStore } = await import("./local-store");
    localStore.snapshot();

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it("archives imported work items that disappear during auto-sync reconciliation", async () => {
    const { localStore } = await import("./local-store");

    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const importedItem = localStore.snapshot().workItems[0];
    expect(importedItem?.status).toBe("active");

    const result = localStore.importSyncedWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(result.archivedCount).toBe(1);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem!._id,
      status: "archived",
    });
  });

  it("drops a settle's pending write when the settle is undone", async () => {
    const { localStore } = await import("./local-store");
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const workItemId = localStore.snapshot().workItems[0]!._id;

    const token = localStore.settleWorkItem(workItemId, {
      state: { name: "Waiting", done: false },
    });
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "settled",
      pendingSourceWrite: { state: "Waiting" },
    });

    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "active",
      sourceStatusLabel: "Active",
    });
    expect(
      localStore.snapshot().workItems[0]?.pendingSourceWrite,
    ).toBeUndefined();
  });

  it("unarchives imported work items when they return during auto-sync reconciliation", async () => {
    const { localStore } = await import("./local-store");

    const candidate = buildImportCandidate();
    localStore.importSyncedWorkItems([candidate]);
    const importedItem = localStore.snapshot().workItems[0]!;

    localStore.importSyncedWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem._id,
      status: "archived",
    });

    const result = localStore.importSyncedWorkItems([candidate], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(result.updatedCount).toBe(1);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem._id,
      status: "active",
      archivedAt: undefined,
    });
  });

  it("keeps opted-in imported work items during auto-sync reconciliation", async () => {
    const { localStore } = await import("./local-store");

    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const importedItem = localStore.snapshot().workItems[0]!;

    expect(importedItem.keepWhenMissingFromSync).toBe(false);

    localStore.updateWorkItem(importedItem._id, {
      keepWhenMissingFromSync: true,
    });

    const result = localStore.importSyncedWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(result.archivedCount).toBe(0);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem._id,
      status: "active",
      keepWhenMissingFromSync: true,
    });
  });

  it("initializes imported estimate fields from backlog candidates", async () => {
    const { localStore } = await import("./local-store");

    localStore.importSyncedWorkItems([buildImportCandidate()]);

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      originalEstimateHours: 12,
      remainingEstimateHours: 8,
      completedEstimateHours: 4,
    });
  });

  it("increments completed and decrements remaining when manual time is saved for a mapped task", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.addProjectTask(projectId, { name: "Imported task" });
    const taskId = localStore.snapshot().projects[0]!.tasks.at(-1)!._id;
    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const workItem = localStore.snapshot().workItems[0]!;
    localStore.updateWorkItem(workItem._id, {
      projectId,
      taskId,
    });

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      durationMs: 2 * 60 * 60 * 1000,
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      remainingEstimateHours: 6,
      completedEstimateHours: 6,
    });
  });

  it("clamps remaining at zero when logged time exceeds the estimate", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.addProjectTask(projectId, { name: "Overrun task" });
    const taskId = localStore.snapshot().projects[0]!.tasks.at(-1)!._id;
    localStore.importSyncedWorkItems([
      buildImportCandidate({
        remainingEstimateHours: 1,
        completedEstimateHours: 0,
      }),
    ]);
    const workItem = localStore.snapshot().workItems[0]!;
    localStore.updateWorkItem(workItem._id, {
      projectId,
      taskId,
    });

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      durationMs: 2 * 60 * 60 * 1000,
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      remainingEstimateHours: 0,
      completedEstimateHours: 2,
    });
  });

  it("updates estimates for a backlog work item even when no project or task is mapped", async () => {
    const { localStore } = await import("./local-store");

    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const workItem = localStore.snapshot().workItems[0]!;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      workItemId: workItem._id,
      durationMs: 90 * 60 * 1000,
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      remainingEstimateHours: 6.5,
      completedEstimateHours: 5.5,
    });
  });

  it("updates a subtask mapping when it follows the parent's mapping", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.addProject({
      name: "Project Mercury",
      color: "#123456",
      tasks: [{ name: "Feature Work" }, { name: "Bugfixing" }],
    });
    const project = localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === projectId);
    const featureTaskId = project?.tasks[0]?._id;
    const bugfixTaskId = project?.tasks[1]?._id;

    expect(featureTaskId).toBeTruthy();
    expect(bugfixTaskId).toBeTruthy();

    const parentId = localStore.addWorkItem({
      title: "Parent task",
      projectId,
      taskId: featureTaskId,
    });
    const childId = localStore.addSubtask(parentId, {
      title: "Child task",
      projectId,
      taskId: featureTaskId,
    });

    localStore.updateWorkItem(parentId, {
      projectId,
      taskId: bugfixTaskId,
    });

    expect(
      localStore.snapshot().workItems.find((item) => item._id === childId),
    ).toMatchObject({
      _id: childId,
      projectId,
      taskId: bugfixTaskId,
    });
  });

  it("updates an unmapped subtask when the parent later gains a mapping", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.addProject({
      name: "Project Mercury",
      color: "#123456",
      tasks: [{ name: "Feature Work" }],
    });
    const taskId = localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === projectId)?.tasks[0]?._id;

    expect(taskId).toBeTruthy();

    const parentId = localStore.addWorkItem({
      title: "Parent task",
    });
    const childId = localStore.addSubtask(parentId, {
      title: "Child task",
    });

    localStore.updateWorkItem(parentId, {
      projectId,
      taskId,
    });

    expect(
      localStore.snapshot().workItems.find((item) => item._id === childId),
    ).toMatchObject({
      _id: childId,
      projectId,
      taskId,
    });
  });

  it("preserves a subtask mapping when it has its own mapping", async () => {
    const { localStore } = await import("./local-store");

    const parentProjectId = localStore.addProject({
      name: "Project Mercury",
      color: "#123456",
      tasks: [{ name: "Feature Work" }, { name: "Bugfixing" }],
    });
    const ownProjectId = localStore.addProject({
      name: "Project Apollo",
      color: "#654321",
      tasks: [{ name: "Operations" }],
    });

    const parentProject = localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === parentProjectId);
    const ownProject = localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === ownProjectId);
    const featureTaskId = parentProject?.tasks[0]?._id;
    const bugfixTaskId = parentProject?.tasks[1]?._id;
    const ownTaskId = ownProject?.tasks[0]?._id;

    expect(featureTaskId).toBeTruthy();
    expect(bugfixTaskId).toBeTruthy();
    expect(ownTaskId).toBeTruthy();

    const parentId = localStore.addWorkItem({
      title: "Parent task",
      projectId: parentProjectId,
      taskId: featureTaskId,
    });
    const childId = localStore.addSubtask(parentId, {
      title: "Child task",
      projectId: ownProjectId,
      taskId: ownTaskId,
    });

    localStore.updateWorkItem(parentId, {
      projectId: parentProjectId,
      taskId: bugfixTaskId,
    });

    expect(
      localStore.snapshot().workItems.find((item) => item._id === childId),
    ).toMatchObject({
      _id: childId,
      projectId: ownProjectId,
      taskId: ownTaskId,
    });
  });

  it("reverses unmapped backlog estimate deltas when the linked time entry is deleted", async () => {
    const { localStore } = await import("./local-store");

    localStore.importSyncedWorkItems([buildImportCandidate()]);
    const workItem = localStore.snapshot().workItems[0]!;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      workItemId: workItem._id,
      durationMs: 90 * 60 * 1000,
    });

    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    localStore.deleteTimesheetEntry(entryId);

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      remainingEstimateHours: 8,
      completedEstimateHours: 4,
    });
  });

  it("undoes only the last time entry action, once, while its token is kept", async () => {
    const { localStore } = await import("./local-store");
    localStore.saveManualTimeEntry({
      localDate: "2026-10-07",
      note: "Kept exactly",
      durationMs: 75_123,
    });
    localStore.saveManualTimeEntry({
      localDate: "2026-10-07",
      note: "Second",
      durationMs: 60_000,
    });
    const [first, second] = localStore.snapshot().timesheetEntries;
    const before = localStore.snapshot().timesheetEntries;

    const deleteToken = localStore.deleteTimesheetEntry(first!._id)!;
    const moveToken = localStore.moveTimesheetEntry(second!._id, {
      localDate: "2026-10-08",
      note: "Second",
      durationMs: 60_000,
    })!;

    expect(localStore.undo(deleteToken)).toBe("expired");
    expect(localStore.undo(moveToken)).toBe("restored");
    expect(localStore.undo(moveToken)).toBe("expired");

    const nextDelete = localStore.deleteTimesheetEntry(first!._id)!;
    localStore.forgetUndo(nextDelete);
    expect(localStore.undo(nextDelete)).toBe("expired");

    const finalDelete = localStore.deleteTimesheetEntry(second!._id)!;
    expect(localStore.undo(finalDelete)).toBe("restored");
    expect(
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2")!)
        .timesheetEntries,
    ).toEqual(JSON.parse(JSON.stringify(before.slice(1))));
  });

  it("hydrates committed entries from desktop bootstrap state when the current profile was reset", async () => {
    const bootstrapState = {
      projects: [
        {
          _id: "project_custom",
          name: "Recovered project",
          color: "#123456",
          status: "active" as const,
          tasks: [],
        },
      ],
      timesheetEntries: [
        {
          _id: "timesheet_recovered",
          localDate: "2026-04-15",
          label: "Recovered entry",
          durationMs: 60 * 60 * 1000,
          sourceBlockIds: [],
          committedAt: 123,
        },
      ],
      updatedAt: 999,
    };

    const storage = new Map<string, string>();
    storage.set(
      "ajour.local-state.v2",
      JSON.stringify({
        user: {
          _id: "local_user",
          name: "Local User",
          email: "local-only@ajour.dev",
        },
        projects: [
          {
            _id: "project_default_1",
            name: "Internal",
            color: "#1f7667",
            code: "INT",
            status: "active",
            tasks: [],
          },
          {
            _id: "project_default_2",
            name: "Client Work",
            color: "#ec7a43",
            code: "CLT",
            status: "active",
            tasks: [],
          },
        ],
        rules: [],
        segments: [],
        dismissedSegmentIds: [],
        editedBlocks: [],
        importedBrowserDrafts: [],
        timers: [],
        timesheetEntries: [],
        workItems: [],
        workflowStates: [],
        workflowStateMappings: [],
        backlogSortMode: "custom",
        capture: {
          urlMode: "sanitized_path",
          titleMode: "normalized",
          blockedDomains: [],
          sensitiveDomains: [],
          maxPathSegments: 4,
        },
        userPreferences: {
          themeMode: "system",
        },
        updatedAt: 100,
      }),
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        ajourDesktop: {
          bootstrapLocalState: bootstrapState,
        },
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

    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);
    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      _id: "timesheet_recovered",
      localDate: "2026-04-15",
    });
    expect(localStore.snapshot().projects[0]).toMatchObject({
      _id: "project_custom",
      name: "Recovered project",
    });
  });

  it("merges recovered entries into a partially restored profile", async () => {
    const bootstrapState = {
      projects: [
        {
          _id: "project_custom",
          name: "Recovered project",
          color: "#123456",
          status: "active" as const,
          tasks: [],
        },
      ],
      timesheetEntries: [
        {
          _id: "timesheet_bootstrap",
          localDate: "2026-04-15",
          label: "Recovered entry",
          durationMs: 60 * 60 * 1000,
          sourceBlockIds: [],
          committedAt: 123,
        },
      ],
      updatedAt: 999,
    };

    const storage = new Map<string, string>();
    storage.set(
      "ajour.local-state.v2",
      JSON.stringify({
        user: {
          _id: "local_user",
          name: "Local User",
          email: "local-only@ajour.dev",
        },
        projects: [
          {
            _id: "project_default_1",
            name: "Internal",
            color: "#1f7667",
            code: "INT",
            status: "active",
            tasks: [],
          },
          {
            _id: "project_default_2",
            name: "Client Work",
            color: "#ec7a43",
            code: "CLT",
            status: "active",
            tasks: [],
          },
        ],
        rules: [],
        segments: [],
        dismissedSegmentIds: [],
        editedBlocks: [],
        importedBrowserDrafts: [],
        timers: [],
        timesheetEntries: [
          {
            _id: "timesheet_current",
            localDate: "2026-04-11",
            label: "",
            durationMs: 30 * 60 * 1000,
            sourceBlockIds: [],
            committedAt: 100,
          },
        ],
        workItems: [],
        workflowStates: [],
        workflowStateMappings: [],
        backlogSortMode: "custom",
        capture: {
          urlMode: "sanitized_path",
          titleMode: "normalized",
          blockedDomains: [],
          sensitiveDomains: [],
          maxPathSegments: 4,
        },
        userPreferences: {
          themeMode: "system",
        },
        updatedAt: 100,
      }),
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        ajourDesktop: {
          bootstrapLocalState: bootstrapState,
        },
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

    const { localStore } = await import("./local-store");

    expect(
      localStore.snapshot().timesheetEntries.map((entry) => entry._id),
    ).toEqual(["timesheet_current", "timesheet_bootstrap"]);
    expect(localStore.snapshot().projects[0]).toMatchObject({
      _id: "project_custom",
      name: "Recovered project",
    });
  });

  it("stages workbook imports for review and commits ready rows on demand", async () => {
    const { localStore } = await import("./local-store");

    localStore.stageTimesheetImportRows([
      {
        date: "2026-04-21",
        project: "Project Mercury",
        task: "Feature Work",
        note: "Imported row",
        hours: 1.5,
      },
    ]);

    expect(localStore.snapshot().timesheetImportDrafts).toHaveLength(1);
    expect(localStore.snapshot().timesheetEntries).toHaveLength(0);

    const draftId = localStore.snapshot().timesheetImportDrafts[0]!._id;
    localStore.commitTimesheetImportDraft(draftId);

    expect(localStore.snapshot().timesheetImportDrafts).toHaveLength(0);
    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);
    expect(localStore.snapshot().projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Project Mercury",
          tasks: expect.arrayContaining([
            expect.objectContaining({ name: "Feature Work" }),
          ]),
        }),
      ]),
    );
  });

  it("imports workbook rows without a project or task without creating an empty project", async () => {
    const { localStore } = await import("./local-store");
    const initialProjectCount = localStore.snapshot().projects.length;

    localStore.stageTimesheetImportRows([
      {
        date: "2026-04-21",
        project: "",
        task: "",
        note: "Imported unassigned row",
        hours: 1.5,
      },
    ]);

    const draftId = localStore.snapshot().timesheetImportDrafts[0]!._id;
    localStore.commitTimesheetImportDraft(draftId);

    expect(localStore.snapshot().timesheetImportDrafts).toHaveLength(0);
    expect(localStore.snapshot().projects).toHaveLength(initialProjectCount);
    expect(
      localStore.snapshot().projects.map((project) => project.name),
    ).not.toContain("");
    expect(localStore.snapshot().timesheetEntries).toEqual([
      expect.objectContaining({
        localDate: "2026-04-21",
        projectId: undefined,
        taskId: undefined,
        note: "Imported unassigned row",
        durationMs: 90 * 60 * 1000,
      }),
    ]);
  });

  it("flags potential conflicts for staged workbook imports", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.addProject({
      name: "Project Mercury",
      color: "#123456",
      tasks: [{ name: "Feature Work" }],
    });
    const taskId = localStore
      .snapshot()
      .projects.find((project) => project._id === projectId)?.tasks[0]?._id;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      durationMs: 60 * 60 * 1000,
    });

    localStore.stageTimesheetImportRows([
      {
        date: "2026-04-21",
        project: "Project Mercury",
        task: "Feature Work",
        note: "Imported row",
        hours: 1.5,
      },
    ]);

    expect(localStore.snapshot().timesheetImportDrafts[0]).toMatchObject({
      potentialConflict: true,
    });
  });

  it("dismisses staged workbook imports without changing committed entries", async () => {
    const { localStore } = await import("./local-store");

    localStore.stageTimesheetImportRows([
      {
        date: "2026-04-21",
        project: "Project Mercury",
        task: "Feature Work",
        note: "Imported row",
        hours: 1.5,
      },
    ]);

    const draftId = localStore.snapshot().timesheetImportDrafts[0]!._id;
    localStore.dismissTimesheetImportDraft(draftId);

    expect(localStore.snapshot().timesheetImportDrafts).toHaveLength(0);
    expect(localStore.snapshot().timesheetEntries).toHaveLength(0);
  });

  it("merges imported project workbook rows by project name and adds missing tasks", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.addProject({
      name: "Project Mercury",
      code: "OLD",
      color: "#123456",
      tasks: [{ name: "Feature Work" }],
    });
    const existingTaskId = localStore
      .snapshot()
      .projects.find((project) => project._id === projectId)?.tasks[0]?._id;
    expect(existingTaskId).toBeTruthy();

    const result = localStore.importProjectWorkbookRows([
      {
        project: "Project Mercury",
        code: "MER",
        color: "#654321",
        status: "active",
        task: "Feature Work",
        taskStatus: "archived",
        billable: "billable",
        budgetHours: "",
        adjustmentHours: "",
      },
      {
        project: "Project Mercury",
        code: "MER",
        color: "#654321",
        status: "active",
        task: "Planning",
        taskStatus: "active",
        billable: "billable",
        budgetHours: "",
        adjustmentHours: "",
      },
      {
        project: "Project Apollo",
        code: "APL",
        color: "#111111",
        status: "archived",
        task: "",
        taskStatus: "",
        billable: "",
        budgetHours: "",
        adjustmentHours: "",
      },
    ]);

    expect(result).toEqual({
      createdProjectCount: 1,
      mergedProjectCount: 1,
      addedTaskCount: 1,
      updatedTaskCount: 1,
    });

    const mercury = localStore
      .snapshot()
      .projects.find((project) => project.name === "Project Mercury");
    const apollo = localStore
      .snapshot()
      .projects.find((project) => project.name === "Project Apollo");

    expect(mercury).toMatchObject({
      code: "MER",
      color: "#654321",
      status: "active",
    });
    expect(mercury?.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: existingTaskId,
          name: "Feature Work",
          status: "archived",
        }),
        expect.objectContaining({
          name: "Planning",
          status: "active",
        }),
      ]),
    );

    expect(apollo).toMatchObject({
      code: "APL",
      color: "#111111",
      status: "archived",
      tasks: [],
    });
  });

  it("stores task budget and adjustment fields and updates them from project workbook rows", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.addProject({
      name: "Project Mercury",
      color: "#123456",
      tasks: [{ name: "Feature Work" }],
    });
    const taskId = localStore
      .snapshot()
      .projects.find((project) => project._id === projectId)?.tasks[0]?._id;

    expect(taskId).toBeTruthy();

    localStore.updateProjectTask(projectId, taskId!, {
      billable: false,
      budgetMs: 2 * 60 * 60 * 1000,
      adjustmentMs: -30 * 60 * 1000,
    });

    expect(
      localStore
        .snapshot()
        .projects.find((project) => project._id === projectId)?.tasks[0],
    ).toMatchObject({
      _id: taskId,
      billable: false,
      budgetMs: 2 * 60 * 60 * 1000,
      adjustmentMs: -30 * 60 * 1000,
    });

    const result = localStore.importProjectWorkbookRows([
      {
        project: "Project Mercury",
        code: "",
        color: "#123456",
        status: "active",
        task: "Feature Work",
        taskStatus: "active",
        billable: "billable",
        budgetHours: 3.5,
        adjustmentHours: 0.25,
      },
    ]);

    expect(result).toEqual({
      createdProjectCount: 0,
      mergedProjectCount: 1,
      addedTaskCount: 0,
      updatedTaskCount: 1,
    });

    expect(
      localStore
        .snapshot()
        .projects.find((project) => project._id === projectId)?.tasks[0],
    ).toMatchObject({
      _id: taskId,
      billable: true,
      budgetMs: 3.5 * 60 * 60 * 1000,
      adjustmentMs: 0.25 * 60 * 60 * 1000,
    });
  });

  it("loads a workspace saved before tombstones with none", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({ timesheetEntries: [] }),
    );
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().timesheetTombstones).toEqual([]);
  });

  it("migrates entries stored as submitted to committed copies on load", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "submitted",
            localDate: "2026-04-21",
            label: "",
            note: "Weekly sync",
            durationMs: 3_600_000,
            sourceBlockIds: [],
            committedAt: 1,
            submittedAt: 7,
            submittedFingerprint: "old",
          },
          {
            _id: "edited",
            localDate: "2026-04-21",
            label: "",
            durationMs: 1_800_000,
            sourceBlockIds: [],
            committedAt: 2,
            previousSubmittedAt: 7,
          },
        ],
      }),
    );
    const { localStore } = await import("./local-store");
    const [submitted, edited] = localStore.snapshot().timesheetEntries;

    expect(submitted).toMatchObject({
      commit: { at: 7, localDate: "2026-04-21", note: "Weekly sync" },
    });
    expect(submitted).not.toHaveProperty("submittedAt");
    expect(edited!.commit).toBeUndefined();
    expect(edited).not.toHaveProperty("previousSubmittedAt");
  });

  it("marks changes as committed, and Undo takes the commit back", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      note: "Weekly sync",
      durationMs: 60 * 60 * 1000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;

    const token = localStore.markTimesheetEntriesCommitted([entryId]);

    expect(token).not.toBeNull();
    expect(localStore.snapshot().timesheetEntries[0]!.commit).toMatchObject({
      localDate: "2026-04-21",
      note: "Weekly sync",
    });
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().timesheetEntries[0]!.commit).toBeUndefined();
  });

  it("recovers from malformed persisted JSON without overwriting it", async () => {
    window.localStorage.setItem("ajour.local-state.v2", "{not-json");
    vi.mocked(window.localStorage.setItem).mockClear();

    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().projects.length).toBeGreaterThan(0);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes malformed collection shapes and team settings", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: "invalid",
        workItems: {},
        timesheetEntries: null,
        team: {
          _id: "team-1",
          name: "Local",
          slug: "local",
          settings: {
            mergeGapMs: 1,
          },
        },
      }),
    );

    const { localStore } = await import("./local-store");
    const state = localStore.snapshot();

    expect(state.workItems).toEqual([]);
    expect(state.timesheetEntries).toEqual([]);
    expect(state.team?.settings).toMatchObject({
      mergeGapMs: 1,
      idleThresholdMs: 2 * 60 * 1000,
      microBlockThresholdMs: 3 * 60 * 1000,
    });
  });

  it("normalizes the weeks it asked to commit", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        commitPromptedWeeks: ["2026-10-12", 3, "2026-10-12", "2026-10-05"],
      }),
    );

    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().commitPromptedWeeks).toEqual([
      "2026-10-12",
      "2026-10-05",
    ]);
  });

  it("remembers a week it asked to commit, outside Undo", async () => {
    const { localStore } = await import("./local-store");
    expect(localStore.snapshot().commitPromptedWeeks).toEqual([]);

    localStore.saveManualTimeEntry({
      localDate: "2026-10-12",
      durationMs: 60_000,
    });
    const entryId = localStore.snapshot().timesheetEntries.at(-1)!._id;
    const undoToken = localStore.deleteTimesheetEntry(entryId);
    localStore.markCommitPrompted("2026-10-12");
    localStore.markCommitPrompted("2026-10-12");
    expect(localStore.undo(undoToken!)).not.toBe("expired");

    const restored = localStore.snapshot();
    expect(restored.timesheetEntries.some((e) => e._id === entryId)).toBe(true);
    expect(restored.commitPromptedWeeks).toEqual(["2026-10-12"]);
  });

  it("does not persist a no-op transition", async () => {
    const { localStore } = await import("./local-store");
    localStore.snapshot();
    vi.mocked(window.localStorage.setItem).mockClear();
    vi.mocked(window.dispatchEvent).mockClear();

    localStore.saveTimer("missing");

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("localStore subscriptions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("announces a write in this window without re-reading storage", async () => {
    const { localStore } = await import("./local-store");
    const listener = vi.fn();
    localStore.subscribe(listener);
    localStore.addWorkItem({ title: "Ship it" });
    const written = localStore.snapshot();
    vi.mocked(window.localStorage.getItem).mockClear();

    const announced = vi.mocked(window.dispatchEvent).mock.calls.at(-1)![0];
    expect(announced.type).toBe("ajour-local-state");
    const deliver = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === "ajour-local-state")![1];
    (deliver as () => void)();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
    expect(localStore.snapshot()).toBe(written);
  });

  it("reloads once for a write from another window, however many subscribers", async () => {
    const { localStore } = await import("./local-store");
    localStore.subscribe(vi.fn());
    localStore.subscribe(vi.fn());
    const before = localStore.snapshot();
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({ ...before, updatedAt: before.updatedAt + 1 }),
    );
    vi.mocked(window.localStorage.getItem).mockClear();
    vi.mocked(window.dispatchEvent).mockClear();

    const storageListeners = vi
      .mocked(window.addEventListener)
      .mock.calls.filter(([type]) => type === "storage");
    expect(storageListeners).toHaveLength(1);
    (storageListeners[0]![1] as unknown as (event: { key: string }) => void)({
      key: "ajour.local-state.v2",
    });

    expect(
      vi
        .mocked(window.localStorage.getItem)
        .mock.calls.filter(([key]) => key === "ajour.local-state.v2"),
    ).toHaveLength(1);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(localStore.snapshot()).not.toBe(before);
    expect(localStore.snapshot().updatedAt).toBe(before.updatedAt + 1);
  });

  it("takes the other window's revision with its state, so the next write goes through", async () => {
    const { localStore } = await import("./local-store");
    localStore.subscribe(vi.fn());
    const before = localStore.snapshot();
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        ...before,
        updatedAt: before.updatedAt + 1,
        revision: "other-window",
      }),
    );
    window.localStorage.setItem("ajour.local-state.revision", "other-window");
    const storageListener = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === "storage")![1];
    (storageListener as unknown as (event: { key: string }) => void)({
      key: "ajour.local-state.v2",
    });
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(() => localStore.addWorkItem({ title: "Ship it" })).not.toThrow();
      // The reload took the revision from the state itself, so no reload now.
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});

describe("runWithUndo", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockWindow();
  });

  it("makes commands without their own undo undoable", async () => {
    const { localStore } = await import("./local-store");
    const { undoToken } = localStore.runWithUndo(() =>
      localStore.startTimer({ note: "Agent work" }),
    );

    expect(localStore.snapshot().timers).toHaveLength(1);
    expect(localStore.undo(undoToken!)).toBe("restored");
    expect(localStore.snapshot().timers).toHaveLength(0);
  });

  it("returns no token when nothing changed", async () => {
    const { localStore } = await import("./local-store");
    expect(localStore.runWithUndo(() => undefined).undoToken).toBeNull();
  });
});

describe("relocateTimesheetEntries", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockWindow();
  });

  it("returns the copies with one undo token that removes them all", async () => {
    const { localStore } = await import("./local-store");
    localStore.saveManualTimeEntry({
      localDate: "2026-10-05",
      note: "First",
      durationMs: 60_000,
    });
    localStore.saveManualTimeEntry({
      localDate: "2026-10-06",
      note: "Second",
      durationMs: 60_000,
    });
    const [first, second] = localStore.snapshot().timesheetEntries;

    const { undoToken, entryIds } = localStore.relocateTimesheetEntries(
      [
        { entryId: first!._id, localDate: "2026-10-05" },
        { entryId: second!._id, localDate: "2026-10-06" },
      ],
      "copy",
    );

    expect(entryIds).toHaveLength(2);
    expect(entryIds).not.toContain(first!._id);
    expect(
      localStore
        .snapshot()
        .timesheetEntries.filter((entry) => entryIds.includes(entry._id))
        .map((entry) => [entry.localDate, entry.note]),
    ).toEqual([
      ["2026-10-05", "First"],
      ["2026-10-06", "Second"],
    ]);

    expect(localStore.undo(undoToken!)).toBe("restored");
    expect(localStore.snapshot().timesheetEntries).toHaveLength(2);
  });

  it("returns no token and no entries when nothing could move", async () => {
    const { localStore } = await import("./local-store");
    expect(
      localStore.relocateTimesheetEntries(
        [{ entryId: "gone", localDate: "2026-10-05" }],
        "cut",
      ),
    ).toEqual({ undoToken: null, entryIds: [] });
  });
});

describe("calendar suggestions in the store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  const today = new Date();
  const localDate = (daysAgo: number) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - daysAgo,
    );
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  };

  it("loads valid decisions within 90 days and valid rules, with default settings", async () => {
    const decision = {
      _id: "kept",
      pluginId: "ics",
      connectionId: "work",
      occurrenceKey: "standup",
      localDate: localDate(90),
      decision: "dismissed",
      decidedAt: 1,
    };
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        calendarDecisions: [
          decision,
          { ...decision, _id: "expired", localDate: localDate(91) },
          { ...decision, _id: "invalid", decision: "maybe" },
        ],
        calendarEventRules: [
          {
            _id: "assign",
            pluginId: "ics",
            connectionId: "work",
            seriesId: "standup",
            label: "Daily standup",
            action: "assign",
            projectId: "internal",
            createdAt: 1,
          },
          {
            _id: "no-project",
            pluginId: "ics",
            connectionId: "work",
            seriesId: "sync",
            label: "Sync",
            action: "assign",
            createdAt: 1,
          },
        ],
      }),
    );

    const { localStore } = await import("./local-store");
    const state = localStore.snapshot();
    expect(state.calendarDecisions?.map((item) => item._id)).toEqual(["kept"]);
    expect(state.calendarEventRules?.map((item) => item._id)).toEqual([
      "assign",
    ]);
    expect(state.userPreferences.calendarSuggestions).toEqual({
      hideAllDay: true,
      hideDeclined: true,
      hideFree: true,
      hideUnanswered: false,
      minimumMinutes: 0,
      refreshMinutes: 10,
    });
  });

  it("adds a suggestion with one undo, and removes a connection's calendar data", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({
      name: "Internal",
      color: "#123456",
    });
    const suggestion = {
      key: "k",
      pluginId: "ics",
      connectionId: "work",
      connectionLabel: "Work",
      occurrenceKey: JSON.stringify(["standup", 1]),
      seriesId: "standup",
      localDate: localDate(0),
      startsAt: 1,
      endsAt: 900_001,
      durationMs: 900_000,
      title: "Daily standup",
      untitled: false,
      allDay: false,
    };

    const added = localStore.acceptCalendarSuggestions([
      { suggestion, projectId, remember: true },
    ]);
    expect(added.entryIds).toHaveLength(1);
    expect(localStore.snapshot().calendarEventRules).toHaveLength(1);

    expect(localStore.undo(added.undoToken!)).toBe("restored");
    expect(localStore.snapshot().timesheetEntries).toEqual([]);
    expect(localStore.snapshot().calendarDecisions).toEqual([]);
    expect(localStore.snapshot().calendarEventRules).toEqual([]);

    localStore.acceptCalendarSuggestions([
      { suggestion, projectId, remember: true },
    ]);
    localStore.removeConnectionCalendarData("ics", "work");
    expect(localStore.snapshot().calendarDecisions).toEqual([]);
    expect(localStore.snapshot().calendarEventRules).toEqual([]);
    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);
  });
});

describe("submitted weeks in the store", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockWindow();
  });

  const HOUR = 60 * 60 * 1000;
  const reason = lockedWeekMessage("2026-10-05");

  /** "API" on Tuesday, October 6, committed; the week is submitted when `locked`. */
  function seedWeek({ locked }: { locked: boolean }) {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "api",
            localDate: "2026-10-06",
            label: "",
            note: "API",
            durationMs: HOUR,
            sourceBlockIds: [],
            committedAt: 1,
            commit: {
              at: 1,
              localDate: "2026-10-06",
              note: "API",
              durationMs: HOUR,
            },
          },
        ],
        lockedWeeks: locked ? [{ weekOf: "2026-10-05", lockedAt: 2 }] : [],
      }),
    );
  }

  it("refuses a write to a submitted week and persists nothing", async () => {
    seedWeek({ locked: true });
    const { localStore } = await import("./local-store");
    const before = localStore.snapshot();
    vi.mocked(window.localStorage.setItem).mockClear();

    expect(() =>
      localStore.updateTimesheetEntry("api", {
        note: "Changed",
        durationMs: HOUR,
      }),
    ).toThrow(reason);
    expect(() => localStore.deleteTimesheetEntry("api")).toThrow(reason);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(localStore.snapshot()).toBe(before);
  });

  it("refuses to start a running entry when today is in a submitted week", async () => {
    seedWeek({ locked: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 9));
    try {
      const { localStore } = await import("./local-store");

      expect(() => localStore.startTimer({})).toThrow(reason);
      expect(localStore.snapshot().timers).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits a committed week with Undo, and reopens it with Undo", async () => {
    seedWeek({ locked: false });
    const { localStore } = await import("./local-store");

    const { undoToken, result } = localStore.submitWeek("2026-10-08");
    expect(result).toEqual({ ok: true, weekOf: "2026-10-05" });
    expect(localStore.snapshot().lockedWeeks).toMatchObject([
      { weekOf: "2026-10-05" },
    ]);
    expect(localStore.undo(undoToken!)).toBe("restored");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);

    localStore.submitWeek("2026-10-05");
    const reopenToken = localStore.reopenWeek("2026-10-05");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);
    expect(localStore.undo(reopenToken!)).toBe("restored");
    expect(localStore.snapshot().lockedWeeks).toMatchObject([
      { weekOf: "2026-10-05" },
    ]);
  });

  it("returns the refusal with no undo token", async () => {
    seedWeek({ locked: true });
    const { localStore } = await import("./local-store");

    expect(localStore.submitWeek("2026-10-05")).toEqual({
      undoToken: null,
      result: {
        ok: false,
        kind: "already-submitted",
        message: "The week of 2026-10-05 is already submitted.",
      },
    });
    expect(localStore.reopenWeek("2026-10-12")).toBeNull();
  });

  /**
   * Another window wrote the state and its revision; this window has not read
   * the storage event yet.
   */
  function writeInAnotherWindow(change: Record<string, unknown>) {
    const stored = JSON.parse(
      window.localStorage.getItem("ajour.local-state.v2")!,
    ) as Record<string, unknown>;
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({ ...stored, ...change, revision: "other-window" }),
    );
    window.localStorage.setItem("ajour.local-state.revision", "other-window");
  }

  /** Another window submitted the week of October 5. */
  function submitInAnotherWindow() {
    writeInAnotherWindow({
      lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 9 }],
    });
  }

  const storedLocks = () =>
    (
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2")!) as {
        lockedWeeks: unknown[];
      }
    ).lockedWeeks;

  it("refuses a stale Submit of another week and keeps the other window's lock", async () => {
    seedWeek({ locked: false });
    const { localStore, StaleWindowError } = await import("./local-store");
    localStore.snapshot();
    submitInAnotherWindow();

    expect(() => localStore.submitWeek("2026-10-12")).toThrow(StaleWindowError);
    expect(storedLocks()).toEqual([{ weekOf: "2026-10-05", lockedAt: 9 }]);
    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 9 },
    ]);
  });

  it("refuses a stale Reopen", async () => {
    seedWeek({ locked: true });
    const { localStore, StaleWindowError } = await import("./local-store");
    localStore.snapshot();
    writeInAnotherWindow({
      lockedWeeks: [
        { weekOf: "2026-10-05", lockedAt: 2 },
        { weekOf: "2026-10-12", lockedAt: 9 },
      ],
    });

    expect(() => localStore.reopenWeek("2026-10-05")).toThrow(StaleWindowError);
    expect(storedLocks()).toHaveLength(2);
  });

  it("refuses a stale Undo", async () => {
    seedWeek({ locked: false });
    const { localStore, StaleWindowError } = await import("./local-store");
    const { undoToken } = localStore.submitWeek("2026-10-12");
    writeInAnotherWindow({
      lockedWeeks: [
        { weekOf: "2026-10-05", lockedAt: 9 },
        { weekOf: "2026-10-12", lockedAt: 1 },
      ],
    });

    expect(() => localStore.undo(undoToken!)).toThrow(StaleWindowError);
    expect(storedLocks()).toHaveLength(2);
  });

  it("never reads the stored state back on a write in a single window", async () => {
    seedWeek({ locked: false });
    const { localStore } = await import("./local-store");
    // The seed has no revision key yet; the first write stores it.
    localStore.saveManualTimeEntry({
      localDate: "2026-10-14",
      durationMs: HOUR,
    });
    const getItem = vi.mocked(window.localStorage.getItem);
    getItem.mockClear();
    const parse = vi.spyOn(JSON, "parse");
    try {
      localStore.saveManualTimeEntry({
        localDate: "2026-10-13",
        durationMs: HOUR,
      });
      const token = localStore.submitWeek("2026-10-12").undoToken;
      localStore.undo(token!);

      expect(parse).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalledWith("ajour.local-state.v2");
      expect(getItem).toHaveBeenCalledWith("ajour.local-state.revision");
    } finally {
      parse.mockRestore();
    }
  });

  // Each window loads its own module, so compare refusals by message.
  const stale = "Ajour changed in another window. Try again.";

  /** Loads the store again as a second window on the same storage. */
  async function openAnotherWindow() {
    vi.resetModules();
    return (await import("./local-store")).localStore;
  }

  it("leaves no stale write possible when the revision key cannot be written", async () => {
    seedWeek({ locked: false });
    const { localStore: first } = await import("./local-store");
    // Both windows start on the same revision, and the hint holds it.
    first.saveManualTimeEntry({ localDate: "2026-10-14", durationMs: HOUR });
    const second = await openAnotherWindow();
    second.snapshot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.mocked(window.localStorage.setItem);
    const write = setItem.getMockImplementation()!;
    setItem.mockImplementation((key, value) => {
      if (key === "ajour.local-state.revision") {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      write(key, value);
    });
    try {
      first.submitWeek("2026-10-05");
      expect(first.snapshot().lockedWeeks).toHaveLength(1);
    } finally {
      setItem.mockImplementation(write);
    }

    // The command's event counts the failure; nothing goes to the console.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(() =>
      second.saveManualTimeEntry({ localDate: "2026-10-27", durationMs: HOUR }),
    ).toThrow(stale);
    expect(storedLocks()).toMatchObject([{ weekOf: "2026-10-05" }]);
  });

  it("never pairs an old state with a newer revision while loading", async () => {
    seedWeek({ locked: false });
    const { localStore: first } = await import("./local-store");
    first.saveManualTimeEntry({ localDate: "2026-10-14", durationMs: HOUR });
    const second = await openAnotherWindow();
    // The first window submits right after the second one read the state.
    const getItem = vi.mocked(window.localStorage.getItem);
    const read = getItem.getMockImplementation()!;
    let interleaved = false;
    getItem.mockImplementation((key) => {
      const value = read(key);
      if (key === "ajour.local-state.v2" && !interleaved) {
        interleaved = true;
        first.submitWeek("2026-10-19");
      }
      return value;
    });
    try {
      expect(second.snapshot().lockedWeeks).toEqual([]);
    } finally {
      getItem.mockImplementation(read);
    }

    expect(() =>
      second.saveManualTimeEntry({ localDate: "2026-10-27", durationMs: HOUR }),
    ).toThrow(stale);
    expect(storedLocks()).toMatchObject([{ weekOf: "2026-10-19" }]);
  });

  it("reloads when the revision key is missing, and still writes on a fresh base", async () => {
    seedWeek({ locked: false });
    const { localStore } = await import("./local-store");
    localStore.saveManualTimeEntry({
      localDate: "2026-10-14",
      durationMs: HOUR,
    });
    window.localStorage.removeItem("ajour.local-state.revision");
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(() =>
        localStore.saveManualTimeEntry({
          localDate: "2026-10-15",
          durationMs: HOUR,
        }),
      ).not.toThrow();
      expect(parse).toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    expect(localStore.snapshot().timesheetEntries).toHaveLength(3);
    expect(window.localStorage.getItem("ajour.local-state.revision")).toBe(
      localStore.snapshot().revision,
    );
  });

  it("keeps the Undo when a stale window refuses it, so a retry works", async () => {
    seedWeek({ locked: false });
    const { localStore, StaleWindowError } = await import("./local-store");
    const { undoToken } = localStore.submitWeek("2026-10-12");
    // Another window changes something unrelated to the submitted week.
    writeInAnotherWindow({ dismissedSegmentIds: ["segment-1"] });

    expect(() => localStore.undo(undoToken!)).toThrow(StaleWindowError);
    expect(localStore.undo(undoToken!)).toBe("restored");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);
    expect(localStore.snapshot().dismissedSegmentIds).toEqual(["segment-1"]);
  });

  it("does not submit a recovered week that holds the store's running entry", async () => {
    recoverFromDesktop(
      {
        timers: [
          {
            _id: "local-running",
            startedAt: 1,
            localDate: "2026-10-07",
            accumulatedDurationMs: 0,
          },
        ],
      },
      [
        { weekOf: "2026-10-05", lockedAt: 2 },
        { weekOf: "2026-10-12", lockedAt: 3 },
      ],
    );
    const { localStore, localStateLoad } = await import("./local-store");

    expect(localStore.snapshot().timers).toHaveLength(1);
    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-12", lockedAt: 3 },
    ]);
    // The boot's event says so.
    expect(localStateLoad().recovery).toMatchObject({
      decision: "merged",
      unsubmitted_week_count: 1,
    });
  });

  it("refuses a stale window's write to a week another window submitted", async () => {
    seedWeek({ locked: false });
    const { localStore } = await import("./local-store");
    localStore.snapshot();
    submitInAnotherWindow();

    expect(() =>
      localStore.updateTimesheetEntry("api", {
        note: "Changed",
        durationMs: HOUR,
      }),
    ).toThrow(reason);
    const stored = JSON.parse(
      window.localStorage.getItem("ajour.local-state.v2")!,
    ) as { lockedWeeks: unknown[]; timesheetEntries: { note: string }[] };
    expect(stored.lockedWeeks).toEqual([{ weekOf: "2026-10-05", lockedAt: 9 }]);
    expect(stored.timesheetEntries[0]!.note).toBe("API");
    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 9 },
    ]);
  });

  it("refuses any other stale write once, then writes on the fresh state", async () => {
    seedWeek({ locked: false });
    const { localStore, StaleWindowError } = await import("./local-store");
    localStore.snapshot();
    submitInAnotherWindow();
    const write = () =>
      localStore.saveManualTimeEntry({
        localDate: "2026-10-13",
        durationMs: HOUR,
      });

    let refusal: unknown;
    try {
      write();
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(StaleWindowError);
    expect((refusal as Error).message).toBe(
      "Ajour changed in another window. Try again.",
    );
    expect(localStore.snapshot().timesheetEntries).toHaveLength(1);

    // The refusal refreshed this window, so the next try writes.
    expect(() => write()).not.toThrow();
    expect(localStore.snapshot().timesheetEntries).toHaveLength(2);
    expect(localStore.snapshot().lockedWeeks).toHaveLength(1);
  });

  /** A desktop recovery file with "api" on October 6 and "next" on October 13. */
  function recoverFromDesktop(
    current: Record<string, unknown>,
    recoveredLockedWeeks: unknown[],
    recoveredExtra: Record<string, unknown> = {},
  ) {
    const recovered = (_id: string, localDate: string) => ({
      _id,
      localDate,
      label: "",
      note: _id,
      durationMs: HOUR,
      sourceBlockIds: [],
      committedAt: 1,
    });
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify(current),
    );
    Object.assign(window, {
      ajourDesktop: {
        bootstrapLocalState: {
          timesheetEntries: [
            recovered("api", "2026-10-06"),
            recovered("next", "2026-10-13"),
          ],
          lockedWeeks: recoveredLockedWeeks,
          updatedAt: 5,
          ...recoveredExtra,
        },
      },
    });
  }

  it("does not submit again on reload a recovered week the user reopened", async () => {
    const entry = (_id: string, localDate: string) => ({
      _id,
      localDate,
      label: "",
      note: _id,
      durationMs: HOUR,
      sourceBlockIds: [],
      committedAt: 1,
    });
    // The store already holds what the recovery file holds.
    recoverFromDesktop(
      {
        timesheetEntries: [
          entry("api", "2026-10-06"),
          entry("next", "2026-10-13"),
        ],
        lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 2 }],
      },
      [{ weekOf: "2026-10-12", lockedAt: 2 }],
    );
    const { localStore } = await import("./local-store");
    localStore.reopenWeek("2026-10-12");

    // Reload: the recovery file is offered again.
    vi.resetModules();
    const reloaded = (await import("./local-store")).localStore;

    expect(reloaded.snapshot().lockedWeeks).toEqual([]);
  });

  it("redoes the recovery on the fresh state when storage changed while it ran", async () => {
    recoverFromDesktop({ lockedWeeks: [] }, []);
    // Another tab saves an entry right after this one read the state.
    const getItem = vi.mocked(window.localStorage.getItem);
    const read = getItem.getMockImplementation()!;
    let interleaved = false;
    getItem.mockImplementation((key) => {
      const value = read(key);
      if (key === "ajour.local-state.v2" && !interleaved) {
        interleaved = true;
        window.localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            timesheetEntries: [
              {
                _id: "other-tab",
                localDate: "2026-10-20",
                label: "",
                durationMs: HOUR,
                sourceBlockIds: [],
                committedAt: 1,
              },
            ],
            revision: "other-tab",
          }),
        );
        window.localStorage.setItem("ajour.local-state.revision", "other-tab");
      }
      return value;
    });
    try {
      const { localStore } = await import("./local-store");
      localStore.snapshot();
    } finally {
      getItem.mockImplementation(read);
    }

    const stored = JSON.parse(
      window.localStorage.getItem("ajour.local-state.v2")!,
    ) as { timesheetEntries: { _id: string }[] };
    expect(stored.timesheetEntries.map((entry) => entry._id)).toEqual([
      "other-tab",
      "api",
      "next",
    ]);
  });

  it("keeps the submitted weeks of recovered entries", async () => {
    recoverFromDesktop(
      { lockedWeeks: [{ weekOf: "2026-10-19", lockedAt: 3 }] },
      [{ weekOf: "2026-10-07", lockedAt: 2 }],
    );
    const { localStore } = await import("./local-store");

    expect(
      localStore.snapshot().timesheetEntries.map((entry) => entry._id),
    ).toEqual(["api", "next"]);
    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 2 },
      { weekOf: "2026-10-19", lockedAt: 3 },
    ]);
  });

  it("leaves out recovered entries that land in a week this store submitted", async () => {
    recoverFromDesktop(
      { lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 3 }] },
      [],
    );
    const { localStore, localStateLoad } = await import("./local-store");

    expect(
      localStore.snapshot().timesheetEntries.map((entry) => entry._id),
    ).toEqual(["next"]);
    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 3 },
    ]);
    expect(localStateLoad().recovery).toMatchObject({
      left_out_entry_count: 1,
    });
  });

  it("leaves out a recovered running entry in a week locked after the merge", async () => {
    recoverFromDesktop({}, [{ weekOf: "2026-10-05", lockedAt: 2 }], {
      timers: [
        {
          _id: "running",
          startedAt: 1,
          localDate: "2026-10-07",
          accumulatedDurationMs: 0,
        },
      ],
    });
    const { localStore, localStateLoad } = await import("./local-store");

    expect(localStore.snapshot().timers).toEqual([]);
    expect(localStore.snapshot().lockedWeeks).toHaveLength(1);
    expect(localStateLoad().recovery).toMatchObject({
      left_out_running_entry_count: 1,
    });
  });

  it("recovers submitted weeks alone, with no entry to recover", async () => {
    recoverFromDesktop(
      {
        timesheetEntries: [
          {
            _id: "kept",
            localDate: "2026-04-11",
            label: "",
            durationMs: HOUR,
            sourceBlockIds: [],
            committedAt: 1,
          },
        ],
      },
      [{ weekOf: "2026-10-05", lockedAt: 2 }],
      { timesheetEntries: [] },
    );
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 2 },
    ]);
    expect(
      localStore.snapshot().timesheetEntries.map((entry) => entry._id),
    ).toEqual(["kept"]);
  });

  it("starts with no submitted week", async () => {
    const { localStore } = await import("./local-store");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);
  });

  it("reads submitted weeks on their Monday and drops malformed ones", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        lockedWeeks: [
          { weekOf: "2026-10-07", lockedAt: 5 },
          { weekOf: "soon", lockedAt: 6 },
        ],
      }),
    );
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 5 },
    ]);
  });
});

describe("localStore description timelog", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      // The renderer's wide events draw their IDs from it.
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  const description = [
    "---",
    "timelog:",
    "  project: Acme",
    "  task: Development",
    "---",
    "Build the page.",
  ].join("\n");

  it("maps the item and creates its task in the description's Undo", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({ name: "Acme", color: "#111111" });
    const itemId = localStore.addWorkItem({ title: "Landing page" });
    const before = localStore.snapshot();

    const token = localStore.updateWorkItemWithUndo(itemId, { description });

    const project = localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === projectId)!;
    const created = project.tasks.find((task) => task.name === "Development");
    expect(created?.status).toBe("active");
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      projectId,
      taskId: created?._id,
      description,
    });

    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().projects).toEqual(before.projects);
    expect(localStore.snapshot().workItems).toEqual(before.workItems);
  });

  it("keeps a project the same update sets, even the one the item had", async () => {
    const { localStore } = await import("./local-store");
    localStore.addProject({ name: "Acme", color: "#111111" });
    const otherId = localStore.addProject({ name: "Other", color: "#222222" });
    const itemId = localStore.addWorkItem({
      title: "Landing page",
      projectId: otherId,
    });

    localStore.updateWorkItemWithUndo(itemId, {
      projectId: otherId,
      description,
    });

    expect(localStore.snapshot().workItems[0]?.projectId).toBe(otherId);
  });

  it("offers Undo for an editor save only when its timelog changed the mapping", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({ name: "Acme", color: "#111111" });
    const itemId = localStore.addWorkItem({ title: "Landing page" });

    expect(localStore.saveWorkItemEdits(itemId, { title: "Hero" })).toBeNull();
    expect(localStore.snapshot().workItems[0]?.title).toBe("Hero");

    const before = localStore.snapshot();
    const token = localStore.saveWorkItemEdits(itemId, { description });
    expect(token).not.toBeNull();
    expect(localStore.snapshot().workItems[0]?.projectId).toBe(projectId);

    // Undo takes back what the timelog did and keeps the saved text.
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().projects).toEqual(before.projects);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      title: "Hero",
      description,
    });
    expect(localStore.snapshot().workItems[0]?.projectId).toBeUndefined();
  });

  it("undoes a move with what its editor save's timelog did, and keeps the save", async () => {
    const { localStore } = await import("./local-store");
    localStore.addProject({ name: "Acme", color: "#111111" });
    const itemId = localStore.addWorkItem({ title: "Landing page" });
    const before = localStore.snapshot();
    const doneId = before.workflowStates.find((state) => state.done)!._id;

    const token = localStore.moveWorkItemToState(itemId, doneId, {
      edits: { title: "Hero", description },
    });
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      status: "archived",
      title: "Hero",
    });
    expect(localStore.snapshot().workItems[0]?.projectId).toBeDefined();

    expect(localStore.undo(token!)).toBe("restored");
    const restored = localStore.snapshot().workItems[0];
    expect(restored).toMatchObject({
      status: "active",
      title: "Hero",
      description,
    });
    expect(restored?.projectId).toBeUndefined();
    expect(localStore.snapshot().projects).toEqual(before.projects);
  });

  it("gives a new editor item's timelog its own Undo, which keeps the item", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({ name: "Acme", color: "#111111" });
    const before = localStore.snapshot();

    expect(localStore.saveNewWorkItem({ title: "Plain" }).undoToken).toBeNull();

    const { workItemId, undoToken } = localStore.saveNewWorkItem({
      title: "Landing page",
      description,
    });
    const created = localStore
      .snapshot()
      .workItems.find((item) => item._id === workItemId);
    expect(created?.projectId).toBe(projectId);
    expect(undoToken).not.toBeNull();

    expect(localStore.undo(undoToken!)).toBe("restored");
    const after = localStore.snapshot();
    expect(after.projects).toEqual(before.projects);
    expect(
      after.workItems.find((item) => item._id === workItemId),
    ).toMatchObject({ title: "Landing page", description });
    expect(
      after.workItems.find((item) => item._id === workItemId)?.projectId,
    ).toBeUndefined();
  });

  it("undoes a new editor item's timelog with its close in a done state", async () => {
    const { localStore } = await import("./local-store");
    localStore.addProject({ name: "Acme", color: "#111111" });
    const before = localStore.snapshot();
    const doneId = before.workflowStates.find((state) => state.done)!._id;

    const { workItemId, undoToken } = localStore.saveNewWorkItem(
      { title: "Landing page", description },
      doneId,
    );
    expect(
      localStore.snapshot().workItems.find((item) => item._id === workItemId),
    ).toMatchObject({ status: "archived", workflowStateId: doneId });

    expect(localStore.undo(undoToken!)).toBe("restored");
    const restored = localStore
      .snapshot()
      .workItems.find((item) => item._id === workItemId);
    expect(restored).toMatchObject({ status: "active", description });
    expect(restored?.projectId).toBeUndefined();
    expect(localStore.snapshot().projects).toEqual(before.projects);
  });

  it("maps a synced item whose description arrives with a timelog", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({ name: "Acme", color: "#111111" });

    localStore.importSyncedWorkItems([
      buildImportCandidate({ note: description }),
    ]);

    expect(localStore.snapshot().workItems[0]?.projectId).toBe(projectId);
    expect(localStore.snapshot().workItems[0]?.taskId).toBeDefined();
  });

  it("maps a synced item whose description arrives with a timelog as it closes", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({ name: "Acme", color: "#111111" });
    localStore.importSyncedWorkItems([buildImportCandidate()]);

    localStore.archiveDoneSyncedWorkItems([
      {
        source: "azure_devops",
        connectionId: "ado-1",
        sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/101",
        state: "Closed",
        description: { text: description },
      },
    ]);

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      description,
      projectId,
    });
  });

  it("takes the source's side of a description conflict, with Undo", async () => {
    const { localStore } = await import("./local-store");
    localStore.importSyncedWorkItems([
      buildImportCandidate({ description: { text: "Original" } }),
    ]);
    const itemId = localStore.snapshot().workItems[0]!._id;
    localStore.updateWorkItemWithUndo(itemId, { description: "Mine" });
    localStore.importSyncedWorkItems([
      buildImportCandidate({ description: { text: "Theirs" } }),
    ]);
    expect(
      localStore.snapshot().workItems[0]?.descriptionSync?.conflict,
    ).toBeDefined();

    const token = localStore.takeSourceDescriptionWithUndo(itemId);

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      description: "Theirs",
      descriptionSync: { baseline: "Theirs", remote: "Theirs" },
    });
    expect(
      localStore.snapshot().workItems[0]?.descriptionSync?.conflict,
    ).toBeUndefined();
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().workItems[0]?.description).toBe("Mine");
  });

  it("keeps a code block's indentation when a description is saved", async () => {
    const { localStore } = await import("./local-store");
    const itemId = localStore.addWorkItem({
      title: "Script",
      description: "    echo hi",
    });

    localStore.updateWorkItemWithUndo(itemId, {
      description: "\n    echo hello  \n",
    });

    expect(localStore.snapshot().workItems[0]?.description).toBe(
      "    echo hello",
    );
  });

  it("creates the missing project with Undo", async () => {
    const { localStore } = await import("./local-store");
    const itemId = localStore.addWorkItem({
      title: "Landing page",
      description,
    });
    const before = localStore.snapshot();
    expect(before.workItems[0]?.projectId).toBeUndefined();

    const token = localStore.applyTimelogWithUndo(itemId);

    const project = localStore.snapshot().projects.at(-1)!;
    expect(project).toMatchObject({ name: "Acme", status: "active" });
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      projectId: project._id,
      taskId: project.tasks[0]?._id,
    });
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().projects).toEqual(before.projects);
    expect(localStore.snapshot().workItems).toEqual(before.workItems);
  });
});

describe("localStore favorites", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(16).slice(2)}`),
    });
    installMockWindow();
  });

  it("offers Undo for a removed star, which brings back its place", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.addProject({
      name: "Atlas",
      color: "#123456",
      icon: { kind: "preset", name: "dot" },
      tasks: [{ name: "Development" }],
    });
    const atlas = () =>
      localStore
        .snapshot()
        .projects.find((project) => project._id === projectId)!;
    const taskId = atlas().tasks[0]!._id;

    expect(
      localStore.setProjectTaskFavorite(projectId, taskId, true),
    ).toBeNull();
    const starred = atlas().tasks[0]!.favoritedAt;
    expect(starred).toEqual(expect.any(Number));

    const token = localStore.setProjectTaskFavorite(projectId, taskId, false);
    expect(atlas().tasks[0]!.favoritedAt).toBeUndefined();
    expect(localStore.undo(token!)).toBe("restored");
    expect(atlas().tasks[0]!.favoritedAt).toBe(starred);

    expect(localStore.setProjectFavorite(projectId, true)).toBeNull();
    const projectToken = localStore.setProjectFavorite(projectId, false);
    expect(localStore.undo(projectToken!)).toBe("restored");
    expect(atlas().favoritedAt).toEqual(expect.any(Number));
  });
});
