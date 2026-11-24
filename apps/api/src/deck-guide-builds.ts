import { Worker } from "node:worker_threads";
import {
  GUIDE_WORKER_URL,
  type GuideJob,
  type GuideJobResult,
} from "../../../packages/review-deck/guide-job.ts";
import type { DeckConcern, DeckGuide } from "../../../packages/shared/deck.ts";
import type { ApiEvents } from "./events.ts";

/*
 * Deck's guide builds (#782). Every pull request gets a guide built from the
 * code by Review Deck's vendored pipeline, in a worker thread, so the local
 * API's main thread and the window do no pipeline work. Builds run one at a
 * time, at low priority: a build for the pull request the user just opened
 * runs before every preload still waiting, though never in the middle of
 * one already running.
 */

/** What the pipeline reads: the diff `buildDiff` wrote, and both versions of each file. */
export interface GuideBuildInput {
  diff: string;
  /** Each file's base version, by its base path. */
  old: Map<string, string>;
  /** Each file's head version, by its head path. */
  new: Map<string, string>;
}

/**
 * What builds a guide's concerns. The local API runs the worker thread
 * below; tests pass an in-process fake. `signal` aborts once nobody waits
 * for the build anymore.
 */
export interface DeckGuideRuntime {
  build(input: GuideBuildInput, signal: AbortSignal): Promise<DeckConcern[]>;
  close(): Promise<void>;
}

/** A worker idle this long ends, and gives back the parsers' memory. */
const WORKER_IDLE_MS = 2 * 60_000;

/** A build stopped because nobody waits for it anymore. */
export class GuideBuildCancelled extends Error {
  constructor() {
    super("The guide build was cancelled.");
  }
}

/**
 * The worker thread that runs the pipeline. It starts with the first build,
 * stays for the next ones so the parsers load once, and ends after a while
 * idle. A cancelled build ends the worker, since the pipeline can't stop
 * halfway, and the next build starts a new one.
 */
export function createWorkerGuideRuntime(
  workerUrl = GUIDE_WORKER_URL,
): DeckGuideRuntime {
  let worker: Worker | undefined;
  let idle: NodeJS.Timeout | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (concerns: DeckConcern[]) => void;
      reject: (error: Error) => void;
    }
  >();

  const failPending = (error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  const stop = () => {
    clearTimeout(idle);
    const ending = worker;
    worker = undefined;
    return ending?.terminate();
  };
  const start = () => {
    const started = new Worker(workerUrl);
    // A build never keeps the process alive.
    started.unref();
    started.on("message", (result: GuideJobResult) => {
      const job = pending.get(result.id);
      if (!job) return;
      pending.delete(result.id);
      if ("error" in result) job.reject(new Error(result.error));
      else job.resolve(result.concerns);
      if (!pending.size) {
        clearTimeout(idle);
        idle = setTimeout(() => void stop(), WORKER_IDLE_MS);
        idle.unref();
      }
    });
    started.on("error", (error) => {
      if (worker === started) worker = undefined;
      failPending(error);
    });
    started.on("exit", () => {
      if (worker === started) worker = undefined;
      failPending(new Error("The guide worker stopped."));
    });
    return started;
  };

  return {
    build(input, signal) {
      if (signal.aborted) return Promise.reject(new GuideBuildCancelled());
      clearTimeout(idle);
      worker ??= start();
      const id = ++nextId;
      const built = new Promise<DeckConcern[]>((resolve, reject) => {
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
          void stop();
        },
        { once: true },
      );
      return built;
    },
    async close() {
      failPending(new GuideBuildCancelled());
      await stop();
    },
  };
}

export type GuidePriority = "open" | "preload";

interface Job {
  key: string;
  input: GuideBuildInput;
  priority: GuidePriority;
  queuedAt: number;
  promise: Promise<DeckGuide>;
  resolve: (guide: DeckGuide) => void;
  reject: (error: Error) => void;
  /** Set once the job runs. */
  stop?: AbortController;
}

/**
 * The queue of guide builds, one at a time. A build is named by its pull
 * request's key, so a second request for the same key shares the first.
 */
export function createGuideBuilds(options: {
  runtime: DeckGuideRuntime;
  events?: ApiEvents;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running: Job | undefined;

  const cancel = (job: Job) => {
    if (jobs.get(job.key) !== job) return;
    if (job === running) {
      job.stop?.abort();
      return;
    }
    jobs.delete(job.key);
    queue.splice(queue.indexOf(job), 1);
    job.reject(new GuideBuildCancelled());
  };

  const pump = () => {
    if (running || !queue.length) return;
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
    const startedAt = now();
    const unit = options.events?.start("deck.guide_build", {
      kind: "job",
      trigger: job.priority === "open" ? "user" : "system",
      detached: true,
    });
    unit?.set({
      deck: { priority: job.priority, wait_ms: startedAt - job.queuedAt },
    });
    try {
      const concerns = await options.runtime.build(job.input, stop.signal);
      unit?.set({
        deck: {
          concern_count: concerns.length,
          build_ms: now() - startedAt,
        },
      });
      unit?.end();
      job.resolve({ madeWith: "code", concerns });
    } catch (error) {
      if (stop.signal.aborted) {
        unit?.cancel("replaced").end();
        job.reject(new GuideBuildCancelled());
      } else {
        unit?.fail(error).end();
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      jobs.delete(job.key);
      running = undefined;
      pump();
    }
  };

  return {
    /**
     * The guide of the pull request named `key`, built from `input`. An
     * `open` build runs before every queued preload. A build already queued
     * for the key is shared, and moves ahead when it is now an open. Once
     * `signal` aborts, the build stops and its promise rejects with
     * `GuideBuildCancelled`.
     */
    build(
      key: string,
      input: GuideBuildInput,
      priority: GuidePriority,
      signal?: AbortSignal,
    ): Promise<DeckGuide> {
      let job = jobs.get(key);
      if (!job) {
        let resolve!: Job["resolve"];
        let reject!: Job["reject"];
        const promise = new Promise<DeckGuide>((resolveJob, rejectJob) => {
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
      if (signal) {
        const owned = job;
        if (signal.aborted) cancel(owned);
        else
          signal.addEventListener("abort", () => cancel(owned), { once: true });
      }
      pump();
      return job.promise;
    },

    /** Moves a queued build ahead of the preloads, as for a pull request just opened. */
    prioritize(key: string, signal?: AbortSignal) {
      const job = jobs.get(key);
      if (!job) return;
      job.priority = "open";
      if (signal)
        signal.addEventListener("abort", () => cancel(job), { once: true });
    },

    /** Cancels the build of `key`, queued or running. */
    cancel(key: string) {
      const job = jobs.get(key);
      if (job) cancel(job);
    },

    async close() {
      for (const job of [...queue]) cancel(job);
      if (running) cancel(running);
      await options.runtime.close();
    },
  };
}

export type GuideBuilds = ReturnType<typeof createGuideBuilds>;
