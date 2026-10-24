/**
 * The vault: where Ajour keeps the secrets of plugin connections and agent
 * task settings, encrypted by the operating system. The state file records
 * only which secret fields are set (decided in #233).
 *
 * `SecretVault` is the port. `FileSecretVault` is the one Ajour ships: a
 * file beside the state file, written atomically, whose entries a
 * `SecretCipher` encrypts. The desktop app's cipher is Electron's async
 * `safeStorage`, which works only after `ready`. The standalone local API
 * has no vault and holds no secrets. Tests use the in-memory fake in
 * `test-support/`.
 *
 * At its first use, `open()` proves encryption with an encrypt-and-decrypt
 * round trip, rather than trusting an availability flag, then decrypts the
 * check value the file keeps. When the check fails, the key that encrypted
 * the vault is gone, as after a restore on another computer, and every
 * entry is unreadable at once. When the check passes but one entry fails,
 * only that entry is. Either way decryption isn't tried again before the
 * next launch, and an unreadable entry is kept until it is replaced or
 * removed.
 */

import { readFile, rename } from "node:fs/promises";
import { removeOrphanedTempFiles, writeFileAtomically } from "./atomic-file.ts";

/**
 * One secret's place. `connectionId` is null for the plugin's agent task
 * settings, and `fieldId` is null for a whole config, sealed as one entry
 * while its plugin's package was missing.
 */
export interface SecretKey {
  pluginId: string;
  connectionId: string | null;
  fieldId: string | null;
}

export interface SecretWrite extends SecretKey {
  value: string;
  /** The user's reminder date for the secret, if any. */
  expiresAt?: number;
}

/** An entry as the vault lists it: never its value. */
export interface SecretEntryInfo extends SecretKey {
  setAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  /** True once its decryption failed, or the whole vault's did. */
  unreadable: boolean;
}

/** Whether the vault can keep and give back secrets on this computer. */
export type VaultStatus =
  | { state: "available" }
  | { state: "unavailable"; reason: string }
  | { state: "unreadable" };

/** One secret as a read finds it. */
export type SecretRead =
  | { state: "set"; value: string }
  | { state: "unreadable" }
  | { state: "missing" };

/** What a selection of entries to remove covers. */
export interface SecretSelection {
  pluginId: string;
  /** Absent: every entry of the plugin. Null: its agent task settings. */
  connectionId?: string | null;
  /** Absent: every field of the owner. */
  fieldIds?: readonly (string | null)[];
}

export interface VaultOpened {
  status: VaultStatus;
  entryCount: number;
  /** Temp files an interrupted save left that couldn't be deleted. */
  undeletableOrphans: number;
}

export interface SecretVault {
  /**
   * Proves encryption and reads the vault, once: later calls give the same
   * answer. Every other method opens the vault first.
   */
  open(): Promise<VaultOpened>;
  list(): Promise<SecretEntryInfo[]>;
  /**
   * Decrypts each key's entry, in order. `usedAt` records the read as a use
   * of every secret it found.
   */
  read(
    keys: readonly SecretKey[],
    options?: { usedAt?: number },
  ): Promise<SecretRead[]>;
  /**
   * Encrypts and saves the entries, replacing any with the same key, all or
   * none. Throws `VaultUnavailableError` when encryption isn't available.
   */
  write(entries: readonly SecretWrite[]): Promise<void>;
  /** Deletes the selected entries, readable or not. Returns how many. */
  remove(selection: SecretSelection): Promise<number>;
}

/** Encrypts the vault's entries. The desktop app's is Electron's `safeStorage`. */
export interface SecretCipher {
  /** Why encryption can't be used here, before it is tried. Undefined when it may. */
  unavailableReason?(): Promise<string | undefined>;
  encrypt(text: string): Promise<Uint8Array>;
  /** `reEncrypt` asks for the value to be encrypted again, as after a key rotation. */
  decrypt(
    ciphertext: Uint8Array,
  ): Promise<{ text: string; reEncrypt?: boolean }>;
}

/** A secret write refused because this computer can't encrypt it. */
export class VaultUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      `Ajour can't protect credentials on this computer, so it can't save a secret. ${reason}`,
    );
    this.name = "VaultUnavailableError";
    this.reason = reason;
  }
}

/** The reason the standalone local API, which has no vault, gives. */
export const NO_VAULT_REASON =
  "The standalone local API holds no secrets. Use the Ajour desktop app to save credentials.";

/** The status of a local API without a vault. */
export const NO_VAULT_STATUS: VaultStatus = {
  state: "unavailable",
  reason: NO_VAULT_REASON,
};

export function secretKeyId(key: SecretKey) {
  return JSON.stringify([key.pluginId, key.connectionId, key.fieldId]);
}

export function selects(selection: SecretSelection, key: SecretKey) {
  return (
    key.pluginId === selection.pluginId &&
    (selection.connectionId === undefined ||
      key.connectionId === selection.connectionId) &&
    (selection.fieldIds === undefined ||
      selection.fieldIds.includes(key.fieldId))
  );
}

/** The text the check value holds, encrypted. */
const CHECK_TEXT = "ajour-vault-check";
/** Skips saving `lastUsedAt` more than once a minute per entry. */
const LAST_USED_RESOLUTION_MS = 60_000;

interface StoredEntry extends SecretKey {
  ciphertext: string;
  setAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
}

interface VaultFile {
  version: 1;
  check: string;
  entries: StoredEntry[];
}

function isStoredEntry(value: unknown): value is StoredEntry {
  const entry = value as Partial<StoredEntry> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.pluginId === "string" &&
    (entry.connectionId === null || typeof entry.connectionId === "string") &&
    (entry.fieldId === null || typeof entry.fieldId === "string") &&
    typeof entry.ciphertext === "string" &&
    typeof entry.setAt === "number"
  );
}

/** The file's entries and check, or undefined for a file that isn't a vault. */
function parseVaultFile(text: string): VaultFile | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<VaultFile> | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      typeof parsed.check !== "string" ||
      !Array.isArray(parsed.entries) ||
      !parsed.entries.every(isStoredEntry)
    ) {
      return undefined;
    }
    return { version: 1, check: parsed.check, entries: parsed.entries };
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(text: string) {
  return Buffer.from(text, "base64");
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Encryption failed.";
}

export interface FileSecretVaultOptions {
  /** The vault file, beside the state file. */
  filePath: string;
  cipher: SecretCipher;
  now?: () => number;
}

/** The vault in a file, encrypted by `cipher`. Only this class writes it. */
export class FileSecretVault implements SecretVault {
  private readonly filePath: string;
  private readonly cipher: SecretCipher;
  private readonly now: () => number;
  private opening?: Promise<VaultOpened>;
  private status: VaultStatus = { state: "unavailable", reason: "" };
  private check?: string;
  private entries = new Map<string, StoredEntry>();
  /** Entries whose decryption failed this launch, never tried again. */
  private readonly unreadable = new Set<string>();
  /** When each entry's `lastUsedAt` was last saved. */
  private readonly savedLastUse = new Map<string, number>();
  /** True when the file exists but isn't a vault: the next save keeps it aside. */
  private foundUnreadableFile = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileSecretVaultOptions) {
    this.filePath = options.filePath;
    this.cipher = options.cipher;
    this.now = options.now ?? Date.now;
  }

  open(): Promise<VaultOpened> {
    return (this.opening ??= this.load());
  }

  async list(): Promise<SecretEntryInfo[]> {
    await this.open();
    return [...this.entries.entries()].map(([id, entry]) => ({
      pluginId: entry.pluginId,
      connectionId: entry.connectionId,
      fieldId: entry.fieldId,
      setAt: entry.setAt,
      ...(entry.lastUsedAt !== undefined
        ? { lastUsedAt: entry.lastUsedAt }
        : {}),
      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
      unreadable: this.unreadable.has(id),
    }));
  }

  async read(
    keys: readonly SecretKey[],
    options: { usedAt?: number } = {},
  ): Promise<SecretRead[]> {
    await this.open();
    const reads: SecretRead[] = [];
    const reEncrypt: SecretWrite[] = [];
    let touched = false;
    for (const key of keys) {
      const id = secretKeyId(key);
      const entry = this.entries.get(id);
      if (!entry) {
        reads.push({ state: "missing" });
        continue;
      }
      if (this.status.state !== "available" || this.unreadable.has(id)) {
        reads.push({ state: "unreadable" });
        continue;
      }
      try {
        const decrypted = await this.cipher.decrypt(
          fromBase64(entry.ciphertext),
        );
        reads.push({ state: "set", value: decrypted.text });
        if (decrypted.reEncrypt) {
          reEncrypt.push({
            ...key,
            value: decrypted.text,
            ...(entry.expiresAt !== undefined
              ? { expiresAt: entry.expiresAt }
              : {}),
          });
        }
        if (options.usedAt !== undefined) {
          entry.lastUsedAt = options.usedAt;
          if (
            options.usedAt - (this.savedLastUse.get(id) ?? 0) >=
            LAST_USED_RESOLUTION_MS
          ) {
            touched = true;
          }
        }
      } catch {
        this.unreadable.add(id);
        reads.push({ state: "unreadable" });
      }
    }
    // Best effort: a failed save loses only a last-use time or a fresher
    // ciphertext, which the next save writes anyway.
    if (reEncrypt.length > 0) {
      await this.write(reEncrypt, { keepSetAt: true }).catch(() => undefined);
    } else if (touched) {
      await this.serialized(() => this.save()).catch(() => undefined);
    }
    return reads;
  }

  async write(
    entries: readonly SecretWrite[],
    options: { keepSetAt?: boolean } = {},
  ): Promise<void> {
    await this.open();
    await this.serialized(async () => {
      if (this.status.state === "unavailable") {
        throw new VaultUnavailableError(this.status.reason);
      }
      // Encrypt everything before anything changes, so a failure saves none.
      const encrypted = await Promise.all(
        entries.map(async (entry) => ({
          entry,
          ciphertext: toBase64(await this.cipher.encrypt(entry.value)),
        })),
      );
      // An unreadable vault's key is gone. The first new secret starts over
      // with a check value under the current key; the old entries stay
      // unreadable, and the next launch finds each of them unreadable alone.
      const rekey = this.status.state === "unreadable" || !this.check;
      const check = rekey
        ? toBase64(await this.cipher.encrypt(CHECK_TEXT))
        : this.check!;
      const next = new Map(this.entries);
      const setAt = this.now();
      for (const { entry, ciphertext } of encrypted) {
        const id = secretKeyId(entry);
        const previous = next.get(id);
        next.set(id, {
          pluginId: entry.pluginId,
          connectionId: entry.connectionId,
          fieldId: entry.fieldId,
          ciphertext,
          setAt: options.keepSetAt && previous ? previous.setAt : setAt,
          ...(options.keepSetAt && previous?.lastUsedAt !== undefined
            ? { lastUsedAt: previous.lastUsedAt }
            : {}),
          ...(entry.expiresAt !== undefined
            ? { expiresAt: entry.expiresAt }
            : {}),
        });
      }
      await this.save(next, check);
      // The entries the load found unreadable stay marked; these are new.
      for (const { entry } of encrypted) {
        this.unreadable.delete(secretKeyId(entry));
      }
      if (rekey) this.status = { state: "available" };
    });
  }

  async remove(selection: SecretSelection): Promise<number> {
    await this.open();
    return await this.serialized(async () => {
      const next = new Map(
        [...this.entries].filter(([, entry]) => !selects(selection, entry)),
      );
      const removed = this.entries.size - next.size;
      if (removed === 0) return 0;
      await this.save(next);
      return removed;
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Saves `entries` and `check` whole, then holds them. */
  private async save(
    entries: Map<string, StoredEntry> = this.entries,
    check: string | undefined = this.check,
  ) {
    if (check === undefined) {
      // No secret was ever saved, so there is nothing to keep but an empty file.
      if (entries.size === 0) {
        this.entries = entries;
        return;
      }
      throw new Error("The vault has no check value.");
    }
    if (this.foundUnreadableFile) {
      // Kept for whoever can still read it; Ajour never reads it again.
      await rename(this.filePath, `${this.filePath}.unreadable`);
      this.foundUnreadableFile = false;
    }
    const file: VaultFile = {
      version: 1,
      check,
      entries: [...entries.values()],
    };
    await writeFileAtomically(
      this.filePath,
      `${JSON.stringify(file, null, 2)}\n`,
    );
    this.entries = entries;
    this.check = check;
    for (const [id, entry] of entries) {
      if (entry.lastUsedAt !== undefined)
        this.savedLastUse.set(id, entry.lastUsedAt);
    }
  }

  private async load(): Promise<VaultOpened> {
    const { undeletable } = await removeOrphanedTempFiles(this.filePath);
    let file: VaultFile | undefined;
    let text: string | undefined;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.foundUnreadableFile = true;
      }
    }
    if (text !== undefined) {
      file = parseVaultFile(text);
      if (!file) this.foundUnreadableFile = true;
    }
    for (const entry of file?.entries ?? []) {
      this.entries.set(secretKeyId(entry), entry);
      if (entry.lastUsedAt !== undefined) {
        this.savedLastUse.set(secretKeyId(entry), entry.lastUsedAt);
      }
    }
    this.check = file?.check;
    this.status = await this.proveEncryption();
    if (this.status.state === "available") {
      if (this.foundUnreadableFile) {
        this.status = { state: "unreadable" };
      } else if (file && !(await this.checkPasses(file.check))) {
        this.status = { state: "unreadable" };
      }
    }
    if (this.status.state === "unreadable") {
      for (const id of this.entries.keys()) this.unreadable.add(id);
    }
    return {
      status: this.status,
      entryCount: this.entries.size,
      undeletableOrphans: undeletable,
    };
  }

  /** Encryption works when a value encrypted here decrypts back to itself. */
  private async proveEncryption(): Promise<VaultStatus> {
    try {
      const reason = await this.cipher.unavailableReason?.();
      if (reason) return { state: "unavailable", reason };
      const probe = await this.cipher.encrypt(CHECK_TEXT);
      const { text } = await this.cipher.decrypt(probe);
      if (text !== CHECK_TEXT) {
        return {
          state: "unavailable",
          reason: "Encryption gave back a different value.",
        };
      }
      return { state: "available" };
    } catch (error) {
      return { state: "unavailable", reason: messageOf(error) };
    }
  }

  private async checkPasses(check: string) {
    try {
      return (await this.cipher.decrypt(fromBase64(check))).text === CHECK_TEXT;
    } catch {
      return false;
    }
  }
}
