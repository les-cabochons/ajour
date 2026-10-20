import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { stopWithin } = require("./electron/stop-within.cjs") as {
  stopWithin: (
    stopping: Promise<unknown>,
    timeoutMs: number,
  ) => Promise<"stopped" | "failed" | "timed-out">;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stopping within a time limit", () => {
  it("reports a stop that finishes in time", async () => {
    const outcome = stopWithin(Promise.resolve(), 10_000);

    await expect(outcome).resolves.toBe("stopped");
  });

  it("gives up on a stop that never finishes once the limit passes", async () => {
    const settled = vi.fn();
    void stopWithin(new Promise(() => {}), 10_000).then(settled);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith("timed-out");
  });

  it("reports a stop that fails, without rejecting", async () => {
    const outcome = stopWithin(
      Promise.reject(new Error("plugin manager refused to stop")),
      10_000,
    );

    await expect(outcome).resolves.toBe("failed");
  });

  it("leaves no timer behind once the stop finishes", async () => {
    await stopWithin(Promise.resolve(), 10_000);

    expect(vi.getTimerCount()).toBe(0);
  });
});
