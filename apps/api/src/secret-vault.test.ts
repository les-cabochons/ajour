import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileSecretVault,
  VaultUnavailableError,
  type SecretCipher,
  type SecretKey,
} from "./secret-vault.ts";

/**
 * A cipher under one key, as the operating system's: a value encrypted
 * under another key doesn't decrypt. It counts its decryptions.
 */
function fakeCipher(key: string, options: { unavailable?: string } = {}) {
  const cipher = {
    decryptions: 0,
    async unavailableReason() {
      return options.unavailable;
    },
    async encrypt(text: string) {
      return Buffer.from(`${key}:${Buffer.from(text).toString("hex")}`, "utf8");
    },
    async decrypt(ciphertext: Uint8Array) {
      cipher.decryptions += 1;
      const [usedKey, hex] = Buffer.from(ciphertext)
        .toString("utf8")
        .split(":");
      if (usedKey !== key || hex === undefined) {
        throw new Error("Decryption failed.");
      }
      return { text: Buffer.from(hex, "hex").toString("utf8") };
    },
  } satisfies SecretCipher & { decryptions: number };
  return cipher;
}

const TOKEN = "pat-7c1e09b4a2d65f38";
const token: SecretKey = {
  pluginId: "jira",
  connectionId: "jira_1",
  fieldId: "token",
};
const pin: SecretKey = {
  pluginId: "jira",
  connectionId: "jira_1",
  fieldId: "pin",
};

describe("the vault file", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function vaultPath() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-vault-"));
    tempDirs.push(dir);
    return { dir, filePath: path.join(dir, "app-api-vault.json") };
  }

  it("gives back what it encrypted at the next launch, and keeps no value in plain text", async () => {
    const { dir, filePath } = await vaultPath();
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await vault.write([{ ...token, value: TOKEN }]);

    const next = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(next.open()).resolves.toMatchObject({
      status: { state: "available" },
      entryCount: 1,
    });
    await expect(next.read([token, pin])).resolves.toEqual([
      { state: "set", value: TOKEN },
      { state: "missing" },
    ]);
    expect(await readFile(filePath, "utf8")).not.toContain(TOKEN);
    // Saved whole, with no temp file left beside it.
    await expect(readdir(dir)).resolves.toEqual(["app-api-vault.json"]);
  });

  it("is unavailable when encryption fails its round trip, refuses writes and still removes", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
    ]);

    const broken: SecretCipher = {
      encrypt: async () => {
        throw new Error("Encryption is not available.");
      },
      decrypt: async () => {
        throw new Error("Encryption is not available.");
      },
    };
    const vault = new FileSecretVault({ filePath, cipher: broken });
    await expect(vault.open()).resolves.toMatchObject({
      status: {
        state: "unavailable",
        reason: "Encryption is not available.",
      },
    });
    await expect(vault.write([{ ...pin, value: "1234" }])).rejects.toThrow(
      VaultUnavailableError,
    );
    await expect(vault.read([token])).resolves.toEqual([
      { state: "unreadable" },
    ]);
    await expect(vault.remove({ pluginId: "jira" })).resolves.toBe(1);
  });

  it("trusts the round trip, not an availability flag, and takes a reason the cipher gives first", async () => {
    const { filePath } = await vaultPath();
    const lying: SecretCipher = {
      encrypt: async (text) => Buffer.from(text),
      decrypt: async () => ({ text: "something else" }),
    };
    await expect(
      new FileSecretVault({ filePath, cipher: lying }).open(),
    ).resolves.toMatchObject({
      status: {
        state: "unavailable",
        reason: "Encryption gave back a different value.",
      },
    });
    await expect(
      new FileSecretVault({
        filePath,
        cipher: fakeCipher("a", { unavailable: "No keyring (basic_text)." }),
      }).open(),
    ).resolves.toMatchObject({
      status: { state: "unavailable", reason: "No keyring (basic_text)." },
    });
  });

  it("marks every entry unreadable at once under another key, and decrypts none of them", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
      { ...pin, value: "1234" },
    ]);

    // As after a restore on another computer.
    const cipher = fakeCipher("b");
    const vault = new FileSecretVault({ filePath, cipher });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "unreadable" },
      entryCount: 2,
    });
    const afterOpen = cipher.decryptions;
    await expect(vault.read([token, pin])).resolves.toEqual([
      { state: "unreadable" },
      { state: "unreadable" },
    ]);
    await vault.read([token, pin]);
    expect(cipher.decryptions).toBe(afterOpen);
    await expect(vault.list()).resolves.toEqual([
      expect.objectContaining({ fieldId: "token", unreadable: true }),
      expect.objectContaining({ fieldId: "pin", unreadable: true }),
    ]);
  });

  it("starts over under the current key with the first new secret, and keeps the old ones unreadable", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
      { ...pin, value: "1234" },
    ]);
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("b") });
    await vault.write([{ ...token, value: "pat-pasted-again" }]);
    await expect(vault.read([token, pin])).resolves.toEqual([
      { state: "set", value: "pat-pasted-again" },
      { state: "unreadable" },
    ]);

    // The next launch finds the check readable, and the old entry alone unreadable.
    const next = new FileSecretVault({ filePath, cipher: fakeCipher("b") });
    await expect(next.open()).resolves.toMatchObject({
      status: { state: "available" },
    });
    await expect(next.read([token, pin])).resolves.toEqual([
      { state: "set", value: "pat-pasted-again" },
      { state: "unreadable" },
    ]);
  });

  it("marks one corrupt entry alone, and never tries it again before the next launch", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
      { ...pin, value: "1234" },
    ]);
    const file = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: { fieldId: string; ciphertext: string }[];
    };
    file.entries.find((entry) => entry.fieldId === "pin")!.ciphertext =
      Buffer.from("garbage").toString("base64");
    await writeFile(filePath, JSON.stringify(file));

    const cipher = fakeCipher("a");
    const vault = new FileSecretVault({ filePath, cipher });
    await expect(vault.read([token, pin])).resolves.toEqual([
      { state: "set", value: TOKEN },
      { state: "unreadable" },
    ]);
    const tried = cipher.decryptions;
    await expect(vault.read([pin])).resolves.toEqual([{ state: "unreadable" }]);
    expect(cipher.decryptions).toBe(tried);
    await expect(vault.list()).resolves.toEqual([
      expect.objectContaining({ fieldId: "token", unreadable: false }),
      expect.objectContaining({ fieldId: "pin", unreadable: true }),
    ]);
  });

  it("records when a secret was set and last used, and keeps an expiry", async () => {
    const { filePath } = await vaultPath();
    let now = 1_000;
    const vault = new FileSecretVault({
      filePath,
      cipher: fakeCipher("a"),
      now: () => now,
    });
    await vault.write([{ ...token, value: TOKEN, expiresAt: 9_000 }]);
    now = 5_000;
    await vault.read([token], { usedAt: 120_000 });

    const next = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(next.list()).resolves.toEqual([
      {
        ...token,
        setAt: 1_000,
        lastUsedAt: 120_000,
        expiresAt: 9_000,
        unreadable: false,
      },
    ]);
  });

  it("removes a connection's entries, or a plugin's, and only those", async () => {
    const { filePath } = await vaultPath();
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await vault.write([
      { ...token, value: TOKEN },
      { ...token, connectionId: "jira_2", value: "pat-other" },
      { pluginId: "jira", connectionId: null, fieldId: "apiKey", value: "k" },
      {
        pluginId: "github",
        connectionId: "gh_1",
        fieldId: "token",
        value: "g",
      },
    ]);

    await expect(
      vault.remove({ pluginId: "jira", connectionId: "jira_1" }),
    ).resolves.toBe(1);
    await expect(vault.remove({ pluginId: "jira" })).resolves.toBe(2);
    const next = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(next.list()).resolves.toEqual([
      expect.objectContaining({ pluginId: "github" }),
    ]);
  });

  it("treats a file that isn't a vault as unreadable, and keeps it aside at the next save", async () => {
    const { filePath } = await vaultPath();
    await writeFile(filePath, "not a vault");
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "unreadable" },
    });
    await vault.write([{ ...token, value: TOKEN }]);
    await expect(readFile(`${filePath}.unreadable`, "utf8")).resolves.toBe(
      "not a vault",
    );
    await expect(
      new FileSecretVault({ filePath, cipher: fakeCipher("a") }).read([token]),
    ).resolves.toEqual([{ state: "set", value: TOKEN }]);
  });
});
