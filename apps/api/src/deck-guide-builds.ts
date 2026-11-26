import { Worker } from "node:worker_threads";
import {
  GUIDE_WORKER_URL,
  type GuideJob,
  type GuideJobBuilt,
  type GuideJobResult,
} from "../../../packages/review-deck/guide-job.ts";
import type { GroupedConcern } from "../../../packages/review-deck/summary.ts";
import type { ApiEvents } from "./events.ts";

/*
 * Deck's guide builds (#782). Every pull request gets a guide built from the
 * code by Review Deck's vendored pipeline, in a worker thread, so the local
 * API's main thread and the window do no pipeline work. Builds run one at a
 * time, at low priority: a build for the pull request the user just opened
 * runs before every preload still waiting, and stops a preload already
 * running, which waits again at the head of the preloads.
 */

/** What the pipeline reads: the diff `buildDiff` wrote, and both versions of each file. */
export interface GuideBuildInput {
  diff: string;
  /** Each file's base version, by its base path. */
  old: Map<string, string>;
  /** Each file's head version, by its head path. */
  new: Map<string, string>;
  /**
   * Concerns grouped already, as an agent regrouped them (#794): the build
   * skips the pipeline and runs only the summary's rules on them.
   */
  concerns?: GroupedConcern[];
}

/**
 * What builds a guide's concerns. The local API runs the worker thread
 * below; tests pass an in-process fake. `signal` aborts once the build must
 * stop: nobody waits for it anymore, an open needs the worker, or it took
 * too long.
 */
export interface DeckGuideRuntime {
  build(input: GuideBuildInput, signal: AbortSignal): Promise<GuideJobBuilt>;
  close(): Promise<void>;
}

/** A worker idle this long ends, and gives back the parsers' memory. */
const WORKER_IDLE_MS = 2 * 60_000;
/** A build that runs this long stops, and its pull request shows without a guide. */
const BUILD_TIMEOUT_MS = 2 * 60_000;

/** A build stopped because nobody waits for it anymore. */
export class GuideBuildCancelled extends Error {
  constructor() {
    super("The guide build was cancelled.");
  }
}

/**
 * The worker thread that runs the pipeline. It starts with the first build,
 * stays for the next ones so the parsers load once, and ends after a while
 * idle. A stopped build ends the worker, since the pipeline can't stop
 * halfway, and the next build starts a new one. Each worker answers only
 * its own builds, so an ending worker never fails the next one's.
 */
export function createWorkerGuideRuntime(
  workerUrl = GUIDE_WORKER_URL,
): DeckGuideRuntime {
  type Pending = Map<
    number,
    {
      resolve: (built: GuideJobBuilt) => void;
      reject: (error: Error) => void;
    }
  >;
  let current: { worker: Worker; pending: Pending } | undefined;
  let idle: NodeJS.Timeout | undefined;
  let nextId = 0;

  const failAll = (pending: Pending, error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  const stop = () => {
    clearTimeout(idle);
    const ending = current;
    current = undefined;
    return ending?.worker.terminate();
  };
  const start = () => {
    const worker = new Worker(workerUrl);
    const pending: Pending = new Map();
    // A build never keeps the process alive.
    worker.unref();
    worker.on("message", (result: GuideJobResult) => {
      const job = pending.get(result.id);
      if (!job) return;
      pending.delete(result.id);
      if ("error" in result) job.reject(new Error(result.error));
      else job.resolve({ concerns: result.concerns, summary: result.summary });
      if (!pending.size && current?.worker === worker) {
        clearTimeout(idle);
        idle = setTimeout(() => void stop(), WORKER_IDLE_MS);
        idle.unref();
      }
    });
    const ended = (error: Error) => {
      if (current?.worker === worker) current = undefined;
      failAll(pending, error);
    };
    worker.on("error", ended);
    worker.on("exit", () => ended(new Error("The guide worker stopped.")));
    return { worker, pending };
  };

  return {
    build(input, signal) {
      if (signal.aborted) return Promise.reject(new GuideBuildCancelled());
      clearTimeout(idle);
      current ??= start();
      const { worker, pending } = current;
      const id = ++nextId;
      const built = new Promise<GuideJobBuilt>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      const job: GuideJob = { id, ...input };
      worker.postMessage(job);
      signal.addEventListener(
        "abort",
        () => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          waiting.reject(new GuideBuildCancelled());
          if (current?.worker === worker) void stop();
        },
        { once: true },
      );
      return built;
    },
    async close() {
      const ending = current;
      if (ending) failAll(ending.pending, new GuideBuildCancelled());
      await stop();
    },
  };
}

/**
 * What the worker built, with a title or rationale too long for the wire
 * cut, so one long heuristic title never loses the whole guide. The local
 * API checks the guide's other limits once it adds the linked tickets
 * (`guideOf`), and anything out of bounds fails the guide then.
 */
function trimmed(built: GuideJobBuilt): GuideJobBuilt {
  return {
    ...built,
    concerns: built.concerns.map((concern) => ({
      ...concern,
      title: concern.title.slice(0, 500),
      rationale: concern.rationale.slice(0, 2_000),
    })),
  };
}

export type GuidePriority = "open" | "preload";

/** Why a running build stopped. */
type StopReason = "replaced" | "evicted" | "closed" | "preempted" | "timeout";

interface Job {
  key: string;
  input: GuideBuildInput;
  priority: GuidePriority;
  queuedAt: number;
  promise: Promise<GuideJobBuilt>;
  resolve: (built: GuideJobBuilt) => void;
  reject: (error: Error) => void;
  /** Set while the job runs. */
  stop?: AbortController;
  stopReason?: StopReason;
}

/**
 * The queue of guide builds, one at a time. A build is named by its pull
 * request's key, so a second request for the same key shares the first.
 */
export function createGuideBuilds(options: {
  runtime: DeckGuideRuntime;
  events?: ApiEvents;
  now?: () => number;
  /** How long a build may run. Tests shorten it. */
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running: Job | undefined;
  let closed = false;

  const cancel = (job: Job, reason: Exclude<StopReason, "preempted">) => {
    if (jobs.get(job.key) !== job) return;
    if (job === running) {
      // A cancel ends the job, even one an open had only paused.
      if (!job.stopReason || job.stopReason === "preempted") {
        job.stopReason = reason;
      }
      job.stop?.abort();
      return;
    }
    jobs.delete(job.key);
    queue.splice(queue.indexOf(job), 1);
    job.reject(new GuideBuildCancelled());
  };

  /** An open waiting stops a preload running, so the open needn't wait for it. */
  const preempt = () => {
    if (
      running?.priority === "preload" &&
      !running.stopReason &&
      queue.some((job) => job.priority === "open")
    ) {
      running.stopReason = "preempted";
      running.stop?.abort();
    }
  };

  const pump = () => {
    if (closed || running || !queue.length) return;
    // Opened pull requests first, then preloads, each in the order queued.
    const index = Math.max(
      queue.findIndex((job) => job.priority === "open"),
      0,
    );
    const [job] = queue.splice(index, 1);
    running = job!;
    void run(job!);
  };

  const run = async (job: Job) => {
    const stop = new AbortController();
    job.stop = stop;
    job.stopReason = undefined;
    const timer = setTimeout(() => {
      job.stopReason ??= "timeout";
      stop.abort();
    }, timeoutMs);
    timer.unref();
    const startedAt = now();
    const unit = options.events?.start("deck.guide_build", {
      kind: "job",
      trigger: job.priority === "open" ? "user" : "system",
      detached: true,
    });
    unit?.set({
      deck: { priority: job.priority, wait_ms: startedAt - job.queuedAt },
    });
    let requeue = false;
    try {
      const built = trimmed(
        await options.runtime.build(job.input, stop.signal),
      );
      unit?.set({
        deck: {
          concern_count: built.concerns.length,
          build_ms: now() - startedAt,
        },
      });
      unit?.end();
      job.resolve(built);
    } catch (error) {
      const reason = stop.signal.aborted ? job.stopReason : undefined;
      if (reason === "preempted") {
        // It waits again at the head of the preloads.
        unit?.cancel("preempted").end();
        requeue = true;
      } else if (reason === "timeout") {
        unit?.set({ deck: { build_ms: now() - startedAt } });
        unit?.end("timeout");
        job.reject(new Error("The guide took too long to build."));
      } else if (reason) {
        unit?.cancel(reason).end();
        job.reject(new GuideBuildCancelled());
      } else {
        unit?.fail(error).end();
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      clearTimeout(timer);
      job.stop = undefined;
      if (requeue) {
        const firstPreload = queue.findIndex(
          (queued) => queued.priority === "preload",
        );
        queue.splice(firstPreload < 0 ? queue.length : firstPreload, 0, job);
      } else {
        jobs.delete(job.key);
      }
      running = undefined;
      pump();
    }
  };

  const watch = (job: Job, signal: AbortSignal | undefined) => {
    if (!signal) return;
    if (signal.aborted) cancel(job, "replaced");
    else
      signal.addEventListener("abort", () => cancel(job, "replaced"), {
        once: true,
      });
  };

  return {
    /**
     * What the worker builds for the pull request named `key`, its concerns and the summary's rule-based lines,, built from `input`. An
     * `open` build runs before every queued preload, and stops a preload
     * running. A build already queued for the key is shared, and moves ahead
     * when it is now an open. Once `signal` aborts, the build stops and its
     * promise rejects with `GuideBuildCancelled`, as it does at once once the
     * queue is closed. A build that fails or takes too long rejects with its
     * error.
     */
    build(
      key: string,
      input: GuideBuildInput,
      priority: GuidePriority,
      signal?: AbortSignal,
    ): Promise<GuideJobBuilt> {
      // A closed queue builds nothing more: a late build is cancelled at once.
      if (closed) return Promise.reject(new GuideBuildCancelled());
      let job = jobs.get(key);
      if (!job) {
        let resolve!: Job["resolve"];
        let reject!: Job["reject"];
        const promise = new Promise<GuideJobBuilt>((resolveJob, rejectJob) => {
          resolve = resolveJob;
          reject = rejectJob;
        });
        // A caller that stopped waiting may never read the rejection.
        promise.catch(() => {});
        job = {
          key,
          input,
          priority,
          queuedAt: now(),
          promise,
          resolve,
          reject,
        };
        jobs.set(key, job);
        queue.push(job);
      } else if (priority === "open") {
        job.priority = "open";
      }
      watch(job, signal);
      preempt();
      pump();
      return job.promise;
    },

    /** Moves a waiting build ahead of the preloads, as for a pull request just opened. */
    prioritize(key: string, signal?: AbortSignal) {
      const job = jobs.get(key);
      if (!job) return;
      job.priority = "open";
      watch(job, signal);
      preempt();
    },

    /** Cancels the build of `key`, waiting or running: its pull request left the content cache. */
    evict(key: string) {
      const job = jobs.get(key);
      if (job) cancel(job, "evicted");
    },

    async close() {
      closed = true;
      for (const job of [...queue]) cancel(job, "closed");
      if (running) cancel(running, "closed");
      await options.runtime.close();
    },
  };
}

export type GuideBuilds = ReturnType<typeof createGuideBuilds>;
