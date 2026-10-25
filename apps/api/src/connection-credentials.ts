/**
 * Everything about a connection's credentials, and the agent task settings
 * marked secret: which fields hold one, how a save keeps, replaces or
 * removes them, the values a plugin's text is redacted against, the values a
 * form may show, and the connection a plugin receives. Every read or write of
 * a secret value goes through here.
 *
 * Secret values live in the vault (`secret-vault.ts`), and the state file
 * records only which fields the vault holds. The second half of this module
 * moves plain-text values into the vault, reads them back for a plugin
 * operation, and splits a save between the two files.
 *
 * A secret field is one the manifest marks `secret: true`, or one the vault
 * already holds. A stored key the manifest doesn't declare counts as secret
 * too, except Ajour's own fields: a plugin update renamed or dropped its
 * field, which may have been secret. It is redacted, and moves into the
 * vault like any secret, so it never stays in plain text.
 *
 * A save keeps a saved secret the request leaves empty, replaces it with a
 * new value, and deletes it when the request lists the field in
 * `removeSecrets`. A value can't both replace and remove a secret.
 */

import {
  agentTaskSettingFields,
  pluginFieldValueSchema,
  pluginFieldValuesSchema,
  type PluginFieldValue,
  type PluginFieldValues,
  type PluginManifest,
} from "../../../packages/shared/plugins.ts";
import type { StoredSecretFields } from "./agent-runner-state.ts";
import { RESERVED_CONNECTION_FIELD_IDS } from "./connection-values.ts";
import {
  NO_VAULT_STATUS,
  type SecretKey,
  type SecretRead,
  type SecretSelection,
  type SecretVault,
  type SecretWrite,
  type VaultStatus,
} from "./secret-vault.ts";
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

/** A value a save leaves empty: no secret, so a saved one stays. */
export function isEmptySecretValue(value: PluginFieldValue | undefined) {
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
 * The config an API 4 plugin's validation saves. Secret fields are
 * host-owned: the plugin never saw them, so its answer can neither set nor
 * drop one, and they come from the save itself. So do the fields the broker
 * builds requests from (`networkFields`, see `pluginNetworkFieldIds`): the
 * base address and the auth scheme's user. A plugin answering with another
 * address, or another user, is ignored rather than refused: the validation's
 * requests went to what the user entered, so that is what was proven, and a
 * plugin's harmless clean-up, such as a trailing slash the broker drops
 * anyway, doesn't fail the save. Of the rest of the plugin's answer only the
 * declared fields stay: a key it adds, such as one of Ajour's own fields, an
 * access choice or a value for the vault, is dropped.
 */
export function api4SavedConfig(
  fields: readonly SecretFieldDeclaration[],
  normalized: Readonly<PluginFieldValues>,
  submitted: Readonly<PluginFieldValues>,
  networkFields: readonly string[],
): PluginFieldValues {
  const userOwned = new Set(networkFields);
  const saved: PluginFieldValues = {};
  for (const field of fields) {
    const value =
      field.secret || userOwned.has(field.id)
        ? submitted[field.id]
        : normalized[field.id];
    if (value !== undefined) saved[field.id] = value;
  }
  return saved;
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
  /** The access choices it turned on, which only an API 4 plugin receives. */
  access?: readonly string[];
}

/**
 * The connection as a plugin receives it: its config, secrets included, and
 * the fields Ajour owns that a plugin may read. An API 3 plugin needs the
 * secrets in plain text, so until the cut-over (#403) the host decrypts a
 * connection's secrets from the vault only to build this, for its worker.
 * An API 4 plugin gets it without the secrets, which the plugin host
 * removes, and with its access choices.
 */
export function pluginConnection(connection: SavedConnection) {
  return {
    ...(connection.access ? { access: [...connection.access] } : {}),
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

// The vault.

/** What a plugin's manifest says about secrets, for its connections and its agent tasks. */
export interface SecretManifest {
  id: string;
  connectionFields: readonly SecretFieldDeclaration[];
  /** The settings the plugin's agent tasks share. */
  agentTaskFields: readonly SecretFieldDeclaration[];
}

/** What a plugin's manifest says about its secrets. */
export function secretManifestOf(manifest: PluginManifest): SecretManifest {
  return {
    id: manifest.id,
    connectionFields: manifest.connectionFields,
    agentTaskFields: agentTaskSettingFields(
      manifest.capabilities.agentTask?.tasks ?? [],
    ),
  };
}

/**
 * Values that may hold secrets, of one owner: a connection's config, or the
 * agent task settings a plugin's tasks share (`connectionId` null).
 */
export interface SecretHolder {
  pluginId: string;
  connectionId: string | null;
  /** The values the state file keeps. Once checked, none is secret. */
  values: PluginFieldValues;
  /**
   * The fields whose values the vault holds. Undefined until the values are
   * checked against the plugin's manifest, as for every holder saved before
   * the vault came.
   */
  secrets?: StoredSecretFields;
}

/** Why a holder's secrets can't reach a plugin now, so its connection pauses. */
export type SecretPause =
  /** This computer can't encrypt, or the API has no vault. */
  | "vault_unavailable"
  /** The vault holds the secret, but it can't be read on this computer. */
  | "secret_unreadable"
  /** A secret still sits in the state file, waiting to move into the vault. */
  | "not_in_vault";

/** The message a paused connection's refused operation answers with. */
export function secretPauseMessage(pause: SecretPause, reason?: string) {
  switch (pause) {
    case "vault_unavailable":
      return `Ajour can't protect credentials on this computer, so this connection is paused.${reason ? ` ${reason}` : ""}`;
    case "secret_unreadable":
      return "This connection's saved credentials can't be read on this computer. Enter them again to resume it.";
    case "not_in_vault":
      return "Ajour couldn't move this connection's credentials into the vault, so it is paused. Ajour tries again at the next launch.";
  }
}

/** An operation refused because its connection's secrets can't reach the plugin. */
export class ConnectionPausedError extends Error {
  readonly pause: SecretPause;

  constructor(pause: SecretPause, reason?: string) {
    super(secretPauseMessage(pause, reason));
    this.name = "ConnectionPausedError";
    this.pause = pause;
  }
}

function holderKey(holder: SecretHolder, fieldId: string | null): SecretKey {
  return {
    pluginId: holder.pluginId,
    connectionId: holder.connectionId,
    fieldId,
  };
}

/** The fields the manifest declares for the holder: connection fields or agent task settings. */
function declaredFields(
  manifest: SecretManifest,
  holder: Pick<SecretHolder, "connectionId">,
) {
  return holder.connectionId === null
    ? manifest.agentTaskFields
    : manifest.connectionFields;
}

/** Ajour's own connection fields, which are never secret. */
function isOwnField(holder: Pick<SecretHolder, "connectionId">, id: string) {
  return holder.connectionId !== null && RESERVED_CONNECTION_FIELD_IDS.has(id);
}

/**
 * The fields a save treats as secret: those the manifest marks, and those
 * the vault already holds. A field stays secret once in the vault, so an
 * update that drops `secret: true` neither shows it in a form nor loses it.
 */
export function effectiveSecretFields(
  fields: readonly SecretFieldDeclaration[],
  secrets: StoredSecretFields | undefined,
): SecretFieldDeclaration[] {
  const inVault = new Set(secrets?.fields ?? []);
  const effective = fields.map((field) =>
    inVault.has(field.id) && !field.secret ? { ...field, secret: true } : field,
  );
  for (const id of inVault) {
    if (!fields.some((field) => field.id === id)) {
      effective.push({ id, secret: true });
    }
  }
  return effective;
}

/**
 * The connection fields a connection's texts are redacted with: those of
 * its manifest, with the ones the vault holds marked secret, so a field an
 * update stopped marking secret is still redacted.
 */
export function redactionFields(
  fields: readonly SecretFieldDeclaration[],
  secrets: StoredSecretFields | undefined,
): SecretConnectionFields {
  return { connectionFields: effectiveSecretFields(fields, secrets) };
}

/**
 * The keys of `values` that go to the vault, by the rule redaction uses:
 * each field the manifest marks secret or the vault already holds, and each
 * stored key the manifest doesn't declare, Ajour's own fields excepted. An
 * update may have renamed a secret field, or a plugin's normalized config
 * may hold a value it traded for, so an undeclared value is never kept in
 * plain text.
 */
function secretIdsOf(
  fields: readonly SecretFieldDeclaration[],
  holder: SecretHolder,
  values: Readonly<PluginFieldValues>,
): Set<string> {
  const effective = effectiveSecretFields(fields, holder.secrets);
  const declared = new Set(effective.map((field) => field.id));
  const ids = new Set(
    effective
      .filter((field) => field.secret && !isOwnField(holder, field.id))
      .map((field) => field.id),
  );
  for (const id of Object.keys(values)) {
    if (!declared.has(id) && !isOwnField(holder, id)) ids.add(id);
  }
  return ids;
}

function secretFieldIds(
  manifest: SecretManifest,
  holder: SecretHolder,
  values: Readonly<PluginFieldValues> = holder.values,
): Set<string> {
  return secretIdsOf(declaredFields(manifest, holder), holder, values);
}

/** The values a holder keeps that nothing has checked for secrets. */
function uncheckedValues(holder: SecretHolder): PluginFieldValues {
  return Object.fromEntries(
    Object.entries(holder.values).filter(
      ([id, value]) => value !== undefined && !isOwnField(holder, id),
    ),
  );
}

/**
 * Whether the holder keeps something the vault should hold: a secret in
 * plain text, or, while its plugin's manifest is missing, values nothing
 * has checked. Values sealed while the plugin was missing are split once it
 * is back.
 */
export function holderNeedsMove(
  holder: SecretHolder,
  manifest: SecretManifest | undefined,
): boolean {
  if (!manifest) {
    return (
      holder.secrets === undefined &&
      Object.keys(uncheckedValues(holder)).length > 0
    );
  }
  if (holder.secrets?.sealed) return true;
  const secretIds = secretFieldIds(manifest, holder);
  return Object.entries(holder.values).some(
    ([id, value]) => secretIds.has(id) && !isEmptySecretValue(value),
  );
}

/**
 * Whether the holder's values were never checked against its plugin's
 * manifest, which is here. Marking them checked needs no vault, and keeps
 * them from being sealed if the plugin's package goes missing later.
 */
function holderNeedsCheck(
  holder: SecretHolder,
  manifest: SecretManifest | undefined,
) {
  return manifest !== undefined && holder.secrets === undefined;
}

/** Whether `moveHolderToVault` has anything to do for the holder. */
export function holderNeedsSettling(
  holder: SecretHolder,
  manifest: SecretManifest | undefined,
) {
  return (
    holderNeedsMove(holder, manifest) || holderNeedsCheck(holder, manifest)
  );
}

/** `values` without any the manifest marks secret or the vault holds. */
export function nonSecretValues(
  holder: SecretHolder,
  manifest: SecretManifest,
  values: PluginFieldValues,
): PluginFieldValues {
  const secretIds = secretFieldIds(manifest, holder, values);
  return Object.fromEntries(
    Object.entries(values).filter(([id]) => !secretIds.has(id)),
  );
}

/** A vault value: the field value as JSON, so a number stays a number. */
function encodeValue(value: PluginFieldValue) {
  return JSON.stringify(value);
}

function decodeValue(text: string): PluginFieldValue | undefined {
  try {
    const parsed = pluginFieldValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function decodeSealed(text: string): PluginFieldValues | undefined {
  try {
    const parsed = pluginFieldValuesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** How a move of a holder's values into the vault went. */
export type SecretMove =
  | { outcome: "unchanged" }
  | {
      outcome: "moved";
      holder: SecretHolder;
      /**
       * The secret values the move took out of the state file, for redacting
       * the texts stored beside them, such as a connection's last error.
       */
      secrets: string[];
      /** The sealed entry to delete once the state file no longer needs it. */
      removeAfterSave?: SecretSelection;
    }
  | { outcome: "failed" };

/**
 * Moves what the vault should hold out of a holder's values (see
 * `holderNeedsMove`). Each value is encrypted and written, then read back
 * and compared; only then does the returned holder leave it out. Any
 * failure returns `failed` and the holder keeps its values. With the
 * manifest, each secret field gets its own entry, and values sealed while
 * the plugin was missing are split: the secrets stay in the vault, the rest
 * returns to the state file. Without it, the values go into the vault whole,
 * as one entry, because nothing says which are secret.
 */
export async function moveHolderToVault(
  holder: SecretHolder,
  manifest: SecretManifest | undefined,
  vault: SecretVault | undefined,
): Promise<SecretMove> {
  if (!holderNeedsMove(holder, manifest)) {
    return holderNeedsCheck(holder, manifest)
      ? {
          outcome: "moved",
          holder: { ...holder, secrets: { fields: [] } },
          secrets: [],
        }
      : { outcome: "unchanged" };
  }
  if (!vault) return { outcome: "failed" };
  try {
    if (!manifest) {
      const sealed = uncheckedValues(holder);
      const text = JSON.stringify(sealed);
      const key = holderKey(holder, null);
      await vault.write([{ ...key, value: text }]);
      const [read] = await vault.read([key]);
      if (read?.state !== "set" || read.value !== text) {
        return { outcome: "failed" };
      }
      return {
        outcome: "moved",
        holder: {
          ...holder,
          values: Object.fromEntries(
            Object.entries(holder.values).filter(([id]) =>
              isOwnField(holder, id),
            ),
          ),
          secrets: { fields: [], sealed: true },
        },
        // Nothing says which values are secret. A plugin that is missing
        // shows neither its stored last error nor its summary.
        secrets: [],
      };
    }

    let values = holder.values;
    const sealed = holder.secrets?.sealed === true;
    if (sealed) {
      const [read] = await vault.read([holderKey(holder, null)]);
      const unsealed =
        read?.state === "set" ? decodeSealed(read.value) : undefined;
      if (!unsealed) return { outcome: "failed" };
      values = { ...unsealed, ...holder.values };
    }
    // A sealed value the returning manifest doesn't declare stays secret.
    const secretIds = secretFieldIds(manifest, holder, values);
    const writes = Object.entries(values)
      .filter(([id, value]) => secretIds.has(id) && !isEmptySecretValue(value))
      .map(([id, value]) => ({
        ...holderKey(holder, id),
        value: encodeValue(value!),
      }));
    if (writes.length > 0) {
      await vault.write(writes);
      const reads = await vault.read(writes);
      if (
        reads.some(
          (read, index) =>
            read.state !== "set" || read.value !== writes[index]!.value,
        )
      ) {
        return { outcome: "failed" };
      }
    }
    return {
      outcome: "moved",
      holder: {
        ...holder,
        values: Object.fromEntries(
          Object.entries(values).filter(([id]) => !secretIds.has(id)),
        ),
        secrets: {
          fields: Array.from(
            new Set([
              ...(holder.secrets?.fields ?? []),
              ...writes.map((write) => write.fieldId!),
            ]),
          ).sort(),
        },
      },
      secrets: connectionSecretValues(
        {
          connectionFields: [...secretIds].map((id) => ({ id, secret: true })),
        },
        [
          Object.fromEntries(
            Object.entries(values).filter(([id]) => secretIds.has(id)),
          ),
        ],
      ),
      ...(sealed
        ? {
            removeAfterSave: {
              pluginId: holder.pluginId,
              connectionId: holder.connectionId,
              fieldIds: [null],
            },
          }
        : {}),
    };
  } catch {
    return { outcome: "failed" };
  }
}

/** A holder's values with its secrets, as far as they can be read. */
export interface HolderSecrets {
  /** The values with every secret that could be read. */
  values: PluginFieldValues;
  /** Why the holder's secrets can't all reach a plugin, if they can't. */
  pause?: SecretPause;
  /** The vault's reason when it is unavailable. */
  reason?: string;
  /** The secret fields that couldn't be read. A save keeps their entries. */
  unreadable: string[];
  /**
   * For a holder sealed while its plugin was missing, how its sealed entry
   * reads: `unavailable` when the vault can't be read now.
   */
  sealed?: SecretRead["state"] | "unavailable";
}

/** What decides whether a holder's connection pauses. */
export interface SecretPauseFacts {
  /** The holder has a secret in the vault, a sealed config, or one still in plain text. */
  needsVault: boolean;
  /** The vault's status: `NO_VAULT_STATUS` for an API without one. */
  status: VaultStatus;
  /** A secret it holds in the vault can't be read. */
  unreadable: boolean;
  /** A secret still sits in the state file (`holderNeedsMove`). */
  notMoved: boolean;
}

/**
 * Why a holder's secrets can't reach a plugin, if they can't, and the
 * vault's reason when it is unavailable. The overview, which decrypts
 * nothing, and a plugin operation, which reads the secrets, both decide here.
 */
export function decideSecretPause(facts: SecretPauseFacts): {
  pause?: SecretPause;
  reason?: string;
} {
  if (!facts.needsVault) return {};
  if (facts.status.state === "unavailable") {
    return { pause: "vault_unavailable", reason: facts.status.reason };
  }
  if (facts.unreadable) return { pause: "secret_unreadable" };
  if (facts.notMoved) return { pause: "not_in_vault" };
  return {};
}

/**
 * Reads a holder's secrets from the vault into its values. A secret that
 * can't be read is left out and pauses the holder, as do values that still
 * wait to move into the vault (`decideSecretPause`). A sealed config is read
 * only to know whether it can be. `usedAt` records the read as a use, for a
 * plugin operation.
 */
export async function readHolderSecrets(
  holder: SecretHolder,
  manifest: SecretManifest | undefined,
  vault: SecretVault | undefined,
  options: { usedAt?: number } = {},
): Promise<HolderSecrets> {
  const fields = holder.secrets?.fields ?? [];
  const sealed = holder.secrets?.sealed === true;
  const notMoved = holderNeedsMove(holder, manifest);
  const values: PluginFieldValues = { ...holder.values };
  const needsVault = fields.length > 0 || sealed || notMoved;
  if (!needsVault) return { values, unreadable: [] };
  const status = vault ? (await vault.open()).status : NO_VAULT_STATUS;
  if (!vault || status.state === "unavailable") {
    return {
      values,
      unreadable: fields,
      ...(sealed ? { sealed: "unavailable" as const } : {}),
      ...decideSecretPause({ needsVault, status, unreadable: false, notMoved }),
    };
  }
  const keys = fields.map((id) => holderKey(holder, id));
  if (sealed) keys.push(holderKey(holder, null));
  const reads = keys.length > 0 ? await vault.read(keys, options) : [];
  const unreadable: string[] = [];
  fields.forEach((id, index) => {
    const read = reads[index]!;
    const value = read.state === "set" ? decodeValue(read.value) : undefined;
    if (value === undefined) unreadable.push(id);
    else values[id] = value;
  });
  const sealedRead = sealed ? reads[fields.length]! : undefined;
  const sealedState: HolderSecrets["sealed"] =
    sealedRead?.state === "set" && !decodeSealed(sealedRead.value)
      ? "unreadable"
      : sealedRead?.state;
  return {
    values,
    unreadable,
    ...(sealedState ? { sealed: sealedState } : {}),
    ...decideSecretPause({
      needsVault,
      status,
      unreadable: unreadable.length > 0 || sealedState === "unreadable",
      notMoved,
    }),
  };
}

/** A save, split between the state file and the vault. */
export interface SplitSave {
  /** The values the state file keeps: no secret. */
  values: PluginFieldValues;
  secrets: StoredSecretFields;
  /** The secrets to encrypt, new or changed. */
  writes: SecretWrite[];
  /** The entries the save no longer needs. */
  removals: Array<string | null>;
}

/**
 * Splits the values a save stores between the state file and the vault.
 * `next` holds the values with their secrets, as the plugin normalized
 * them; `previous` the readable values before the save. A secret that
 * changed is written, an unchanged one keeps its entry, and one the save
 * no longer holds is removed: removed on request, or dropped by the plugin.
 * An entry that can't be read is kept unless the save replaces or removes
 * it, since the plugin never saw it. A key the manifest doesn't declare is
 * a secret too (`secretIdsOf`).
 *
 * A config sealed while its plugin was missing is replaced by the save only
 * when it can't be read on this computer. One that wasn't split yet, because
 * the vault can't be read now or its move failed this launch, still holds
 * what the save would lose: the save is refused with `ConnectionPausedError`.
 */
export function splitSave(
  holder: SecretHolder,
  fields: readonly SecretFieldDeclaration[],
  next: PluginFieldValues,
  previous: HolderSecrets,
  removeSecrets: readonly string[] = [],
): SplitSave {
  if (
    holder.secrets?.sealed &&
    previous.sealed !== "unreadable" &&
    previous.sealed !== "missing"
  ) {
    throw new ConnectionPausedError(
      previous.pause === "vault_unavailable" ? previous.pause : "not_in_vault",
      previous.reason,
    );
  }
  const secretIds = secretIdsOf(fields, holder, next);
  const inVault = new Set(holder.secrets?.fields ?? []);
  const values: PluginFieldValues = {};
  const kept = new Set<string>();
  const writes: SecretWrite[] = [];
  for (const [id, value] of Object.entries(next)) {
    if (!secretIds.has(id)) {
      values[id] = value;
      continue;
    }
    if (isEmptySecretValue(value)) continue;
    kept.add(id);
    // A value still in plain text, or a changed one, is written.
    if (
      !inVault.has(id) ||
      previous.values[id] === undefined ||
      encodeValue(previous.values[id]!) !== encodeValue(value!)
    ) {
      writes.push({ ...holderKey(holder, id), value: encodeValue(value!) });
    }
  }
  const removed = new Set(removeSecrets);
  for (const id of previous.unreadable) {
    if (!kept.has(id) && !removed.has(id)) kept.add(id);
  }
  const removals: Array<string | null> = (holder.secrets?.fields ?? []).filter(
    (id) => !kept.has(id),
  );
  if (holder.secrets?.sealed) removals.push(null);
  return {
    values,
    secrets: { fields: [...kept].sort() },
    writes,
    removals,
  };
}
