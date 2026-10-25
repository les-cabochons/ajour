import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileSecretVault,
  VaultUnavailableError,
  type SecretCipher,
  type SecretKey,
} from "./secret-vault.ts";

/**
 * A read of the vault file can be made to fail, or to find other bytes than
 * those saved, as when an antivirus scan holds the file or the disk lies.
 */
const fileReads: {
  hook?: (filePath: string) => Promise<string> | undefined;
} = {};
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      const hooked = fileReads.hook?.(String(args[0]));
      if (hooked) return await hooked;
      return await actual.readFile(...args);
    }),
  };
});

function fsError(code: string) {
  return Object.assign(new Error(`${code}: resource busy or locked`), {
    code,
  });
}

/**
 * A cipher under one key, as the operating system's: a value encrypted
 * under another key doesn't decrypt, unless it is one of `alsoDecrypts`,
 * keys the operating system still holds. It counts its decryptions.
 */
function fakeCipher(
  key: string,
  options: { unavailable?: string; alsoDecrypts?: string[] } = {},
) {
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
      if (
        (usedKey !== key && !options.alsoDecrypts?.includes(usedKey!)) ||
        hex === undefined
      ) {
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
    fileReads.hook = undefined;
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

  it("marks every entry unreadable at once under another key, and doesn't try them again", async () => {
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
    const { dir, filePath } = await vaultPath();
    await writeFile(filePath, "not a vault");
    await writeFile(`${filePath}.unreadable-1`, "kept aside before");
    const vault = new FileSecretVault({
      filePath,
      cipher: fakeCipher("a"),
      now: () => 1,
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "unreadable" },
    });
    await vault.write([{ ...token, value: TOKEN }]);
    // Never over a file kept aside before.
    await expect(readFile(`${filePath}.unreadable-1`, "utf8")).resolves.toBe(
      "kept aside before",
    );
    const aside = (await readdir(dir)).filter(
      (name) =>
        name.startsWith("app-api-vault.json.unreadable-") &&
        name !== "app-api-vault.json.unreadable-1",
    );
    expect(aside).toHaveLength(1);
    await expect(readFile(path.join(dir, aside[0]!), "utf8")).resolves.toBe(
      "not a vault",
    );
    await expect(
      new FileSecretVault({ filePath, cipher: fakeCipher("a") }).read([token]),
    ).resolves.toEqual([{ state: "set", value: TOKEN }]);
  });

  it("gives a damaged file and a lost key their own reasons", async () => {
    const damaged = await vaultPath();
    await writeFile(damaged.filePath, "not a vault");
    await expect(
      new FileSecretVault({
        filePath: damaged.filePath,
        cipher: fakeCipher("a"),
      }).open(),
    ).resolves.toMatchObject({
      status: {
        state: "unreadable",
        reason: "The secrets file was damaged and set aside.",
      },
    });

    const lost = await vaultPath();
    await new FileSecretVault({
      filePath: lost.filePath,
      cipher: fakeCipher("a"),
    }).write([{ ...token, value: TOKEN }]);
    const { status } = await new FileSecretVault({
      filePath: lost.filePath,
      cipher: fakeCipher("b"),
    }).open();
    expect(status).toMatchObject({ state: "unreadable" });
    expect(status).toEqual({
      state: "unreadable",
      reason: expect.stringContaining("key"),
    });
    expect((status as { reason: string }).reason).not.toContain("damaged");
  });

  it("treats an empty or blank file as no vault yet, and keeps nothing aside", async () => {
    for (const text of ["", "  \r\n\t\n"]) {
      const { dir, filePath } = await vaultPath();
      await writeFile(filePath, text);
      const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
      await expect(vault.open()).resolves.toMatchObject({
        status: { state: "available" },
        entryCount: 0,
      });
      await vault.write([{ ...token, value: TOKEN }]);
      await expect(readdir(dir)).resolves.toEqual(["app-api-vault.json"]);
      await expect(
        new FileSecretVault({ filePath, cipher: fakeCipher("a") }).read([
          token,
        ]),
      ).resolves.toEqual([{ state: "set", value: TOKEN }]);
    }
  });

  it("refuses to remove from a newer version's file, rather than report nothing removed", async () => {
    const { filePath } = await vaultPath();
    const text = JSON.stringify({ version: 2, entries: [] });
    await writeFile(filePath, text);
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(vault.remove({ pluginId: "jira" })).rejects.toThrow(
      /^Ajour can't change saved secrets right now: .*newer version.*\. Restart Ajour and try again\.$/,
    );
    await expect(readFile(filePath, "utf8")).resolves.toBe(text);
  });

  it("reads the file again when another process holds it for a moment", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
    ]);
    let attempts = 0;
    fileReads.hook = (read) => {
      if (read !== filePath) return undefined;
      attempts += 1;
      return attempts <= 2 ? Promise.reject(fsError("EBUSY")) : undefined;
    };

    const vault = new FileSecretVault({
      filePath,
      cipher: fakeCipher("a"),
      readRetryDelaysMs: [1, 1, 1],
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "available" },
      entryCount: 1,
    });
    expect(attempts).toBe(3);
    await expect(vault.read([token])).resolves.toEqual([
      { state: "set", value: TOKEN },
    ]);
  });

  it("changes nothing in a file it can't read this launch, and refuses every write", async () => {
    const { dir, filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
    ]);
    const before = await readFile(filePath, "utf8");
    fileReads.hook = (read) =>
      read === filePath ? Promise.reject(fsError("EPERM")) : undefined;

    const vault = new FileSecretVault({
      filePath,
      cipher: fakeCipher("a"),
      readRetryDelaysMs: [1, 1],
    });
    await expect(vault.open()).resolves.toMatchObject({
      status: {
        state: "unavailable",
        reason: expect.stringContaining("couldn't read its vault file"),
      },
    });
    await expect(vault.write([{ ...pin, value: "1234" }])).rejects.toThrow(
      VaultUnavailableError,
    );
    // A removal that did nothing would let a caller drop the state that
    // points at the secret while the encrypted value stays in the file.
    await expect(vault.remove({ pluginId: "jira" })).rejects.toThrow(
      /^Ajour can't change saved secrets right now: .*couldn't read its vault file \(EPERM\).*\. Restart Ajour and try again\.$/,
    );
    await expect(vault.remove({ pluginId: "jira" })).rejects.toBeInstanceOf(
      VaultUnavailableError,
    );
    await vault.read([token], { usedAt: 999_999 });

    fileReads.hook = undefined;
    expect(await readFile(filePath, "utf8")).toBe(before);
    await expect(readdir(dir)).resolves.toEqual(["app-api-vault.json"]);
    await expect(
      new FileSecretVault({ filePath, cipher: fakeCipher("a") }).read([token]),
    ).resolves.toEqual([{ state: "set", value: TOKEN }]);
  });

  it("marks a malformed entry alone, and keeps it as it was when the file is saved again", async () => {
    const { filePath } = await vaultPath();
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
      { ...pin, value: "1234" },
    ]);
    const file = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: Record<string, unknown>[];
    };
    const malformed = { ...file.entries[1], ciphertext: 42 };
    const unkeyed = { note: "from a newer Ajour" };
    file.entries[1] = malformed;
    file.entries.push(unkeyed);
    await writeFile(filePath, JSON.stringify(file));

    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(vault.open()).resolves.toMatchObject({
      status: { state: "available" },
    });
    await expect(vault.read([token, pin])).resolves.toEqual([
      { state: "set", value: TOKEN },
      { state: "unreadable" },
    ]);
    await expect(vault.list()).resolves.toEqual([
      expect.objectContaining({ fieldId: "token", unreadable: false }),
      expect.objectContaining({ fieldId: "pin", unreadable: true }),
    ]);

    const other: SecretKey = { ...token, connectionId: "jira_2" };
    await vault.write([{ ...other, value: "pat-other" }]);
    const saved = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: unknown[];
    };
    expect(saved.entries).toContainEqual(malformed);
    expect(saved.entries).toContainEqual(unkeyed);
    await expect(
      new FileSecretVault({ filePath, cipher: fakeCipher("a") }).read([
        token,
        pin,
        other,
      ]),
    ).resolves.toEqual([
      { state: "set", value: TOKEN },
      { state: "unreadable" },
      { state: "set", value: "pat-other" },
    ]);
  });

  it("binds each ciphertext to its entry, so one swapped into another's place doesn't decrypt", async () => {
    const { filePath } = await vaultPath();
    const github: SecretKey = {
      pluginId: "github",
      connectionId: "gh_1",
      fieldId: "token",
    };
    await new FileSecretVault({ filePath, cipher: fakeCipher("a") }).write([
      { ...token, value: TOKEN },
      { ...github, value: "ghp-other-plugin" },
    ]);
    const file = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: { ciphertext: string }[];
    };
    const [first, second] = file.entries;
    [first!.ciphertext, second!.ciphertext] = [
      second!.ciphertext,
      first!.ciphertext,
    ];
    await writeFile(filePath, JSON.stringify(file));

    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await expect(vault.read([token, github])).resolves.toEqual([
      { state: "unreadable" },
      { state: "unreadable" },
    ]);
  });

  it("checks the file it just saved, not what it holds in memory", async () => {
    const { filePath } = await vaultPath();
    const vault = new FileSecretVault({ filePath, cipher: fakeCipher("a") });
    await vault.write([{ ...token, value: TOKEN }]);
    const earlier = await readFile(filePath, "utf8");
    // The disk gives back the earlier file: the new secret isn't in it.
    fileReads.hook = (read) =>
      read === filePath ? Promise.resolve(earlier) : undefined;

    await expect(vault.write([{ ...pin, value: "1234" }])).rejects.toThrow(
      "didn't keep",
    );
  });

  it("keeps using the entries it can decrypt when the check fails, and never replaces that check", async () => {
    const { filePath } = await vaultPath();
    const checkOf = async () =>
      (JSON.parse(await readFile(filePath, "utf8")) as { check: string }).check;
    // The release build's vault, under its key.
    await new FileSecretVault({
      filePath,
      cipher: fakeCipher("release"),
    }).write([{ ...token, value: TOKEN }]);

    // A development build on the same folder holds another key. Nothing
    // decrypts, so its first secret starts over with a check of its own.
    const dev = new FileSecretVault({ filePath, cipher: fakeCipher("dev") });
    await expect(dev.open()).resolves.toMatchObject({
      status: { state: "unreadable" },
    });
    await dev.write([{ ...pin, value: "dev-pin" }]);
    const devCheck = await checkOf();

    // The release build's check fails now, but its entries still decrypt.
    const release = new FileSecretVault({
      filePath,
      cipher: fakeCipher("release"),
    });
    await expect(release.open()).resolves.toMatchObject({
      status: { state: "available" },
    });
    await expect(release.read([token, pin])).resolves.toEqual([
      { state: "set", value: TOKEN },
      { state: "unreadable" },
    ]);
    await release.write([{ ...token, value: "pat-new" }]);
    expect(await checkOf()).toBe(devCheck);

    // A cipher holding both keys reads both, whatever the check says.
    const both = new FileSecretVault({
      filePath,
      cipher: fakeCipher("release", { alsoDecrypts: ["dev"] }),
    });
    await expect(both.read([token, pin])).resolves.toEqual([
      { state: "set", value: "pat-new" },
      { state: "set", value: "dev-pin" },
    ]);
  });
});
