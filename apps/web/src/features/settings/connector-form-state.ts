import type {
  ConnectorField,
  ConnectorFieldValue,
  ConnectorFieldValues,
  ConnectorPluginManifest,
} from "@ajour/shared";

export const SAVED_SECRET_MASK = "••••••••••••";

function buildDefaultValue(field: ConnectorField): ConnectorFieldValue {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  switch (field.type) {
    case "checkbox":
      return false;
    case "number":
      return typeof field.min === "number" ? field.min : 0;
    default:
      return "";
  }
}

export function buildConnectorFormValues(
  plugin: ConnectorPluginManifest,
  editableValues?: ConnectorFieldValues,
): ConnectorFieldValues {
  const values: ConnectorFieldValues = {};
  const hasEditableValues = editableValues !== undefined;

  for (const field of plugin.connectionFields) {
    values[field.id] =
      editableValues?.[field.id] ??
      (field.secret && hasEditableValues
        ? SAVED_SECRET_MASK
        : field.secret
          ? ""
          : buildDefaultValue(field));
  }

  return values;
}

function isFieldEmpty(value: ConnectorFieldValue | undefined) {
  return value === undefined || value === "" || value === null;
}

export function canSubmitConnectorForm(
  plugin: ConnectorPluginManifest | undefined,
  values: ConnectorFieldValues,
  options?: { allowSavedSecrets?: boolean },
) {
  if (!plugin) {
    return false;
  }

  return plugin.connectionFields.every((field) => {
    if (!field.required) {
      return true;
    }

    if (field.id === "autoSyncIntervalMinutes" && values.autoSync !== true) {
      return true;
    }

    if (
      field.secret &&
      options?.allowSavedSecrets &&
      (isFieldEmpty(values[field.id]) || values[field.id] === SAVED_SECRET_MASK)
    ) {
      return true;
    }

    return !isFieldEmpty(values[field.id]);
  });
}

export function normalizeConnectorFormValuesForSave(
  plugin: ConnectorPluginManifest,
  values: ConnectorFieldValues,
  options?: { allowSavedSecrets?: boolean },
): ConnectorFieldValues {
  const normalizedValues: ConnectorFieldValues = { ...values };

  for (const field of plugin.connectionFields) {
    if (
      field.secret &&
      options?.allowSavedSecrets &&
      normalizedValues[field.id] === SAVED_SECRET_MASK
    ) {
      normalizedValues[field.id] = "";
    }
  }

  return normalizedValues;
}

export function areConnectorFormValuesEqual(
  plugin: ConnectorPluginManifest,
  left: ConnectorFieldValues,
  right: ConnectorFieldValues,
) {
  return plugin.connectionFields.every(
    (field) => left[field.id] === right[field.id],
  );
}
