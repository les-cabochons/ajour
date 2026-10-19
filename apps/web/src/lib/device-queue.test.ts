import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceQueue } from "@/lib/device-queue";

const isText = (value: unknown) =>
  typeof value === "string" ? value : undefined;

describe("device queues", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads what another copy of the queue saved", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const first = createDeviceQueue("queue", isText);
    const second = createDeviceQueue("queue", isText);

    first.write(["a"]);
    expect(second.read()).toEqual(["a"]);
    second.write(["a", "b"]);
    expect(first.read()).toEqual(["a", "b"]);
  });

  it("keeps the list for the session while storage refuses it, then saves it again", () => {
    const values = new Map<string, string>();
    let full = true;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (full) throw new Error("QuotaExceededError");
          values.set(key, value);
        },
      },
    });
    const queue = createDeviceQueue("queue", isText);

    queue.write(["a"]);
    expect(queue.read()).toEqual(["a"]);
    expect(values.has("queue")).toBe(false);

    full = false;
    queue.write([...queue.read(), "b"]);
    expect(values.get("queue")).toBe('["a","b"]');
    expect(queue.read()).toEqual(["a", "b"]);
  });

  it("works without storage", () => {
    vi.stubGlobal("window", {});
    const queue = createDeviceQueue("queue", isText);

    queue.write(["a"]);
    expect(queue.read()).toEqual(["a"]);
  });
});
