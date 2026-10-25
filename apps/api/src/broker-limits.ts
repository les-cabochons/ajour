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

/** A plugin's rate: a token bucket. */
export class RateBucket {
  private readonly limits: BrokerLimits;
  private tokens: number;
  private updatedAt: number;

  constructor(limits: BrokerLimits, now: number) {
    this.limits = limits;
    this.tokens = limits.rateBurst;
    this.updatedAt = now;
  }

  take(now: number) {
    this.tokens = Math.min(
      this.limits.rateBurst,
      this.tokens + ((now - this.updatedAt) / 1000) * this.limits.ratePerSecond,
    );
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
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
    }
    this.running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      this.waiting.shift()?.();
    };
  }
}
