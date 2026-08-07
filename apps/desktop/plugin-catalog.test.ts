import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CATALOG_URL, createPluginCatalogService } = require(
  "./electron/plugin-catalog.cjs",
) as {
  CATALOG_URL: string;
  createPluginCatalogService(options: {
    cacheDirectory: string;
    fetchImpl: typeof fetch;
    now?: () => Date;
  }): {
    refresh(): Promise<{
      entries: Array<{ id: string; images?: { thumbnailDataUrl?: string } }>;
      source: "network" | "cache";
      warning?: string;
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
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-catalog-"));
  temporaryDirectories.push(directory);
  return directory;
}

const catalogYaml = `schemaVersion: 1
entries:
  - plugins/azure_devops/plugin.yaml
`;

const pluginYaml = `schemaVersion: 1
id: azure_devops
type: connector
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
  pluginApiVersion: 1
capabilities:
  - work-item-sync
install:
  method: github-release
  allowPrereleases: true
  assetPattern: '^azure_devops-[0-9A-Za-z.+-]+\\.harday-connector$'
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
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (refreshNumber === 1) {
        expect(init?.headers).toMatchObject({ "If-None-Match": expect.any(String) });
        if (url === imageUrl) {
          return response(Buffer.from("updated-image"), {
            status: 200,
            headers: { "content-type": "image/png", etag: '"image-2"' },
          });
        }
        return response(null, { status: 304 });
      }
      if (url === CATALOG_URL) {
        return response(catalogYaml, { status: 200, headers: { etag: '"catalog-1"' } });
      }
      if (url === definitionUrl) {
        return response(pluginYaml, { status: 200, headers: { etag: '"plugin-1"' } });
      }
      if (url === imageUrl) {
        return response(Buffer.from("first-image"), {
          status: 200,
          headers: { "content-type": "image/png", etag: '"image-1"' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
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
      "jira",
      "workday-project-data",
    ]);
  });

  it("selects and bounds the newest matching GitHub release asset", async () => {
    const cacheDirectory = await tempDirectory();
    const downloadUrl =
      "https://github.com/les-cabochons/ajc-azure-devops/releases/download/v1.2.3/azure_devops-1.2.3.harday-connector";
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
        return response(
          JSON.stringify([
            {
              tag_name: "v1.2.3",
              draft: false,
              prerelease: true,
              assets: [
                {
                  name: "azure_devops-1.2.3.harday-connector",
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
    await expect(service.downloadPluginArchive("azure_devops")).resolves.toMatchObject({
      archiveFilename: "azure_devops-1.2.3.harday-connector",
      archiveBytes: Buffer.from("archive"),
    });
  });
});
