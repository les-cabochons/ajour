import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
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
    api.cachePluginsOverview(overview);
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
    api.cachePluginsOverview(overview);
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
    await api.deletePluginConnection("github", "work");
    post.resolve(Response.json(result));
    await sync;
    expect(localStore.snapshot().pullRequests).toEqual([]);
  });

  it("rejects a stale overview after plugin deactivation and keeps the local list", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    api.cachePluginsOverview(overview);
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
    api.cachePluginsOverview({ ...overview, pluginsEnabled: false });
    get.resolve(Response.json(overview));
    await sync;
    expect(localStore.snapshot()).toBe(before);
  });

  it("restores records retained by an uninstall when the plugin is reinstalled", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    const instanceUrl = "https://github.com";
    const closed = { ...facts, id: "pr2", number: 2, title: "Old work" };
    localStore.syncPullRequests(source, {
      ...result,
      instanceUrl,
      pullRequests: [facts, closed],
    });
    const [kept] = localStore.snapshot().pullRequests!;
    localStore.changePullRequest(kept!._id, { type: "settle" });

    const replacementOverview = structuredClone(overview);
    replacementOverview.connectionGroups[0]!.connections[0]!.id = "replacement";
    api.cachePluginsOverview(replacementOverview);
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") return Response.json(replacementOverview);
        bodies.push(JSON.parse(init.body as string));
        const tracked = (bodies.at(-1) as { tracked: unknown[] }).tracked;
        return Response.json({
          ...result,
          instanceUrl,
          pullRequests:
            tracked.length > 0
              ? [facts, { ...closed, state: "merged", closedAt: Date.now() }]
              : [facts],
        });
      }),
    );

    await api.syncCodeHostConnection("github", "replacement");

    expect(bodies).toEqual([
      { tracked: [] },
      {
        tracked: [
          { repository: "acme/api", number: 1 },
          { repository: "acme/api", number: 2 },
        ],
      },
    ]);
    expect(localStore.snapshot().pullRequests).toEqual([
      expect.objectContaining({
        _id: kept!._id,
        connectionId: "replacement",
        status: "settled",
      }),
      expect.objectContaining({
        connectionId: "replacement",
        facts: expect.objectContaining({ number: 2, state: "merged" }),
      }),
    ]);
  });

  it("keeps the list when several retained connections match", async () => {
    const api = await import("./app-api");
    const { localStore } = await import("./local-store");
    const instanceUrl = "https://github.com";
    localStore.syncPullRequests(
      { ...source, connectionId: "a", connectionLabel: "One" },
      { ...result, instanceUrl },
    );
    localStore.syncPullRequests(
      { ...source, connectionId: "b", connectionLabel: "Two" },
      { ...result, instanceUrl },
    );
    const before = localStore.snapshot();
    const replacementOverview = structuredClone(overview);
    replacementOverview.connectionGroups[0]!.connections[0]!.id = "replacement";
    api.cachePluginsOverview(replacementOverview);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({ ...result, instanceUrl })
          : Response.json(replacementOverview),
      ),
    );

    await expect(
      api.syncCodeHostConnection("github", "replacement"),
    ).rejects.toThrow(
      "Several earlier connections match this account: One, Two.",
    );
    expect(localStore.snapshot()).toBe(before);
  });
  it("runs as one pull_request.sync job, the store command that applies it folded in", async () => {
    const api = await import("./app-api");
    const sink = createRecordingSink<AjourEvent>();
    (await import("./wide-events")).replaceEventSink(sink);
    const { localStore } = await import("./local-store");
    api.cachePluginsOverview(overview);
    localStore.syncPullRequests(source, result);
    sink.events.length = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json(result) : Response.json(overview),
    );
    vi.stubGlobal("fetch", fetch);

    await api.syncCodeHostConnection("github", "work", {
      trigger: "schedule",
    });

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pull_request.sync",
        kind: "job",
        trigger: "schedule",
        outcome: "ok",
        plugin: { id: "github" },
        connection: { id: "work" },
        pull_request: { tracked_count: 1, received_count: 1 },
        steps: ["pull_request.apply_sync"],
        counts: expect.objectContaining({ api_call_count: 2 }),
      }),
    ]);
    // Each call sent the job's span.
    for (const [, init] of fetch.mock.calls) {
      expect((init?.headers as Record<string, string>).traceparent).toBe(
        `00-${sink.events[0]!.trace_id}-${sink.events[0]!.span_id}-01`,
      );
    }
    expect(JSON.stringify(sink.events)).not.toContain(facts.title);
  });

  it("ends a sync whose answer lands after the plugin turned off as a noop that says why", async () => {
    const api = await import("./app-api");
    const sink = createRecordingSink<AjourEvent>();
    (await import("./wide-events")).replaceEventSink(sink);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json(result)
          : Response.json({ ...overview, pluginsEnabled: false }),
      ),
    );

    await api.syncCodeHostConnection("github", "work");

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pull_request.sync",
        trigger: "user",
        outcome: "noop",
        pull_request: expect.objectContaining({ discarded: "capability_off" }),
      }),
    ]);
  });
});
