import { describe, expect, it, vi } from "vitest";
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
