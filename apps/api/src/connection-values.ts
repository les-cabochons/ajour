import type {
  ConnectorFieldValue,
  ConnectorFieldValues,
  ConnectorPluginManifest,
} from "../../../packages/shared/connectors.ts";

function isEmptySecretValue(value: ConnectorFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

export function mergeConnectionConfigForSave(
  plugin: ConnectorPluginManifest,
  submittedConfig: ConnectorFieldValues,
  existingConfig?: ConnectorFieldValues,
): ConnectorFieldValues {
  if (!existingConfig) {
    return submittedConfig;
  }

  const mergedConfig: ConnectorFieldValues = { ...submittedConfig };

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
