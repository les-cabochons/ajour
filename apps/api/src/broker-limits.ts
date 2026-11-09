/**
 * The credential broker's limits on one plugin: its rate, a token bucket
 * with the requests waiting for it, and its requests in flight, with those
 * waiting for a slot. The limits
 * themselves are `BROKER_LIMITS` (`broker-port.ts`).
 */

import { BrokerRequestError, type BrokerLimits } from "./broker-port.ts";

export function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/** A request waiting for its rate: woken when its token is ready. */
interface RateWaiter {
  wake(): void;
}

/**
 * A plugin's rate: a token bucket. A request past the burst waits in line
 * for its token instead of failing, so a sync that sends many requests slows
 * down to the rate rather than stopping at the first one over it. The line
 * is first come, first served, and one timer wakes its head when a token
 * refills. A request that leaves the line, aborted, frees its turn for the
 * ones behind it.
 */
export class RateBucket {
  private readonly limits: BrokerLimits;
  private readonly now: () => number;
  private tokens: number;
  private updatedAt: number;
  private readonly waiting: RateWaiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(limits: BrokerLimits, now: () => number) {
    this.limits = limits;
    this.now = now;
    this.tokens = limits.rateBurst;
    this.updatedAt = now();
  }

  /**
   * Takes a token, waiting in line when none is left or others wait. It is
   * refused at once, charged nothing, when the line already holds
   * `queuedPerPlugin` requests or when its turn would come only after its
   * own timeout (`timeoutMs`). Aborted before or while it waits, it rejects
   * with its signal's reason.
   */
  async take(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError(signal);
    this.refill();
    if (this.waiting.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    if (this.waiting.length >= this.limits.queuedPerPlugin) {
      throw new BrokerRequestError(
        "limit",
        "too_many_queued",
        "The plugin sent too many requests at once.",
      );
    }
    // The tokens this request needs: one for each request ahead, and its own.
    const turnMs =
      ((this.waiting.length + 1 - this.tokens) / this.limits.ratePerSecond) *
      1000;
    if (turnMs >= this.limits.timeoutMs) {
      throw new BrokerRequestError(
        "limit",
        "rate_limited",
        "The plugin sent too many requests. Try again in a moment.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: RateWaiter = {
        wake: () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
        this.schedule();
        reject(abortError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
      this.schedule();
    });
  }

  /** Wakes the waiters whose tokens are ready, then times the next one. */
  private schedule() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.refill();
    while (this.waiting.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.waiting.shift()!.wake();
    }
    if (this.waiting.length === 0) return;
    const nextMs = ((1 - this.tokens) / this.limits.ratePerSecond) * 1000;
    this.timer = setTimeout(() => this.schedule(), nextMs);
  }

  private refill() {
    const now = this.now();
    this.tokens = Math.min(
      this.limits.rateBurst,
      this.tokens + ((now - this.updatedAt) / 1000) * this.limits.ratePerSecond,
    );
    this.updatedAt = now;
  }
}

/** A plugin's requests in flight, and those waiting for a slot. */
export class Slots {
  private readonly limits: BrokerLimits;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(limits: BrokerLimits) {
    this.limits = limits;
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    // A signal aborted before this call never fires its abort event again,
    // so a waiter would miss it.
    if (signal.aborted) throw abortError(signal);
    if (this.running >= this.limits.concurrentPerPlugin) {
      if (this.waiting.length >= this.limits.queuedPerPlugin) {
        throw new BrokerRequestError(
          "limit",
          "too_many_queued",
          "The plugin sent too many requests at once.",
        );
      }
      // The release that wakes this waiter hands its slot over, so a caller
      // arriving before the waiter runs finds the slot taken.
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.waiting.indexOf(wake);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.waiting.push(wake);
      });
    } else {
      this.running += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    };
  }
}
