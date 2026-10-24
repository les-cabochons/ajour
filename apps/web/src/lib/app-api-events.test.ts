import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { catalog } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { decodeTraceparent } from "@ajour/wide-events/trace-context.ts";

/*
 * The local API client's events (#310), through the client functions
 * themselves with a stubbed fetch: a call sends the active unit's
 * `traceparent` and counts on it, a call outside any unit is its own
 * `command`, named from the client table, and a poll is none.
 */

const mcpSettings = { enabled: true, clients: [] };

function installWindow(ajourDesktop?: object) {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
    ...(ajourDesktop ? { ajourDesktop } : {}),
  });
}

/** The modules as a fresh window loads them, with a recording sink. */
async function load() {
  const sink = createRecordingSink<AjourEvent>();
  const events = await import("@/lib/wide-events");
  events.replaceEventSink(sink);
  const api = await import("@/lib/app-api");
  return { api, events, recorded: sink.events };
}

/** The `traceparent` header each fetch sent. */
function sentTraceparents(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.map(
    ([, init]) =>
      (init as RequestInit | undefined)?.headers as Record<string, string>,
  );
}

beforeEach(() => {
  vi.resetModules();
  installWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the local API client's events", () => {
  it("names every client function after a request event a command or a job may open", async () => {
    const { api } = await load();

    for (const name of Object.values(api.APP_API_CLIENT)) {
      const spec = catalog.events[name];
      expect(spec.fields, name).toHaveProperty("http");
      expect(
        spec.kinds.some((kind) => kind === "command" || kind === "job"),
        name,
      ).toBe(true);
    }
  });

  it("makes a call outside any unit its own command, joined by the traceparent it sends", async () => {
    const { api, recorded } = await load();
    const fetch = vi.fn(async () => Response.json(mcpSettings));
    vi.stubGlobal("fetch", fetch);

    await api.getMcpSettings();

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "mcp.status",
        kind: "command",
        runtime: "renderer",
        outcome: "ok",
        trigger: "user",
        http: { method: "GET", status_code: 200 },
        counts: expect.objectContaining({
          api_call_count: 1,
          api_attempt_count: 1,
          api_call_ms: expect.any(Number),
        }),
      }),
    ]);
    const [headers] = sentTraceparents(fetch);
    expect(decodeTraceparent(headers!.traceparent!)).toEqual({
      trace_id: recorded[0]!.trace_id,
      span_id: recorded[0]!.span_id,
    });
  });

  it("refuses a call the local API answers with a 4xx, with its status and never its message", async () => {
    const { api, recorded } = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "No client named Ana's laptop." },
          { status: 404 },
        ),
      ),
    );

    await expect(api.revokeMcpClient("client-1")).rejects.toThrow();

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "agent_client.revoke",
        kind: "command",
        outcome: "refused",
        http: { method: "POST", status_code: 404 },
        error: { type: "Error" },
        counts: expect.objectContaining({
          api_call_count: 1,
          api_failed_call_count: 1,
        }),
      }),
    ]);
    expect(JSON.stringify(recorded)).not.toContain("Ana");
  });

  it("counts every attempt of a call that never reached the local API", async () => {
    vi.useFakeTimers();
    const { api, recorded } = await load();
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetch);

    const call = api.getMcpSettings();
    const failed = expect(call).rejects.toThrow();
    await vi.runAllTimersAsync();
    await failed;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "mcp.status",
        outcome: "error",
        error: { type: "AppApiUnavailableError" },
        counts: expect.objectContaining({
          api_call_count: 1,
          api_attempt_count: 3,
          api_failed_call_count: 1,
        }),
      }),
    ]);
  });

  it("adds a call made inside a unit to that unit, and sends its span", async () => {
    const { api, events, recorded } = await load();
    const fetch = vi.fn(async () => Response.json(mcpSettings));
    vi.stubGlobal("fetch", fetch);

    await events.wideEvents.run(
      "pending_writes.flush",
      { kind: "job", trigger: "boot" },
      () => Promise.all([api.getMcpSettings(), api.getMcpSettings()]),
    );

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "pending_writes.flush",
        counts: expect.objectContaining({
          api_call_count: 2,
          api_attempt_count: 2,
        }),
      }),
    ]);
    for (const headers of sentTraceparents(fetch)) {
      expect(decodeTraceparent(headers.traceparent!)).toEqual({
        trace_id: recorded[0]!.trace_id,
        span_id: recorded[0]!.span_id,
      });
    }
  });

  it("records nothing for a poll, and sends no trace", async () => {
    const { api, recorded } = await load();
    const fetch = vi.fn(async () => Response.json(mcpSettings));
    vi.stubGlobal("fetch", fetch);

    await api.asPoll(() => api.getMcpSettings());

    expect(recorded).toEqual([]);
    expect(sentTraceparents(fetch)[0]).not.toHaveProperty("traceparent");
  });

  it("passes the active unit's traceparent with a desktop bridge call", async () => {
    const getPluginCatalogSettings = vi.fn(async () => ({
      refreshMinutes: 15,
    }));
    installWindow({ getPluginCatalogSettings });
    const { api, events, recorded } = await load();

    await events.wideEvents.run(
      "pending_writes.flush",
      { kind: "job", trigger: "boot" },
      () => api.getPluginCatalogSettings(),
    );
    await api.getPluginCatalogSettings();

    const [inside, outside] = getPluginCatalogSettings.mock
      .calls as unknown as [[{ traceparent: string }], [undefined]];
    expect(decodeTraceparent(inside[0].traceparent)).toEqual({
      trace_id: recorded[0]!.trace_id,
      span_id: recorded[0]!.span_id,
    });
    expect(outside[0]).toBeUndefined();
  });

  it("names Ajour's item on each comment call that is its own command, never a source ID", async () => {
    const { api, events, recorded } = await load();
    const person = { id: "person-canary", displayName: "Canary" };
    const comment = {
      id: "comment-canary",
      author: person,
      body: "Canary body",
      createdAt: "2026-10-13T10:00:00Z",
    };
    const answers = [
      { viewer: person, comments: [comment] },
      { comment },
      { comment },
      { reactions: [] },
      { people: [person] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(answers.shift())),
    );
    const caller = { itemId: "item-1" };
    const ref = { sourceId: "source-canary-101" };

    await api.listItemComments(
      "azure_devops",
      "ado-1",
      { ...ref, limit: 5 },
      { ...caller, cacheHit: false },
    );
    await api.postItemComment(
      "azure_devops",
      "ado-1",
      { ...ref, body: "Canary body" },
      caller,
    );
    await api.editItemComment(
      "azure_devops",
      "ado-1",
      { ...ref, commentId: "comment-canary", body: "Canary body" },
      caller,
    );
    await api.setItemCommentReaction(
      "azure_devops",
      "ado-1",
      { ...ref, commentId: "comment-canary", reaction: "like", reacted: true },
      caller,
    );
    await api.searchItemPeople(
      "azure_devops",
      "ado-1",
      { ...ref, query: "", limit: 20 },
      caller,
    );
    // A call made inside another unit leaves that unit's fields alone.
    await events.wideEvents.run(
      "pending_writes.flush",
      { kind: "job", trigger: "boot" },
      async () => {
        answers.push({ people: [person] });
        await api.searchItemPeople(
          "azure_devops",
          "ado-1",
          { ...ref, query: "", limit: 20 },
          caller,
        );
      },
    );

    expect(recorded.map((event) => [event.name, event.backlog_item])).toEqual([
      ["comment.list", { id: "item-1" }],
      ["comment.post", { id: "item-1" }],
      ["comment.edit", { id: "item-1" }],
      ["comment.react", { id: "item-1" }],
      ["mention.search", { id: "item-1" }],
      ["pending_writes.flush", undefined],
    ]);
    expect(recorded[0]).toMatchObject({ comment: { cache_hit: false } });
    expect(JSON.stringify(recorded)).not.toMatch(/canary/i);
  });
});
