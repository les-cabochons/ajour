import type {
  PluginFieldValue,
  PluginFieldValues,
  PluginManifest,
} from "../../../packages/shared/plugins.ts";

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
