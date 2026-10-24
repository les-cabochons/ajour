import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginsOverview, TeamSyncRequest } from "@ajour/shared";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";

const PLUGIN = "team";
const CONNECTION = "acme";
const SYNC_URL = `/api/teams/${PLUGIN}/connections/${CONNECTION}/sync`;

/** The local API's view: the team plugin with one connection to `teamId`. */
function overviewWith(teamId: string | null): PluginsOverview {
  const plugin = {
    id: PLUGIN,
    version: "0.1.0",
    apiVersion: 3,
    displayName: "Team sync",
    iconSvg: "<svg />",
    entrypoint: "dist/plugin.mjs",
    capabilities: { team: { apiVersion: 1 as const } },
    connectionFields: [
      {
        id: "label",
        label: "Label",
        type: "text" as const,
        required: true,
        secret: false,
      },
      {
        id: "teamId",
        label: "Team ID",
        type: "text" as const,
        required: true,
        secret: false,
      },
      {
        id: "teamSecret",
        label: "Secret",
        type: "password" as const,
        required: true,
        secret: true,
      },
    ],
  };
  return {
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connections:
          teamId === null
            ? []
            : [
                {
                  id: CONNECTION,
                  pluginId: PLUGIN,
                  label: "Acme",
                  tenantLabel: "Acme",
                  connectedAt: 1,
                  autoSync: false,
                  autoSyncIntervalMinutes: 15,
                  pendingImportCount: 0,
                  selectedImportCount: 0,
                  configSummary: {},
                  editableValues: { label: "Acme", teamId },
                },
              ],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

const teamProject = (remoteId: string, name: string) => ({
  remoteId,
  name,
  displayName: name,
  code: null,
  color: "#4f46e5",
  icon: { kind: "preset", name: "dot" },
  status: "active",
  tasks: [],
});

/**
 * Answers each sync round with the next response, records the requests, and
 * serves `api.overview` as the local API's connections, which a test changes.
 */
function stubApi(
  respond: (
    request: TeamSyncRequest,
    round: number,
  ) => unknown | Promise<unknown>,
) {
  const api = {
    overview: overviewWith("team-1"),
    requests: [] as TeamSyncRequest[],
    failDelete: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(SYNC_URL)) {
        const request = JSON.parse(String(init?.body)) as TeamSyncRequest;
        api.requests.push(request);
        return Response.json(await respond(request, api.requests.length));
      }
      if (init?.method === "DELETE") {
        if (api.failDelete) {
          return Response.json({ error: "Storage is busy." }, { status: 500 });
        }
        api.overview = overviewWith(null);
      }
      return Response.json(api.overview);
    }),
  );
  return api;
}

/** Gives every new record in the round an ID, as a team would. */
function assignAll(request: TeamSyncRequest) {
  return request.changes.flatMap((change) => [
    ...(change.remoteId
      ? []
      : [{ localId: change.localId, remoteId: `r-${change.localId}` }]),
    ...change.tasks
      .filter((task) => !task.remoteId)
      .map((task) => ({
        localId: task.localId,
        remoteId: `r-${task.localId}`,
      })),
  ]);
}

describe("team sync service", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage: localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function load() {
    const { localStore } = await import("./local-store");
    const { syncTeamConnection } = await import("./team-sync");
    const api = await import("./app-api");
    return { localStore, syncTeamConnection, api };
  }

  /**
   * Syncs the connection once, as joining does, so sharing is allowed, then
   * shares a new project. The test stubs the API again afterwards.
   */
  async function addSharedProject(
    { localStore, syncTeamConnection }: Awaited<ReturnType<typeof load>>,
    name: string,
  ) {
    stubApi(() => ({ cursor: "c0", projects: [] }));
    await syncTeamConnection(PLUGIN, CONNECTION);
    const projectId = localStore.addProject({ name, color: "#123456" });
    const shared = localStore.shareProjectWithTeam(CONNECTION, projectId);
    expect(shared.result).toEqual({ kind: "shared" });
    return { projectId, undoToken: shared.undoToken };
  }

  const answer = (request: TeamSyncRequest) => ({
    cursor: "c1",
    projects: [],
    assigned: assignAll(request),
  });

  it("sends a shared project once its Undo window closes, then sends nothing", async () => {
    const loaded = await load();
    const { localStore, syncTeamConnection } = loaded;
    const { projectId, undoToken } = await addSharedProject(loaded, "Beta");
    const api = stubApi(answer);

    await syncTeamConnection(PLUGIN, CONNECTION);
    expect(api.requests[0]?.changes).toEqual([]);

    localStore.forgetUndo(undoToken!);
    const outcome = await syncTeamConnection(PLUGIN, CONNECTION);
    expect(api.requests[1]).toMatchObject({
      cursor: "c1",
      changes: [{ localId: projectId, name: "Beta" }],
    });
    expect(outcome).toMatchObject({
      rounds: 1,
      sentProjectCount: 1,
      incomplete: false,
    });
    expect(
      localStore.snapshot().projects.find((p) => p._id === projectId)?.team,
    ).toMatchObject({ remoteId: `r-${projectId}` });

    await syncTeamConnection(PLUGIN, CONNECTION);
    expect(api.requests[2]?.changes).toEqual([]);
  });

  it("keeps another window from sending a project whose Undo is open here", async () => {
    const here = await load();
    const { projectId } = await addSharedProject(here, "Beta");

    // Another window: the same saved state, without this window's memory.
    vi.resetModules();
    const elsewhere = await load();
    const api = stubApi(answer);
    expect(elsewhere.localStore.pendingUndoProjectIds().has(projectId)).toBe(
      true,
    );
    await elsewhere.syncTeamConnection(PLUGIN, CONNECTION);
    expect(api.requests[0]?.changes).toEqual([]);
  });

  it("goes on while the team has more pages, from each page's cursor", async () => {
    const { localStore, syncTeamConnection } = await load();
    const api = stubApi((_, round) =>
      round === 1
        ? {
            cursor: "page-1",
            projects: [teamProject("r1", "Alpha")],
            hasMore: true,
          }
        : { cursor: "page-2", projects: [teamProject("r2", "Gamma")] },
    );

    const outcome = await syncTeamConnection(PLUGIN, CONNECTION);

    expect(api.requests.map((request) => request.cursor)).toEqual([
      undefined,
      "page-1",
    ]);
    expect(outcome).toMatchObject({ rounds: 2, incomplete: false });
    expect(outcome.createdProjectIds).toHaveLength(2);
    expect(localStore.snapshot().teamConnections?.[CONNECTION]?.cursor).toBe(
      "page-2",
    );
  });

  it("throws on an answer the workspace refuses and applies nothing", async () => {
    const loaded = await load();
    const { localStore, syncTeamConnection } = loaded;
    const { projectId, undoToken } = await addSharedProject(loaded, "Beta");
    localStore.forgetUndo(undoToken!);
    stubApi(() => ({ cursor: "c1", projects: [], assigned: [] }));
    const before = localStore.snapshot();

    await expect(syncTeamConnection(PLUGIN, CONNECTION)).rejects.toThrow(
      /left out the ID of a new project/,
    );
    const after = localStore.snapshot();
    expect(after.projects).toEqual(before.projects);
    expect(after.teamConnections?.[CONNECTION]?.cursor).toBe("c0");
    expect(after.projects.find((p) => p._id === projectId)?.team).toEqual({
      connectionId: CONNECTION,
    });
  });

  it("drops an answer for a connection removed while the round was on its way", async () => {
    const loaded = await load();
    const { localStore, syncTeamConnection, api } = loaded;
    const { projectId, undoToken } = await addSharedProject(loaded, "Beta");
    localStore.forgetUndo(undoToken!);
    let deliver!: (value: unknown) => void;
    stubApi(() => new Promise((resolve) => (deliver = resolve)));

    const sync = syncTeamConnection(PLUGIN, CONNECTION);
    await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
    await api.deletePluginConnection(PLUGIN, CONNECTION);
    deliver({
      cursor: "c1",
      projects: [teamProject("r-other", "Gamma")],
      assigned: [{ localId: projectId, remoteId: `r-${projectId}` }],
    });
    await sync;

    const state = localStore.snapshot();
    expect(state.projects.some((project) => project.name === "Gamma")).toBe(
      false,
    );
    expect(
      state.projects.find((p) => p._id === projectId)?.team,
    ).toBeUndefined();
    expect(state.teamConnections?.[CONNECTION]).toBeUndefined();
  });

  it("drops an answer for a connection pointed at another team meanwhile", async () => {
    const { localStore, syncTeamConnection } = await load();
    let deliver!: (value: unknown) => void;
    const api = stubApi(() => new Promise((resolve) => (deliver = resolve)));

    const sync = syncTeamConnection(PLUGIN, CONNECTION);
    await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
    api.overview = overviewWith("team-2");
    deliver({ cursor: "c9", projects: [teamProject("r-old", "Old team")] });
    await sync;

    const state = localStore.snapshot();
    expect(state.projects.some((project) => project.name === "Old team")).toBe(
      false,
    );
    expect(state.teamConnections?.[CONNECTION]).toBeUndefined();
  });

  it("turns the old team's projects local when the connection names a new team", async () => {
    const { localStore, syncTeamConnection } = await load();
    const api = stubApi(() => ({
      cursor: "c1",
      projects: [teamProject("r1", "Alpha")],
    }));
    await syncTeamConnection(PLUGIN, CONNECTION);
    const alpha = localStore
      .snapshot()
      .projects.find((project) => project.name === "Alpha")!;
    expect(alpha.team?.remoteId).toBe("r1");

    api.overview = overviewWith("team-2");
    await syncTeamConnection(PLUGIN, CONNECTION);

    const after = localStore.snapshot();
    expect(
      after.projects.find((p) => p._id === alpha._id)?.team,
    ).toBeUndefined();
    expect(api.requests[1]?.cursor).toBeUndefined();
  });

  it("keeps syncing after a removal that failed", async () => {
    const { localStore, syncTeamConnection, api } = await load();
    const stub = stubApi(() => ({
      cursor: "c1",
      projects: [teamProject("r1", "Alpha")],
    }));
    stub.failDelete = true;

    await expect(
      api.deletePluginConnection(PLUGIN, CONNECTION),
    ).rejects.toThrow(/Storage is busy/);
    const outcome = await syncTeamConnection(PLUGIN, CONNECTION);

    expect(outcome.rounds).toBe(1);
    expect(
      localStore
        .snapshot()
        .projects.some((project) => project.name === "Alpha"),
    ).toBe(true);
  });

  it("unshares without an Undo", async () => {
    const loaded = await load();
    const { localStore } = loaded;
    const { projectId, undoToken } = await addSharedProject(loaded, "Beta");
    localStore.forgetUndo(undoToken!);

    expect(localStore.unshareProjectFromTeam(projectId)).toBeUndefined();
    expect(localStore.pendingUndoProjectIds().has(projectId)).toBe(false);
    expect(
      localStore.snapshot().projects.find((p) => p._id === projectId)?.team,
    ).toBeUndefined();
  });

  it("runs as one team.sync job, with its rounds' calls and store commands in it", async () => {
    const { syncTeamConnection } = await load();
    const sink = createRecordingSink<AjourEvent>();
    (await import("./wide-events")).replaceEventSink(sink);
    stubApi(() => ({
      cursor: "c1",
      projects: [teamProject("r1", "Atlas canary")],
    }));

    await syncTeamConnection(PLUGIN, CONNECTION, { trigger: "schedule" });

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "team.sync",
        kind: "job",
        trigger: "schedule",
        outcome: "ok",
        plugin: { id: PLUGIN },
        connection: { id: CONNECTION },
        team_sync: {
          round_count: 1,
          projects_sent: 0,
          created_count: 1,
          updated_count: 0,
          held_arrival_count: 0,
          unsendable_count: 0,
          incomplete: false,
        },
        steps: ["team.apply_sync"],
        // The identity read before and after the round, and the round.
        counts: expect.objectContaining({
          api_call_count: 3,
          store_write_count: 1,
        }),
      }),
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("canary");
  });

  it("refuses a sync whose team connection is gone, in its one event", async () => {
    const { syncTeamConnection } = await load();
    const sink = createRecordingSink<AjourEvent>();
    (await import("./wide-events")).replaceEventSink(sink);
    const api = stubApi(() => ({ cursor: "c1", projects: [] }));
    api.overview = overviewWith(null);

    await expect(syncTeamConnection(PLUGIN, CONNECTION)).rejects.toThrow();

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "team.sync",
        trigger: "user",
        outcome: "refused",
        outcome_reason: "connection_not_found",
        error: { type: "Error" },
      }),
    ]);
  });
});

describe("team connections for sharing", () => {
  it("lists the connections of active team plugins, and none while plugins are off", async () => {
    const { teamConnectionsOf } = await import("./team-sync");
    const overview = overviewWith("team-1");

    expect(teamConnectionsOf(overview)).toEqual([
      { pluginId: PLUGIN, connectionId: CONNECTION, teamName: "Acme" },
    ]);
    expect(teamConnectionsOf({ ...overview, pluginsEnabled: false })).toEqual(
      [],
    );
    expect(
      teamConnectionsOf({
        ...overview,
        connectionGroups: overview.connectionGroups.map((group) => ({
          ...group,
          inactiveCapabilities: ["team" as const],
        })),
      }),
    ).toEqual([]);
  });
});
