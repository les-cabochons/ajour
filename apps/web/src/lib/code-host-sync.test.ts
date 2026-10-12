import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codeHostOverview as overview,
  pullRequestFacts as facts,
} from "../../tests/fixtures/pull-requests";

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { resolve, promise };
}
const result = {
  viewer: { login: "alex", isBot: false },
  pullRequests: [facts],
};
const source = {
  pluginId: "github",
  pluginName: "GitHub",
  connectionId: "work",
  connectionLabel: "Work",
};

describe("code host sync persistence", () => {
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

  it("deduplicates scheduled and manual sync and preserves settled choices across a reload", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    api.cacheConnectorsOverview(overview);
    localStore.syncPullRequests(source, result);
    const id = localStore.snapshot().pullRequests![0]!._id;
    localStore.changePullRequest(id, { type: "settle" });
    const post = deferred();
    const fetch = vi.fn((url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? post.promise
        : Promise.resolve(Response.json(overview)),
    );
    vi.stubGlobal("fetch", fetch);
    const first = api.syncCodeHostConnection("github", "work");
    expect(api.syncCodeHostConnection("github", "work")).toBe(first);
    post.resolve(Response.json(result));
    await first;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      tracked: [{ repository: "acme/api", number: 1 }],
    });
    vi.resetModules();
    const reloaded = (await import("./local-store")).localStore.snapshot();
    expect(reloaded.pullRequests).toEqual([
      expect.objectContaining({
        _id: id,
        status: "settled",
        facts: expect.objectContaining({ title: facts.title }),
      }),
    ]);
    expect(reloaded.userPreferences.changesEndSnoozeEarly).toBe(false);
  });

  it("does not change the list when a result fails validation", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    localStore.syncPullRequests(source, result);
    const before = localStore.snapshot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ...result, pullRequests: [{ ...facts, number: -1 }] }),
      ),
    );
    await expect(
      api.syncCodeHostConnection("github", "work"),
    ).rejects.toThrow();
    expect(localStore.snapshot()).toBe(before);
  });

  it("does not recreate records after a connection is removed during a sync", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    api.cacheConnectorsOverview(overview);
    localStore.syncPullRequests(source, result);
    const post = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? post.promise
          : Response.json(
              init?.method === "DELETE"
                ? { ...overview, connectionGroups: [] }
                : overview,
            ),
      ),
    );
    const sync = api.syncCodeHostConnection("github", "work");
    await api.deleteConnectorConnection("github", "work");
    post.resolve(Response.json(result));
    await sync;
    expect(localStore.snapshot().pullRequests).toEqual([]);
  });

  it("rejects a stale overview after plugin deactivation and keeps the local list", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    api.cacheConnectorsOverview(overview);
    localStore.syncPullRequests(source, result);
    const before = localStore.snapshot();
    const get = deferred();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ ...result, pullRequests: [] })
        : get.promise,
    );
    vi.stubGlobal("fetch", fetch);
    const sync = api.syncCodeHostConnection("github", "work");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    api.cacheConnectorsOverview({ ...overview, pluginsEnabled: false });
    get.resolve(Response.json(overview));
    await sync;
    expect(localStore.snapshot()).toBe(before);
  });
});
