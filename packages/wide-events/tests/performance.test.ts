import { describe, expect, it } from "vitest";
import { createEmitter } from "../index.ts";
import { apiContext, testCatalog } from "./fixtures.ts";

describe("the cost of an event", () => {
  it("emits 100,000 events to the default sink quickly, without serializing them", () => {
    const events = createEmitter({ catalog: testCatalog, context: apiContext });
    const stringify = JSON.stringify;
    let serialized = 0;
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      serialized += 1;
      return stringify(...args);
    }) as typeof JSON.stringify;

    const started = performance.now();
    try {
      for (let index = 0; index < 100_000; index += 1) {
        events.run(
          "backlog.sync",
          { kind: "job", trigger: "schedule" },
          (sync) => {
            sync.set({
              plugin: { id: "jira" },
              sync: { received_count: index },
            });
            events.run(
              "time_entry.update",
              { kind: "command", trigger: "system" },
              (update) => update.count("store_write_count"),
            );
          },
        );
      }
    } finally {
      JSON.stringify = stringify;
    }
    const elapsed = performance.now() - started;

    expect(serialized).toBe(0);
    // Under 1 µs per sync and its folded command on a laptop. The bound
    // leaves ten times that for a slow machine.
    expect(elapsed).toBeLessThan(1_000);
  });
});
