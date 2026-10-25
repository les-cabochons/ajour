import { describe, expect, it } from "vitest";
import { BROKER_LIMITS } from "./broker-port.ts";
import { Slots } from "./broker-limits.ts";

const limits = { ...BROKER_LIMITS, concurrentPerPlugin: 2, queuedPerPlugin: 8 };
const never = new AbortController().signal;

/** Lets every promise already settled run its continuations. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("a plugin's requests in flight", () => {
  it("never holds more slots than the limit when a new caller arrives as a slot is released", async () => {
    const slots = new Slots(limits);
    let holding = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const run = async () => {
      const release = await slots.acquire(never);
      holding += 1;
      peak = Math.max(peak, holding);
      releases.push(() => {
        holding -= 1;
        release();
      });
    };

    const runs = [run(), run(), run()];
    await settle();
    expect(holding).toBe(2);

    // A slot is released, and new callers arrive before the waiter runs.
    releases[0]!();
    runs.push(run(), run());
    await settle();

    expect(holding).toBe(2);
    for (let opened = 1; opened < 5; opened += 1) {
      releases[opened]!();
      await settle();
    }
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it("wakes the waiters in the order they came", async () => {
    const slots = new Slots(limits);
    const order: number[] = [];
    const releases = await Promise.all([
      slots.acquire(never),
      slots.acquire(never),
    ]);
    const waiters = [1, 2, 3].map((n) =>
      slots.acquire(never).then((release) => {
        order.push(n);
        release();
      }),
    );

    releases[0]();
    releases[1]();
    await Promise.all(waiters);

    expect(order).toEqual([1, 2, 3]);
  });

  it("refuses a caller when the queue is full, and frees a slot released twice only once", async () => {
    const slots = new Slots({ ...limits, queuedPerPlugin: 1 });
    const [release] = await Promise.all([
      slots.acquire(never),
      slots.acquire(never),
    ]);
    const queued = slots.acquire(never);

    await expect(slots.acquire(never)).rejects.toMatchObject({
      reason: "too_many_queued",
    });
    release();
    release();
    await expect(queued).resolves.toBeTypeOf("function");
    // One slot opened, and the waiter took it.
    const next = slots.acquire(never);
    const outcome = await Promise.race([next, settle().then(() => "waiting")]);
    expect(outcome).toBe("waiting");
  });

  it("leaves the queue of a waiter that is aborted, without losing a slot", async () => {
    const slots = new Slots(limits);
    const held = await Promise.all([
      slots.acquire(never),
      slots.acquire(never),
    ]);
    const controller = new AbortController();
    const aborted = slots.acquire(controller.signal);
    controller.abort();
    await expect(aborted).rejects.toBeDefined();

    held[0]();
    const next = await slots.acquire(never);

    expect(next).toBeTypeOf("function");
  });
});
