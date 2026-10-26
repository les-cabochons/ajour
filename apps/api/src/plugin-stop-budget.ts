import {
  PLUGIN_CRASH_BUDGET,
  type PluginStopCause,
  type PluginSuspension,
} from "../../../packages/shared/plugin-lifecycle.ts";

/**
 * Each plugin's crash budget (#217): 3 stops within 10 minutes, a crash, a
 * timeout or a memory kill, suspend it. A suspension lasts until the user
 * turns the plugin back on, or Ajour restarts: it is kept in memory only.
 * A cancelled call is no stop.
 */
export class PluginStopBudget {
  private readonly stops = new Map<string, number[]>();
  private readonly suspensions = new Map<string, PluginSuspension>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Counts one stop. Returns the suspension and how many stops it counted
   * when this one suspended the plugin, and undefined otherwise.
   */
  record(
    pluginId: string,
    cause: PluginStopCause,
    at: number = this.now(),
  ): { suspension: PluginSuspension; stops: number } | undefined {
    if (this.suspensions.has(pluginId)) return undefined;
    const since = at - PLUGIN_CRASH_BUDGET.windowMs;
    const recent = [...(this.stops.get(pluginId) ?? []), at].filter(
      (stoppedAt) => stoppedAt > since,
    );
    if (recent.length < PLUGIN_CRASH_BUDGET.stops) {
      this.stops.set(pluginId, recent);
      return undefined;
    }
    this.stops.delete(pluginId);
    const suspension = { cause, at };
    this.suspensions.set(pluginId, suspension);
    return { suspension, stops: recent.length };
  }

  suspension(pluginId: string): PluginSuspension | undefined {
    return this.suspensions.get(pluginId);
  }

  /** Turn back on: the plugin runs again, and its budget starts over. */
  resume(pluginId: string): boolean {
    this.stops.delete(pluginId);
    return this.suspensions.delete(pluginId);
  }
}
