import { Parser } from "web-tree-sitter";
import { expect, test, vi } from "vitest";
import { createPipelineDeps } from "../pipeline.ts";

test("a failed Parser.init is retried by the next caller", async () => {
  vi.spyOn(Parser, "init").mockRejectedValueOnce(new Error("no wasm"));

  await expect(createPipelineDeps()).rejects.toThrow("no wasm");
  const deps = await createPipelineDeps();

  await deps.parsers.load(["a.ts"]);
  expect(deps.parsers.symbols("a.ts", "")).not.toBeNull();
});
