import { describe, expect, it } from "vitest";
import { PLUGIN_CRASH_BUDGET, PLUGIN_MEMORY_CEILING_MB } from "@ajour/shared";
import { readMemoryCeiling, suspensionReason } from "./runtime-settings";

describe("reading the Memory ceiling field", () => {
  it("takes an empty field as the plugin's own ceiling", () => {
    expect(readMemoryCeiling("  ")).toEqual({ ok: true, value: null });
  });

  it("takes a whole number inside the range the API accepts, ends included", () => {
    expect(readMemoryCeiling(String(PLUGIN_MEMORY_CEILING_MB.min))).toEqual({
      ok: true,
      value: PLUGIN_MEMORY_CEILING_MB.min,
    });
    expect(readMemoryCeiling(` ${PLUGIN_MEMORY_CEILING_MB.max} `)).toEqual({
      ok: true,
      value: PLUGIN_MEMORY_CEILING_MB.max,
    });
  });

  it("names the range in its error, and refuses what falls outside it or isn't whole", () => {
    const message = `Enter a whole number of MB from ${PLUGIN_MEMORY_CEILING_MB.min} to ${PLUGIN_MEMORY_CEILING_MB.max}.`;
    for (const text of [
      String(PLUGIN_MEMORY_CEILING_MB.min - 1),
      String(PLUGIN_MEMORY_CEILING_MB.max + 1),
      "128.5",
      "lots",
    ]) {
      expect(readMemoryCeiling(text)).toEqual({ ok: false, error: message });
    }
  });
});

describe("the notice of a plugin that keeps stopping", () => {
  it("states the crash budget the API keeps", () => {
    const minutes = PLUGIN_CRASH_BUDGET.windowMs / 60_000;
    expect(suspensionReason("crashed")).toContain(
      `stopped ${PLUGIN_CRASH_BUDGET.stops} times in ${minutes} minutes`,
    );
  });
});
