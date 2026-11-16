import { expect, expectTypeOf, it } from "vitest";
import type { AjourProcessResult } from "../index.js";
import { createFakeAjour } from "../testing.js";
it("Given a launch result, SDK callers can distinguish it from capture", async () => {
  const fake = createFakeAjour({ processRun: async () => ({ started: true }) });
  const result: AjourProcessResult = await fake.process.run({
    command: "launch",
    args: {},
  });
  if (result.started === true)
    expectTypeOf(result.started).toEqualTypeOf<true>();
  else expectTypeOf(result.stdout).toEqualTypeOf<string>();
  expect(result).toEqual({ started: true });
});
