import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/*
 * The leak search of the real-Electron checks (#725):
 * `sandbox-check/process-attacks.cjs` and
 * `sandbox-check/official-plugins/handoff-cases.cjs` look for argv, paths
 * and hand-off content in the recorded wide events. A search of the events'
 * JSON misses any value JSON escapes, so these prove the search finds them.
 */

const require = createRequire(import.meta.url);
const { eventsHold, stringsIn } = require("./sandbox-check/event-values.cjs");

describe("eventsHold", () => {
  const leaks = ["C:\\repo", 'a"b c"d'];

  it.each(leaks)("finds %s, which the events' JSON escapes", (leak) => {
    const events = [
      { name: "plugin.process", data: { outcome: "ok", argv: ["x", leak] } },
    ];
    expect(JSON.stringify(events).includes(leak)).toBe(false);
    expect(eventsHold(events, leak)).toBe(true);
  });

  it.each(leaks)("finds %s inside a longer value, deeply", (leak) => {
    const events = [
      {
        name: "plugin.process",
        data: { nested: [{ cwd: `folder ${leak}\\payments` }] },
      },
    ];
    expect(eventsHold(events, leak)).toBe(true);
  });

  it("finds a value used as a key", () => {
    expect(eventsHold([{ data: { "C:\\repo": 1 } }], "C:\\repo")).toBe(true);
  });

  it("passes events that hold only ids and outcomes", () => {
    const events = [
      {
        name: "plugin.process",
        data: { pluginId: "fixture-escape", outcome: "refused", count: 2 },
      },
    ];
    for (const leak of leaks) expect(eventsHold(events, leak)).toBe(false);
  });

  it("reads Maps, Sets and cycles", () => {
    const cycle: Record<string, unknown> = { name: "x" };
    cycle.self = cycle;
    const value = [new Map([["k", new Set(["C:\\repo"])]]), cycle];
    expect(stringsIn(value)).toEqual(["k", "C:\\repo", "name", "x", "self"]);
  });
});
