import { describe, expect, it } from "vitest";
import type { PluginCatalogEntry, PluginOrigin } from "@ajour/shared";
import {
  canInstallCatalogPlugin,
  catalogOffersUpdate,
  isEntrySigned,
} from "./plugin-catalog-ui";

const OFFICIAL = "https://github.com/les-cabochons/ajour-plugins";

function entry(
  capabilities: PluginCatalogEntry["capabilities"],
  overrides: Partial<PluginCatalogEntry> = {},
): PluginCatalogEntry {
  return {
    id: "sample",
    title: "Sample",
    description: "Sample plugin.",
    version: "1.2.0",
    author: { name: "Ajour", url: "https://github.com/les-cabochons" },
    license: { name: "MIT License", spdxId: "MIT" },
    website: "https://docs.ajour.day",
    repository: { slug: "les-cabochons/ajour-plugins", url: OFFICIAL },
    source: {
      url: OFFICIAL,
      name: "Ajour official plugins",
      official: true,
      signed: true,
      keyFingerprint: "3f2a 9c1d 77e0 b4a2",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities,
    features: ["sample"],
    install: { method: "source" },
    tags: ["sample"],
    ...overrides,
  };
}

function origin(overrides: Partial<PluginOrigin> = {}): PluginOrigin {
  return {
    kind: "source",
    signed: true,
    sourceUrl: OFFICIAL,
    installedAt: "2026-10-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("canInstallCatalogPlugin", () => {
  it.each([["connector"], ["codeHost"], ["calendar"], ["team"], ["agentTask"]])(
    "allows downloading a packaged %s plugin",
    (capability) => {
      expect(
        canInstallCatalogPlugin(
          entry([capability as PluginCatalogEntry["capabilities"][number]]),
        ),
      ).toBe(true);
    },
  );

  it("leaves a schema-only plugin to the built-in shapes for now", () => {
    expect(canInstallCatalogPlugin(entry(["schema"]))).toBe(false);
  });
});

describe("catalogOffersUpdate", () => {
  const listed = entry(["connector"]);

  it("offers a newer version from the source the plugin came from", () => {
    expect(
      catalogOffersUpdate(listed, { version: "1.1.0", origin: origin() }),
    ).toBe(true);
    expect(
      catalogOffersUpdate(listed, { version: "1.2.0", origin: origin() }),
    ).toBe(false);
    expect(
      catalogOffersUpdate(listed, { version: "1.3.0", origin: origin() }),
    ).toBe(false);
  });

  it("replaces a plugin Ajour cannot run with a compatible package", () => {
    expect(
      catalogOffersUpdate(listed, {
        version: "1.2.0",
        unavailableReason: "Built for plugin API 2.",
      }),
    ).toBe(true);
  });

  it("never updates a plugin from another source, or from a file install", () => {
    expect(
      catalogOffersUpdate(listed, {
        version: "1.0.0",
        origin: origin({ sourceUrl: "https://codeberg.org/alice/plugins" }),
      }),
    ).toBe(false);
    // Installed before Ajour kept origins: the listing it matches updates it.
    expect(catalogOffersUpdate(listed, { version: "1.0.0" })).toBe(true);
    expect(
      catalogOffersUpdate(entry(["connector"], { install: undefined }), {
        version: "1.0.0",
      }),
    ).toBe(false);
  });

  it("skips a package built for another plugin API", () => {
    expect(
      catalogOffersUpdate(
        entry(["connector"], { compatibility: { pluginApiVersion: 4 } }),
        { version: "1.0.0" },
      ),
    ).toBe(false);
  });
});

describe("isEntrySigned", () => {
  it("trusts an installed plugin's origin over its listing", () => {
    expect(isEntrySigned(entry(["connector"]))).toBe(true);
    expect(
      isEntrySigned(entry(["connector"]), {
        origin: origin({ kind: "file", signed: false, sourceUrl: undefined }),
      }),
    ).toBe(false);
    expect(isEntrySigned(entry(["connector"]), {})).toBe(false);
    expect(
      isEntrySigned(
        entry(["connector"], {
          source: {
            url: OFFICIAL,
            name: "Ajour",
            official: true,
            signed: false,
          },
        }),
      ),
    ).toBe(false);
  });
});
