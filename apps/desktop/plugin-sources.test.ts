import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPluginArchive } from "../api/src/plugin-package.ts";

const require = createRequire(import.meta.url);
const sources = require("./electron/plugin-sources.cjs") as {
  BLOCKED_TRUST_STATES: Set<string>;
  OFFICIAL_PLUGIN_SOURCE_URL: string;
  assessSourceTrust(input: {
    manifestBytes: Uint8Array;
    signatureBytes: Uint8Array | null;
    pinnedPublicKey?: string;
    official?: boolean;
    officialKeys?: string[];
  }): {
    state: string;
    signed: boolean;
    publicKey?: string;
    fingerprint?: string;
  };
  createPluginArchive(
    files: Array<{ path: string; bytes: Uint8Array }>,
  ): Buffer;
  createSourceReader(options: { fetchImpl: typeof fetch }): {
    detectHostKind(url: string): Promise<string>;
    readListing(source: { url: string; hostKind: string }): Promise<{
      manifestBytes: Buffer;
      signatureBytes: Buffer | null;
    }>;
    readPluginFiles(
      source: { url: string; hostKind: string },
      plugin: ReturnType<typeof sources.parseSourceManifest>["plugins"][number],
    ): Promise<Array<{ path: string; bytes: Buffer }>>;
  };
  keyFingerprint(publicKey: Uint8Array): string;
  normalizeSourceUrl(input: string): string;
  parseSourceManifest(bytes: Uint8Array): {
    name: string;
    plugins: Array<{
      id: string;
      name: string;
      version: string;
      commit?: string;
      path?: string;
      files?: Array<{ path: string; sha256: string; size: number }>;
    }>;
  };
  rawFileUrl(
    source: { url: string; hostKind: string },
    ref: string,
    filePath: string,
  ): string;
};

const COMMIT = "888d80ba3fa8d53889011f03a5ab7848b0e06328";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

const pluginFiles = {
  "plugin.json": Buffer.from(
    JSON.stringify({
      id: "weather",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Weather",
      iconSvg: "<svg/>",
      entrypoint: "src/plugin.ts",
      capabilities: { calendar: {} },
      connectionFields: [
        { id: "label", label: "Label", type: "text", required: true },
        { id: "tenantLabel", label: "Account", type: "text", required: true },
      ],
    }),
  ),
  "package.json": Buffer.from(JSON.stringify({ type: "module" })),
  "src/plugin.ts": Buffer.from(
    "export async function validateConnection() {}\n",
  ),
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    name: "Alice's plugins",
    plugins: [
      {
        id: "weather",
        name: "Weather",
        description: "Suggests rainy days off.",
        version: "1.0.0",
        pluginApiVersion: 3,
        capabilities: ["calendar"],
        features: ["calendar-events"],
        tags: ["weather"],
        author: { name: "Alice", url: "https://codeberg.org/alice" },
        license: { name: "MIT License", spdxId: "MIT" },
        status: "available",
        commit: COMMIT,
        path: "plugins/weather",
        files: Object.entries(pluginFiles).map(([filePath, bytes]) => ({
          path: filePath,
          sha256: sha256(bytes),
          size: bytes.byteLength,
        })),
        ...overrides,
      },
    ],
  };
}

function bytesOf(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    publicKey: raw.toString("base64"),
    raw,
    sign(bytes: Uint8Array) {
      return Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          algorithm: "ed25519",
          publicKey: raw.toString("base64"),
          signature: sign(null, bytes, privateKey).toString("base64"),
        }),
      );
    },
  };
}

describe("ajour.json", () => {
  it("reads a listing that follows the format", () => {
    const parsed = sources.parseSourceManifest(bytesOf(listing()));
    expect(parsed.name).toBe("Alice's plugins");
    expect(parsed.plugins[0]).toMatchObject({
      id: "weather",
      version: "1.0.0",
      commit: COMMIT,
      path: "plugins/weather",
    });
  });

  it.each([
    ["an unknown key", { homepage: "https://example.com" }, "unknown key"],
    [
      "a path that climbs out",
      { files: [{ path: "../secrets", sha256: "a".repeat(64), size: 1 }] },
      "relative path",
    ],
    ["an available plugin without files", { files: undefined }, "files"],
    [
      "a coming-soon plugin with files",
      { status: "coming-soon" },
      "must not list files",
    ],
    [
      "files without plugin.json",
      { files: [{ path: "src/plugin.ts", sha256: "a".repeat(64), size: 1 }] },
      "plugin.json",
    ],
    ["a short commit", { commit: "888d80b" }, "commit"],
    [
      "an HTTP author link",
      { author: { name: "A", url: "http://a.b" } },
      "HTTPS",
    ],
  ])("refuses %s", (_name, overrides, message) => {
    expect(() =>
      sources.parseSourceManifest(bytesOf(listing(overrides))),
    ).toThrow(message);
  });

  it("refuses a listing that names a plugin twice", () => {
    const doubled = listing();
    doubled.plugins.push(doubled.plugins[0]!);
    expect(() => sources.parseSourceManifest(bytesOf(doubled))).toThrow(
      "twice",
    );
  });
});

describe("signatures and trust", () => {
  const manifestBytes = bytesOf(listing());

  it("shows a key's fingerprint in four groups of four", () => {
    expect(sources.keyFingerprint(signer().raw)).toMatch(
      /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/u,
    );
  });

  it("asks before trusting a key it has not seen, then trusts only that key", () => {
    const alice = signer();
    const signatureBytes = alice.sign(manifestBytes);

    expect(
      sources.assessSourceTrust({ manifestBytes, signatureBytes }),
    ).toMatchObject({ state: "untrusted_key", signed: false });
    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes,
        pinnedPublicKey: alice.publicKey,
      }),
    ).toMatchObject({ state: "signed", signed: true });
    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes: signer().sign(manifestBytes),
        pinnedPublicKey: alice.publicKey,
      }),
    ).toMatchObject({ state: "key_changed", signed: false });
  });

  it("blocks a changed listing, and a pinned source that lost its signature", () => {
    const alice = signer();
    const tampered = Buffer.from(
      manifestBytes.toString().replace("1.0.0", "1.0.1"),
    );

    expect(
      sources.assessSourceTrust({
        manifestBytes: tampered,
        signatureBytes: alice.sign(manifestBytes),
        pinnedPublicKey: alice.publicKey,
      }),
    ).toMatchObject({ state: "bad_signature", signed: false });
    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes: null,
        pinnedPublicKey: alice.publicKey,
      }),
    ).toMatchObject({ state: "signature_missing" });
    expect(
      sources.assessSourceTrust({ manifestBytes, signatureBytes: null }),
    ).toMatchObject({ state: "unsigned", signed: false });
    for (const state of ["bad_signature", "signature_missing", "key_changed"]) {
      expect(sources.BLOCKED_TRUST_STATES.has(state)).toBe(true);
    }
  });

  it("trusts the official source only with a built-in key once there is one", () => {
    const official = signer();
    const signatureBytes = official.sign(manifestBytes);

    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes,
        official: true,
        officialKeys: [official.publicKey],
      }),
    ).toMatchObject({ state: "signed", signed: true });
    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes: signer().sign(manifestBytes),
        official: true,
        officialKeys: [official.publicKey],
      }),
    ).toMatchObject({ state: "key_changed" });
    expect(
      sources.assessSourceTrust({
        manifestBytes,
        signatureBytes: null,
        official: true,
        officialKeys: [official.publicKey],
      }),
    ).toMatchObject({ state: "signature_missing" });
  });
});

describe("source addresses", () => {
  it.each([
    ["https://github.com/Alice/Plugins", "https://github.com/Alice/Plugins"],
    [
      "https://GitHub.com/alice/plugins.git",
      "https://github.com/alice/plugins",
    ],
    [
      "https://codeberg.org/alice/plugins/",
      "https://codeberg.org/alice/plugins",
    ],
    [
      " https://gitlab.example.com/group/sub/plugins ",
      "https://gitlab.example.com/group/sub/plugins",
    ],
  ])("reads %s as %s", (input, expected) => {
    expect(sources.normalizeSourceUrl(input)).toBe(expected);
  });

  it.each([
    "http://github.com/alice/plugins",
    "https://user:pass@github.com/alice/plugins",
    "https://github.com/alice/plugins?tab=readme",
    "https://github.com/alice",
    "github.com/alice/plugins",
  ])("refuses %s", (input) => {
    expect(() => sources.normalizeSourceUrl(input)).toThrow();
  });

  it("builds each host's raw file address", () => {
    expect(
      sources.rawFileUrl(
        { url: "https://github.com/alice/plugins", hostKind: "github" },
        COMMIT,
        "plugins/weather/plugin.json",
      ),
    ).toBe(
      `https://raw.githubusercontent.com/alice/plugins/${COMMIT}/plugins/weather/plugin.json`,
    );
    expect(
      sources.rawFileUrl(
        {
          url: "https://gitlab.example.com/group/sub/plugins",
          hostKind: "gitlab",
        },
        "main",
        "ajour.json",
      ),
    ).toBe(
      "https://gitlab.example.com/group/sub/plugins/-/raw/main/ajour.json",
    );
    expect(
      sources.rawFileUrl(
        { url: "https://codeberg.org/alice/plugins", hostKind: "gitea" },
        COMMIT,
        "plugins/weather/plugin.json",
      ),
    ).toBe(
      `https://codeberg.org/alice/plugins/raw/commit/${COMMIT}/plugins/weather/plugin.json`,
    );
    expect(
      sources.rawFileUrl(
        { url: "https://codeberg.org/alice/plugins", hostKind: "gitea" },
        "main",
        "ajour.json",
      ),
    ).toBe("https://codeberg.org/alice/plugins/raw/branch/main/ajour.json");
  });
});

/** A fake host that serves `files` (URL to bytes) and answers 404 otherwise. */
function fakeHost(files: Record<string, Uint8Array | object>) {
  const requests: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    const body = files[url];
    if (body === undefined) return new Response("", { status: 404 });
    return new Response(
      body instanceof Uint8Array ? body : JSON.stringify(body),
      { status: 200 },
    );
  });
  return {
    requests,
    reader: sources.createSourceReader({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe("reading a source", () => {
  const github = {
    url: "https://github.com/alice/plugins",
    hostKind: "github",
  };
  const raw = "https://raw.githubusercontent.com/alice/plugins";

  it("detects a self-hosted Gitea or GitLab, and refuses anything else", async () => {
    const gitea = fakeHost({
      "https://git.example.com/api/v1/version": { version: "1.22.0" },
    });
    await expect(
      gitea.reader.detectHostKind("https://git.example.com/alice/plugins"),
    ).resolves.toBe("gitea");

    const gitlab = fakeHost({
      "https://lab.example.com/api/v4/version": { version: "17.0" },
    });
    await expect(
      gitlab.reader.detectHostKind("https://lab.example.com/group/plugins"),
    ).resolves.toBe("gitlab");

    await expect(
      fakeHost({}).reader.detectHostKind("https://example.com/alice/plugins"),
    ).rejects.toThrow("GitHub, GitLab");
    await expect(
      fakeHost({}).reader.detectHostKind("https://github.com/alice/plugins"),
    ).resolves.toBe("github");
  });

  it("reads the listing from the default branch and treats a missing signature as unsigned", async () => {
    const manifestBytes = bytesOf(listing());
    const { reader } = fakeHost({ [`${raw}/HEAD/ajour.json`]: manifestBytes });

    await expect(reader.readListing(github)).resolves.toEqual({
      manifestBytes,
      signatureBytes: null,
    });
  });

  it("asks GitLab for the default branch before reading the listing", async () => {
    const manifestBytes = bytesOf(listing());
    const source = {
      url: "https://gitlab.com/group/plugins",
      hostKind: "gitlab",
    };
    const { reader, requests } = fakeHost({
      "https://gitlab.com/api/v4/projects/group%2Fplugins": {
        default_branch: "trunk",
      },
      "https://gitlab.com/group/plugins/-/raw/trunk/ajour.json": manifestBytes,
    });

    await expect(reader.readListing(source)).resolves.toMatchObject({
      manifestBytes,
    });
    expect(requests).toContain(
      "https://gitlab.com/group/plugins/-/raw/trunk/ajour.json.sig",
    );
  });

  it("downloads a plugin's files at its commit and checks every hash", async () => {
    const plugin = sources.parseSourceManifest(bytesOf(listing())).plugins[0]!;
    const served = Object.fromEntries(
      Object.entries(pluginFiles).map(([filePath, bytes]) => [
        `${raw}/${COMMIT}/plugins/weather/${filePath}`,
        bytes,
      ]),
    );

    const files = await fakeHost(served).reader.readPluginFiles(github, plugin);
    expect(files.map((file) => file.path)).toEqual([
      "plugin.json",
      "package.json",
      "src/plugin.ts",
    ]);

    served[`${raw}/${COMMIT}/plugins/weather/src/plugin.ts`] = Buffer.from(
      "export async function validateConnection() { steal(); }\n",
    );
    await expect(
      fakeHost(served).reader.readPluginFiles(github, plugin),
    ).rejects.toThrow("does not match the hash");
  });

  it("packs verified files into an archive the installer accepts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-source-archive-"));
    temporaryDirectories.push(root);
    const longPath = `src/${"nested/".repeat(15)}deep.ts`;
    const archive = sources.createPluginArchive([
      ...Object.entries(pluginFiles).map(([filePath, bytes]) => ({
        path: filePath,
        bytes,
      })),
      { path: longPath, bytes: Buffer.from("export const deep = 1;\n") },
    ]);

    const installed = await installPluginArchive({
      archiveBytes: archive,
      archiveFilename: "weather-1.0.0.ajour-connector",
      installRoot: path.join(root, "plugins"),
    });

    expect(installed.manifest).toMatchObject({
      id: "weather",
      version: "1.0.0",
    });
    await expect(
      readFile(path.join(installed.directory, "src", "plugin.ts"), "utf8"),
    ).resolves.toBe("export async function validateConnection() {}\n");
    await expect(
      readFile(path.join(installed.directory, longPath), "utf8"),
    ).resolves.toBe("export const deep = 1;\n");
  });
});
