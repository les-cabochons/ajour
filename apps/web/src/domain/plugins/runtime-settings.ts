import {
  PLUGIN_CRASH_BUDGET,
  PLUGIN_MEMORY_CEILING_MB,
  pluginMemoryCeilingMbSchema,
  type PluginStopCause,
} from "@ajour/shared";

/*
 * What a plugin's page says of its renderer's lifecycle (#391): the Memory
 * ceiling field, read against the range the API accepts, and the reason a
 * plugin that kept stopping is off. The limits belong to the API; this
 * reads them from the shared contract and keeps no copy.
 */

/** Reads the ceiling field: a whole number in range, empty for the plugin's, or an error. */
export function readMemoryCeiling(
  text: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = pluginMemoryCeilingMbSchema.safeParse(Number(trimmed));
  if (!parsed.success) {
    return {
      ok: false,
      error: `Enter a whole number of MB from ${PLUGIN_MEMORY_CEILING_MB.min} to ${PLUGIN_MEMORY_CEILING_MB.max}.`,
    };
  }
  return { ok: true, value: parsed.data };
}

/** What the last of its stops was, in the notice's words. */
const LAST_STOP: Record<PluginStopCause, string> = {
  crashed: "its process crashed",
  oom: "it ran out of memory",
  killed: "the system ended it",
  memory: "it used more memory than its ceiling allows",
  timeout: "a call took longer than 30 seconds",
};

/** Why the plugin is off, for the notice under its title. */
export function suspensionReason(cause: PluginStopCause) {
  const minutes = PLUGIN_CRASH_BUDGET.windowMs / 60_000;
  return `It stopped ${PLUGIN_CRASH_BUDGET.stops} times in ${minutes} minutes. The last time, ${LAST_STOP[cause]}. Ajour keeps it off until you turn it back on or restart Ajour.`;
}
