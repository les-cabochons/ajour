import { useCallback, useEffect, useRef, useState } from "react";
import {
  queryLogs,
  tailLogs,
  type DesktopLogFilter,
  type LoggedEvent,
} from "@/lib/desktop-bridge";
import { eventKey, tailFilterOf } from "./diagnostics-events-model";

/** Events asked for at a time: one page of `logs.query`. */
export const EVENTS_PAGE_SIZE = 200;

export interface LogEventsState {
  status: "loading" | "ready" | "error";
  /** Newest first. */
  events: LoggedEvent[];
  /** The events that match, on every page, and those Live added since. */
  matchCount: number;
  nextCursor: string | null;
  loadingMore: boolean;
  /** Live couldn't follow the file. */
  liveError: boolean;
}

const LOADING: LogEventsState = {
  status: "loading",
  events: [],
  matchCount: 0,
  nextCursor: null,
  loadingMore: false,
  liveError: false,
};

const startedMs = (event: LoggedEvent) => Date.parse(event.started_at) || 0;

/**
 * Adds `added` to newest-first `events`, without the ones already there.
 * Returns how many were new.
 */
function merge(
  events: LoggedEvent[],
  added: LoggedEvent[],
  where: "before" | "after",
): { events: LoggedEvent[]; count: number } {
  const known = new Set(events.map(eventKey));
  const fresh = added.filter((event) => {
    const key = eventKey(event);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (fresh.length === 0) return { events, count: 0 };
  if (where === "after") return { events: [...events, ...fresh], count: 0 };
  const merged = [...fresh, ...events];
  // A unit is written when it ends, so a long one can arrive after units
  // that started later: keep the list newest first by start.
  merged.sort((a, b) => startedMs(b) - startedMs(a));
  return { events: merged, count: fresh.length };
}

/**
 * The events `logs.query` answers for `filter`, a page at a time, and while
 * `live` is on, the matching events main writes, through `logs.tail`. A null
 * filter matches nothing and asks main for nothing. A new filter starts over
 * and drops what an older one answers late.
 */
export function useLogEvents(filter: DesktopLogFilter | null, live: boolean) {
  const filterKey = filter ? JSON.stringify(filter) : null;
  const [state, setState] = useState<LogEventsState>(LOADING);
  const generation = useRef(0);
  const current = useRef({ filter, state });
  current.current = { filter, state };

  useEffect(() => {
    const run = ++generation.current;
    const query = current.current.filter;
    if (!query) {
      setState({ ...LOADING, status: "ready" });
      return;
    }
    setState(LOADING);
    queryLogs(query, { limit: EVENTS_PAGE_SIZE })
      .then((result) => {
        if (generation.current !== run) return;
        setState((previous) => {
          // Live may have delivered while the first page was on its way.
          const merged = merge(result.events, previous.events, "before");
          return {
            ...previous,
            status: "ready",
            events: merged.events,
            matchCount: result.match_count + merged.count,
            nextCursor: result.next_cursor,
          };
        });
      })
      .catch(() => {
        if (generation.current === run) {
          setState((previous) => ({ ...previous, status: "error" }));
        }
      });
  }, [filterKey]);

  useEffect(() => {
    const query = current.current.filter;
    if (!live || !query) return;
    let stopped = false;
    let stop: (() => void) | undefined;
    tailLogs(tailFilterOf(query), (batch) => {
      if (stopped) return;
      setState((previous) => {
        const merged = merge(previous.events, batch, "before");
        return merged.count === 0
          ? previous
          : {
              ...previous,
              events: merged.events,
              matchCount: previous.matchCount + merged.count,
            };
      });
    })
      .then((stopTail) => {
        if (stopped) stopTail();
        else stop = stopTail;
      })
      .catch(() => {
        if (!stopped) {
          setState((previous) => ({ ...previous, liveError: true }));
        }
      });
    setState((previous) =>
      previous.liveError ? { ...previous, liveError: false } : previous,
    );
    return () => {
      stopped = true;
      stop?.();
    };
  }, [filterKey, live]);

  /** Asks for the next page, once, when there is one. */
  const loadMore = useCallback(() => {
    const { filter: query, state: now } = current.current;
    if (!query || !now.nextCursor || now.loadingMore || now.status !== "ready")
      return;
    const run = generation.current;
    setState((previous) => ({ ...previous, loadingMore: true }));
    queryLogs(query, { limit: EVENTS_PAGE_SIZE, cursor: now.nextCursor })
      .then((result) => {
        if (generation.current !== run) return;
        setState((previous) => ({
          ...previous,
          events: merge(previous.events, result.events, "after").events,
          nextCursor: result.next_cursor,
          loadingMore: false,
        }));
      })
      .catch(() => {
        if (generation.current !== run) return;
        setState((previous) => ({ ...previous, loadingMore: false }));
      });
  }, []);

  return { ...state, loadMore };
}
