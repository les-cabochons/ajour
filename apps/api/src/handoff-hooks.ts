import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Handoff } from "../../../packages/shared/handoffs.ts";
import { shouldRefresh } from "./handoff-state.ts";

/**
 * Handoff hooks (#726): a tool that supports hooks, such as Claude Code's
 * `type: "http"` hooks, posts to `POST /hooks/handoff/:id?token=…` when its
 * thread stops, needs the user or ends. A post only schedules a refresh of
 * that handoff through the plugin; its body is never read as the state.
 *
 * The token is 32 random bytes, given once to the plugin in the start's
 * hook URL. The API state keeps only its SHA-256 hash, beside the handoff.
 * It is revoked when the handoff is removed, and 24 hours after the
 * handoff reached done or gone, when automatic refresh stops too.
 */

/** The path prefix of hook posts. */
export const HANDOFF_HOOK_PATH = "/hooks/handoff/";

/** The most body bytes a hook post may send. Ajour reads none of them. */
export const MAX_HOOK_BODY_BYTES = 1024 * 1024;

export type HookResult = "accepted" | "rate_limited" | "unknown";

export function createHookToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashHookToken(token) };
}

export function hashHookToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A stand-in hash, compared when the id is unknown, so both take as long. */
const NO_HASH = hashHookToken("");

/**
 * The hook URL a tool posts to: always loopback on the API's own port. The
 * token's and id's characters need no escaping, in a URL or in JSON.
 */
export function handoffHookUrl(
  host: string,
  port: number,
  id: string,
  token: string,
) {
  const hostname =
    host === "localhost" ? "localhost" : host === "::1" ? "[::1]" : "127.0.0.1";
  return `http://${hostname}:${port}${HANDOFF_HOOK_PATH}${id}?token=${token}`;
}

/** The handoff id of a hook path, or undefined when it isn't one. */
export function hookPathId(pathname: string): string | undefined {
  if (!pathname.startsWith(HANDOFF_HOOK_PATH)) return undefined;
  const id = pathname.slice(HANDOFF_HOOK_PATH.length);
  return /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : "";
}

export interface HandoffHookOptions {
  /** The saved handoff and its token hash, or undefined. */
  find(id: string): Promise<{ record: Handoff; tokenHash: string } | undefined>;
  /** Forgets a token for good, as when its handoff stopped refreshing. */
  revoke(id: string): Promise<void>;
  /** Refreshes one handoff through its plugin, as Refresh does. */
  refresh(id: string): Promise<unknown>;
  now?: () => number;
  /** How long accepted posts for one handoff gather before one refresh. */
  debounceMs?: number;
  /** Accepted posts per handoff per window. */
  perHandoffLimit?: number;
  /** Posts of any kind, valid or not, across every handoff per window. */
  globalLimit?: number;
  windowMs?: number;
}

/**
 * Checks hook posts and turns the valid ones into refreshes: at most one
 * waiting per handoff, and none started while one runs, so a burst of
 * posts makes one refresh, and a flood is refused before any work.
 */
export class HandoffHooks {
  private readonly options: HandoffHookOptions;
  private readonly now: () => number;
  private readonly windowMs: number;
  private global: number[] = [];
  private readonly perHandoff = new Map<string, number[]>();
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<string>();
  private readonly again = new Set<string>();
  private closed = false;

  constructor(options: HandoffHookOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? 60_000;
  }

  /**
   * Whether a post counts as a valid hook for a live handoff. A wrong
   * token, an unknown id and a revoked token are the same `unknown`, so
   * ids can't be probed.
   */
  async receive(
    id: string,
    token: string | null,
    /**
     * Runs once the post is valid and within its limits, before a refresh
     * is scheduled; false drops the post, as for a body over the cap.
     */
    admit: () => Promise<boolean> = async () => true,
  ): Promise<{ result: HookResult | "dropped"; tool?: string }> {
    const now = this.now();
    this.global = this.global.filter((at) => now - at < this.windowMs);
    if (this.global.length >= (this.options.globalLimit ?? 120))
      return { result: "rate_limited" };
    this.global.push(now);

    const found = id ? await this.options.find(id) : undefined;
    const matches = timingSafeEqual(
      Buffer.from(hashHookToken(token ?? ""), "hex"),
      Buffer.from(found?.tokenHash ?? NO_HASH, "hex"),
    );
    if (!found || !token || !matches) return { result: "unknown" };
    if (!shouldRefresh(found.record, now)) {
      await this.options.revoke(id);
      return { result: "unknown" };
    }

    const recent = (this.perHandoff.get(id) ?? []).filter(
      (at) => now - at < this.windowMs,
    );
    if (recent.length >= (this.options.perHandoffLimit ?? 30)) {
      this.perHandoff.set(id, recent);
      return { result: "rate_limited", tool: found.record.toolId };
    }
    this.perHandoff.set(id, [...recent, now]);
    if (!(await admit())) return { result: "dropped", tool: found.record.toolId };
    this.schedule(id);
    return { result: "accepted", tool: found.record.toolId };
  }

  private schedule(id: string) {
    if (this.closed) return;
    if (this.running.has(id)) {
      this.again.add(id);
      return;
    }
    if (this.waiting.has(id)) return;
    const timer = setTimeout(() => {
      this.waiting.delete(id);
      void this.run(id);
    }, this.options.debounceMs ?? 1_000);
    timer.unref?.();
    this.waiting.set(id, timer);
  }

  private async run(id: string) {
    if (this.closed) return;
    this.running.add(id);
    try {
      await this.options.refresh(id);
    } catch {
      // The refresh records its own failure; the next tick retries.
    } finally {
      this.running.delete(id);
      if (this.again.delete(id)) this.schedule(id);
    }
  }

  /** Forgets the counts of a removed handoff. */
  forget(id: string) {
    this.perHandoff.delete(id);
    const timer = this.waiting.get(id);
    if (timer) clearTimeout(timer);
    this.waiting.delete(id);
    this.again.delete(id);
  }

  close() {
    this.closed = true;
    for (const timer of this.waiting.values()) clearTimeout(timer);
    this.waiting.clear();
  }
}
