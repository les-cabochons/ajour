import { z } from "zod";

/*
 * How a plugin API 4 renderer starts and how much memory it may use, as its
 * manifest declares and its user chooses on the plugin's page (#217, #391).
 * The user's choice wins, and takes effect on the renderer's next start.
 */

/** The memory ceiling a user may set for a plugin's renderer, in MB (#217). */
export const PLUGIN_MEMORY_CEILING_MB = {
  min: 64,
  max: 2048,
  default: 256,
} as const;

/** "Load when needed" or "Always ready". */
export const pluginStartModeSchema = z.enum(["whenNeeded", "alwaysReady"]);
export type PluginStartMode = z.infer<typeof pluginStartModeSchema>;

/** What the user picked for Start: `plugin` follows the manifest. */
export const pluginStartChoiceSchema = z.enum([
  "plugin",
  "whenNeeded",
  "alwaysReady",
]);
export type PluginStartChoice = z.infer<typeof pluginStartChoiceSchema>;

export const pluginMemoryCeilingMbSchema = z
  .number()
  .int()
  .min(PLUGIN_MEMORY_CEILING_MB.min)
  .max(PLUGIN_MEMORY_CEILING_MB.max);

/** The Advanced section of a plugin's page, as saved. */
export const pluginRuntimeSettingsSchema = z.object({
  start: pluginStartChoiceSchema,
  /** Absent: the manifest's ceiling, or Ajour's default. */
  memoryCeilingMb: pluginMemoryCeilingMbSchema.optional(),
});
export type PluginRuntimeSettings = z.infer<typeof pluginRuntimeSettingsSchema>;

export const DEFAULT_PLUGIN_RUNTIME_SETTINGS: PluginRuntimeSettings = {
  start: "plugin",
};

/** Saves the Advanced section. A null ceiling goes back to the plugin's. */
export const pluginRuntimeSettingsUpdateSchema = z.object({
  start: pluginStartChoiceSchema,
  memoryCeilingMb: pluginMemoryCeilingMbSchema.nullable(),
});
export type PluginRuntimeSettingsUpdate = z.infer<
  typeof pluginRuntimeSettingsUpdateSchema
>;

/**
 * Why a plugin's renderer stopped, as its crash budget counts it: its
 * process `crashed`, ran out of memory (`oom`), was `killed` by the system,
 * went over its `memory` ceiling, or a call ran past its time (`timeout`).
 */
export const pluginStopCauseSchema = z.enum([
  "crashed",
  "oom",
  "killed",
  "memory",
  "timeout",
]);
export type PluginStopCause = z.infer<typeof pluginStopCauseSchema>;

/** Stops within this window, this many of them, suspend a plugin. */
export const PLUGIN_CRASH_BUDGET = {
  stops: 3,
  windowMs: 10 * 60_000,
} as const;

/**
 * A plugin that kept stopping: its calls fail at once until the user turns
 * it back on or Ajour restarts. `cause` is the last stop's.
 */
export const pluginSuspensionSchema = z.object({
  cause: pluginStopCauseSchema,
  at: z.number().int().nonnegative(),
});
export type PluginSuspension = z.infer<typeof pluginSuspensionSchema>;

/** What the plugins overview says of an API 4 plugin's renderer. */
export const pluginRuntimeSummarySchema = z.object({
  /** What the manifest declares, with Ajour's default ceiling filled in. */
  declared: z.object({
    start: pluginStartModeSchema,
    memoryCeilingMb: pluginMemoryCeilingMbSchema,
  }),
  settings: pluginRuntimeSettingsSchema,
});
export type PluginRuntimeSummary = z.infer<typeof pluginRuntimeSummarySchema>;

/** How the renderer starts: the user's choice, or the manifest's. */
export function effectiveStartMode(
  declared: PluginStartMode,
  settings: PluginRuntimeSettings,
): PluginStartMode {
  return settings.start === "plugin" ? declared : settings.start;
}

/** The ceiling in MB: the user's, the manifest's, or Ajour's default. */
export function effectiveMemoryCeilingMb(
  declared: number | undefined,
  settings: PluginRuntimeSettings,
): number {
  return (
    settings.memoryCeilingMb ?? declared ?? PLUGIN_MEMORY_CEILING_MB.default
  );
}
