import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSecretVault, type SecretCipher } from "../api/src/secret-vault.ts";

const require = createRequire(import.meta.url);
const { createSafeStorageCipher } = require("./electron/secret-cipher.cjs") as {
  createSafeStorageCipher: (options: {
    safeStorage: FakeSafeStorage;
    platform: NodeJS.Platform;
  }) => SecretCipher;
};

/** Electron's `safeStorage`, as far as the cipher uses it, under one key. */
function fakeSafeStorage(
  key: string,
  options: { backend?: string; shouldReEncrypt?: boolean } = {},
) {
  return {
    encryptStringAsync: vi.fn(async (text: string) =>
      Buffer.from(`${key}|${text}`, "utf8"),
    ),
    decryptStringAsync: vi.fn(async (encrypted: Buffer) => {
      const [usedKey, ...rest] = encrypted.toString("utf8").split("|");
      if (usedKey !== key) {
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.",
        );
      }
      return {
        result: rest.join("|"),
        shouldReEncrypt: options.shouldReEncrypt ?? false,
      };
    }),
    getSelectedStorageBackend: vi.fn(() => options.backend ?? "unknown"),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };
}
type FakeSafeStorage = ReturnType<typeof fakeSafeStorage>;

const TOKEN = "pat-2b8e6c0f4a1d9735";
const key = { pluginId: "jira", connectionId: "jira_1", fieldId: "token" };

describe("the safeStorage cipher of the vault", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function vaultFile() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-safe-storage-"));
    tempDirs.push(dir);
    return path.join(dir, "app-api-vault.json");
  }

  it("encrypts with the async API only, and the vault gives the secret back at the next launch", async () => {
    const filePath = await vaultFile();
    const safeStorage = fakeSafeStorage("user-key");
    const cipher = createSafeStorageCipher({ safeStorage, platform: "win32" });
    await new FileSecretVault({ filePath, cipher }).write([
      { ...key, value: TOKEN },
    ]);

    const next = new FileSecretVault({
      filePath,
      cipher: createSafeStorageCipher({ safeStorage, platform: "win32" }),
    });
    await expect(next.read([key])).resolves.toEqual([
      { state: "set", value: TOKEN },
    ]);
    expect(await readFile(filePath, "utf8")).not.toContain(TOKEN);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("finds the vault unreadable under another user's key", async () => {
    const filePath = await vaultFile();
    await new FileSecretVault({
      filePath,
      cipher: createSafeStorageCipher({
        safeStorage: fakeSafeStorage("old-key"),
        platform: "darwin",
      }),
    }).write([{ ...key, value: TOKEN }]);

    const vault = new FileSecretVault({
      filePath,
      cipher: createSafeStorageCipher({
        safeStorage: fakeSafeStorage("new-key"),
        platform: "darwin",
      }),
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "unreadable" },
    });
  });

  it("counts Linux's basic_text backend as unavailable", async () => {
    const vault = new FileSecretVault({
      filePath: await vaultFile(),
      cipher: createSafeStorageCipher({
        safeStorage: fakeSafeStorage("key", { backend: "basic_text" }),
        platform: "linux",
      }),
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: {
        state: "unavailable",
        reason: expect.stringContaining("No secret store"),
      },
    });
  });

  it("is unavailable, with Electron's reason, when encryption throws", async () => {
    const safeStorage = fakeSafeStorage("key");
    safeStorage.encryptStringAsync.mockRejectedValue(
      new Error("Encryption is not available."),
    );
    const vault = new FileSecretVault({
      filePath: await vaultFile(),
      cipher: createSafeStorageCipher({ safeStorage, platform: "win32" }),
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: {
        state: "unavailable",
        reason: "Encryption is not available.",
      },
    });
  });

  it("encrypts a secret again when safeStorage asks, as after a key rotation", async () => {
    const filePath = await vaultFile();
    const safeStorage = fakeSafeStorage("key", { shouldReEncrypt: true });
    const vault = new FileSecretVault({
      filePath,
      cipher: createSafeStorageCipher({ safeStorage, platform: "darwin" }),
    });
    await vault.write([{ ...key, value: TOKEN }]);
    const encryptions = safeStorage.encryptStringAsync.mock.calls.length;

    await expect(vault.read([key])).resolves.toEqual([
      { state: "set", value: TOKEN },
    ]);
    expect(safeStorage.encryptStringAsync.mock.calls.length).toBeGreaterThan(
      encryptions,
    );
  });
});
