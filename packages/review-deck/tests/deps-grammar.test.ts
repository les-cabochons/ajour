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

test("a grammar that cannot be resolved falls back to path-only grouping", async () => {
  const onGrammarError = vi.fn();
  const deps = await createPipelineDeps({ onGrammarError });

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
  expect(onGrammarError).toHaveBeenCalledTimes(1);
  expect(onGrammarError).toHaveBeenCalledWith("python", expect.anything());
});

test("only the first caller hears about grammar errors", async () => {
  const later = vi.fn();
  const first = await createPipelineDeps();
  const deps = await createPipelineDeps({ onGrammarError: later });

  expect(deps.parsers).toBe(first.parsers);
  await deps.parsers.load(["app/a.py"]);
  expect(later).not.toHaveBeenCalled();
});
