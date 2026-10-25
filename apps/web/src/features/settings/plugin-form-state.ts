import {
  isCapabilitySwitchedOn,
  pluginConnectionFormFields,
  pluginHasBacklog,
  syncsPullRequestsAutomatically,
  type PluginField,
  type PluginFieldValue,
  type PluginFieldValues,
  type PluginManifest,
  type SwitchableCapability,
} from "@ajour/shared";

import {
  dateTextToExpiry,
  expiryToDateText,
} from "@/domain/plugins/secret-state";

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

/**
 * The values a form starts with. A secret field starts empty, whether or not
 * one is saved: the API never sends a value back, and an empty value keeps
 * the saved secret. The form shows the saved secret's state instead.
 */
export function buildPluginFormValues(
  plugin: PluginManifest,
  editableValues?: PluginFieldValues,
): PluginFieldValues {
  const values: PluginFieldValues = {};

  for (const field of pluginConnectionFormFields(plugin)) {
    values[field.id] = field.secret
      ? ""
      : (editableValues?.[field.id] ?? buildDefaultValue(field));
  }

  return values;
}

/** One opening of a connection form: what it started with and what it holds now. */
export type PluginFormState = {
  /** Which opening of the form this is, so a late result finds its own. */
  instance: number;
  pluginId: string;
  editingConnectionId: string | null;
  initialValues: PluginFieldValues;
  values: PluginFieldValues;
  /** The reminder dates as date text, by secret field. */
  initialExpiry: Record<string, string>;
  expiry: Record<string, string>;
  /** The access choices turned on, those always on left out. */
  initialAccess: readonly string[];
  access: readonly string[];
  /** The secret field whose Replace opens at once, as when the Vault sent the user. */
  replaceFieldId?: string;
};

/** The form for a new connection, or for editing `connection`. */
export function createPluginFormState(
  instance: number,
  plugin: PluginManifest,
  connection?: {
    id: string;
    editableValues: PluginFieldValues;
    secretFields?: ReadonlyArray<{ id: string; expiresAt?: number }>;
    access?: readonly string[];
  },
  replaceFieldId?: string,
  /** The plugin's access choices; a new connection starts with none on. */
  accessChoices: ReadonlyArray<{ id: string; always: boolean }> = [],
): PluginFormState {
  const initialValues = buildPluginFormValues(
    plugin,
    connection?.editableValues,
  );
  const initialExpiry = buildExpiryDrafts(
    secretFieldIds(plugin),
    connection?.secretFields,
  );
  const initialAccess = accessChoices
    .filter(
      (choice) => !choice.always && connection?.access?.includes(choice.id),
    )
    .map((choice) => choice.id);
  return {
    instance,
    pluginId: plugin.id,
    editingConnectionId: connection?.id ?? null,
    initialValues,
    values: initialValues,
    initialExpiry,
    expiry: initialExpiry,
    initialAccess,
    access: initialAccess,
    ...(replaceFieldId ? { replaceFieldId } : {}),
  };
}

/** The form's access with one choice turned on or off. */
export function withAccessChoice(
  form: PluginFormState,
  choiceId: string,
  on: boolean,
): PluginFormState {
  const rest = form.access.filter((id) => id !== choiceId);
  return { ...form, access: on ? [...rest, choiceId] : rest };
}

/** Whether the form turns the choice on, from off before. */
export function turnsAccessOn(form: PluginFormState, choiceId: string) {
  return (
    form.access.includes(choiceId) && !form.initialAccess.includes(choiceId)
  );
}

function sameAccess(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Whether the form holds a change: a value, a reminder date or its access. */
export function isPluginFormDirty(
  plugin: PluginManifest,
  form: PluginFormState,
) {
  return (
    !arePluginFormValuesEqual(plugin, form.values, form.initialValues) ||
    !areExpiryDraftsEqual(form.expiry, form.initialExpiry) ||
    !sameAccess(form.access, form.initialAccess)
  );
}

/** The ids of the secret fields the form can show a state for. */
export function secretFieldIds(plugin: PluginManifest) {
  return pluginConnectionFormFields(plugin)
    .filter((field) => field.secret)
    .map((field) => field.id);
}

/**
 * The reminder dates a form starts with, as date text by secret field: those
 * the vault holds, and empty text for a field with none.
 */
export function buildExpiryDrafts(
  fieldIds: readonly string[],
  secretFields: ReadonlyArray<{ id: string; expiresAt?: number }> = [],
): Record<string, string> {
  return Object.fromEntries(
    fieldIds.map((id) => [
      id,
      expiryToDateText(
        secretFields.find((entry) => entry.id === id)?.expiresAt,
      ),
    ]),
  );
}

/**
 * The reminder dates a save sends: a secret field's date, or `null` to clear
 * it. A date that isn't a whole date text counts as none. With `initial`, only
 * the dates the user changed go, because a date the vault already holds is
 * not an update, and a vault that can't be changed still takes a save that
 * changes no secret. A field in `replaced` has a new secret, which starts
 * without a date unless the save gives one, so its date goes as shown.
 */
export function expiryForSave(
  drafts: Readonly<Record<string, string>>,
  initial?: Readonly<Record<string, string>>,
  replaced: readonly string[] = [],
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(drafts)
      .filter(
        ([id, text]) =>
          !initial ||
          replaced.includes(id) ||
          text.trim() !== (initial[id] ?? "").trim(),
      )
      .map(([id, text]) => [id, dateTextToExpiry(text)]),
  );
}

/**
 * Starts a form over when a saved secret is replaced, or its state or
 * reminder date changes, and only then. Replacing sets a new `setAt`, so the
 * pasted token and the open Replace go. Its last use changes with every sync
 * and the form is usually open while one runs, so it is left out: remounting
 * would drop what the user typed.
 */
export function secretFieldsKey<
  Field extends {
    id: string;
    state: string;
    setAt?: number;
    expiresAt?: number;
  },
>(secretFields: readonly Field[]) {
  return JSON.stringify(
    secretFields.map(({ id, state, setAt, expiresAt }) => [
      id,
      state,
      setAt,
      expiresAt,
    ]),
  );
}

/** Whether every date typed is empty or a whole date. */
export function areExpiryDraftsValid(drafts: Readonly<Record<string, string>>) {
  return Object.values(drafts).every(
    (text) => text.trim() === "" || dateTextToExpiry(text) !== null,
  );
}

/** Whether the dates differ from those the form started with. */
export function areExpiryDraftsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...ids].every((id) => (left[id] ?? "") === (right[id] ?? ""));
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

/**
 * Whether the form can be saved: every shown required field has a value. A
 * required secret field may stay empty when the connection already holds one
 * (`savedSecrets`), because an empty value keeps it.
 */
export function canSubmitPluginForm(
  plugin: PluginManifest | undefined,
  values: PluginFieldValues,
  options?: {
    savedSecrets?: ReadonlySet<string>;
    inactiveCapabilities?: readonly SwitchableCapability[];
  },
) {
  if (!plugin) {
    return false;
  }

  return pluginConnectionFormFields(plugin).every((field) => {
    if (
      !field.required ||
      !isPluginFieldShown(plugin, field, values, options?.inactiveCapabilities)
    ) {
      return true;
    }

    if (
      field.secret &&
      options?.savedSecrets?.has(field.id) &&
      isFieldEmpty(values[field.id])
    ) {
      return true;
    }

    return !isFieldEmpty(values[field.id]);
  });
}

export function arePluginFormValuesEqual(
  plugin: PluginManifest,
  left: PluginFieldValues,
  right: PluginFieldValues,
) {
  return pluginConnectionFormFields(plugin).every(
    (field) => left[field.id] === right[field.id],
  );
}
