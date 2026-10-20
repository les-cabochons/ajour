import {
  AJOUR_CONNECTION_FIELD_IDS,
  type PluginFieldValue,
  type PluginFieldValues,
  type PluginManifest,
} from "../../../packages/shared/plugins.ts";

/**
 * The connection fields Ajour owns. Ajour keeps them out of the config it
 * stores for the plugin, and passes label, tenantLabel and the auto sync
 * settings beside that config on each operation. None of them is secret.
 */
export const RESERVED_CONNECTION_FIELD_IDS: ReadonlySet<string> = new Set([
  "label",
  "tenantLabel",
  "autoSync",
  "autoSyncIntervalMinutes",
  "pullRequestAutoSync",
  ...AJOUR_CONNECTION_FIELD_IDS,
]);

function isEmptySecretValue(value: PluginFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

export function mergeConnectionConfigForSave(
  plugin: PluginManifest,
  submittedConfig: PluginFieldValues,
  existingConfig?: PluginFieldValues,
): PluginFieldValues {
  if (!existingConfig) {
    return submittedConfig;
  }

  const mergedConfig: PluginFieldValues = { ...submittedConfig };

  for (const field of plugin.connectionFields) {
    if (!field.secret) {
      continue;
    }

    if (isEmptySecretValue(mergedConfig[field.id])) {
      const existingValue = existingConfig[field.id];
      if (existingValue !== undefined) {
        mergedConfig[field.id] = existingValue;
      }
    }
  }

  return mergedConfig;
}
