/**
 * The credential broker's limits on one plugin: its rate, a token bucket,
 * and its requests in flight, with those waiting for a slot. The limits
 * themselves are `BROKER_LIMITS` (`broker-port.ts`).
 */

import { BrokerRequestError, type BrokerLimits } from "./broker-port.ts";

export function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/**
 * A plugin's rate: a token bucket. A request past the burst waits for its
 * token to refill instead of failing, so a sync that sends many requests
 * slows down to the rate rather than stopping at the first one over it.
 */
export class RateBucket {
  private readonly limits: BrokerLimits;
  private readonly now: () => number;
  /** Below zero while requests wait: one token owed per waiting request. */
  private tokens: number;
  private updatedAt: number;

  constructor(limits: BrokerLimits, now: () => number) {
    this.limits = limits;
    this.now = now;
    this.tokens = limits.rateBurst;
    this.updatedAt = now();
  }

  /**
   * Takes a token, waiting until it refills when none is left. A request
   * whose turn would come only after its own timeout (`timeoutMs`) is
   * refused at once, and a request aborted while it waits rejects with its
   * signal's reason. Both give their token back.
   */
  async take(signal: AbortSignal): Promise<void> {
    this.refill();
    this.tokens -= 1;
    if (this.tokens >= 0) return;
    const waitMs = (-this.tokens / this.limits.ratePerSecond) * 1000;
    if (waitMs >= this.limits.timeoutMs) {
      this.giveBack();
      throw new BrokerRequestError(
        "limit",
        "rate_limited",
        "The plugin sent too many requests. Try again in a moment.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        this.giveBack();
        reject(abortError(signal));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, waitMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private giveBack() {
    this.refill();
    this.tokens = Math.min(this.limits.rateBurst, this.tokens + 1);
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
    } else if (signal.aborted) {
      throw abortError(signal);
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
