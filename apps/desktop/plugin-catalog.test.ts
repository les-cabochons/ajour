import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const { CATALOG_URL, createPluginCatalogService } =
  require("./electron/plugin-catalog.cjs") as {
    CATALOG_URL: string;
    createPluginCatalogService(options: {
      cacheDirectory: string;
      fetchImpl: typeof fetch;
      now?: () => Date;
    }): {
      refresh(options?: { unit?: unknown }): Promise<{
        entries: Array<{ id: string; images?: { thumbnailDataUrl?: string } }>;
        source: "network" | "cache";
        warning?: string;
        skippedPluginIds?: string[];
      }>;
      downloadPluginArchive(pluginId: string): Promise<{
        archiveBytes: Buffer;
        archiveFilename: string;
      }>;
    };
  };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ajour-plugin-catalog-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

const catalogYaml = `schemaVersion: 2
entries:
  - plugins/azure_devops/plugin.yaml
`;

const pluginYaml = `schemaVersion: 2
id: azure_devops
title: Azure DevOps
description: Sync Azure DevOps work items into Ajour's local backlog.
author:
  name: Alex Trépanier
  url: https://github.com/alextrepa
license:
  name: MIT License
  spdxId: MIT
  url: https://github.com/les-cabochons/ajc-azure-devops/blob/main/LICENSE
website: https://github.com/les-cabochons/ajc-azure-devops#readme
repository:
  provider: github
  slug: les-cabochons/ajc-azure-devops
  url: https://github.com/les-cabochons/ajc-azure-devops
status: available
compatibility:
  pluginApiVersion: 2
capabilities:
  - connector
features:
  - work-item-sync
install:
  method: github-release
  allowPrereleases: true
  assetPattern: '^azure_devops-[0-9A-Za-z.+-]+\\.ajour-connector$'
images:
  thumbnail: thumbnail.png
tags:
  - project-management
`;

const definitionUrl = new URL(
  "plugins/azure_devops/plugin.yaml",
  CATALOG_URL,
).toString();
const imageUrl = new URL(
  "plugins/azure_devops/thumbnail.png",
  CATALOG_URL,
).toString();

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe("desktop plugin catalog", () => {
  it("caches artwork and conditionally checks it again on refresh", async () => {
    const cacheDirectory = await tempDirectory();
    let refreshNumber = 0;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (refreshNumber === 1) {
          expect(init?.headers).toMatchObject({
            "If-None-Match": expect.any(String),
          });
          if (url === imageUrl) {
            return response(Buffer.from("updated-image"), {
              status: 200,
              headers: { "content-type": "image/png", etag: '"image-2"' },
            });
          }
          return response(null, { status: 304 });
        }
        if (url === CATALOG_URL) {
          return response(catalogYaml, {
            status: 200,
            headers: { etag: '"catalog-1"' },
          });
        }
        if (url === definitionUrl) {
          return response(pluginYaml, {
            status: 200,
            headers: { etag: '"plugin-1"' },
          });
        }
        if (url === imageUrl) {
          return response(Buffer.from("first-image"), {
            status: 200,
            headers: { "content-type": "image/png", etag: '"image-1"' },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    );
    const service = createPluginCatalogService({
      cacheDirectory,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-08-07T04:00:00.000Z"),
    });

    const first = await service.refresh();
    expect(first.entries[0]?.images?.thumbnailDataUrl).toContain(
      Buffer.from("first-image").toString("base64"),
    );

    refreshNumber = 1;
    const second = await service.refresh();
    expect(second.entries[0]?.images?.thumbnailDataUrl).toContain(
      Buffer.from("updated-image").toString("base64"),
    );
    expect(
      await readFile(
        path.join(cacheDirectory, "images", "azure_devops-thumbnail.png"),
        "utf8",
      ),
    ).toBe("updated-image");
  });

  it("uses cached metadata and artwork when a later launch is offline", async () => {
    const cacheDirectory = await tempDirectory();
    let offline = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (offline) throw new Error("offline");
      const url = String(input);
      if (url === CATALOG_URL) return response(catalogYaml);
      if (url === definitionUrl) return response(pluginYaml);
      if (url === imageUrl) {
        return response(Buffer.from("cached-image"), {
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createPluginCatalogService({
      cacheDirectory,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await service.refresh();
    offline = true;
    const cached = await service.refresh();

    expect(cached.source).toBe("cache");
    expect(cached.warning).toContain("Using cached");
    expect(cached.entries[0]?.images?.thumbnailDataUrl).toContain(
      Buffer.from("cached-image").toString("base64"),
    );
  });

  it("uses the built-in index snapshot when the first refresh is unavailable", async () => {
    const service = createPluginCatalogService({
      cacheDirectory: await tempDirectory(),
      fetchImpl: vi.fn(async () => {
        throw new Error("private index");
      }) as unknown as typeof fetch,
      now: () => new Date("2026-08-07T04:00:00.000Z"),
    });

    const catalog = await service.refresh();

    expect(catalog.source).toBe("cache");
    expect(catalog.warning).toContain("could not be refreshed");
    expect(catalog.entries.map((entry) => entry.id)).toEqual([
      "azure_devops",
      "github",
      "jira",
      "workday-agent",
      "workday-project-data",
    ]);
  });

  it.each(["connector", "codeHost", "calendar", "team", "agentTask"])(
    "selects and bounds the newest matching GitHub release asset for %s",
    async (capability) => {
      const cacheDirectory = await tempDirectory();
      const downloadUrl =
        "https://github.com/les-cabochons/ajc-azure-devops/releases/download/v1.2.3/azure_devops-1.2.3.ajour-connector";
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === CATALOG_URL) return response(catalogYaml);
        if (url === definitionUrl)
          return response(
            pluginYaml.replace("  - connector", `  - ${capability}`),
          );
        if (url === imageUrl) {
          return response(Buffer.from("image"), {
            headers: { "content-type": "image/png" },
          });
        }
        if (url.includes("api.github.com/repos/")) {
          return response(
            JSON.stringify([
              {
                tag_name: "v1.2.3",
                draft: false,
                prerelease: true,
                assets: [
                  {
                    name: "azure_devops-1.2.3.ajour-connector",
                    browser_download_url: downloadUrl,
                  },
                ],
              },
            ]),
          );
        }
        if (url === downloadUrl) return response(Buffer.from("archive"));
        throw new Error(`Unexpected URL ${url}`);
      });
      const service = createPluginCatalogService({
        cacheDirectory,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await service.refresh();
      await expect(
        service.downloadPluginArchive("azure_devops"),
      ).resolves.toMatchObject({
        archiveFilename: "azure_devops-1.2.3.ajour-connector",
        archiveBytes: Buffer.from("archive"),
      });
    },
  );

  function serviceForPluginYaml(definition: string, index = catalogYaml) {
    return tempDirectory().then((cacheDirectory) =>
      createPluginCatalogService({
        cacheDirectory,
        fetchImpl: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url === CATALOG_URL) return response(index);
          if (url.endsWith("plugins/valid/plugin.yaml")) {
            return response(
              pluginYaml.replace("id: azure_devops", "id: valid"),
            );
          }
          if (url === definitionUrl) return response(definition);
          if (url === imageUrl || url.endsWith("plugins/valid/thumbnail.png")) {
            return response(Buffer.from("image"), {
              headers: { "content-type": "image/png" },
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch,
      }),
    );
  }

  it("refuses to download a plugin that is only a schema", async () => {
    const service = await serviceForPluginYaml(
      pluginYaml.replace(
        "capabilities:\n  - connector",
        "capabilities:\n  - schema",
      ),
    );

    await service.refresh();
    await expect(service.downloadPluginArchive("azure_devops")).rejects.toThrow(
      "cannot install packaged schema plugins",
    );
  });

  it("skips a catalog entry with an unknown capability and keeps the rest", async () => {
    const service = await serviceForPluginYaml(
      pluginYaml.replace(
        "capabilities:\n  - connector",
        "capabilities:\n  - work-item-sync",
      ),
      `${catalogYaml}  - plugins/valid/plugin.yaml\n`,
    );

    const catalog = await service.refresh();

    expect(catalog.entries.map((entry) => entry.id)).toEqual(["valid"]);
    // A skipped entry is not a cache fallback.
    expect(catalog.source).toBe("network");
    expect(catalog.warning).toBeUndefined();
    expect(catalog.skippedPluginIds).toEqual(["azure_devops"]);
  });

  function serviceWithReleases(releases: unknown[]) {
    const downloads: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === CATALOG_URL) return response(catalogYaml);
      if (url === definitionUrl) return response(pluginYaml);
      if (url === imageUrl) {
        return response(Buffer.from("image"), {
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("api.github.com/repos/")) {
        return response(JSON.stringify(releases));
      }
      if (
        url.startsWith(
          "https://github.com/les-cabochons/ajc-azure-devops/releases/download/",
        )
      ) {
        downloads.push(url);
        return response(Buffer.from("archive"));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    return tempDirectory().then((cacheDirectory) => ({
      downloads,
      service: createPluginCatalogService({
        cacheDirectory,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    }));
  }

  function release(
    version: string,
    options: { prerelease?: boolean; draft?: boolean; assets?: number } = {},
  ) {
    const name = `azure_devops-${version}.ajour-connector`;
    return {
      tag_name: `v${version}`,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? true,
      assets: Array.from({ length: options.assets ?? 1 }, () => ({
        name,
        browser_download_url: `https://github.com/les-cabochons/ajc-azure-devops/releases/download/v${version}/${name}`,
      })),
    };
  }

  it("downloads the highest version when GitHub lists an older build first", async () => {
    const { service } = await serviceWithReleases([
      release("1.0.0-main.9.aaaaaaa"),
      release("1.0.0-main.10.bbbbbbb"),
      release("1.0.0-main.2.ccccccc"),
    ]);

    await service.refresh();
    await expect(
      service.downloadPluginArchive("azure_devops"),
    ).resolves.toMatchObject({
      archiveFilename: "azure_devops-1.0.0-main.10.bbbbbbb.ajour-connector",
    });
  });

  it("prefers a stable release over prereleases of the same version and skips drafts", async () => {
    const { service } = await serviceWithReleases([
      release("1.1.0", { draft: true }),
      release("1.0.0-main.10.bbbbbbb"),
      release("1.0.0", { prerelease: false }),
    ]);

    await service.refresh();
    await expect(
      service.downloadPluginArchive("azure_devops"),
    ).resolves.toMatchObject({
      archiveFilename: "azure_devops-1.0.0.ajour-connector",
    });
  });

  it("ignores an older release with ambiguous assets but refuses an ambiguous newest one", async () => {
    const olderAmbiguous = await serviceWithReleases([
      release("1.0.0-main.1.aaaaaaa", { assets: 2 }),
      release("1.0.0-main.2.bbbbbbb"),
    ]);
    await olderAmbiguous.service.refresh();
    await expect(
      olderAmbiguous.service.downloadPluginArchive("azure_devops"),
    ).resolves.toMatchObject({
      archiveFilename: "azure_devops-1.0.0-main.2.bbbbbbb.ajour-connector",
    });

    const newestAmbiguous = await serviceWithReleases([
      release("1.0.0-main.3.ccccccc", { assets: 2 }),
      release("1.0.0-main.2.bbbbbbb"),
    ]);
    await newestAmbiguous.service.refresh();
    await expect(
      newestAmbiguous.service.downloadPluginArchive("azure_devops"),
    ).rejects.toThrow("multiple matching plugin assets");
  });
});

describe("the catalog.refresh event", () => {
  /** Runs one refresh as the main process does, and returns its event. */
  async function refreshEvent(service: {
    refresh(options?: { unit?: unknown }): Promise<unknown>;
  }) {
    const { events, recorded } = recordingEvents();
    await events.run(
      "catalog.refresh",
      { kind: "job", trigger: "boot" },
      (unit) => service.refresh({ unit }),
    );
    return recorded[0]!;
  }

  function indexFetch(handle: (url: string, init?: RequestInit) => Response) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      handle(String(input), init),
    ) as unknown as typeof fetch;
  }

  const fresh = (url: string) => {
    if (url === CATALOG_URL) {
      return response(catalogYaml, { headers: { etag: '"catalog-1"' } });
    }
    if (url === definitionUrl) {
      return response(pluginYaml, { headers: { etag: '"plugin-1"' } });
    }
    if (url === imageUrl) {
      return response(Buffer.from("image"), {
        headers: { "content-type": "image/png", etag: '"image-1"' },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  it("records what came from the network", async () => {
    const service = createPluginCatalogService({
      cacheDirectory: await tempDirectory(),
      fetchImpl: indexFetch(fresh),
    });

    const event = await refreshEvent(service);

    expect(event).toMatchObject({
      name: "catalog.refresh",
      outcome: "ok",
      catalog: {
        source: "network",
        status: 200,
        revalidated: false,
        entry_count: 1,
        definitions_fetched: 1,
        definitions_revalidated: 0,
        definitions_failed: 0,
        images_fetched: 1,
        images_revalidated: 0,
        images_failed: 0,
        bytes: catalogYaml.length + Buffer.byteLength(pluginYaml) + 5,
      },
    });
  });

  it("records what a conditional refresh revalidated", async () => {
    const cacheDirectory = await tempDirectory();
    let revalidate = false;
    const service = createPluginCatalogService({
      cacheDirectory,
      fetchImpl: indexFetch((url) =>
        revalidate ? response(null, { status: 304 }) : fresh(url),
      ),
    });
    await service.refresh();
    revalidate = true;

    const event = await refreshEvent(service);

    expect(event).toMatchObject({
      outcome: "ok",
      catalog: {
        source: "network",
        status: 304,
        revalidated: true,
        definitions_revalidated: 1,
        images_revalidated: 1,
        bytes: 0,
      },
    });
  });

  it("records a refresh that fell back to the cache", async () => {
    const cacheDirectory = await tempDirectory();
    let offline = false;
    const service = createPluginCatalogService({
      cacheDirectory,
      fetchImpl: indexFetch((url) => {
        if (offline) throw new Error("offline");
        return fresh(url);
      }),
    });
    await service.refresh();
    offline = true;

    const event = await refreshEvent(service);

    expect(event).toMatchObject({
      outcome: "ok",
      catalog: { source: "cache", definitions_failed: 1, images_failed: 1 },
    });
    expect((event.catalog as { status?: number }).status).toBeUndefined();
  });

  // The refresh never rejects, so its outcome comes from its result.
  it("records a refresh that kept the built-in snapshot as a failure", async () => {
    const service = createPluginCatalogService({
      cacheDirectory: await tempDirectory(),
      fetchImpl: indexFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });

    const event = await refreshEvent(service);

    expect(event).toMatchObject({
      outcome: "error",
      error: { type: "TypeError", message: "fetch failed" },
      catalog: { source: "built_in", entry_count: 5 },
    });
  });

  it("records skipped entries without printing them", async () => {
    const warn = vi.spyOn(console, "warn");
    const service = await serviceForSkippedEntry();

    const event = await refreshEvent(service);

    expect(event).toMatchObject({
      outcome: "ok",
      catalog: { skipped_plugin_ids: ["azure_devops"], entry_count: 1 },
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  async function serviceForSkippedEntry() {
    return createPluginCatalogService({
      cacheDirectory: await tempDirectory(),
      fetchImpl: indexFetch((url) => {
        if (url === CATALOG_URL) {
          return response(`${catalogYaml}  - plugins/valid/plugin.yaml\n`);
        }
        if (url.endsWith("plugins/valid/plugin.yaml")) {
          return response(pluginYaml.replace("id: azure_devops", "id: valid"));
        }
        if (url === definitionUrl) {
          return response(
            pluginYaml.replace(
              "capabilities:\n  - connector",
              "capabilities:\n  - work-item-sync",
            ),
          );
        }
        return response(Buffer.from("image"), {
          headers: { "content-type": "image/png" },
        });
      }),
    });
  }
});
