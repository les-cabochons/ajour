import { beforeEach, describe, expect, it, vi } from "vitest";

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
    priority: 2,
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
      localStore.importConnectorWorkItems([buildImportCandidate()]);
      localStore.importConnectorWorkItems([], {
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
      reloaded.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([candidate]);
    const closed = localStore.snapshot().workItems[0]!;
    expect(closed.status).toBe("archived");
    const token = localStore.moveWorkItemToState(closed._id, openId, {
      sourceWrites: { [closed._id]: "Active" },
    });
    const pending = localStore.snapshot().workItems[0]!;
    expect(pending.status).toBe("active");
    expect(pending.pendingSourceWrite?.state).toBe("Active");
    localStore.importConnectorWorkItems([candidate]);
    expect(localStore.snapshot().workItems[0]).toEqual(pending);
    expect(
      localStore.archiveDoneConnectorWorkItems([
        {
          source: candidate.source,
          connectionId: candidate.connectionId,
          sourceId: candidate.sourceId,
          state: "Closed",
        },
      ]),
    ).toBe(0);
    localStore.importConnectorWorkItems([], {
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
      localStore.importConnectorWorkItems([buildImportCandidate()]);
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
        localStore.updateWorkItem(parentId, { note: "Keep my later edit" });
      if (outcome === "failure")
        localStore.updateWorkItem(childId, {
          note: "Keep the child's later edit",
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
            ?.note,
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
          : { ...closedChild, note: "Keep the child's later edit" },
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
      localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([parent, child]);
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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

  it("recovers the last successful priority write when its replacement fails", async () => {
    const { localStore } = await import("./local-store");
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
      localStore.importConnectorWorkItems([candidate]);
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
        localStore.importConnectorWorkItems([
          buildImportCandidate({ state: "Resolved", stateDone: true }),
        ]);
      } else {
        expect(
          localStore.archiveDoneConnectorWorkItems([
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

  it("preserves carried children through sync until a parent reopen is undone", async () => {
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
    localStore.importConnectorWorkItems([parent, child]);
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
    localStore.importConnectorWorkItems(
      [parent, child].map((item) => ({
        ...item,
        state: "Closed",
        stateDone: true,
      })),
    );
    expect(localStore.snapshot().workItems).toEqual(pending);
    localStore.archiveDoneConnectorWorkItems(
      [parent, child].map((item) => ({
        source: item.source,
        connectionId: item.connectionId,
        sourceId: item.sourceId,
        state: "Closed",
      })),
    );
    localStore.importConnectorWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });
    expect(localStore.snapshot().workItems).toEqual(pending);
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().workItems).toEqual(closed);
  });

  it("preserves a local open-state override when automatic mapping discovers Done", async () => {
    const { localStore } = await import("./local-store");
    const candidate = buildImportCandidate({ state: "Resolved" });
    localStore.importConnectorWorkItems([candidate]);
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
      weeklyCapacityTargets: {
        monday: 8 * 60 * 60 * 1000,
        tuesday: 123,
        wednesday: 8 * 60 * 60 * 1000,
      },
      warnWhenOverCapacity: false,
      warnWhenSubmittingUnderCapacity: false,
    });
  });

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

    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
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

    localStore.importConnectorWorkItems([buildImportCandidate()]);
    const importedItem = localStore.snapshot().workItems[0];
    expect(importedItem?.status).toBe("active");

    const result = localStore.importConnectorWorkItems([], {
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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([candidate]);
    const importedItem = localStore.snapshot().workItems[0]!;

    localStore.importConnectorWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem._id,
      status: "archived",
    });

    const result = localStore.importConnectorWorkItems([candidate], {
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

    localStore.importConnectorWorkItems([buildImportCandidate()]);
    const importedItem = localStore.snapshot().workItems[0]!;

    expect(importedItem.keepWhenMissingFromSync).toBe(false);

    localStore.updateWorkItem(importedItem._id, {
      keepWhenMissingFromSync: true,
    });

    const result = localStore.importConnectorWorkItems([], {
      archiveMissingFromConnectionId: "ado-1",
    });

    expect(result.archivedCount).toBe(0);
    expect(localStore.snapshot().workItems[0]).toMatchObject({
      _id: importedItem._id,
      status: "active",
      keepWhenMissingFromSync: true,
    });
  });

  it("initializes imported estimate fields from connector candidates", async () => {
    const { localStore } = await import("./local-store");

    localStore.importConnectorWorkItems([buildImportCandidate()]);

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
    localStore.importConnectorWorkItems([buildImportCandidate()]);
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
    localStore.importConnectorWorkItems([
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

    localStore.importConnectorWorkItems([buildImportCandidate()]);
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

    localStore.importConnectorWorkItems([buildImportCandidate()]);
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

  it("marks selected timesheet entries as submitted", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.addProjectTask(projectId, { name: "Submitted work" });
    const taskId = localStore.snapshot().projects[0]!.tasks.at(-1)!._id;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      note: "Weekly sync",
      durationMs: 60 * 60 * 1000,
    });

    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    localStore.markTimesheetEntriesSubmitted([entryId]);

    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      _id: entryId,
      submittedAt: expect.any(Number),
      submittedFingerprint: expect.any(String),
    });
  });

  it("keeps submitted state when a timesheet entry is saved without changes", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.addProjectTask(projectId, { name: "Stable work" });
    const taskId = localStore.snapshot().projects[0]!.tasks.at(-1)!._id;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      note: "Keep submitted",
      durationMs: 90 * 60 * 1000,
    });

    const entry = localStore.snapshot().timesheetEntries[0]!;
    localStore.markTimesheetEntriesSubmitted([entry._id]);

    const submittedEntry = localStore.snapshot().timesheetEntries[0]!;
    localStore.updateTimesheetEntry(entry._id, {
      projectId,
      taskId,
      note: "Keep submitted",
      durationMs: 90 * 60 * 1000,
    });

    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      _id: entry._id,
      submittedAt: submittedEntry.submittedAt,
      submittedFingerprint: submittedEntry.submittedFingerprint,
    });
  });

  it("clears submitted state when a saved timesheet entry changes", async () => {
    const { localStore } = await import("./local-store");

    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.addProjectTask(projectId, { name: "Changed work" });
    const taskId = localStore.snapshot().projects[0]!.tasks.at(-1)!._id;

    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      taskId,
      note: "Before change",
      durationMs: 2 * 60 * 60 * 1000,
    });

    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    localStore.markTimesheetEntriesSubmitted([entryId]);
    localStore.updateTimesheetEntry(entryId, {
      projectId,
      taskId,
      note: "After change",
      durationMs: 2 * 60 * 60 * 1000,
    });

    expect(localStore.snapshot().timesheetEntries[0]).toMatchObject({
      _id: entryId,
      submittedAt: undefined,
      submittedFingerprint: undefined,
    });
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
