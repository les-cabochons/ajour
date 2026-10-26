import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginCatalogResponseSchema } from "../../packages/shared/plugin-catalog.ts";
import { recordingEvents } from "./recording-events.ts";

interface Source {
  url: string;
  hostKind?: string;
  publicKey?: string;
}

const require = createRequire(import.meta.url);
const { createPluginCatalogService } =
  require("./electron/plugin-catalog.cjs") as {
    createPluginCatalogService(options: {
      cacheDirectory: string;
      fetchImpl: typeof fetch;
      getSources: () => Source[];
      onHostKind?: (url: string, hostKind: string) => void;
      officialKeys?: string[];
      now?: () => Date;
    }): {
      refresh(options?: { unit?: unknown }): Promise<Record<string, any>>;
      getCurrentCatalog(): Record<string, any>;
      inspectSource(url: string): Promise<Record<string, any>>;
      downloadPluginArchive(
        pluginId: string,
        sourceUrl?: string,
      ): Promise<{
        archiveBytes: Buffer;
        archiveFilename: string;
        signed: boolean;
        origin: Record<string, unknown>;
      }>;
    };
  };

const OFFICIAL = "https://github.com/les-cabochons/ajour-plugins";
const ALICE = "https://codeberg.org/alice/plugins";
const COMMIT = "888d80ba3fa8d53889011f03a5ab7848b0e06328";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-catalog-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    publicKey: raw.toString("base64"),
    sign: (bytes: Uint8Array) =>
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          algorithm: "ed25519",
          publicKey: raw.toString("base64"),
          signature: sign(null, bytes, privateKey).toString("base64"),
        }),
      ),
  };
}

function pluginFiles(id: string, version: string, capabilities: object) {
  return {
    "plugin.json": Buffer.from(
      JSON.stringify({
        id,
        version,
        apiVersion: 3,
        displayName: id,
        iconSvg: "<svg/>",
        entrypoint: "src/plugin.ts",
        capabilities,
        connectionFields: [],
      }),
    ),
    "package.json": Buffer.from('{"type":"module"}'),
    "src/plugin.ts": Buffer.from(`export const id = "${id}";\n`),
  };
}

const thumbnail = Buffer.from("PNG image bytes");

/** One plugin entry of an ajour.json, with the hashes of `files`. */
function listedPlugin(
  id: string,
  files: Record<string, Buffer>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: id === "jira" ? "Jira" : id,
    description: `${id} plugin.`,
    version: "1.0.0",
    pluginApiVersion: 3,
    capabilities: ["connector"],
    features: ["work-item-sync"],
    tags: ["test"],
    author: { name: "Alex", url: "https://github.com/alextrepa" },
    license: { name: "MIT License", spdxId: "MIT" },
    status: "available",
    commit: COMMIT,
    path: `plugins/${id}`,
    files: Object.entries(files).map(([filePath, bytes]) => ({
      path: filePath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    })),
    ...overrides,
  };
}

/**
 * A fake world: the official source on GitHub, signed, and Alice's unsigned
 * source on Codeberg. `offline` makes every request fail.
 */
function world() {
  const official = signer();
  const jiraFiles = pluginFiles("jira", "1.0.0", { connector: {} });
  const schemaFiles = pluginFiles("shape", "1.0.0", { projectDataShape: {} });
  const weatherFiles = pluginFiles("weather", "1.0.0", { calendar: {} });
  const officialManifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      name: "Ajour official plugins",
      plugins: [
        listedPlugin("jira", jiraFiles, {
          images: {
            thumbnail: {
              path: "thumbnail.png",
              sha256: sha256(thumbnail),
              size: thumbnail.byteLength,
            },
          },
        }),
        listedPlugin("shape", schemaFiles, { capabilities: ["schema"] }),
        listedPlugin("future", jiraFiles, { capabilities: ["teleport"] }),
      ],
    }),
  );
  const aliceManifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      name: "Alice's plugins",
      plugins: [
        listedPlugin("weather", weatherFiles, { capabilities: ["calendar"] }),
        listedPlugin("jira", jiraFiles, { name: "Alice's Jira" }),
      ],
    }),
  );
  const raw = "https://raw.githubusercontent.com/les-cabochons/ajour-plugins";
  const served: Record<string, Buffer | object> = {
    [`${raw}/HEAD/ajour.json`]: officialManifest,
    [`${raw}/HEAD/ajour.json.sig`]: official.sign(officialManifest),
    [`${raw}/${COMMIT}/plugins/jira/thumbnail.png`]: thumbnail,
    "https://codeberg.org/api/v1/repos/alice/plugins": {
      default_branch: "main",
    },
    [`${ALICE}/raw/branch/main/ajour.json`]: aliceManifest,
  };
  for (const [filePath, bytes] of Object.entries(jiraFiles)) {
    served[`${raw}/${COMMIT}/plugins/jira/${filePath}`] = bytes;
  }
  for (const [filePath, bytes] of Object.entries(weatherFiles)) {
    served[`${ALICE}/raw/commit/${COMMIT}/plugins/weather/${filePath}`] = bytes;
  }
  const state = { offline: false };
  const requests: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (state.offline) throw new TypeError("fetch failed");
    const body = served[url];
    if (body === undefined) return new Response("", { status: 404 });
    return new Response(Buffer.isBuffer(body) ? body : JSON.stringify(body), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return {
    official,
    served,
    raw,
    state,
    requests,
    fetchImpl,
    officialManifest,
  };
}

async function serviceIn(
  fake: ReturnType<typeof world>,
  sources: Source[],
  options: { officialKeys?: string[]; cacheDirectory?: string } = {},
) {
  return createPluginCatalogService({
    cacheDirectory: options.cacheDirectory ?? (await tempDirectory()),
    fetchImpl: fake.fetchImpl,
    getSources: () => sources,
    officialKeys: options.officialKeys ?? [fake.official.publicKey],
  });
}

describe("plugin catalog from plugin sources", () => {
  it("lists every source's plugins, with where they come from and whether they are signed", async () => {
    const fake = world();
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
      { url: ALICE },
    ]);

    const catalog = pluginCatalogResponseSchema.parse(await service.refresh());

    expect(catalog.source).toBe("network");
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "jira",
      "shape",
      "weather",
    ]);
    expect(catalog.entries[0]).toMatchObject({
      title: "Jira",
      version: "1.0.0",
      repository: { slug: "les-cabochons/ajour-plugins", url: OFFICIAL },
      source: {
        url: OFFICIAL,
        name: "Ajour official plugins",
        official: true,
        signed: true,
        keyFingerprint: expect.stringMatching(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/),
      },
      install: { method: "source" },
      images: {
        thumbnailDataUrl: `data:image/png;base64,${thumbnail.toString("base64")}`,
      },
    });
    expect(catalog.entries[2]).toMatchObject({
      id: "weather",
      source: { url: ALICE, official: false, signed: false },
    });
    // A plugin this Ajour can't read, and an id an earlier source already lists.
    expect(catalog.skippedPluginIds).toEqual(["future", "jira"]);
    expect(catalog.sources).toEqual([
      expect.objectContaining({
        url: OFFICIAL,
        state: "signed",
        name: "Ajour official plugins",
        pluginCount: 2,
      }),
      expect.objectContaining({
        url: ALICE,
        state: "unsigned",
        hostKind: "gitea",
        pluginCount: 1,
      }),
    ]);
  });

  it("asks before trusting a third-party key, and hides a source whose key changed", async () => {
    const fake = world();
    const alice = signer();
    const aliceManifest = fake.served[
      `${ALICE}/raw/branch/main/ajour.json`
    ] as Buffer;
    fake.served[`${ALICE}/raw/branch/main/ajour.json.sig`] =
      alice.sign(aliceManifest);

    const unapproved = await serviceIn(fake, [
      { url: ALICE, hostKind: "gitea" },
    ]);
    const first = await unapproved.refresh();
    expect(first.sources[0]).toMatchObject({ state: "untrusted_key" });
    expect(first.entries[0].source).toMatchObject({ signed: false });

    const approved = await serviceIn(fake, [
      { url: ALICE, hostKind: "gitea", publicKey: alice.publicKey },
    ]);
    expect((await approved.refresh()).entries[0].source.signed).toBe(true);

    const changed = await serviceIn(fake, [
      { url: ALICE, hostKind: "gitea", publicKey: signer().publicKey },
    ]);
    const blocked = await changed.refresh();
    expect(blocked.entries).toEqual([]);
    expect(blocked.sources[0]).toMatchObject({
      state: "key_changed",
      pluginCount: 0,
      approvedKeyFingerprint: expect.any(String),
      message: expect.stringContaining("different key"),
    });
  });

  it("uses a source's saved listing while it is unreachable, checked again", async () => {
    const fake = world();
    const cacheDirectory = await tempDirectory();
    const service = await serviceIn(
      fake,
      [{ url: OFFICIAL, hostKind: "github" }],
      { cacheDirectory },
    );
    await service.refresh();
    fake.state.offline = true;

    const offline = await service.refresh();

    expect(offline.source).toBe("cache");
    expect(offline.warning).toContain("Using the saved listing");
    expect(offline.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "jira",
      "shape",
    ]);
    expect(offline.entries[0].source.signed).toBe(true);
  });

  it("keeps the built-in list, as a failed refresh, when no source was ever read", async () => {
    const fake = world();
    fake.state.offline = true;
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
    ]);
    const { events, recorded } = recordingEvents();

    const catalog = await events.run(
      "catalog.refresh",
      { kind: "job", trigger: "boot" },
      (unit) => service.refresh({ unit }),
    );

    expect(catalog.entries.map((entry: { id: string }) => entry.id)).toContain(
      "jira",
    );
    expect(catalog.warning).toContain("could not read the plugin sources");
    expect(catalog.sources).toMatchObject([
      { url: OFFICIAL, state: "unreachable" },
    ]);
    expect(recorded[0]).toMatchObject({
      outcome: "error",
      catalog: { source: "built_in", sources_total: 1, sources_unreachable: 1 },
    });
    expect(JSON.stringify(recorded[0])).not.toContain("github.com");
  });

  it("records what each refresh read, as counts only", async () => {
    const fake = world();
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
      { url: ALICE, hostKind: "gitea" },
    ]);
    const { events, recorded } = recordingEvents();

    await events.run(
      "catalog.refresh",
      { kind: "job", trigger: "boot" },
      (unit) => service.refresh({ unit }),
    );

    expect(recorded[0]).toMatchObject({
      outcome: "ok",
      catalog: {
        source: "network",
        entry_count: 3,
        sources_total: 2,
        sources_read: 2,
        sources_signed: 1,
        sources_unsigned: 1,
        sources_blocked: 0,
        images_fetched: 1,
        skipped_plugin_ids: ["future", "jira"],
      },
    });
    expect(JSON.stringify(recorded[0])).not.toMatch(/codeberg|github\.com/);
  });

  it("downloads a plugin at its commit and says where it came from", async () => {
    const fake = world();
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
    ]);
    await service.refresh();

    const downloaded = await service.downloadPluginArchive("jira", OFFICIAL);

    expect(downloaded).toMatchObject({
      archiveFilename: "jira-1.0.0.ajour-connector",
      signed: true,
      origin: {
        kind: "source",
        signed: true,
        sourceUrl: OFFICIAL,
        sourceName: "Ajour official plugins",
        official: true,
        commit: COMMIT,
      },
    });
    expect(downloaded.archiveBytes.byteLength).toBeGreaterThan(0);
  });

  it("refuses a plugin whose files or manifest changed since its listing was signed", async () => {
    const fake = world();
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
    ]);
    await service.refresh();
    fake.served[`${fake.raw}/${COMMIT}/plugins/jira/src/plugin.ts`] =
      Buffer.from('export const id = "evil";\n');

    await expect(service.downloadPluginArchive("jira")).rejects.toThrow(
      "does not match the hash",
    );
  });

  it("refuses schema plugins and plugins no source lists", async () => {
    const fake = world();
    const service = await serviceIn(fake, [
      { url: OFFICIAL, hostKind: "github" },
    ]);
    await service.refresh();

    await expect(service.downloadPluginArchive("shape")).rejects.toMatchObject({
      code: "not_available",
    });
    await expect(
      service.downloadPluginArchive("missing"),
    ).rejects.toMatchObject({
      code: "not_available",
    });
  });

  it("reads a source before it is added, and refuses a signature that does not match", async () => {
    const fake = world();
    const alice = signer();
    const service = await serviceIn(fake, []);

    await expect(service.inspectSource(`${ALICE}.git`)).resolves.toMatchObject({
      url: ALICE,
      name: "Alice's plugins",
      official: false,
      hostKind: "gitea",
      signed: false,
      plugins: [
        { id: "weather", name: "weather", version: "1.0.0" },
        { id: "jira", name: "Alice's Jira", version: "1.0.0" },
      ],
      alreadyAdded: false,
    });

    fake.served[`${ALICE}/raw/branch/main/ajour.json.sig`] = alice.sign(
      Buffer.from("another listing"),
    );
    await expect(service.inspectSource(ALICE)).rejects.toThrow(
      "does not match its listing",
    );
  });
});
