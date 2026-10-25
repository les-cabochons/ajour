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
 * check value the file keeps. When the check fails, each entry is tried
 * once: those that decrypt stay usable, and the check is kept. When none
 * does, the key that encrypted the vault is gone, as after a restore on
 * another computer, and every entry is unreadable at once; the first new
 * secret then starts over with a check under the current key. When the
 * check passes but one entry fails, only that entry is unreadable. Either
 * way decryption isn't tried again before the next launch, and an
 * unreadable entry is kept until it is replaced or removed.
 *
 * Each ciphertext holds its entry's plugin, connection and field ids with
 * the value, and a read checks them, so a ciphertext moved to another
 * entry's place in the file doesn't decrypt there.
 *
 * Nothing is lost to a file Ajour can't read. A read that fails for a moment,
 * as while an antivirus scan holds the file on Windows, is tried again. When
 * the file still can't be read, the vault refuses every change until the
 * next launch rather than replace it. An entry the file holds but this
 * version can't make sense of is unreadable, and written back as it was.
 */

import { randomUUID } from "node:crypto";
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
   * none, then checks the saved file gives each back. Throws
   * `VaultUnavailableError` when encryption isn't available, or the file
   * can't be changed this launch.
   */
  write(entries: readonly SecretWrite[]): Promise<void>;
  /**
   * Deletes the selected entries, readable or not. Returns how many. A file
   * that can't be changed this launch keeps them, and none is removed.
   */
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
/**
 * Read errors Windows gives for a moment while another process, such as an
 * antivirus scan, holds the file open.
 */
const TRANSIENT_READ_CODES = new Set(["EBUSY", "EPERM", "EACCES", "EAGAIN"]);
/** The waits between attempts to read the file: about 1.5 s in all. */
const READ_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 700] as const;

/** An entry as the file keeps it, properties this version doesn't know included. */
type FileEntry = SecretKey & Record<string, unknown>;

/** An entry this version can decrypt, as far as its shape goes. */
type StoredEntry = FileEntry & {
  ciphertext: string;
  setAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyOf(value: unknown): SecretKey | undefined {
  if (!isRecord(value)) return undefined;
  const { pluginId, connectionId, fieldId } = value;
  if (
    typeof pluginId !== "string" ||
    !(connectionId === null || typeof connectionId === "string") ||
    !(fieldId === null || typeof fieldId === "string")
  ) {
    return undefined;
  }
  return { pluginId, connectionId, fieldId };
}

function isWellFormed(entry: FileEntry): entry is StoredEntry {
  return (
    typeof entry.ciphertext === "string" &&
    typeof entry.setAt === "number" &&
    (entry.lastUsedAt === undefined || typeof entry.lastUsedAt === "number") &&
    (entry.expiresAt === undefined || typeof entry.expiresAt === "number")
  );
}

type ParsedVaultFile =
  | {
      kind: "vault";
      check?: string;
      entries: unknown[];
      /** Top-level properties this version doesn't know, written back. */
      extras: Record<string, unknown>;
    }
  /** Not JSON, or not a vault: kept aside at the next save. */
  | { kind: "not_a_vault" }
  /** A newer version's vault: left as it is. */
  | { kind: "newer" };

function parseVaultFile(text: string): ParsedVaultFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "not_a_vault" };
  }
  if (!isRecord(parsed)) return { kind: "not_a_vault" };
  const { version, check, entries, ...extras } = parsed;
  if (version !== 1) {
    return typeof version === "number" && version > 1
      ? { kind: "newer" }
      : { kind: "not_a_vault" };
  }
  if (!Array.isArray(entries)) return { kind: "not_a_vault" };
  return {
    kind: "vault",
    ...(typeof check === "string" ? { check } : {}),
    entries,
    extras,
  };
}

/** What a ciphertext holds: the value, bound to its entry's place. */
function boundText(entry: SecretWrite) {
  return JSON.stringify({
    pluginId: entry.pluginId,
    connectionId: entry.connectionId,
    fieldId: entry.fieldId,
    value: entry.value,
  });
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Why the vault changes nothing this launch, after its file couldn't be read. */
function unreadFileReason(code: string) {
  return `Ajour couldn't read its vault file (${code}), so it changes nothing in it until it starts again. Quit Ajour and open it again.`;
}

const NEWER_FILE_REASON =
  "The vault file was saved by a newer version of Ajour, so this one leaves it as it is. Update Ajour to use its credentials.";

export interface FileSecretVaultOptions {
  /** The vault file, beside the state file. */
  filePath: string;
  cipher: SecretCipher;
  now?: () => number;
  /** The waits between attempts to read a file another process holds. */
  readRetryDelaysMs?: readonly number[];
}

/** The vault in a file, encrypted by `cipher`. Only this class writes it. */
export class FileSecretVault implements SecretVault {
  private readonly filePath: string;
  private readonly cipher: SecretCipher;
  private readonly now: () => number;
  private readonly readRetryDelaysMs: readonly number[];
  private opening?: Promise<VaultOpened>;
  private status: VaultStatus = { state: "unavailable", reason: "" };
  private check?: string;
  /** The entries with a key, by `secretKeyId`, as the file keeps them. */
  private entries = new Map<string, FileEntry>();
  /** Entries without a key this version can read, written back as they are. */
  private unkeyed: unknown[] = [];
  private extras: Record<string, unknown> = {};
  /** Entries whose decryption failed this launch, or that are malformed. Never tried again. */
  private readonly unreadable = new Set<string>();
  /** When each entry's `lastUsedAt` was last saved. */
  private readonly savedLastUse = new Map<string, number>();
  private fileFound = false;
  /** True when the file exists but isn't a vault: the next save keeps it aside. */
  private foundUnreadableFile = false;
  /** Why the file mustn't change this launch: it couldn't be read, or is a newer version's. */
  private frozen?: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileSecretVaultOptions) {
    this.filePath = options.filePath;
    this.cipher = options.cipher;
    this.now = options.now ?? Date.now;
    this.readRetryDelaysMs = options.readRetryDelaysMs ?? READ_RETRY_DELAYS_MS;
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
      setAt: typeof entry.setAt === "number" ? entry.setAt : 0,
      ...(typeof entry.lastUsedAt === "number"
        ? { lastUsedAt: entry.lastUsedAt }
        : {}),
      ...(typeof entry.expiresAt === "number"
        ? { expiresAt: entry.expiresAt }
        : {}),
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
      if (
        this.status.state !== "available" ||
        this.unreadable.has(id) ||
        !isWellFormed(entry)
      ) {
        reads.push({ state: "unreadable" });
        continue;
      }
      try {
        const decrypted = await this.decryptEntry(entry);
        reads.push({ state: "set", value: decrypted.value });
        if (decrypted.reEncrypt) {
          reEncrypt.push({
            ...key,
            value: decrypted.value,
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
          ciphertext: toBase64(await this.cipher.encrypt(boundText(entry))),
        })),
      );
      // No entry decrypts under the current key, so it is gone. The first
      // new secret starts over with a check value under the current key; the
      // old entries stay unreadable. A check that fails while some entry
      // decrypts is never replaced: it may be another build's, whose
      // entries the next launch of that build still reads.
      const rekey = this.status.state === "unreadable" || !this.check;
      const check = rekey
        ? toBase64(await this.cipher.encrypt(CHECK_TEXT))
        : this.check!;
      const next = new Map(this.entries);
      const setAt = this.now();
      for (const { entry, ciphertext } of encrypted) {
        const id = secretKeyId(entry);
        const previous = next.get(id);
        const keep = options.keepSetAt && previous && isWellFormed(previous);
        next.set(id, {
          pluginId: entry.pluginId,
          connectionId: entry.connectionId,
          fieldId: entry.fieldId,
          ciphertext,
          setAt: keep ? previous.setAt : setAt,
          ...(keep && previous.lastUsedAt !== undefined
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
      await this.verifySaved(entries);
    });
  }

  async remove(selection: SecretSelection): Promise<number> {
    await this.open();
    return await this.serialized(async () => {
      if (this.frozen) return 0;
      const next = new Map(
        [...this.entries].filter(([, entry]) => !selects(selection, entry)),
      );
      const removed = this.entries.size - next.size;
      if (removed === 0) return 0;
      await this.save(next);
      for (const id of this.entries.keys()) {
        if (!next.has(id)) this.unreadable.delete(id);
      }
      return removed;
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Saves `entries` and `check` whole, with what this version can't read as it was, then holds them. */
  private async save(
    entries: Map<string, FileEntry> = this.entries,
    check: string | undefined = this.check,
  ) {
    if (this.frozen) throw new VaultUnavailableError(this.frozen);
    if (
      check === undefined &&
      !this.fileFound &&
      entries.size === 0 &&
      this.unkeyed.length === 0
    ) {
      // No secret was ever saved, so there is nothing to keep but an empty file.
      this.entries = entries;
      return;
    }
    if (this.foundUnreadableFile) {
      // Kept for whoever can still read it, beside any kept before; Ajour
      // never reads it again.
      await rename(
        this.filePath,
        `${this.filePath}.unreadable-${this.now()}-${randomUUID().slice(0, 8)}`,
      );
      this.foundUnreadableFile = false;
    }
    const file = {
      ...this.extras,
      version: 1,
      ...(check !== undefined ? { check } : {}),
      entries: [...entries.values(), ...this.unkeyed],
    };
    await writeFileAtomically(
      this.filePath,
      `${JSON.stringify(file, null, 2)}\n`,
    );
    this.fileFound = true;
    this.entries = entries;
    this.check = check;
    for (const [id, entry] of entries) {
      if (typeof entry.lastUsedAt === "number")
        this.savedLastUse.set(id, entry.lastUsedAt);
    }
  }

  /**
   * Reads the file just saved and decrypts each entry written, so a value
   * the disk didn't keep fails the write rather than the next launch.
   */
  private async verifySaved(written: readonly SecretWrite[]) {
    const found = await this.readText();
    const parsed =
      found.text === undefined ? undefined : parseVaultFile(found.text);
    const onDisk = new Map<string, FileEntry>();
    if (parsed?.kind === "vault") {
      for (const value of parsed.entries) {
        const key = keyOf(value);
        if (key) onDisk.set(secretKeyId(key), value as FileEntry);
      }
    }
    const lost: string[] = [];
    for (const entry of written) {
      const id = secretKeyId(entry);
      const saved = onDisk.get(id);
      try {
        if (!saved || !isWellFormed(saved)) throw new Error("Missing.");
        const { value } = await this.decryptEntry(saved);
        if (value !== entry.value) throw new Error("Changed.");
      } catch {
        lost.push(id);
      }
    }
    if (lost.length > 0) {
      for (const id of lost) this.unreadable.add(id);
      throw new Error("The vault file didn't keep a secret it saved.");
    }
  }

  /** The value a well-formed entry holds, if the ids inside its ciphertext are its own. */
  private async decryptEntry(entry: StoredEntry) {
    const { text, reEncrypt } = await this.cipher.decrypt(
      fromBase64(entry.ciphertext),
    );
    const payload = JSON.parse(text) as unknown;
    if (
      !isRecord(payload) ||
      payload.pluginId !== entry.pluginId ||
      payload.connectionId !== entry.connectionId ||
      payload.fieldId !== entry.fieldId ||
      typeof payload.value !== "string"
    ) {
      throw new Error("The entry's ciphertext belongs to another entry.");
    }
    return { value: payload.value, reEncrypt: reEncrypt === true };
  }

  /**
   * The file's text, tried again while another process holds the file.
   * `errorCode` when it still can't be read; neither when it doesn't exist.
   */
  private async readText(): Promise<{ text?: string; errorCode?: string }> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return { text: await readFile(this.filePath, "utf8") };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") return {};
        const wait = this.readRetryDelaysMs[attempt];
        if (code === undefined || !TRANSIENT_READ_CODES.has(code) || !wait) {
          return { errorCode: code ?? "EIO" };
        }
        await delay(wait);
      }
    }
  }

  /** Holds the entries of a file this version reads. */
  private hold(file: Extract<ParsedVaultFile, { kind: "vault" }>) {
    this.check = file.check;
    this.extras = file.extras;
    for (const value of file.entries) {
      const key = keyOf(value);
      const id = key && secretKeyId(key);
      if (!id || this.entries.has(id)) {
        this.unkeyed.push(value);
        continue;
      }
      const entry = value as FileEntry;
      this.entries.set(id, entry);
      if (!isWellFormed(entry)) {
        this.unreadable.add(id);
      } else if (entry.lastUsedAt !== undefined) {
        this.savedLastUse.set(id, entry.lastUsedAt);
      }
    }
  }

  private async load(): Promise<VaultOpened> {
    const { undeletable } = await removeOrphanedTempFiles(this.filePath);
    const found = await this.readText();
    let readable = false;
    if (found.errorCode) {
      this.fileFound = true;
      this.frozen = unreadFileReason(found.errorCode);
    } else if (found.text !== undefined) {
      this.fileFound = true;
      const file = parseVaultFile(found.text);
      if (file.kind === "newer") this.frozen = NEWER_FILE_REASON;
      else if (file.kind === "not_a_vault") this.foundUnreadableFile = true;
      else {
        this.hold(file);
        readable = true;
      }
    }
    this.status = await this.proveEncryption();
    if (this.status.state === "available") {
      if (this.frozen) {
        this.status = { state: "unavailable", reason: this.frozen };
      } else if (this.foundUnreadableFile) {
        this.status = { state: "unreadable" };
      } else if (readable) {
        this.status = await this.checkKey();
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

  /**
   * Whether the entries are under a key this computer holds. The check value
   * says so at once. When it fails, each entry is tried once: one that
   * decrypts keeps the vault available.
   */
  private async checkKey(): Promise<VaultStatus> {
    if (this.check !== undefined && (await this.checkPasses(this.check))) {
      return { state: "available" };
    }
    let anyReadable = false;
    for (const [id, entry] of this.entries) {
      if (this.unreadable.has(id) || !isWellFormed(entry)) continue;
      try {
        await this.decryptEntry(entry);
        anyReadable = true;
      } catch {
        this.unreadable.add(id);
      }
    }
    if (anyReadable) return { state: "available" };
    if (this.entries.size === 0) {
      // No secret to lose: the first one saved writes a new check value.
      this.check = undefined;
      return { state: "available" };
    }
    return { state: "unreadable" };
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
