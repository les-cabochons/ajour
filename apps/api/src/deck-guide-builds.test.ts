import { afterEach, expect, it } from "vitest";
import { buildDiff } from "../../../packages/review-deck/diff.ts";
import {
  createGuideBuilds,
  createWorkerGuideRuntime,
  GuideBuildCancelled,
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

/**
 * A runtime whose builds end only when the test says, so a test can act
 * between a build's stop and the moment the queue hears of it.
 */
function heldRuntime() {
  const builds: {
    path: string;
    signal: AbortSignal;
    finish: () => void;
    fail: () => void;
  }[] = [];
  const runtime: DeckGuideRuntime = {
    build(buildInput, signal) {
      const [path = ""] = [...buildInput.new.keys()];
      return new Promise((resolve, reject) => {
        builds.push({
          path,
          signal,
          finish: () => resolve([]),
          fail: () => reject(new GuideBuildCancelled()),
        });
      });
    },
    close: async () => {},
  };
  return { runtime, builds, built: () => builds.map((build) => build.path) };
}

it("cancels a preload evicted after an open stopped it, rather than running it again", async () => {
  const held = heldRuntime();
  const queue = createGuideBuilds({ runtime: held.runtime });

  const preload = queue.build("a", input("src/a.ts"), "preload");
  const open = queue.build("b", input("src/b.ts"), "open");
  expect(held.builds[0]!.signal.aborted).toBe(true);
  queue.evict("a");
  held.builds[0]!.fail();

  await expect(preload).rejects.toBeInstanceOf(GuideBuildCancelled);
  await expect.poll(() => held.builds.length).toBe(2);
  held.builds[1]!.finish();
  await open;
  expect(held.built()).toEqual(["src/a.ts", "src/b.ts"]);
});

it("starts no build once closed, even for a preload an open had just stopped", async () => {
  const held = heldRuntime();
  const queue = createGuideBuilds({ runtime: held.runtime });

  const preload = queue.build("a", input("src/a.ts"), "preload");
  const open = queue.build("b", input("src/b.ts"), "open");
  await queue.close();
  held.builds[0]!.fail();

  await expect(preload).rejects.toBeInstanceOf(GuideBuildCancelled);
  await expect(open).rejects.toBeInstanceOf(GuideBuildCancelled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(held.built()).toEqual(["src/a.ts"]);
});

it("cancels a build asked for after the queue closed, rather than leave it waiting", async () => {
  const held = heldRuntime();
  const queue = createGuideBuilds({ runtime: held.runtime });
  await queue.close();

  await expect(
    queue.build("a", input("src/a.ts"), "open"),
  ).rejects.toBeInstanceOf(GuideBuildCancelled);
  queue.prioritize("a");
  expect(held.built()).toEqual([]);
});
