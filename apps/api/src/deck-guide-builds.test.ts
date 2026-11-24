import { afterEach, expect, it } from "vitest";
import { buildDiff } from "../../../packages/review-deck/diff.ts";
import {
  createWorkerGuideRuntime,
  type DeckGuideRuntime,
} from "./deck-guide-builds.ts";

/*
 * The worker thread that builds Deck's guides (#782), through its runtime:
 * a stopped build ends its worker, and the next build runs on a new one.
 */

const runtimes: DeckGuideRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

function input(path: string) {
  const content = "export const value = 1;\n";
  return {
    diff: buildDiff(
      [{ path, changeType: "add" as const }],
      new Map([
        [path, { old: null, new: content, binary: false, tooLarge: false }],
      ]),
    ),
    old: new Map<string, string>(),
    new: new Map([[path, content]]),
  };
}

it("builds a pull request's concerns in the worker", async () => {
  const runtime = createWorkerGuideRuntime();
  runtimes.push(runtime);

  const concerns = await runtime.build(
    input("src/a.ts"),
    new AbortController().signal,
  );

  expect(concerns.flatMap((concern) => concern.hunkIds)).toEqual([
    "src/a.ts#0",
  ]);
});

it("runs the build after a stopped one on a new worker, which the old worker's end never fails", async () => {
  const runtime = createWorkerGuideRuntime();
  runtimes.push(runtime);
  const stop = new AbortController();

  const stopped = runtime.build(input("src/a.ts"), stop.signal);
  stop.abort();
  const next = runtime.build(input("src/b.ts"), new AbortController().signal);

  await expect(stopped).rejects.toThrow("The guide build was cancelled.");
  const concerns = await next;
  expect(concerns.flatMap((concern) => concern.hunkIds)).toEqual([
    "src/b.ts#0",
  ]);
});
