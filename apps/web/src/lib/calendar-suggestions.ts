import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  CalendarEventFacts,
  CalendarListEventsRequest,
  CalendarListEventsResult,
} from "@ajour/shared";
import {
  buildCalendarSuggestions,
  enabledCalendarGroups,
  normalizeCalendarSuggestionSettings,
  type CalendarSource,
  type FetchedCalendarEvents,
} from "@/domain/time/calendar-suggestions";
import {
  getCachedPluginsOverview,
  listCalendarEvents,
  subscribePluginsOverview,
} from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { wideEvents } from "@/lib/wide-events";

/*
 * Calendar events live only in memory (ADR 0005): a reload, or a week left
 * longer than the refresh interval, fetches them again.
 */

export interface CalendarRange {
  /** First local date shown, YYYY-MM-DD. */
  from: string;
  /** Last local date shown, included. */
  to: string;
}

export interface CalendarRangeEntry {
  /** When the last successful fetch finished. */
  fetchedAt?: number;
  /** The last events fetched. An error keeps them. */
  events?: CalendarEventFacts[];
  /** Why the last fetch failed, as the API reported it. */
  error?: string;
  loading: boolean;
}

type CalendarFetcher = (
  pluginId: string,
  connectionId: string,
  request: CalendarListEventsRequest,
) => Promise<CalendarListEventsResult>;

/** The user's IANA time zone, which the plugin uses for floating times. */
export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Fetched events per connection and range. Concurrent loads of one range
 * share a request. A removed connection's entries are never read again: its
 * replacement gets a new id.
 */
export class CalendarEventCache {
  private readonly entries = new Map<string, CalendarRangeEntry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly fetcher: CalendarFetcher,
    private readonly now: () => number = Date.now,
    private readonly timeZone: () => string = currentTimeZone,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Changes whenever an entry changes, for `useSyncExternalStore`. */
  getVersion = () => this.version;

  get(
    source: Pick<CalendarSource, "pluginId" | "connectionId">,
    range: CalendarRange,
  ): CalendarRangeEntry | undefined {
    return this.entries.get(rangeKey(source, range));
  }

  /**
   * Fetches the range unless a fetch younger than `maxAgeMs` exists. `force`
   * fetches anyway, as Refresh does. Never rejects: a failure is in the entry,
   * which keeps the events fetched before. Each fetch is one `calendar.fetch`
   * job; a load the cache or a running fetch answers is none.
   */
  load(
    source: Pick<CalendarSource, "pluginId" | "connectionId">,
    range: CalendarRange,
    options: { maxAgeMs: number; force?: boolean },
  ): Promise<void> {
    const key = rangeKey(source, range);
    const running = this.pending.get(key);
    if (running) return running;
    const entry = this.entries.get(key);
    if (
      !options.force &&
      entry?.fetchedAt !== undefined &&
      this.now() - entry.fetchedAt < options.maxAgeMs
    ) {
      return Promise.resolve();
    }

    this.set(key, { ...entry, loading: true });
    // Refresh is the user's; a range that opens or goes stale, the app's.
    const job = wideEvents.start("calendar.fetch", {
      kind: "job",
      trigger: options.force ? "user" : "system",
      detached: true,
    });
    job.set({
      plugin: { id: source.pluginId },
      connection: { id: source.connectionId },
      calendar: {
        range_days: rangeDays(range),
        forced: options.force === true,
      },
    });
    const run = job
      .enter(() =>
        this.fetcher(source.pluginId, source.connectionId, {
          from: range.from,
          to: range.to,
          timeZone: this.timeZone(),
        }),
      )
      .then(
        (result) => {
          job.set({ calendar: { event_count: result.events.length } });
          this.set(key, {
            fetchedAt: this.now(),
            events: result.events,
            loading: false,
          });
        },
        (error: unknown) => {
          job.fail(error);
          const previous = this.entries.get(key);
          this.set(key, {
            fetchedAt: previous?.fetchedAt,
            events: previous?.events,
            error:
              error instanceof Error
                ? error.message
                : "The calendar could not be read.",
            loading: false,
          });
        },
      )
      .finally(() => {
        job.end();
        this.pending.delete(key);
      });
    this.pending.set(key, run);
    return run;
  }

  private set(key: string, entry: CalendarRangeEntry) {
    this.entries.set(key, entry);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/** The days a range spans, both ends included. */
function rangeDays(range: CalendarRange) {
  const days =
    (Date.parse(`${range.to}T00:00:00Z`) -
      Date.parse(`${range.from}T00:00:00Z`)) /
      86_400_000 +
    1;
  return Number.isFinite(days) ? days : undefined;
}

function rangeKey(
  source: Pick<CalendarSource, "pluginId" | "connectionId">,
  range: CalendarRange,
) {
  return JSON.stringify([
    source.pluginId,
    source.connectionId,
    range.from,
    range.to,
  ]);
}

export const calendarEventCache = new CalendarEventCache(listCalendarEvents);

/** Every connection of an enabled calendar plugin. */
export function useCalendarSources(): CalendarSource[] {
  const overview = useSyncExternalStore(
    subscribePluginsOverview,
    getCachedPluginsOverview,
    getCachedPluginsOverview,
  );
  return useMemo(
    () =>
      enabledCalendarGroups(overview).flatMap((group) =>
        group.connections.map((connection) => ({
          pluginId: group.plugin.id,
          connectionId: connection.id,
          connectionLabel: connection.label,
        })),
      ),
    [overview],
  );
}

export interface CalendarRangeState {
  fetched: FetchedCalendarEvents[];
  errors: { source: CalendarSource; message: string }[];
  loading: boolean;
  /** Whether any calendar connection is on. Without one, show nothing. */
  hasCalendar: boolean;
  refresh: () => void;
}

/**
 * The events of every enabled calendar connection for a range. Fetches when
 * the range opens, on `refresh`, and every refresh interval while the window
 * is visible.
 */
export function useCalendarEvents({
  from,
  to,
}: CalendarRange): CalendarRangeState {
  const sources = useCalendarSources();
  const state = useLocalState();
  const settings = normalizeCalendarSuggestionSettings(
    state.userPreferences.calendarSuggestions,
  );
  const maxAgeMs = settings.refreshMinutes * 60_000;
  const version = useSyncExternalStore(
    calendarEventCache.subscribe,
    calendarEventCache.getVersion,
    calendarEventCache.getVersion,
  );

  useEffect(() => {
    if (sources.length === 0) return;
    const loadAll = () => {
      for (const source of sources) {
        void calendarEventCache.load(source, { from, to }, { maxAgeMs });
      }
    };
    loadAll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadAll();
    }, maxAgeMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sources, from, to, maxAgeMs]);

  return useMemo(() => {
    // `version` changes with every cache entry, so the entries are read again.
    void version;
    const entries = sources.map((source) => ({
      source,
      entry: calendarEventCache.get(source, { from, to }),
    }));
    return {
      fetched: entries.flatMap(({ source, entry }) =>
        entry?.events ? [{ ...source, events: entry.events }] : [],
      ),
      errors: entries.flatMap(({ source, entry }) =>
        entry?.error ? [{ source, message: entry.error }] : [],
      ),
      loading: entries.some(({ entry }) => entry?.loading ?? true),
      hasCalendar: sources.length > 0,
      refresh: () => {
        for (const source of sources) {
          void calendarEventCache.load(
            source,
            { from, to },
            { maxAgeMs, force: true },
          );
        }
      },
    };
  }, [sources, from, to, version, maxAgeMs]);
}

/** The suggestions for a range, with the user's decisions and filters applied. */
export function useCalendarSuggestions(range: CalendarRange) {
  const calendar = useCalendarEvents(range);
  const state = useLocalState();
  const suggestions = useMemo(
    () =>
      buildCalendarSuggestions(
        state,
        calendar.fetched,
        normalizeCalendarSuggestionSettings(
          state.userPreferences.calendarSuggestions,
        ),
      ),
    [state, calendar.fetched],
  );
  return { ...calendar, suggestions };
}
