import {
  secretKeyId,
  selects,
  VaultUnavailableError,
  type SecretEntryInfo,
  type SecretKey,
  type SecretRead,
  type SecretSelection,
  type SecretVault,
  type SecretWrite,
  type VaultOpened,
  type VaultStatus,
} from "../secret-vault.ts";

/** Failures a test injects into the fake vault, until it clears them. */
export interface MemoryVaultFaults {
  /** Every encryption fails, so no write saves anything. */
  encrypt?: boolean;
  /** The vault's file can't be saved. */
  save?: boolean;
  /** Each read gives back another value than the one written. */
  readBack?: boolean;
  /** A write that holds one of these keys fails, as its encryption would. */
  failFor?: (key: SecretKey) => boolean;
  /**
   * The vault's file can't be changed this launch, for this reason: every
   * write and removal is refused, as for a file Ajour couldn't read.
   */
  frozen?: string;
}

interface MemoryEntry {
  key: SecretKey;
  value: string;
  setAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  /** Encrypted under a key this computer no longer has. */
  lostKey?: boolean;
}

interface LaunchOptions {
  /** Encryption fails its round trip, for this reason. */
  unavailable?: string;
  /** The key the vault was encrypted with is gone: its check fails. */
  keyLost?: boolean;
}

/**
 * An in-memory vault for tests, with the port's rules: a lost key makes every
 * entry unreadable at once, one entry can fail alone, and decryption that
 * failed isn't tried again before the next launch. Its entries outlive a
 * launch: `relaunch` gives the same vault as the next launch opens it.
 */
export class MemorySecretVault implements SecretVault {
  faults: MemoryVaultFaults = {};
  private readonly store: Map<string, MemoryEntry>;
  private readonly launch: LaunchOptions;
  private status?: VaultStatus;
  private readonly unreadable = new Set<string>();
  /** How many entries a read tried to decrypt, for the "never in a loop" rule. */
  decryptAttempts = 0;

  constructor(
    launch: LaunchOptions = {},
    store: Map<string, MemoryEntry> = new Map(),
  ) {
    this.launch = launch;
    this.store = store;
  }

  /** The same vault, as the next launch opens it. */
  relaunch(launch: LaunchOptions = {}): MemorySecretVault {
    return new MemorySecretVault(launch, this.store);
  }

  /** The entry fails to decrypt from now on, as a corrupt one would. */
  corrupt(key: SecretKey) {
    const entry = this.store.get(secretKeyId(key));
    if (entry) entry.lostKey = true;
  }

  /** Every entry's key and value, for a test to check what the vault holds. */
  contents(): Array<SecretKey & { value: string }> {
    return [...this.store.values()].map(({ key, value }) => ({
      ...key,
      value,
    }));
  }

  async open(): Promise<VaultOpened> {
    if (!this.status) {
      if (this.launch.unavailable) {
        this.status = { state: "unavailable", reason: this.launch.unavailable };
      } else if (this.launch.keyLost && this.store.size > 0) {
        for (const entry of this.store.values()) entry.lostKey = true;
        this.status = { state: "unreadable" };
      } else {
        this.status = { state: "available" };
      }
    }
    return {
      status: this.status,
      ...(this.faults.frozen
        ? { changeRefusedReason: this.faults.frozen }
        : {}),
      entryCount: this.store.size,
      undeletableOrphans: 0,
    };
  }

  async list(): Promise<SecretEntryInfo[]> {
    await this.open();
    return [...this.store.entries()].map(([id, entry]) => ({
      ...entry.key,
      setAt: entry.setAt,
      ...(entry.lastUsedAt !== undefined
        ? { lastUsedAt: entry.lastUsedAt }
        : {}),
      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
      unreadable:
        this.unreadable.has(id) || this.status?.state === "unreadable",
    }));
  }

  async read(
    keys: readonly SecretKey[],
    options: { usedAt?: number } = {},
  ): Promise<SecretRead[]> {
    const { status } = await this.open();
    return keys.map((key) => {
      const id = secretKeyId(key);
      const entry = this.store.get(id);
      if (!entry) return { state: "missing" };
      if (status.state !== "available" || this.unreadable.has(id)) {
        return { state: "unreadable" };
      }
      this.decryptAttempts += 1;
      if (entry.lostKey) {
        this.unreadable.add(id);
        return { state: "unreadable" };
      }
      if (options.usedAt !== undefined) entry.lastUsedAt = options.usedAt;
      return {
        state: "set",
        value: this.faults.readBack ? `${entry.value}-garbled` : entry.value,
      };
    });
  }

  async write(entries: readonly SecretWrite[]): Promise<void> {
    const { status } = await this.open();
    if (this.faults.frozen) {
      throw new VaultUnavailableError(this.faults.frozen, "change");
    }
    if (status.state === "unavailable") {
      throw new VaultUnavailableError(status.reason);
    }
    if (
      this.faults.encrypt ||
      entries.some((entry) => this.faults.failFor?.(entry))
    ) {
      throw new Error("Encryption failed.");
    }
    if (this.faults.save) throw new Error("The vault file couldn't be saved.");
    const setAt = Date.now();
    for (const { value, expiresAt, ...key } of entries) {
      const id = secretKeyId(key);
      this.store.set(id, {
        key: {
          pluginId: key.pluginId,
          connectionId: key.connectionId,
          fieldId: key.fieldId,
        },
        value,
        setAt,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      this.unreadable.delete(id);
    }
    // A new secret under the current key: the check passes again.
    if (status.state === "unreadable") this.status = { state: "available" };
    for (const entry of this.store.values()) {
      if (entry.lostKey) this.unreadable.add(secretKeyId(entry.key));
    }
  }

  async remove(selection: SecretSelection): Promise<number> {
    await this.open();
    if (this.faults.frozen) {
      throw new VaultUnavailableError(this.faults.frozen, "change");
    }
    if (this.faults.save) throw new Error("The vault file couldn't be saved.");
    let removed = 0;
    for (const [id, entry] of this.store) {
      if (selects(selection, entry.key)) {
        this.store.delete(id);
        this.unreadable.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
