import {
  isCapabilityActive,
  type PluginsOverview,
  type TimeSyncResult,
} from "@ajour/shared";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import type { LocalAppState, LocalTimeSync } from "@/domain/local-state";
import {
  listingRoundOf,
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
 * round goes 2 s later and sends it. A round that would change an entry the
 * other system has lists the window first, with no changes, and plans again
 * from what that took, since the plugin applies changes before it lists.
 * The rules live in
 * domain/projects/time-sync.ts. The runner sends a round 2 s after a store
 * write and checks every 5 s while the window shows, every 60 s while it is
 * hidden, while Time entries is on and the plugin is active, one round at a
 * time per connection, and backs off after a failure.
 *
 * A check (#843) is a round with the cursor of the last full answer and no
 * changes, sent while nothing the rules read changed in Ajour since that
 * answer was kept. A plugin with a change marker answers it unchanged
 * without listing, and the check keeps nothing. Any other round is full and
 * sends no cursor, unless it has changes to send: the plugin then gets the
 * cursor too, to reuse what it keeps there. A plugin that answers without a cursor has nothing to
 * check against, so its checks list at most once a minute, as the 60-second
 * poll did before #843.
 */

/** How long after a store write the runner sends its round. */
export const TIME_SYNC_DEBOUNCE_MS = 2_000;
/** How often the runner checks the other system while the window shows. */
export const TIME_SYNC_CHECK_INTERVAL_MS = 5_000;
/** How often it checks while the window is hidden, such as closed to the tray. */
export const TIME_SYNC_HIDDEN_CHECK_INTERVAL_MS = 60_000;
/**
 * How long a connection without a cursor waits after its last listing
 * before a check lists again: the 60-second poll of before #843.
 */
export const TIME_SYNC_LISTING_INTERVAL_MS = 60_000;
/** The waits before each retry after a failed round; the last one repeats. */
export const TIME_SYNC_RETRY_DELAYS_MS = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
] as const;

/**
 * What started a round: a store write, the check every 5 or 60 seconds,
 * changes left over from the last round, or a retry after a failure. Only a
 * check may send the cursor.
 */
export type TimeSyncTrigger = "change" | "check" | "more" | "retry";

export type TimeSyncRoundOutcome =
  /** No round ran: nothing to send, or Time entries is off. */
  | { kind: "idle" }
  /** A check the plugin answered unchanged: the round kept nothing. */
  | { kind: "unchanged" }
  | TimeSyncRoundResult;

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

/**
 * The local API refuses an unchanged answer to a request without a cursor,
 * so a full round never gets one; this names it if it ever does.
 */
const UNCHANGED_TO_FULL_ROUND =
  "The plugin answered unchanged to a round without a cursor.";

/** The round of each connection running in this window. */
const runningRounds = new Map<string, Promise<TimeSyncRoundOutcome>>();

/**
 * What the time sync rules read from the local state for one connection.
 * The store replaces each of these it changes, so the same objects mean
 * nothing the rules read changed. Only time passing can then change a plan,
 * which a check plans again for.
 */
interface TimeSyncInputs {
  projects: LocalAppState["projects"];
  timers: LocalAppState["timers"];
  timesheetEntries: LocalAppState["timesheetEntries"];
  lockedWeeks: LocalAppState["lockedWeeks"];
  /** The connection's time sync record. */
  record: LocalTimeSync | undefined;
}

function inputsOf(
  state: LocalAppState,
  ref: TimeSyncConnectionRef,
): TimeSyncInputs {
  const timeSyncs = state.timeSyncs ?? {};
  return {
    projects: state.projects,
    timers: state.timers,
    timesheetEntries: state.timesheetEntries,
    lockedWeeks: state.lockedWeeks,
    record: Object.hasOwn(timeSyncs, ref.connectionId)
      ? timeSyncs[ref.connectionId]
      : undefined,
  };
}

const sameInputs = (left: TimeSyncInputs, right: TimeSyncInputs) =>
  left.projects === right.projects &&
  left.timers === right.timers &&
  left.timesheetEntries === right.timesheetEntries &&
  left.lockedWeeks === right.lockedWeeks &&
  left.record === right.record;

/**
 * Where the last full answer of a connection left it: the plugin's cursor,
 * the connection's save count in this window, and Ajour's inputs as that
 * answer left them. Kept in this window's memory only, never in the state,
 * since a cursor may hold a read link.
 */
interface CheckPoint {
  cursor: string;
  generation: number;
  inputs: TimeSyncInputs;
  /**
   * The day that answer was taken on. The rules take a remote entry by its
   * day, such as one dated after today that waits for it, so a new day
   * makes the next round full.
   */
  today: string;
}

/** Each connection's check point, while its last full answer gave a cursor. */
const checkPoints = new Map<string, CheckPoint>();

/** Whether the connection's last full answer gave a cursor to check against. */
function hasCursor(ref: TimeSyncConnectionRef) {
  return checkPoints.has(keyOf(ref));
}

/** A check ready to send: its cursor, its plan, the inputs it planned from, and the check point's day. */
interface PlannedCheck {
  cursor: string;
  planned: PlannedTimeSyncRound;
  inputs: TimeSyncInputs;
  today: string;
}

/**
 * The check a connection may send now, or undefined when its round must be
 * full: no cursor, the connection saved again since, something the rules
 * read changed, a new day, the cached overview doesn't show it active, or time passing
 * left changes to send.
 */
function planCheck(ref: TimeSyncConnectionRef): PlannedCheck | undefined {
  const key = keyOf(ref);
  const point = checkPoints.get(key);
  if (!point) return undefined;
  if (
    point.generation !== connectionGeneration(ref.pluginId, ref.connectionId)
  ) {
    checkPoints.delete(key);
    return undefined;
  }
  const inputs = inputsOf(localStore.snapshot(), ref);
  if (!sameInputs(inputs, point.inputs)) return undefined;
  const overview = getCachedPluginsOverview();
  if (
    !overview ||
    !activeTimeSyncConnections(overview).some((active) => keyOf(active) === key)
  ) {
    return undefined;
  }
  const planned = planFor(ref, overview);
  if (!planned || planned.plan.request.changes.length > 0) return undefined;
  if (planned.context.today !== point.today) return undefined;
  return { cursor: point.cursor, planned, inputs, today: point.today };
}

/**
 * Runs one round of a connection as one `time_sync.round` job: its local
 * API calls and the store commands that keep its answer fold into it. In
 * this window a call shares the connection's round in progress, and another
 * window's round runs first. A store write starts a round only when it
 * leaves something to send, so the runner's own writes start none. A check
 * that finds nothing changed in Ajour sends the cursor without the lock or
 * a fresh overview, and keeps nothing when the plugin answers unchanged: its
 * job is then a quiet noop, which the local log file leaves out. A
 * round that fails keeps its error on the connection, drops the cursor and
 * throws.
 */
export function runTimeSyncRound(
  pluginId: string,
  connectionId: string,
  trigger: TimeSyncTrigger,
): Promise<TimeSyncRoundOutcome> {
  const ref = { pluginId, connectionId };
  const key = keyOf(ref);
  const lock = `ajour-time-sync:${key}`;
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

  /**
   * Keeps one answer of the round, unless the connection was saved again
   * or Time entries went off while it ran, and counts it on the job. Its
   * cursor, if any, becomes the connection's check point.
   */
  const keep = (
    job: Unit<AjourCatalog, "time_sync.round">,
    generation: number,
    { plan, context }: PlannedTimeSyncRound,
    answer: TimeSyncResult,
  ): TimeSyncRoundOutcome => {
    job.set({
      time_sync_round: { unchanged: false, entry_count: answer.entries.length },
    });
    // Saved again in this window while the round ran: the answer may be
    // for another account.
    if (connectionGeneration(pluginId, connectionId) !== generation) {
      checkPoints.delete(key);
      job
        .set({ time_sync_round: { discarded: "connection_changed" } })
        .end("noop");
      return { kind: "discarded" };
    }
    const result = job.enter(() =>
      localStore.applyTimeSyncRound(plan, answer, context),
    );
    if (result.kind === "discarded") {
      checkPoints.delete(key);
      job
        .set({ time_sync_round: { discarded: "time_sync_stopped" } })
        .end("noop");
      return result;
    }
    if (answer.cursor === undefined) {
      checkPoints.delete(key);
    } else {
      checkPoints.set(key, {
        cursor: answer.cursor,
        generation,
        inputs: inputsOf(localStore.snapshot(), ref),
        today: context.today,
      });
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

  /** Keeps why the round failed on the connection, and drops the cursor. */
  const fail = (
    job: Unit<AjourCatalog, "time_sync.round">,
    error: unknown,
    sent: PlannedTimeSyncRound | undefined,
  ) => {
    checkPoints.delete(key);
    // The changes wait for the next round; the connection shows why. Only
    // the creates of a request that went out may be there (#838).
    const message =
      error instanceof Error ? error.message : "The round failed.";
    job.enter(() => localStore.failTimeSyncRound(ref, message, sent));
  };

  /**
   * A check: the cursor and no changes, outside the lock. An unchanged
   * answer only moves the cursor. A full one is kept in the lock, as a full
   * round's is, unless Ajour changed while it ran: the plan would no longer
   * hold, so it is dropped and the next round is full.
   */
  const check = async (
    job: Unit<AjourCatalog, "time_sync.round">,
    { cursor, planned, inputs, today }: PlannedCheck,
  ): Promise<TimeSyncRoundOutcome> => {
    const generation = connectionGeneration(pluginId, connectionId);
    job.set({ time_sync_round: { has_cursor: true, change_count: 0 } });
    const request = { ...planned.plan.request, cursor };
    let answer: Awaited<ReturnType<typeof syncTimeEntries>>;
    try {
      answer = await job.enter(() =>
        syncTimeEntries(pluginId, connectionId, request),
      );
    } catch (error) {
      fail(job, error, planned);
      throw error;
    }
    if ("unchanged" in answer) {
      job.set({ time_sync_round: { unchanged: true } });
      if (connectionGeneration(pluginId, connectionId) !== generation) {
        checkPoints.delete(key);
        job
          .set({ time_sync_round: { discarded: "connection_changed" } })
          .end("noop");
        return { kind: "discarded" };
      }
      checkPoints.set(key, {
        cursor: answer.cursor,
        generation,
        inputs,
        today,
      });
      // A check every few seconds that found nothing: the local log file
      // leaves it out, unless it was slow (#844).
      job.quiet().end();
      return { kind: "unchanged" };
    }
    const full = answer;
    return exclusively(lock, async () => {
      if (!sameInputs(inputsOf(localStore.snapshot(), ref), inputs)) {
        checkPoints.delete(key);
        job
          .set({
            time_sync_round: {
              unchanged: false,
              entry_count: full.entries.length,
              discarded: "inputs_changed",
            },
          })
          .end("noop");
        return { kind: "discarded" };
      }
      return keep(job, generation, planned, full);
    });
  };

  /** A full round, in the lock, from a fresh overview, without the cursor. */
  const run = async (
    job: Unit<AjourCatalog, "time_sync.round">,
  ): Promise<TimeSyncRoundOutcome> => {
    const generation = connectionGeneration(pluginId, connectionId);
    job.set({ time_sync_round: { has_cursor: false } });
    let planned: PlannedTimeSyncRound | undefined;
    /** The round whose request went to the plugin last, for a failure. */
    let sending: PlannedTimeSyncRound | undefined;
    let answer: TimeSyncResult;
    try {
      const overview = await job.enter(() => getPluginsOverview());
      if (
        !activeTimeSyncConnections(overview).some(
          (active) => keyOf(active) === key,
        )
      ) {
        checkPoints.delete(key);
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
      const listing = listingRoundOf(planned.plan);
      if (listing) {
        // Takes what changed there first, so a change Ajour should lose
        // never goes over it, then plans again from what that left.
        job.set({ time_sync_round: { listed_first: true } });
        sending = { plan: listing, context: planned.context };
        const listed = await job.enter(() =>
          syncTimeEntries(pluginId, connectionId, listing.request),
        );
        // A plugin answers unchanged only to a request with a cursor.
        if ("unchanged" in listed) throw new Error(UNCHANGED_TO_FULL_ROUND);
        const kept = keep(
          job,
          generation,
          { plan: listing, context: planned.context },
          listed,
        );
        if (kept.kind !== "applied") return kept;
        const next = planFor(ref, overview);
        if (!next || next.plan.request.changes.length === 0) {
          job.set({ time_sync_round: { change_count: 0, waiting_count: 0 } });
          return kept;
        }
        planned = {
          ...next,
          plan: { ...next.plan, receivedBefore: kept.received },
        };
        job.set({
          time_sync_round: {
            change_count: planned.plan.request.changes.length,
            waiting_count: planned.plan.waiting,
          },
        });
      }
      // A round with changes also carries the plugin's cursor, when this
      // window holds one, so the plugin can reuse what it keeps there. It
      // can't answer unchanged to it: the round has changes.
      const point = checkPoints.get(key);
      const withCursor =
        point?.generation === generation &&
        planned.plan.request.changes.length > 0;
      const sent = withCursor
        ? { ...planned.plan.request, cursor: point.cursor }
        : planned.plan.request;
      if (withCursor) job.set({ time_sync_round: { has_cursor: true } });
      sending = planned;
      const sentAnswer = await job.enter(() =>
        syncTimeEntries(pluginId, connectionId, sent),
      );
      if ("unchanged" in sentAnswer) throw new Error(UNCHANGED_TO_FULL_ROUND);
      answer = sentAnswer;
    } catch (error) {
      fail(job, error, sending ?? planned);
      throw error;
    }
    return keep(job, generation, planned, answer);
  };

  // The job opens now, so the time another window holds the lock counts too.
  const promise = wideEvents
    .run(
      "time_sync.round",
      { kind: "job", trigger: "schedule", detached: true },
      (job) => {
        job.set({
          plugin: { id: pluginId },
          connection: { id: connectionId },
          time_sync_round: { trigger },
        });
        const planned = trigger === "check" ? planCheck(ref) : undefined;
        return planned
          ? check(job, planned)
          : exclusively(lock, () => run(job));
      },
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
  /** When the connection's last round listed the other system. */
  listedAt?: number;
}

/** Whether this window is hidden, such as closed to the tray or minimized. */
function windowHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Starts the rounds of every connection with Time entries on, and returns
 * the function that stops them. It follows the switches as the plugins
 * overview changes, sends a round 2 s after a store write from any window,
 * checks every 5 s while the window shows, every 60 s while it is hidden
 * and once when it shows again, runs the next round at once while changes
 * wait, and after a failure waits 5 s, then longer, up to 5 minutes, before
 * it tries again. The tick records nothing; each round is its own job.
 */
export function startTimeSyncRunner(
  listener: TimeSyncRunnerListener,
): () => void {
  let stopped = false;
  let overview: PluginsOverview | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
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
      // A check waits for the next tick: the round running lists already.
      if (trigger !== "check") slot.queued ??= trigger;
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
          if (outcome.kind !== "unchanged") slot.listedAt = Date.now();
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

  const scheduleCheck = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(
      check,
      windowHidden()
        ? TIME_SYNC_HIDDEN_CHECK_INTERVAL_MS
        : TIME_SYNC_CHECK_INTERVAL_MS,
    );
  };

  /**
   * Sends each active connection's check, then waits for the next. A
   * connection without a cursor lists at most once a minute.
   */
  const check = () => {
    if (stopped) return;
    for (const connection of active()) {
      const { listedAt } = slotOf(keyOf(connection));
      if (
        !hasCursor(connection) &&
        listedAt !== undefined &&
        Date.now() - listedAt < TIME_SYNC_LISTING_INTERVAL_MS
      ) {
        continue;
      }
      run(connection, "check");
    }
    scheduleCheck();
  };

  /** Checks at once when the window shows again. */
  const onVisibilityChange = () => {
    if (overview && !windowHidden()) check();
  };

  /**
   * Follows the switches, forgets the connections that stopped, and starts
   * the checks with the first overview. The runner reads no overview of its
   * own: the sync scheduler refreshes it every 30 seconds, and each full
   * round reads a fresh one before it sends.
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
    if (first) scheduleCheck();
  };

  const unsubscribeOverview = subscribePluginsOverview(receive);
  const unsubscribeStore = localStore.subscribe(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const connection of active()) run(connection, "change");
    }, TIME_SYNC_DEBOUNCE_MS);
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  const cached = getCachedPluginsOverview();
  if (cached) receive(cached);

  return () => {
    stopped = true;
    unsubscribeOverview();
    unsubscribeStore();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    clearTimeout(debounceTimer);
    clearTimeout(checkTimer);
    for (const slot of slots.values()) clearTimeout(slot.retryTimer);
  };
}
