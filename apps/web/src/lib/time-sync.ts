import {
  isCapabilityActive,
  type PluginsOverview,
  type TimeSyncRouteResponse,
} from "@ajour/shared";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import {
  planTimeSyncRound,
  reconcileTimeSyncs,
  timeSyncStateOf,
  type PlannedTimeSyncRound,
  type TimeSyncConnectionRef,
  type TimeSyncContext,
  type TimeSyncRoundResult,
} from "@/domain/projects/time-sync";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";
import {
  connectionGeneration,
  getCachedPluginsOverview,
  getPluginsOverview,
  subscribePluginsOverview,
  syncTimeEntries,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { propertyPluginsOf } from "@/lib/plugin-project-properties";
import { exclusively } from "@/lib/window-lock";
import { wideEvents } from "@/lib/wide-events";

/*
 * Runs the time sync rounds (#692, ADR 0018) beside the project source
 * runner. A round plans from the local store, sends through the local API's
 * sync-time-entries route, and keeps the answer, with what changed in the
 * other system (#694) and what it puts back in a submitted week (#696).
 * A round that finds an entry to put back writes the store, so the next
 * round goes 2 s later and sends it. The rules live in
 * domain/projects/time-sync.ts. The runner sends a round 2 s after a store
 * write and every 60 s while Time entries is on and the plugin is active,
 * one round at a time per connection, and backs off after a failure.
 */

/** How long after a store write the runner sends its round. */
export const TIME_SYNC_DEBOUNCE_MS = 2_000;
/** How often the runner sends a round, to list the other system's window. */
export const TIME_SYNC_POLL_INTERVAL_MS = 60_000;
/** The waits before each retry after a failed round; the last one repeats. */
export const TIME_SYNC_RETRY_DELAYS_MS = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
] as const;

/**
 * What started a round: a store write, the 60-second poll, changes left
 * over from the last round, or a retry after a failure.
 */
export type TimeSyncTrigger = "change" | "poll" | "more" | "retry";

export type TimeSyncRoundOutcome =
  /** No round ran: nothing to send, or Time entries is off. */
  { kind: "idle" } | TimeSyncRoundResult;

/** A connection whose rounds may run now. */
export interface ActiveTimeSyncConnection extends TimeSyncConnectionRef {
  label: string;
}

/**
 * The connections whose rounds may run: Time entries on, the plugin active,
 * and the connection not paused for its secret.
 */
export function activeTimeSyncConnections(
  overview: PluginsOverview,
): ActiveTimeSyncConnection[] {
  if (overview.pluginsEnabled === false) return [];
  return overview.connectionGroups.flatMap((group) =>
    isCapabilityActive(group, "timeSync") && !group.plugin.unavailableReason
      ? group.connections
          .filter((connection) => !connection.paused)
          .map((connection) => ({
            pluginId: group.plugin.id,
            connectionId: connection.id,
            label: connection.label,
          }))
      : [],
  );
}

/**
 * Starts and stops time syncs to match the Time entries switches in
 * `overview`. It writes only when one starts or stops.
 */
export function followTimeSyncSwitches(overview: PluginsOverview) {
  const current = localStore.snapshot().timeSyncs ?? {};
  const today = formatLocalDateFromTimestamp(Date.now());
  if (reconcileTimeSyncs(current, overview, today, Date.now()) !== current) {
    localStore.followTimeSyncSwitches(overview);
  }
}

function contextFor(overview: PluginsOverview): TimeSyncContext {
  return {
    today: formatLocalDateFromTimestamp(Date.now()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    plugins: propertyPluginsOf(overview),
    namesSource: localStore.snapshot().userPreferences.commitLinesNameSource,
  };
}

function planFor(
  ref: TimeSyncConnectionRef,
  overview: PluginsOverview,
): PlannedTimeSyncRound | undefined {
  const context = contextFor(overview);
  const plan = planTimeSyncRound(
    timeSyncStateOf(localStore.snapshot()),
    ref,
    context,
    Date.now(),
  );
  return plan && { plan, context };
}

const keyOf = (ref: TimeSyncConnectionRef) =>
  JSON.stringify([ref.pluginId, ref.connectionId]);

/** The round of each connection running in this window. */
const runningRounds = new Map<string, Promise<TimeSyncRoundOutcome>>();

/**
 * Runs one round of a connection as one `time_sync.round` job: its local
 * API calls and the store commands that keep its answer fold into it. In
 * this window a call shares the connection's round in progress, and another
 * window's round runs first. A store write starts a round only when it
 * leaves something to send, so the runner's own writes start none. A round
 * that fails keeps its error on the connection and throws.
 */
export function runTimeSyncRound(
  pluginId: string,
  connectionId: string,
  trigger: TimeSyncTrigger,
): Promise<TimeSyncRoundOutcome> {
  const ref = { pluginId, connectionId };
  const key = keyOf(ref);
  const running = runningRounds.get(key);
  if (running) return running;
  if (trigger === "change") {
    // A connection without a time sync yet starts one in the round.
    const overview = getCachedPluginsOverview();
    const planned = overview && planFor(ref, overview);
    if (planned && planned.plan.request.changes.length === 0) {
      return Promise.resolve({ kind: "idle" });
    }
  }

  const run = async (
    job: Unit<AjourCatalog, "time_sync.round">,
  ): Promise<TimeSyncRoundOutcome> => {
    const generation = connectionGeneration(pluginId, connectionId);
    job.set({
      plugin: { id: pluginId },
      connection: { id: connectionId },
      time_sync_round: { trigger },
    });
    let planned: PlannedTimeSyncRound | undefined;
    let answer: TimeSyncRouteResponse;
    try {
      const overview = await job.enter(() => getPluginsOverview());
      if (
        !activeTimeSyncConnections(overview).some(
          (active) => keyOf(active) === key,
        )
      ) {
        job.refuse("capability_off");
        return { kind: "idle" };
      }
      job.enter(() => followTimeSyncSwitches(overview));
      // Planned inside the lock, so it reads what another window's round kept.
      planned = planFor(ref, overview);
      if (!planned) {
        job.refuse("connection_not_found");
        return { kind: "idle" };
      }
      const { request, waiting } = planned.plan;
      job.set({
        time_sync_round: {
          change_count: request.changes.length,
          waiting_count: waiting,
        },
      });
      if (trigger === "change" && request.changes.length === 0) {
        job.end("noop");
        return { kind: "idle" };
      }
      answer = await job.enter(() =>
        syncTimeEntries(pluginId, connectionId, request),
      );
    } catch (error) {
      // The changes wait for the next round; the connection shows why.
      const message =
        error instanceof Error ? error.message : "The round failed.";
      job.enter(() => localStore.failTimeSyncRound(ref, message, planned));
      throw error;
    }
    const { plan, context } = planned;
    job.set({ time_sync_round: { entry_count: answer.entries.length } });
    // Saved again in this window while the round ran: the answer may be for
    // another account.
    if (connectionGeneration(pluginId, connectionId) !== generation) {
      job
        .set({ time_sync_round: { discarded: "connection_changed" } })
        .end("noop");
      return { kind: "discarded" };
    }
    const result = job.enter(() =>
      localStore.applyTimeSyncRound(plan, answer, context),
    );
    if (result.kind === "discarded") {
      job
        .set({ time_sync_round: { discarded: "time_sync_stopped" } })
        .end("noop");
      return result;
    }
    job.set({
      time_sync_round: {
        synced_count: result.synced,
        put_back_count: result.putBack,
        refused_count: result.refused,
        failed_count: result.failed,
        received_count: result.received,
        held_count: result.held,
      },
    });
    return result;
  };

  // The job opens now, so the time another window holds the lock counts too.
  const promise = wideEvents
    .run(
      "time_sync.round",
      { kind: "job", trigger: "schedule", detached: true },
      (job) => exclusively(`ajour-time-sync:${key}`, () => run(job)),
    )
    .finally(() => {
      if (runningRounds.get(key) === promise) runningRounds.delete(key);
    });
  runningRounds.set(key, promise);
  return promise;
}

/** What the runner tells its host about each connection's rounds. */
export interface TimeSyncRunnerListener {
  /** A round failed as a whole. The runner retries it after a wait. */
  failed(connection: ActiveTimeSyncConnection, message: string): void;
  /** A round of the connection went through. */
  succeeded(connection: ActiveTimeSyncConnection): void;
}

/** The runner's state for one connection. */
interface ConnectionSlot {
  running: boolean;
  /** A round asked for while one ran: it runs right after. */
  queued?: TimeSyncTrigger;
  /** Failed rounds in a row. */
  failures: number;
  /** Until when rounds wait for the retry, after a failure. */
  retryAt?: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Starts the rounds of every connection with Time entries on, and returns
 * the function that stops them. It follows the switches as the plugins
 * overview changes, sends a round 2 s after a store write from any window,
 * polls every 60 s, runs the next round at once while changes wait, and
 * after a failure waits 5 s, then longer, up to 5 minutes, before it tries
 * again. The tick records nothing; each round is its own job.
 */
export function startTimeSyncRunner(
  listener: TimeSyncRunnerListener,
): () => void {
  let stopped = false;
  let overview: PluginsOverview | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const slots = new Map<string, ConnectionSlot>();

  const active = () => (overview ? activeTimeSyncConnections(overview) : []);

  const slotOf = (key: string) => {
    let slot = slots.get(key);
    if (!slot) {
      slot = { running: false, failures: 0 };
      slots.set(key, slot);
    }
    return slot;
  };

  const run = (
    connection: ActiveTimeSyncConnection,
    trigger: TimeSyncTrigger,
  ) => {
    if (stopped) return;
    const slot = slotOf(keyOf(connection));
    // While it backs off, the retry sends what waits.
    if (trigger !== "retry" && slot.retryAt && Date.now() < slot.retryAt) {
      return;
    }
    if (slot.running) {
      slot.queued ??= trigger;
      return;
    }
    slot.running = true;
    let next: TimeSyncTrigger | undefined;
    /** Waits longer after each failure in a row, then retries. */
    const backOff = () => {
      slot.failures += 1;
      const delay =
        TIME_SYNC_RETRY_DELAYS_MS[
          Math.min(slot.failures, TIME_SYNC_RETRY_DELAYS_MS.length) - 1
        ]!;
      slot.retryAt = Date.now() + delay;
      clearTimeout(slot.retryTimer);
      slot.retryTimer = setTimeout(() => run(connection, "retry"), delay);
    };
    runTimeSyncRound(connection.pluginId, connection.connectionId, trigger)
      .then(
        (outcome) => {
          if (outcome.kind === "idle") return;
          listener.succeeded(connection);
          // Changes that failed are sent again after a wait, as after a
          // failed round, never at once, or the same ones would loop.
          if (outcome.kind === "applied" && outcome.failed > 0) {
            backOff();
            return;
          }
          slot.failures = 0;
          slot.retryAt = undefined;
          clearTimeout(slot.retryTimer);
          if (outcome.kind === "applied" && outcome.waiting > 0) next = "more";
        },
        (error: unknown) => {
          // The round's own event records the failure.
          backOff();
          listener.failed(
            connection,
            error instanceof Error ? error.message : "Unknown error",
          );
        },
      )
      .finally(() => {
        slot.running = false;
        const queued = slot.queued;
        slot.queued = undefined;
        if (next ?? queued) run(connection, (next ?? queued)!);
      });
  };

  /** Sends each active connection's poll round, then waits for the next. */
  const poll = () => {
    if (stopped) return;
    clearTimeout(pollTimer);
    for (const connection of active()) run(connection, "poll");
    pollTimer = setTimeout(poll, TIME_SYNC_POLL_INTERVAL_MS);
  };

  /**
   * Follows the switches, forgets the connections that stopped, and starts
   * the 60-second poll with the first overview. The runner reads no overview of its
   * own: the sync scheduler refreshes it every 30 seconds, and each round
   * reads a fresh one before it sends.
   */
  const receive = (next: PluginsOverview) => {
    const first = overview === undefined;
    overview = next;
    try {
      followTimeSyncSwitches(next);
    } catch {
      // Another window wrote first: its event records the refusal, and the
      // next overview tries again. The overview's other readers go on.
    }
    const keys = new Set(active().map(keyOf));
    for (const [key, slot] of slots) {
      if (!keys.has(key) && !slot.running) {
        clearTimeout(slot.retryTimer);
        slots.delete(key);
      }
    }
    if (first) pollTimer = setTimeout(poll, TIME_SYNC_POLL_INTERVAL_MS);
  };

  const unsubscribeOverview = subscribePluginsOverview(receive);
  const unsubscribeStore = localStore.subscribe(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const connection of active()) run(connection, "change");
    }, TIME_SYNC_DEBOUNCE_MS);
  });
  const cached = getCachedPluginsOverview();
  if (cached) receive(cached);

  return () => {
    stopped = true;
    unsubscribeOverview();
    unsubscribeStore();
    clearTimeout(debounceTimer);
    clearTimeout(pollTimer);
    for (const slot of slots.values()) clearTimeout(slot.retryTimer);
  };
}
