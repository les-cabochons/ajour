/**
 * Everything about a connection's credentials, and the agent task settings
 * marked secret: which fields hold one, how a save keeps, replaces or
 * removes them, the values a plugin's text is redacted against, the values a
 * form may show, and the connection a plugin receives. Every read or write of
 * a secret value goes through here, so the vault can take them over in one
 * place.
 *
 * A secret field is one the manifest marks `secret: true`. For redaction, a
 * stored key the manifest no longer declares counts as secret too, except
 * Ajour's own fields: a plugin update renamed or dropped its field, which may
 * have been secret, and the value stays until the connection is saved again.
 *
 * A save keeps a saved secret the request leaves empty, replaces it with a
 * new value, and deletes it when the request lists the field in
 * `removeSecrets`. A value can't both replace and remove a secret.
 */

import type {
  PluginFieldValue,
  PluginFieldValues,
} from "../../../packages/shared/plugins.ts";
import { RESERVED_CONNECTION_FIELD_IDS } from "./connection-values.ts";
import {
  connectionRedaction,
  errorMessage,
  redactPluginText,
  type ConnectionRedaction,
} from "./plugin-errors.ts";

/** A field declaration as far as secrets go: a connection field or an agent task setting. */
export interface SecretFieldDeclaration {
  id: string;
  secret?: boolean;
}

/** The part of a plugin manifest that says which connection fields are secret. */
export interface SecretConnectionFields {
  connectionFields: readonly SecretFieldDeclaration[];
}

type ConnectionValues = Readonly<Record<string, unknown>>;

/** A save that would replace and remove a secret at once, or remove a field that isn't one. */
export class SecretSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretSaveError";
  }
}

function isEmptySecretValue(value: PluginFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

/**
 * The values to store for a save: the submitted ones, with each saved secret
 * the save leaves empty kept, and each secret it lists in `removeSecrets`
 * deleted. Without saved values, a new connection, the submitted values stay
 * as they are, apart from removals. Throws `SecretSaveError` when a removal
 * names a field that isn't secret or that the save also gives a new value.
 */
export function mergeSecretsForSave(
  fields: readonly SecretFieldDeclaration[],
  submitted: PluginFieldValues,
  existing?: PluginFieldValues,
  removeSecrets: readonly string[] = [],
): PluginFieldValues {
  const secretIds = new Set(
    fields.filter((field) => field.secret).map((field) => field.id),
  );
  const removed = new Set(removeSecrets);
  for (const fieldId of removed) {
    if (!secretIds.has(fieldId)) {
      throw new SecretSaveError(
        `Plugin field "${fieldId}" is not a secret, so it can't be removed.`,
      );
    }
    if (!isEmptySecretValue(submitted[fieldId])) {
      throw new SecretSaveError(
        `Plugin field "${fieldId}" can't be replaced and removed in one save.`,
      );
    }
  }

  const merged: PluginFieldValues = { ...submitted };
  if (existing) {
    for (const fieldId of secretIds) {
      if (removed.has(fieldId) || !isEmptySecretValue(merged[fieldId])) {
        continue;
      }
      const saved = existing[fieldId];
      if (saved !== undefined) merged[fieldId] = saved;
    }
  }
  for (const fieldId of removed) delete merged[fieldId];
  return merged;
}

/**
 * The values a form may show: those of the declared fields that aren't
 * secret. A stored key the manifest no longer declares isn't shown either.
 */
export function editableValues(
  fields: readonly SecretFieldDeclaration[],
  values: Readonly<PluginFieldValues>,
): PluginFieldValues {
  const editable: PluginFieldValues = {};
  for (const field of fields) {
    if (field.secret) continue;
    const value = values[field.id];
    if (value !== undefined) editable[field.id] = value;
  }
  return editable;
}

/**
 * The values without the secret ones, for a response that shows every value
 * it holds, such as an agent task's: declared fields keep their place even
 * when the response adds defaults beside them.
 */
export function withoutSecretValues(
  fields: readonly SecretFieldDeclaration[],
  values: Readonly<PluginFieldValues>,
): PluginFieldValues {
  const secretIds = new Set(
    fields.filter((field) => field.secret).map((field) => field.id),
  );
  return Object.fromEntries(
    Object.entries(values).filter(([fieldId]) => !secretIds.has(fieldId)),
  );
}

/**
 * The plugin's secret field values in each config, as a message would show
 * them, without empty ones. A field may hold a string, a number or a boolean.
 * A stored key the manifest no longer declares counts as secret too, Ajour's
 * own fields excepted. A value with spaces at its ends counts trimmed as
 * well, because the host trims a plugin's message before it is redacted.
 */
export function connectionSecretValues(
  plugin: SecretConnectionFields,
  configs: readonly (ConnectionValues | undefined)[],
): string[] {
  const declaredSecret = new Map(
    plugin.connectionFields.map((field) => [field.id, field.secret ?? false]),
  );
  const values = new Set<string>();
  for (const config of configs) {
    for (const [fieldId, value] of Object.entries(config ?? {})) {
      const secret =
        declaredSecret.get(fieldId) ??
        !RESERVED_CONNECTION_FIELD_IDS.has(fieldId);
      if (
        secret &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean")
      ) {
        const text = String(value);
        for (const form of [text, text.trim()]) {
          if (form.length > 0) values.add(form);
        }
      }
    }
  }
  return [...values];
}

/** A connection's credentials for one request, as its texts are redacted. */
export interface ConnectionCredentials {
  /** The secret values, for an event's error scrubber. */
  readonly secrets: readonly string[];
  /** One redaction for every text of the request, built on first use. */
  readonly redaction: ConnectionRedaction;
  /** The message a plugin error may carry out of the plugin host. */
  errorMessage(error: unknown): string;
}

/**
 * The credentials of a connection for one request. Give every config the
 * plugin could have seen: on a save, the submitted values with the saved
 * secrets merged in, and the saved config.
 */
export function connectionCredentials(
  plugin: SecretConnectionFields,
  ...configs: (ConnectionValues | undefined)[]
): ConnectionCredentials {
  const secrets = connectionSecretValues(plugin, configs);
  let redaction: ConnectionRedaction | undefined;
  return {
    secrets,
    get redaction() {
      return (redaction ??= connectionRedaction(secrets));
    },
    errorMessage: (error) => redactPluginText(errorMessage(error), secrets),
  };
}

/**
 * The message a plugin error may carry out of the plugin host, for an
 * operation on a connection. See `connectionCredentials` for the configs.
 */
export function pluginErrorMessage(
  error: unknown,
  plugin: SecretConnectionFields,
  ...configs: (ConnectionValues | undefined)[]
): string {
  return connectionCredentials(plugin, ...configs).errorMessage(error);
}

/** The parts of a saved connection a plugin receives. */
export interface SavedConnection {
  id: string;
  pluginId: string;
  label: string;
  tenantLabel: string;
  autoSync: boolean;
  autoSyncIntervalMinutes: number;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  config: PluginFieldValues;
}

/**
 * The connection as a plugin receives it: its config, secrets included, and
 * the fields Ajour owns that a plugin may read. Until the vault ships, an
 * API 3 plugin needs the secrets in plain text.
 */
export function pluginConnection(connection: SavedConnection) {
  return {
    id: connection.id,
    pluginId: connection.pluginId,
    label: connection.label,
    tenantLabel: connection.tenantLabel,
    autoSync: connection.autoSync,
    autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes,
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastError: connection.lastError,
    config: connection.config,
  };
}
