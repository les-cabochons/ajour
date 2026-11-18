import { expect, test, vi } from "vitest";
import { createPipelineDeps, mergeConfig, runPipeline } from "../pipeline.ts";

// Python's grammar package does not resolve, as if a sync added a grammar without its dependency.
vi.mock("node:module", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:module")>();
  return {
    ...original,
    createRequire: (url: string | URL) => {
      const real = original.createRequire(url);
      const resolve = (id: string) => {
        if (id.startsWith("tree-sitter-python/")) {
          throw Object.assign(new Error(`Cannot find module '${id}'`), {
            code: "MODULE_NOT_FOUND",
          });
        }
        return real.resolve(id);
      };
      return Object.assign((id: string): unknown => real(id), real, {
        resolve,
      });
    },
  };
});

const diff = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-a = 1",
    "+a = 2",
    "",
  ].join("\n");

// The parser and its grammar-load results are cached for the process, so one
// test covers both callers: whichever test ran first would use up Python's load failure.
test("a grammar that cannot be resolved falls back to path-only grouping and reports to the first caller only", async () => {
  const first = vi.fn();
  const later = vi.fn();
  const firstDeps = await createPipelineDeps({ onGrammarError: first });
  const deps = await createPipelineDeps({ onGrammarError: later });
  expect(deps.parsers).toBe(firstDeps.parsers);

  const result = await runPipeline(
    {
      title: "Bump a",
      description: "",
      diff: diff("app/a.py"),
      files: { get: async () => null },
    },
    mergeConfig(),
    deps,
  );

  expect(result.groups.flatMap((g) => g.hunkIds)).toEqual(["app/a.py#0"]);
  expect(result.hunks.get("app/a.py#0")?.language).toBe("python");
  expect(first).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledWith("python", expect.anything());
  expect(later).not.toHaveBeenCalled();
});
