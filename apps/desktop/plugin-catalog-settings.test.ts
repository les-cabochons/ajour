import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface PluginSourceSetting {
  url: string;
  hostKind?: string;
  publicKey?: string;
}
interface Settings {
  refreshMinutes: number;
  allowUnsignedInstalls: boolean;
  sources: PluginSourceSetting[];
}

const require = createRequire(import.meta.url);
const {
  loadPluginCatalogSettings,
  normalizePluginCatalogSettings,
  savePluginCatalogSettings,
} = require("./electron/plugin-catalog-settings.cjs") as {
  loadPluginCatalogSettings(file: string): Settings;
  normalizePluginCatalogSettings(value: unknown): Settings;
  savePluginCatalogSettings(file: string, value: unknown): Settings;
};

const OFFICIAL = {
  url: "https://github.com/les-cabochons/ajour-plugins",
  hostKind: "github",
};
const KEY = Buffer.alloc(32, 7).toString("base64");

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("plugin catalog settings", () => {
  it("defaults to a fifteen-minute refresh, the official source and no unsigned installs", () => {
    expect(normalizePluginCatalogSettings(undefined)).toEqual({
      refreshMinutes: 15,
      allowUnsignedInstalls: false,
      sources: [OFFICIAL],
    });
    expect(
      normalizePluginCatalogSettings({ refreshMinutes: 60 }),
    ).toMatchObject({ refreshMinutes: 60, sources: [OFFICIAL] });
    expect(normalizePluginCatalogSettings({ refreshMinutes: 7 })).toMatchObject(
      { refreshMinutes: 15 },
    );
  });

  it("keeps a removed official source removed, and drops invalid sources", () => {
    expect(normalizePluginCatalogSettings({ sources: [] }).sources).toEqual([]);
    expect(
      normalizePluginCatalogSettings({
        sources: [
          {
            url: "https://codeberg.org/alice/plugins/",
            hostKind: "gitea",
            publicKey: KEY,
          },
          { url: "https://codeberg.org/alice/plugins", hostKind: "gitea" },
          { url: "http://example.com/a/b" },
          {
            url: "https://github.com/bob/plugins",
            hostKind: "svn",
            publicKey: "short",
          },
          "https://github.com/carol/plugins",
        ],
      }).sources,
    ).toEqual([
      {
        url: "https://codeberg.org/alice/plugins",
        hostKind: "gitea",
        publicKey: KEY,
      },
      { url: "https://github.com/bob/plugins" },
    ]);
  });

  it("persists the launch-only refresh, unsigned installs and the sources", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-catalog-settings-"),
    );
    tempDirectories.push(directory);
    const file = path.join(directory, "settings.json");
    const saved = {
      refreshMinutes: 0,
      allowUnsignedInstalls: true,
      sources: [
        OFFICIAL,
        { url: "https://gitlab.com/team/plugins", hostKind: "gitlab" },
      ],
    };

    expect(savePluginCatalogSettings(file, saved)).toEqual(saved);
    expect(loadPluginCatalogSettings(file)).toEqual(saved);
  });
});
