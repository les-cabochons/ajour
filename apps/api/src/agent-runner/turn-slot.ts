import type { AgentTurnBlocker } from "../../../../packages/shared/agent-runs.ts";

/**
 * The one active agent turn the app allows (#643). A timesheet task's run
 * holds it for the whole run, a conversation's turn only while it runs, and
 * an idle conversation never. Holders get it in the order they asked.
 */

export interface TurnLease {
  /** Gives the slot to the next holder. A second call changes nothing. */
  release(): void;
}

interface Waiter {
  holder: AgentTurnBlocker;
  grant: (lease: TurnLease) => void;
}

export class TurnSlotAbortedError extends Error {
  constructor() {
    super("The wait for the agent slot was cancelled.");
    this.name = "TurnSlotAbortedError";
  }
}

export class TurnSlot {
  private holder: AgentTurnBlocker | null = null;
  private readonly waiters: Waiter[] = [];

  /** Who holds the slot now, or null when it is free. */
  current(): AgentTurnBlocker | null {
    return this.holder;
  }

  /** True when the slot is free and nobody waits for it. */
  isFree(): boolean {
    return this.holder === null && this.waiters.length === 0;
  }

  /**
   * The slot, once it is free and every earlier holder had it. `onWait` runs
   * at once, with the current holder, when the slot is busy. An abort only
   * ends a wait: a free slot is taken whatever the signal says, and an abort
   * before the slot comes rejects with `TurnSlotAbortedError`.
   */
  acquire(
    holder: AgentTurnBlocker,
    options: {
      onWait?: (blockedBy: AgentTurnBlocker) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<TurnLease> {
    if (this.isFree()) return Promise.resolve(this.take(holder));
    if (options.signal?.aborted) {
      return Promise.reject(new TurnSlotAbortedError());
    }
    options.onWait?.(this.holder ?? this.waiters[0]!.holder);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { holder, grant: resolve };
      this.waiters.push(waiter);
      options.signal?.addEventListener(
        "abort",
        () => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(new TurnSlotAbortedError());
        },
        { once: true },
      );
    });
  }

  private take(holder: AgentTurnBlocker): TurnLease {
    this.holder = holder;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.holder = null;
        const next = this.waiters.shift();
        if (next) next.grant(this.take(next.holder));
      },
    };
  }
}
