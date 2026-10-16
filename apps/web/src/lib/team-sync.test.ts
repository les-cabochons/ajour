import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorsOverview, TeamSyncRequest } from "@ajour/shared";

const PLUGIN = "team";
const CONNECTION = "acme";
const SYNC_URL = `/api/teams/${PLUGIN}/connections/${CONNECTION}/sync`;

const overview: ConnectorsOverview = {
  pluginsEnabled: true,
  plugins: [],
  connectionGroups: [],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};

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

/** Answers each sync round with the next response, and records the requests. */
function stubTeam(
  respond: (
    request: TeamSyncRequest,
    round: number,
  ) => unknown | Promise<unknown>,
) {
  const requests: TeamSyncRequest[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(SYNC_URL)) {
      const request = JSON.parse(String(init?.body)) as TeamSyncRequest;
      requests.push(request);
      return Response.json(await respond(request, requests.length));
    }
    return Response.json(overview);
  });
  vi.stubGlobal("fetch", fetch);
  return requests;
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

  function addSharedProject(
    localStore: Awaited<ReturnType<typeof load>>["localStore"],
    name: string,
  ) {
    const projectId = localStore.addProject({ name, color: "#123456" });
    const shared = localStore.shareProjectWithTeam(CONNECTION, projectId);
    expect(shared.result).toEqual({ kind: "shared" });
    return { projectId, undoToken: shared.undoToken };
  }

  it("sends a shared project once its Undo window closes, then sends nothing", async () => {
    const { localStore, syncTeamConnection } = await load();
    const { projectId, undoToken } = addSharedProject(localStore, "Beta");
    const requests = stubTeam((request) => ({
      cursor: `c${requests.length}`,
      projects: [],
      assigned: assignAll(request),
    }));

    await syncTeamConnection(PLUGIN, CONNECTION);
    expect(requests[0]?.changes).toEqual([]);

    localStore.forgetUndo(undoToken!);
    const outcome = await syncTeamConnection(PLUGIN, CONNECTION);
    expect(requests[1]).toMatchObject({
      cursor: "c1",
      changes: [{ localId: projectId, name: "Beta" }],
    });
    expect(outcome).toMatchObject({ rounds: 1, incomplete: false });
    expect(
      localStore.snapshot().projects.find((p) => p._id === projectId)?.team,
    ).toMatchObject({ remoteId: `r-${projectId}` });

    await syncTeamConnection(PLUGIN, CONNECTION);
    expect(requests[2]?.changes).toEqual([]);
  });

  it("goes on while the team has more pages, from each page's cursor", async () => {
    const { localStore, syncTeamConnection } = await load();
    const requests = stubTeam((_, round) =>
      round === 1
        ? {
            cursor: "page-1",
            projects: [teamProject("r1", "Alpha")],
            hasMore: true,
          }
        : { cursor: "page-2", projects: [teamProject("r2", "Gamma")] },
    );

    const outcome = await syncTeamConnection(PLUGIN, CONNECTION);

    expect(requests.map((request) => request.cursor)).toEqual([
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
    const { localStore, syncTeamConnection } = await load();
    const { projectId, undoToken } = addSharedProject(localStore, "Beta");
    localStore.forgetUndo(undoToken!);
    stubTeam(() => ({ cursor: "c1", projects: [], assigned: [] }));
    const before = localStore.snapshot();

    await expect(syncTeamConnection(PLUGIN, CONNECTION)).rejects.toThrow(
      /left out the ID of a new project/,
    );
    const after = localStore.snapshot();
    expect(after.projects).toEqual(before.projects);
    expect(after.teamConnections?.[CONNECTION]?.cursor).toBeUndefined();
    expect(after.projects.find((p) => p._id === projectId)?.team).toEqual({
      connectionId: CONNECTION,
    });
  });

  it("drops an answer for a connection removed while the round was on its way", async () => {
    const { localStore, syncTeamConnection, api } = await load();
    const { projectId, undoToken } = addSharedProject(localStore, "Beta");
    localStore.forgetUndo(undoToken!);
    let answer!: (value: unknown) => void;
    stubTeam(() => new Promise((resolve) => (answer = resolve)));

    const sync = syncTeamConnection(PLUGIN, CONNECTION);
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    await api.deleteConnectorConnection(PLUGIN, CONNECTION);
    answer({
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
});
