import {
  isCapabilitySwitchedOn,
  pluginHasBacklog,
  syncsPullRequestsAutomatically,
  type PluginField,
  type PluginFieldValue,
  type PluginFieldValues,
  type PluginManifest,
  type SwitchableCapability,
} from "@ajour/shared";

export const SAVED_SECRET_MASK = "••••••••••••";

function buildDefaultValue(field: PluginField): PluginFieldValue {
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

export function buildPluginFormValues(
  plugin: PluginManifest,
  editableValues?: PluginFieldValues,
): PluginFieldValues {
  const values: PluginFieldValues = {};
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

/**
 * Whether the connection form shows the field. A field of a capability the
 * user turned off is hidden. The interval shows while something syncs on it:
 * backlog items with auto sync, pull requests with their own automatic sync,
 * or a team, which always syncs on it.
 */
export function isPluginFieldShown(
  plugin: PluginManifest,
  field: PluginField,
  values: PluginFieldValues,
  inactiveCapabilities: readonly SwitchableCapability[] = [],
) {
  const active = (capability: SwitchableCapability) =>
    isCapabilitySwitchedOn({ plugin, inactiveCapabilities }, capability);
  if (field.capability && !active(field.capability)) {
    return false;
  }
  if (field.id === "autoSyncIntervalMinutes") {
    const workItems =
      (!pluginHasBacklog(plugin) || active("connector")) &&
      values.autoSync === true;
    const pullRequests =
      active("codeHost") &&
      syncsPullRequestsAutomatically({
        autoSync: values.autoSync === true,
        ...(typeof values.pullRequestAutoSync === "boolean"
          ? { pullRequestAutoSync: values.pullRequestAutoSync }
          : {}),
      });
    return workItems || pullRequests || active("team");
  }
  return true;
}

function isFieldEmpty(value: PluginFieldValue | undefined) {
  return value === undefined || value === "" || value === null;
}

export function canSubmitPluginForm(
  plugin: PluginManifest | undefined,
  values: PluginFieldValues,
  options?: {
    allowSavedSecrets?: boolean;
    inactiveCapabilities?: readonly SwitchableCapability[];
  },
) {
  if (!plugin) {
    return false;
  }

  return plugin.connectionFields.every((field) => {
    if (
      !field.required ||
      !isPluginFieldShown(plugin, field, values, options?.inactiveCapabilities)
    ) {
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

export function normalizePluginFormValuesForSave(
  plugin: PluginManifest,
  values: PluginFieldValues,
  options?: { allowSavedSecrets?: boolean },
): PluginFieldValues {
  const normalizedValues: PluginFieldValues = { ...values };

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

export function arePluginFormValuesEqual(
  plugin: PluginManifest,
  left: PluginFieldValues,
  right: PluginFieldValues,
) {
  return plugin.connectionFields.every(
    (field) => left[field.id] === right[field.id],
  );
}
