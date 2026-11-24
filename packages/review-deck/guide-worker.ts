// Entry point: the worker thread that builds Deck's guides (#782). Ajour starts it by `GUIDE_WORKER_URL` from
// `guide-job.ts`. It runs the pipeline on one pull request at a time, off the local API's main thread, and answers
// each job with its groups in reading order. The parsers load with the first job and stay for the next ones.
import { parentPort } from "node:worker_threads";
import type { GuideJob, GuideJobResult } from "./guide-job.ts";
import { createPipelineDeps, mergeConfig, runPipeline } from "./pipeline.ts";

const config = mergeConfig();

parentPort?.on("message", (job: GuideJob) => {
  void build(job).then((result) => parentPort?.postMessage(result));
});

async function build(job: GuideJob): Promise<GuideJobResult> {
  try {
    // A grammar that fails to load leaves its files to path-only grouping.
    const deps = await createPipelineDeps({ onGrammarError: () => {} });
    const result = await runPipeline(
      {
        title: "",
        description: "",
        diff: job.diff,
        files: {
          get: async (path, side) =>
            (side === "old" ? job.old : job.new).get(path) ?? null,
        },
      },
      config,
      deps,
    );
    return {
      id: job.id,
      concerns: result.groups.map((group) => ({
        id: group.id,
        title: group.title,
        rationale: group.rationale,
        hunkIds: group.hunkIds,
      })),
    };
  } catch (error) {
    return {
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
