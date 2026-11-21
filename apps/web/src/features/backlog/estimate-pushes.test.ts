import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type {
  BacklogImportCandidate,
  BacklogSyncRequest,
  BacklogSyncWorkItemUpdate,
} from "@ajour/shared";

/*
 * A synced item's estimate change goes to its source once its Undo window
 * ends, as a sync of that item alone, through the real store and watcher
 * against a fake local API whose plugin uploads what differs from the
 * agreed value.
 */

const storage = new Map<string, string>();

/** A window whose events reach their listeners: the store notifies through them. */
function installWindow() {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
}

function candidate(sourceId: string): BacklogImportCandidate {
  return {
    id: `candidate-${sourceId}`,
    source: "azure_devops",
    connectionId: "contoso",
    connectionLabel: "Contoso",
    tenantLabel: "Entra",
    sourceId,
    externalId: sourceId,
    title: `Item ${sourceId}`,
    workItemType: "Task",
    state: "Active",
    depth: 0,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: 1,
    remainingEstimateHours: 5,
    completedEstimateHours: 0,
  };
}

/**
 * The local API: the overview, and a sync whose plugin uploads each
 * estimate that differs from the agreed value. While `gate` waits, a sync
 * it received stays on its way.
 */
function fakeApi() {
  const api = {
    syncs: [] as BacklogSyncRequest[],
    gate: undefined as Promise<void> | undefined,
  };
  const plugin = {
    id: "azure_devops",
    displayName: "Azure DevOps",
    version: "1.1.0",
    apiVersion: 3,
    description: "Azure DevOps work items.",
    iconSvg: "<svg />",
    entrypoint: "plugin.mjs",
    capabilities: { connector: {} },
    connectionFields: [],
  };
  const connection = {
    id: "contoso",
    pluginId: "azure_devops",
    label: "Contoso",
    tenantLabel: "Entra",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {},
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      if (route === "/api/plugins" && !init?.method) {
        return Response.json({
          pluginsEnabled: true,
          plugins: [plugin],
          connectionGroups: [
            { plugin, enabled: true, connections: [connection] },
          ],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        });
      }
      if (route.endsWith("/sync")) {
        const request = JSON.parse(String(init?.body)) as BacklogSyncRequest;
        api.syncs.push(request);
        await api.gate;
        const fields = [
          "remainingEstimateHours",
          "completedEstimateHours",
        ] as const;
        const workItemUpdates: BacklogSyncWorkItemUpdate[] =
          request.workItems.map((item) => ({
            localWorkItemId: item.localWorkItemId,
            sourceId: item.sourceId,
            fields: Object.fromEntries(
              fields.map((field) => [
                field,
                {
                  status:
                    item[field] === item.estimateSync?.[field]?.baselineValue
                      ? "noop"
                      : "pushed",
                  localValue: item[field],
                  nextBaselineValue: item[field],
                },
              ]),
            ),
          }));
        return Response.json({
          connection,
          mode: "backlog",
          items: [],
          stagedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          workItemUpdates,
        });
      }
      return Response.json({ error: `No route ${route}` }, { status: 404 });
    }),
  );
  return api;
}

async function load() {
  const { localStore } = await import("@/lib/local-store");
  const { getPluginsOverview } = await import("@/lib/app-api");
  const { ESTIMATE_PUSH_DELAY_MS, watchEstimateChanges } =
    await import("@/features/backlog/estimate-pushes");
  const { refreshBacklog } =
    await import("@/features/backlog/backlog-refresh-workflow");
  await getPluginsOverview();
  localStore.importSyncedWorkItems([candidate("42"), candidate("43")]);
  const item = (sourceId = "42") =>
    localStore
      .snapshot()
      .workItems.find((workItem) => workItem.sourceId === sourceId)!;
  stopWatching = watchEstimateChanges();
  return { localStore, item, refreshBacklog, ESTIMATE_PUSH_DELAY_MS };
}

/** What each sync uploaded: its item and remaining estimate. */
const uploads = (api: ReturnType<typeof fakeApi>) =>
  api.syncs.map((sync) => ({
    trigger: sync.trigger,
    refresh: sync.refresh,
    sourceId: sync.sourceId,
    items: sync.workItems.map((item) => [
      item.sourceId,
      item.remainingEstimateHours,
    ]),
  }));

let stopWatching: (() => void) | undefined;

// Each test imports Ajour afresh. Transforming its modules once here keeps
// that cost out of the first test's time limit on a busy machine.
beforeAll(async () => {
  installWindow();
  fakeApi();
  await load().catch(() => undefined);
  stopWatching?.();
  vi.unstubAllGlobals();
}, 30_000);
beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(Date.parse("2026-11-21T09:00:00Z"));
  installWindow();
});
afterEach(() => {
  stopWatching?.();
  stopWatching = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sends an estimate edit when its Undo window ends, as a sync of that item alone, and nothing after its answer", async () => {
  const api = fakeApi();
  const { localStore, item, ESTIMATE_PUSH_DELAY_MS } = await load();

  localStore.updateWorkItemWithUndo(item()._id, {
    remainingEstimateHours: 3,
  });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS - 1);
  expect(api.syncs).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);

  await vi.waitFor(() =>
    expect(item().estimateSync?.remainingEstimateHours?.baselineValue).toBe(3),
  );
  expect(uploads(api)).toEqual([
    {
      trigger: "source_write",
      refresh: true,
      sourceId: "42",
      items: [["42", 3]],
    },
  ]);
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS * 2);
  expect(api.syncs).toHaveLength(1);
});

it("sends nothing when Undo takes the edit back within its window", async () => {
  const api = fakeApi();
  const { localStore, item, ESTIMATE_PUSH_DELAY_MS } = await load();

  const token = localStore.updateWorkItemWithUndo(item()._id, {
    remainingEstimateHours: 3,
  });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS / 2);
  localStore.undo(token!);
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS * 2);

  expect(item().remainingEstimateHours).toBe(5);
  expect(api.syncs).toEqual([]);
});

it("sends the estimates that logged time changed, also when an entry is edited", async () => {
  const api = fakeApi();
  const { localStore, item, ESTIMATE_PUSH_DELAY_MS } = await load();

  localStore.saveManualTimeEntry({
    localDate: "2026-11-21",
    workItemId: item("43")._id,
    durationMs: 60 * 60_000,
  });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);
  await vi.waitFor(() => expect(api.syncs).toHaveLength(1));
  const entry = localStore.snapshot().timesheetEntries[0]!;
  localStore.updateTimesheetEntry(entry._id, { durationMs: 2 * 60 * 60_000 });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);

  await vi.waitFor(() => expect(api.syncs).toHaveLength(2));
  expect(uploads(api).map((sync) => sync.items)).toEqual([
    [["43", 4]],
    [["43", 3]],
  ]);
});

it("holds a change made while the item's upload is on its way until that upload's answer", async () => {
  const api = fakeApi();
  const { localStore, item, ESTIMATE_PUSH_DELAY_MS } = await load();
  let release!: () => void;
  api.gate = new Promise((resolve) => (release = resolve));

  localStore.updateWorkItemWithUndo(item()._id, { remainingEstimateHours: 3 });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);
  await vi.waitFor(() => expect(api.syncs).toHaveLength(1));
  localStore.updateWorkItemWithUndo(item()._id, { remainingEstimateHours: 2 });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);
  expect(api.syncs).toHaveLength(1);
  api.gate = undefined;
  release();

  await vi.waitFor(() => expect(api.syncs).toHaveLength(2));
  await vi.waitFor(() =>
    expect(item().estimateSync?.remainingEstimateHours?.baselineValue).toBe(2),
  );
  expect(uploads(api).map((sync) => sync.items)).toEqual([
    [["42", 3]],
    [["42", 2]],
  ]);
});

it("lets an item refresh and a Backlog refresh wait while the item's upload is on its way", async () => {
  const api = fakeApi();
  const { localStore, item, refreshBacklog, ESTIMATE_PUSH_DELAY_MS } =
    await load();
  let release!: () => void;
  api.gate = new Promise((resolve) => (release = resolve));

  localStore.updateWorkItemWithUndo(item()._id, { remainingEstimateHours: 3 });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);
  await vi.waitFor(() => expect(api.syncs).toHaveLength(1));
  // Opening its page, then the Backlog page, while it uploads.
  await refreshBacklog({
    source: {
      pluginId: "azure_devops",
      connectionId: "contoso",
      sourceId: "42",
    },
    trigger: "auto",
  });
  await refreshBacklog({ trigger: "auto" });
  api.gate = undefined;
  release();

  await vi.waitFor(() =>
    expect(item().estimateSync?.remainingEstimateHours?.baselineValue).toBe(3),
  );
  expect(api.syncs).toHaveLength(1);
});

it("puts the old value back with Undo after the upload, and sends it", async () => {
  const api = fakeApi();
  const { localStore, item, ESTIMATE_PUSH_DELAY_MS } = await load();

  const token = localStore.updateWorkItemWithUndo(item()._id, {
    remainingEstimateHours: 3,
  });
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);
  await vi.waitFor(() =>
    expect(item().estimateSync?.remainingEstimateHours?.baselineValue).toBe(3),
  );
  expect(localStore.undo(token!)).toBe("restored");
  expect(item().remainingEstimateHours).toBe(5);
  await vi.advanceTimersByTimeAsync(ESTIMATE_PUSH_DELAY_MS);

  await vi.waitFor(() =>
    expect(item().estimateSync?.remainingEstimateHours?.baselineValue).toBe(5),
  );
  expect(uploads(api).map((sync) => sync.items)).toEqual([
    [["42", 3]],
    [["42", 5]],
  ]);
});
