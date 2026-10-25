/**
 * The agent runner's part of the state file: its settings, and the agent
 * task setting values each plugin's tasks share. The values marked secret
 * live in the vault, and `pluginSecrets` records which.
 */

import {
  pluginFieldValuesSchema,
  type PluginFieldValues,
} from "../../../packages/shared/plugins.ts";
import {
  agentRunnerSettingsSchema,
  type AgentRunnerSettings,
} from "../../../packages/shared/agent-runs.ts";

/** Which of a holder's values the vault holds. See `connection-credentials.ts`. */
export interface StoredSecretFields {
  /** The fields whose values the vault holds. */
  fields: string[];
  /** The vault holds all the values as one entry, sealed while the plugin was missing. */
  sealed?: true;
  /**
   * The fields whose secret the service refused with a 401. Replacing the
   * secret clears the mark; until then the holder is paused.
   */
  rejected?: string[];
  /**
   * The fields the user removed. A removed field the manifest requires
   * pauses the holder until a new secret is saved.
   */
  removed?: string[];
}

export interface StoredAgentRunnerState {
  settings: AgentRunnerSettings;
  /** Agent task setting values by plugin ID, shared by the plugin's tasks. */
  pluginValues: Record<string, PluginFieldValues>;
  /**
   * Per plugin, the values the vault holds. A plugin without an entry has
   * values nobody checked for secrets since the vault came.
   */
  pluginSecrets: Record<string, StoredSecretFields>;
}

export function defaultAgentRunnerSettings(): AgentRunnerSettings {
  return { cli: null, browserMode: "ajour-chrome", model: "" };
}

/** Keys that would reach Object.prototype if a stored name were used as a key. */
export const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copies `values` into a map without a prototype and without the unsafe
 * keys, so a stored key can never write to Object.prototype.
 */
export function safeValues(values: PluginFieldValues): PluginFieldValues {
  const copy: PluginFieldValues = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    if (!UNSAFE_KEYS.has(key)) copy[key] = value;
  }
  return copy;
}

/** The secret fields a record names, or undefined for one that isn't. */
export function normalizeSecretFields(
  raw: unknown,
): StoredSecretFields | undefined {
  const record = raw as Partial<StoredSecretFields> | null | undefined;
  if (typeof record !== "object" || record === null) return undefined;
  if (!Array.isArray(record.fields)) return undefined;
  const fields = Array.from(
    new Set(
      record.fields.filter(
        (field): field is string =>
          typeof field === "string" && !UNSAFE_KEYS.has(field),
      ),
    ),
  ).sort();
  const names = (value: unknown) =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (field): field is string =>
                typeof field === "string" && !UNSAFE_KEYS.has(field),
            ),
          ),
        ).sort()
      : [];
  const rejected = names(record.rejected);
  const removed = names(record.removed);
  return {
    fields,
    ...(record.sealed === true ? { sealed: true as const } : {}),
    ...(rejected.length > 0 ? { rejected } : {}),
    ...(removed.length > 0 ? { removed } : {}),
  };
}

export function normalizeAgentRunnerState(
  raw: unknown,
): StoredAgentRunnerState {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const settings = agentRunnerSettingsSchema.safeParse(record.settings);
  const pluginValues: StoredAgentRunnerState["pluginValues"] =
    Object.create(null);
  const merge = (pluginId: string, values: unknown) => {
    if (UNSAFE_KEYS.has(pluginId)) return;
    const parsed = pluginFieldValuesSchema.safeParse(values);
    if (!parsed.success) return;
    const merged = (pluginValues[pluginId] ??= Object.create(null));
    for (const [key, value] of Object.entries(safeValues(parsed.data))) {
      if (merged[key] === undefined || merged[key] === "") merged[key] = value;
    }
  };
  if (typeof record.pluginValues === "object" && record.pluginValues !== null) {
    for (const [pluginId, values] of Object.entries(record.pluginValues)) {
      merge(pluginId, values);
    }
  }
  // Before a plugin's tasks shared their settings, each task kept its own
  // values. The first non-empty value of each setting wins.
  if (typeof record.taskValues === "object" && record.taskValues !== null) {
    for (const [pluginId, tasks] of Object.entries(record.taskValues)) {
      if (typeof tasks !== "object" || tasks === null) continue;
      for (const [taskId, values] of Object.entries(tasks)) {
        if (!UNSAFE_KEYS.has(taskId)) merge(pluginId, values);
      }
    }
  }
  const pluginSecrets: StoredAgentRunnerState["pluginSecrets"] =
    Object.create(null);
  if (
    typeof record.pluginSecrets === "object" &&
    record.pluginSecrets !== null
  ) {
    for (const [pluginId, secrets] of Object.entries(record.pluginSecrets)) {
      const normalized = normalizeSecretFields(secrets);
      if (!UNSAFE_KEYS.has(pluginId) && normalized) {
        pluginSecrets[pluginId] = normalized;
      }
    }
  }
  return {
    settings: settings.success ? settings.data : defaultAgentRunnerSettings(),
    pluginValues,
    pluginSecrets,
  };
}
