import { afterEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import type { CalendarListEventsResult } from "@ajour/shared";
import { CalendarEventCache } from "@/lib/calendar-suggestions";

const source = { pluginId: "ics", connectionId: "work" };
const week = { from: "2026-10-12", to: "2026-10-18" };
const event = {
  eventId: "standup",
  startsAt: 1,
  endsAt: 2,
  allDay: false,
  title: "Daily standup",
  status: "confirmed" as const,
  response: "accepted" as const,
  busy: true,
};

function deferred() {
  let resolve!: (value: CalendarListEventsResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CalendarListEventsResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CalendarEventCache", () => {
  it("fetches a range once, shares concurrent loads and refetches when stale or forced", async () => {
    let now = 0;
    const fetcher = vi.fn(async () => ({ events: [event] }));
    const cache = new CalendarEventCache(
      fetcher,
      () => now,
      () => "America/Toronto",
    );

    await Promise.all([
      cache.load(source, week, { maxAgeMs: 600_000 }),
      cache.load(source, week, { maxAgeMs: 600_000 }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("ics", "work", {
      ...week,
      timeZone: "America/Toronto",
    });
    expect(cache.get(source, week)).toEqual({
      fetchedAt: 0,
      events: [event],
      loading: false,
    });

    now = 599_999;
    await cache.load(source, week, { maxAgeMs: 600_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await cache.load(source, week, { maxAgeMs: 600_000, force: true });
    now = 1_300_000;
    await cache.load(source, week, { maxAgeMs: 600_000 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps the last events with the error when a fetch fails, and notifies listeners", async () => {
    const pending = deferred();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ events: [event] })
      .mockReturnValueOnce(pending.promise);
    const cache = new CalendarEventCache(
      fetcher,
      () => 5,
      () => "UTC",
    );
    const listener = vi.fn();
    cache.subscribe(listener);

    await cache.load(source, week, { maxAgeMs: 0 });
    const refresh = cache.load(source, week, { maxAgeMs: 0, force: true });
    expect(cache.get(source, week)).toMatchObject({
      events: [event],
      loading: true,
    });

    pending.reject(
      new Error("The calendar address no longer exists (HTTP 404)."),
    );
    await refresh;
    expect(cache.get(source, week)).toEqual({
      fetchedAt: 5,
      events: [event],
      error: "The calendar address no longer exists (HTTP 404).",
      loading: false,
    });
    expect(listener).toHaveBeenCalledTimes(4);
    expect(cache.getVersion()).toBe(4);
  });

  it("keeps ranges and connections apart", async () => {
    const fetcher = vi.fn(async () => ({ events: [] }));
    const cache = new CalendarEventCache(
      fetcher,
      () => 0,
      () => "UTC",
    );

    await cache.load(source, week, { maxAgeMs: 600_000 });
    await cache.load(
      source,
      { from: "2026-10-19", to: "2026-10-25" },
      { maxAgeMs: 600_000 },
    );
    await cache.load({ ...source, connectionId: "personal" }, week, {
      maxAgeMs: 600_000,
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      cache.get({ ...source, connectionId: "other" }, week),
    ).toBeUndefined();
  });
});

describe("a calendar fetch's event", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The app's cache, on the real local API client, with a recording sink. */
  async function load(answer: () => Response) {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
      },
    });
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetch);
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const { calendarEventCache } = await import("@/lib/calendar-suggestions");
    return { cache: calendarEventCache, fetch, recorded: sink.events };
  }

  it("is one job per fetch, and none for a load the cache answers", async () => {
    const { cache, fetch, recorded } = await load(() =>
      Response.json({ events: [event] }),
    );

    await cache.load(source, week, { maxAgeMs: 600_000 });
    await cache.load(source, week, { maxAgeMs: 600_000 });
    await cache.load(source, week, { maxAgeMs: 600_000, force: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "calendar.fetch",
        kind: "job",
        trigger: "system",
        outcome: "ok",
        plugin: { id: "ics" },
        connection: { id: "work" },
        calendar: { range_days: 7, forced: false, event_count: 1 },
        counts: expect.objectContaining({ api_call_count: 1 }),
      }),
      expect.objectContaining({
        name: "calendar.fetch",
        trigger: "user",
        calendar: { range_days: 7, forced: true, event_count: 1 },
      }),
    ]);
    expect(JSON.stringify(recorded)).not.toContain("standup");
  });

  it("records a failed fetch, which the cache keeps in its entry", async () => {
    const { cache, recorded } = await load(() =>
      Response.json({ error: "Feed unreachable." }, { status: 502 }),
    );

    await cache.load(source, week, { maxAgeMs: 600_000 });

    expect(cache.get(source, week)?.error).toBe("Feed unreachable.");
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "calendar.fetch",
        outcome: "error",
        error: { type: "Error" },
        counts: expect.objectContaining({ api_failed_call_count: 1 }),
      }),
    ]);
  });
});
