import { sameCommand } from "./command-review.ts";
import type { UndeclaredCommand } from "../../../packages/shared/command-modes.ts";
import { randomUUID } from "node:crypto";
import type { CommandAsk } from "../../../packages/shared/command-modes.ts";
type Answer = {
  answer: "once" | "always" | "deny";
  reason?:
    | "no_window"
    | "ask_timeout"
    | "user_denied"
    | "operation_ended"
    | "ask_queue_full";
};
type Pending = {
  ask: CommandAsk;
  finish: (answer: Answer) => void;
  timer?: ReturnType<typeof setTimeout>;
};
/** One visible ask across all plugins. Queue time does not consume answer time. */
export class CommandAsks {
  private queue: Pending[] = [];
  private readonly window: {
    connected(): boolean;
    publish(ask: CommandAsk | null): void;
  };
  constructor(window: {
    connected(): boolean;
    publish(ask: CommandAsk | null): void;
  }) {
    this.window = window;
  }
  snapshot() {
    return this.queue[0]?.ask ?? null;
  }
  ask(
    input: Omit<CommandAsk, "id" | "expiresAt">,
    signal: AbortSignal,
  ): Promise<Answer> {
    if (!this.window.connected())
      return Promise.resolve({ answer: "deny", reason: "no_window" });
    if (signal.aborted)
      return Promise.resolve({ answer: "deny", reason: "operation_ended" });
    if (
      this.queue.length >= 64 ||
      this.queue.filter((p) => p.ask.pluginId === input.pluginId).length >= 2
    )
      return Promise.resolve({ answer: "deny", reason: "ask_queue_full" });
    return new Promise((resolve) => {
      const abort = () =>
        pending.finish({ answer: "deny", reason: "operation_ended" });
      const pending: Pending = {
        ask: { ...input, id: randomUUID(), expiresAt: 0 },
        finish: (answer) => {
          const active = this.queue[0] === pending;
          clearTimeout(pending.timer);
          signal.removeEventListener("abort", abort);
          this.queue = this.queue.filter((p) => p !== pending);
          resolve(answer);
          if (active) this.showNext();
        },
      };
      signal.addEventListener("abort", abort, { once: true });
      this.queue.push(pending);
      if (this.queue.length === 1) this.showNext();
    });
  }
  answer(id: string, answer: Answer["answer"] | "deny-all") {
    const pending = this.queue[0];
    if (
      !pending ||
      pending.ask.id !== id ||
      Date.now() >= pending.ask.expiresAt
    )
      return false;
    if (answer === "deny-all") {
      for (const item of [...this.queue].reverse())
        if (item.ask.pluginId === pending.ask.pluginId)
          item.finish({ answer: "deny", reason: "user_denied" });
      return true;
    }
    pending.finish({
      answer,
      ...(answer === "deny" ? { reason: "user_denied" as const } : {}),
    });
    return true;
  }
  approveMatching(pluginId: string, command: UndeclaredCommand) {
    for (const pending of [...this.queue].reverse())
      if (
        pending.ask.pluginId === pluginId &&
        sameCommand(pending.ask, command)
      )
        pending.finish({ answer: "once" });
  }
  disconnect() {
    for (const pending of [...this.queue])
      pending.finish({ answer: "deny", reason: "no_window" });
  }
  private showNext() {
    const pending = this.queue[0];
    if (!pending) {
      this.window.publish(null);
      return;
    }
    if (!this.window.connected()) {
      this.disconnect();
      return;
    }
    pending.ask.expiresAt = Date.now() + 120000;
    pending.timer = setTimeout(
      () => pending.finish({ answer: "deny", reason: "ask_timeout" }),
      120000,
    );
    this.window.publish(pending.ask);
  }
}
